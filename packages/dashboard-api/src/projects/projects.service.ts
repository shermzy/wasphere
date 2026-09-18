import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateProjectRouteDto, UpdateProjectRouteDto } from './dto/project-route.dto';
import { ProjectTargetsQueryDto } from './dto/project-targets-query.dto';
import { normalizeProjectRouteKey, slugifyProjectName } from './project-route-key';

type Principal = { userId: string; apiKeyId?: string };
type SessionStatus = { id: string; status?: string };
type ProjectWithTarget = Prisma.ProjectRouteGetPayload<{
  include: { conversation: { include: { contact: true } } };
}>;

type WaConfig = { waServerUrl: string; token: string };

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private async assertHumanMember(principal: Principal, workspaceId: string): Promise<void> {
    if (principal.apiKeyId) {
      throw new ForbiddenException('API keys can resolve and send routes but cannot manage projects');
    }
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');
  }

  private async waConfig(principal: Principal, workspaceId: string): Promise<WaConfig> {
    return this.workspaces.getDecryptedToken(principal.userId, workspaceId);
  }

  private async getJson(config: WaConfig, path: string): Promise<unknown> {
    let response: globalThis.Response;
    try {
      response = await fetch(`${config.waServerUrl.replace(/\/+$/, '')}${path}`, {
        headers: { 'X-Api-Token': config.token, Accept: 'application/json' },
      });
    } catch {
      throw new ServiceUnavailableException('WA Server is unreachable.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('WA Server could not provide the WhatsApp directory.');
    }
    return response.json().catch(() => null);
  }

  private async loadSessionStatuses(config: WaConfig): Promise<{ loaded: boolean; statuses: Map<string, string> }> {
    try {
      const body = await this.getJson(config, '/api/sessions');
      const rows = Array.isArray(body)
        ? body
        : (body && typeof body === 'object' && Array.isArray((body as { sessions?: unknown }).sessions)
          ? (body as { sessions: unknown[] }).sessions
          : []);
      const statuses = new Map<string, string>();
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const item = row as Partial<SessionStatus>;
        if (typeof item.id === 'string') statuses.set(item.id, item.status ?? 'disconnected');
      }
      return { loaded: true, statuses };
    } catch {
      return { loaded: false, statuses: new Map() };
    }
  }

  private async requireConnectedSession(principal: Principal, workspaceId: string, sessionId: string): Promise<WaConfig> {
    const config = await this.waConfig(principal, workspaceId);
    let body: unknown;
    try {
      body = await this.getJson(config, `/api/sessions/${encodeURIComponent(sessionId)}`);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new BadRequestException(`Session "${sessionId}" is not available.`);
      }
      throw error;
    }
    const status = body && typeof body === 'object' ? (body as { status?: string }).status : undefined;
    if (status !== 'connected') {
      throw new ConflictException(`Session "${sessionId}" must be connected before assigning a project.`);
    }
    return config;
  }

  private async fetchGroups(config: WaConfig, sessionId: string): Promise<Array<{ id: string; subject: string }>> {
    const body = await this.getJson(config, `/api/sessions/${encodeURIComponent(sessionId)}/groups`);
    const rows = Array.isArray(body)
      ? body
      : (body && typeof body === 'object' && Array.isArray((body as { groups?: unknown }).groups)
        ? (body as { groups: unknown[] }).groups
        : []);
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const item = row as { id?: unknown; subject?: unknown };
      return typeof item.id === 'string' && item.id.endsWith('@g.us')
        ? [{ id: item.id, subject: typeof item.subject === 'string' ? item.subject : item.id }]
        : [];
    });
  }

  private async resolveTarget(
    principal: Principal,
    workspaceId: string,
    sessionId: string,
    targetJid: string,
  ): Promise<{ jid: string; phone: string; name: string; isGroup: boolean }> {
    const jid = targetJid.trim();
    const isGroup = jid.toLowerCase().endsWith('@g.us');
    const config = await this.requireConnectedSession(principal, workspaceId, sessionId);

    if (isGroup) {
      const group = (await this.fetchGroups(config, sessionId)).find((item) => item.id === jid);
      if (!group) throw new BadRequestException('That group is not in the selected WhatsApp session.');
      return { jid, phone: jid, name: group.subject, isGroup: true };
    }

    const contact = await this.prisma.contact.findUnique({
      where: { workspaceId_jid: { workspaceId, jid } },
      include: { conversations: { where: { sessionId }, take: 1 } },
    });
    if (!contact) {
      throw new BadRequestException('Direct-chat targets must already be observed in Inbox or Contacts.');
    }
    return {
      jid,
      phone: contact.phone,
      name: contact.savedName ?? contact.whatsappName ?? contact.phone,
      isGroup: false,
    };
  }

  private projectView(project: ProjectWithTarget, statuses?: Map<string, string>) {
    const { conversation } = project;
    const status = statuses?.get(conversation.sessionId);
    const available = !conversation.sessionDeletedAt && (!statuses || status === 'connected');
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      routeKey: project.routeKey,
      createdBy: project.createdBy,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sessionId: conversation.sessionId,
      target: {
        conversationId: conversation.id,
        jid: conversation.contact.jid,
        type: conversation.contact.jid.endsWith('@g.us') ? 'group' : 'direct',
        name: conversation.contact.savedName ?? conversation.contact.whatsappName ?? conversation.contact.phone,
      },
      availability: available ? 'connected' : 'unavailable',
    };
  }

  async list(principal: Principal, workspaceId: string) {
    await this.assertHumanMember(principal, workspaceId);
    const projects = await this.prisma.projectRoute.findMany({
      where: { workspaceId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { conversation: { include: { contact: true } } },
    });
    let statuses: Map<string, string> | undefined;
    try {
      const config = await this.waConfig(principal, workspaceId);
      const snapshot = await this.loadSessionStatuses(config);
      if (snapshot.loaded) statuses = snapshot.statuses;
    } catch {
      statuses = undefined;
    }
    return projects.map((project) => this.projectView(project, statuses));
  }

  async targets(principal: Principal, workspaceId: string, query: ProjectTargetsQueryDto) {
    await this.assertHumanMember(principal, workspaceId);
    const projects = await this.prisma.projectRoute.findMany({
      where: { workspaceId },
      include: { conversation: { include: { contact: true } } },
    });
    const projectByConversation = new Map(projects.map((project) => [project.conversationId, project]));
    const conversations = await this.prisma.conversation.findMany({
      where: { workspaceId, ...(query.sessionId ? { sessionId: query.sessionId } : {}) },
      include: { contact: true },
    });
    const contacts = await this.prisma.contact.findMany({ where: { workspaceId } });
    const conversationByTarget = new Map(
      conversations.map((conversation) => [`${conversation.sessionId}:${conversation.contact.jid}`, conversation]),
    );

    let config: WaConfig | null = null;
    let snapshot = { loaded: false, statuses: new Map<string, string>() };
    try {
      config = await this.waConfig(principal, workspaceId);
      snapshot = await this.loadSessionStatuses(config);
    } catch {
      // Observed direct chats remain useful when the WA directory is offline.
    }

    const sessionIds = new Set<string>(conversations.map((conversation) => conversation.sessionId));
    if (query.sessionId) sessionIds.add(query.sessionId);
    for (const sessionId of snapshot.statuses.keys()) sessionIds.add(sessionId);

    const targets = new Map<string, {
      sessionId: string;
      jid: string;
      type: 'group' | 'direct';
      name: string;
      conversationId: string | null;
      assignedProject: { id: string; name: string; routeKey: string } | null;
      availability: 'connected' | 'unavailable';
    }>();

    for (const contact of contacts) {
      if (contact.jid.endsWith('@g.us')) continue;
      const observedSessions = query.sessionId
        ? [query.sessionId]
        : conversations.filter((conversation) => conversation.contactId === contact.id).map((conversation) => conversation.sessionId);
      for (const sessionId of new Set(observedSessions)) {
        const conversation = conversationByTarget.get(`${sessionId}:${contact.jid}`);
        const project = conversation ? projectByConversation.get(conversation.id) : undefined;
        targets.set(`${sessionId}:${contact.jid}`, {
          sessionId,
          jid: contact.jid,
          type: 'direct',
          name: contact.savedName ?? contact.whatsappName ?? contact.phone,
          conversationId: conversation?.id ?? null,
          assignedProject: project ? { id: project.id, name: project.name, routeKey: project.routeKey } : null,
          availability: snapshot.loaded && snapshot.statuses.get(sessionId) === 'connected' && !conversation?.sessionDeletedAt
            ? 'connected'
            : 'unavailable',
        });
      }
    }

    if (config) {
      for (const sessionId of sessionIds) {
        if (snapshot.statuses.get(sessionId) !== 'connected') continue;
        try {
          for (const group of await this.fetchGroups(config, sessionId)) {
            const conversation = conversationByTarget.get(`${sessionId}:${group.id}`);
            const project = conversation ? projectByConversation.get(conversation.id) : undefined;
            targets.set(`${sessionId}:${group.id}`, {
              sessionId,
              jid: group.id,
              type: 'group',
              name: group.subject,
              conversationId: conversation?.id ?? null,
              assignedProject: project ? { id: project.id, name: project.name, routeKey: project.routeKey } : null,
              availability: 'connected',
            });
          }
        } catch {
          // A connected session can lose its directory during reconnect; keep DB targets.
        }
      }
    }

    const term = query.q?.trim().toLowerCase();
    return [...targets.values()]
      .filter((target) => !term || [target.name, target.jid, target.sessionId].some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.sessionId.localeCompare(b.sessionId));
  }

  async create(principal: Principal, workspaceId: string, dto: CreateProjectRouteDto) {
    await this.assertHumanMember(principal, workspaceId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Project name cannot be empty.');
    const routeKey = slugifyProjectName(name);
    const target = await this.resolveTarget(principal, workspaceId, dto.sessionId.trim(), dto.targetJid);

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const contact = await tx.contact.upsert({
          where: { workspaceId_jid: { workspaceId, jid: target.jid } },
          update: target.isGroup ? { whatsappName: target.name } : {},
          create: {
            workspaceId,
            jid: target.jid,
            phone: target.phone,
            ...(target.isGroup ? { whatsappName: target.name } : {}),
          },
        });
        const conversation = await tx.conversation.upsert({
          where: { workspaceId_sessionId_contactId: { workspaceId, sessionId: dto.sessionId.trim(), contactId: contact.id } },
          update: { sessionDeletedAt: null },
          create: { workspaceId, contactId: contact.id, sessionId: dto.sessionId.trim() },
        });
        return tx.projectRoute.create({
          data: { workspaceId, conversationId: conversation.id, name, routeKey, createdBy: principal.userId },
          include: { conversation: { include: { contact: true } } },
        });
      });
      return this.projectView(project, new Map([[dto.sessionId.trim(), 'connected']]));
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('That route key or WhatsApp chat is already assigned to a project.');
      }
      throw error;
    }
  }

  async update(principal: Principal, workspaceId: string, projectId: string, dto: UpdateProjectRouteDto) {
    await this.assertHumanMember(principal, workspaceId);
    const existing = await this.prisma.projectRoute.findFirst({
      where: { id: projectId, workspaceId },
      include: { conversation: { include: { contact: true } } },
    });
    if (!existing) throw new NotFoundException('Project not found');

    const targetChanged = dto.sessionId !== undefined || dto.targetJid !== undefined;
    const sessionId = dto.sessionId?.trim() ?? existing.conversation.sessionId;
    const targetJid = dto.targetJid?.trim() ?? existing.conversation.contact.jid;
    const target = targetChanged
      ? await this.resolveTarget(principal, workspaceId, sessionId, targetJid)
      : null;
    const name = dto.name?.trim() ?? existing.name;
    if (!name) throw new BadRequestException('Project name cannot be empty.');

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        let conversationId = existing.conversationId;
        if (target) {
          const contact = await tx.contact.upsert({
            where: { workspaceId_jid: { workspaceId, jid: target.jid } },
            update: target.isGroup ? { whatsappName: target.name } : {},
            create: {
              workspaceId,
              jid: target.jid,
              phone: target.phone,
              ...(target.isGroup ? { whatsappName: target.name } : {}),
            },
          });
          const conversation = await tx.conversation.upsert({
            where: { workspaceId_sessionId_contactId: { workspaceId, sessionId, contactId: contact.id } },
            update: { sessionDeletedAt: null },
            create: { workspaceId, contactId: contact.id, sessionId },
          });
          conversationId = conversation.id;
        }
        return tx.projectRoute.update({
          where: { id: existing.id },
          data: { name, conversationId },
          include: { conversation: { include: { contact: true } } },
        });
      });
      return this.projectView(project, target ? new Map([[sessionId, 'connected']]) : undefined);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('That WhatsApp chat is already assigned to another project.');
      }
      throw error;
    }
  }

  async remove(principal: Principal, workspaceId: string, projectId: string) {
    await this.assertHumanMember(principal, workspaceId);
    const existing = await this.prisma.projectRoute.findFirst({ where: { id: projectId, workspaceId } });
    if (!existing) throw new NotFoundException('Project not found');
    await this.prisma.projectRoute.delete({ where: { id: existing.id } });
    return { success: true };
  }
}
