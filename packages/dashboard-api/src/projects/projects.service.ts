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
import { normalizeProjectRouteKey } from './project-route-key';

type Principal = { userId: string; apiKeyId?: string };
type SessionStatus = { id: string; status?: string };
type ProjectWithTarget = Prisma.ProjectRouteGetPayload<{
  include: { conversation: { include: { contact: true } } };
}>;

type WaConfig = { waServerUrl: string; token: string };
const ROUTE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

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

  private async assertConnectedSession(config: WaConfig, sessionId: string): Promise<void> {
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
  }

  private async requireConnectedSession(principal: Principal, workspaceId: string, sessionId: string): Promise<WaConfig> {
    await this.workspaces.assertProviderSession(principal.userId, workspaceId, sessionId);
    const config = await this.waConfig(principal, workspaceId);
    await this.assertConnectedSession(config, sessionId);
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
      include: { conversations: { where: { sessionId, sessionDeletedAt: null }, take: 1 } },
    });
    if (!contact || contact.conversations.length === 0) {
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
    const available = !conversation.sessionDeletedAt && status === 'connected';
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      routeKey: project.routeKey,
      enabled: project.enabled,
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
    let ownedSessionIds = new Set<string>();
    try {
      const candidateConfig = await this.waConfig(principal, workspaceId);
      ownedSessionIds = await this.workspaces.listProviderSessionIds(principal.userId, workspaceId);
      const candidateSnapshot = await this.loadSessionStatuses(candidateConfig);
      candidateSnapshot.statuses = new Map(
        [...candidateSnapshot.statuses].filter(([sessionId]) => ownedSessionIds.has(sessionId)),
      );
      config = candidateConfig;
      snapshot = candidateSnapshot;
    } catch {
      // Observed direct chats remain useful when the WA directory is offline.
    }

    const sessionIds = query.sessionId
      ? new Set(ownedSessionIds.has(query.sessionId) ? [query.sessionId] : [])
      : ownedSessionIds;

    const targets = new Map<string, {
      sessionId: string;
      jid: string;
      type: 'group' | 'direct';
      name: string;
      conversationId: string | null;
      assignedProject: { id: string; name: string; routeKey: string; enabled: boolean } | null;
      availability: 'connected' | 'unavailable';
    }>();

    for (const contact of contacts) {
      if (contact.jid.endsWith('@g.us')) continue;
      const observedSessions = conversations
        .filter((conversation) => conversation.contactId === contact.id)
        .map((conversation) => conversation.sessionId);
      for (const sessionId of new Set(observedSessions)) {
        const conversation = conversationByTarget.get(`${sessionId}:${contact.jid}`);
        const project = conversation ? projectByConversation.get(conversation.id) : undefined;
        targets.set(`${sessionId}:${contact.jid}`, {
          sessionId,
          jid: contact.jid,
          type: 'direct',
          name: contact.savedName ?? contact.whatsappName ?? contact.phone,
          conversationId: conversation?.id ?? null,
          assignedProject: project ? { id: project.id, name: project.name, routeKey: project.routeKey, enabled: project.enabled } : null,
          availability: snapshot.loaded && snapshot.statuses.get(sessionId) === 'connected' && !conversation?.sessionDeletedAt
            ? 'connected'
            : 'unavailable',
        });
      }
    }

    for (const conversation of conversations) {
      if (!conversation.contact.jid.endsWith('@g.us')) continue;
      const project = projectByConversation.get(conversation.id);
      targets.set(`${conversation.sessionId}:${conversation.contact.jid}`, {
        sessionId: conversation.sessionId,
        jid: conversation.contact.jid,
        type: 'group',
        name: conversation.contact.savedName ?? conversation.contact.whatsappName ?? conversation.contact.phone,
        conversationId: conversation.id,
        assignedProject: project ? { id: project.id, name: project.name, routeKey: project.routeKey, enabled: project.enabled } : null,
        availability: 'unavailable',
      });
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
              assignedProject: project ? { id: project.id, name: project.name, routeKey: project.routeKey, enabled: project.enabled } : null,
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

  async syncTargets(principal: Principal, workspaceId: string, rawSessionId: unknown) {
    await this.assertHumanMember(principal, workspaceId);
    if (typeof rawSessionId !== 'string' || !rawSessionId.trim() || rawSessionId.length > 64) {
      throw new BadRequestException('A valid session ID is required.');
    }
    const sessionId = rawSessionId.trim();
    const config = await this.requireConnectedSession(principal, workspaceId, sessionId);
    const groups = await this.fetchGroups(config, sessionId);
    await this.assertConnectedSession(config, sessionId);

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
        select: { id: true },
      });
      if (!member) throw new ForbiddenException('Not a member of this workspace');
      for (const group of groups) {
        const contact = await tx.contact.upsert({
          where: { workspaceId_jid: { workspaceId, jid: group.id } },
          update: { whatsappName: group.subject },
          create: { workspaceId, jid: group.id, phone: group.id, whatsappName: group.subject },
        });
        await tx.conversation.upsert({
          where: { workspaceId_sessionId_contactId: { workspaceId, sessionId, contactId: contact.id } },
          update: {},
          create: { workspaceId, sessionId, contactId: contact.id },
        });
      }
    });
    return { synced: groups.length };
  }

  async audit(principal: Principal, workspaceId: string, rawLimit?: string) {
    await this.assertHumanMember(principal, workspaceId);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100.');
    }
    const events = await this.prisma.projectRouteAudit.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return { events };
  }

  private requireRouteKey(value: string): string {
    const key = normalizeProjectRouteKey(value);
    if (!ROUTE_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Route key must be 1–40 lowercase letters, numbers, or hyphens.');
    }
    return key;
  }

  async create(principal: Principal, workspaceId: string, dto: CreateProjectRouteDto) {
    await this.assertHumanMember(principal, workspaceId);
    if (dto.confirmed !== true) throw new BadRequestException('Confirm the exact route and chat before binding.');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Project name cannot be empty.');
    const routeKey = this.requireRouteKey(dto.routeKey);
    const sessionId = dto.sessionId.trim();
    const target = await this.resolveTarget(principal, workspaceId, sessionId, dto.targetJid);

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const member = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
          select: { id: true },
        });
        if (!member) throw new ForbiddenException('Not a member of this workspace');
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
        const created = await tx.projectRoute.create({
          data: { workspaceId, conversationId: conversation.id, name, routeKey, createdBy: principal.userId },
          include: { conversation: { include: { contact: true } } },
        });
        await tx.projectRouteAudit.create({
          data: {
            workspaceId, projectRouteId: created.id, actorUserId: principal.userId,
            action: 'route.bound', routeKey, sessionId, targetJid: target.jid,
          },
        });
        return created;
      });
      return this.projectView(project, new Map([[sessionId, 'connected']]));
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
    if (targetChanged && dto.confirmed !== true) {
      throw new BadRequestException('Confirm the exact route and chat before rebinding.');
    }
    const sessionId = dto.sessionId?.trim() ?? existing.conversation.sessionId;
    const targetJid = dto.targetJid?.trim() ?? existing.conversation.contact.jid;
    const target = targetChanged
      ? await this.resolveTarget(principal, workspaceId, sessionId, targetJid)
      : null;
    if (dto.enabled === true && !existing.enabled && !target) {
      await this.resolveTarget(principal, workspaceId, sessionId, targetJid);
    }
    const name = dto.name?.trim() ?? existing.name;
    if (!name) throw new BadRequestException('Project name cannot be empty.');

    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const member = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
          select: { id: true },
        });
        if (!member) throw new ForbiddenException('Not a member of this workspace');
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
        const conversationChanged = conversationId !== existing.conversationId;
        const changes: Prisma.ProjectRouteUpdateManyMutationInput = {
          ...(dto.name !== undefined && name !== existing.name ? { name } : {}),
          ...(conversationChanged ? { conversationId } : {}),
          ...(dto.enabled !== undefined && dto.enabled !== existing.enabled ? { enabled: dto.enabled } : {}),
        };
        if (Object.keys(changes).length === 0) return existing;
        const result = await tx.projectRoute.updateMany({
          where: { id: existing.id, workspaceId, updatedAt: existing.updatedAt },
          data: changes,
        });
        if (result.count !== 1) {
          throw new ConflictException('Project changed while this update was being confirmed. Reload and try again.');
        }
        const updated = await tx.projectRoute.findFirst({
          where: { id: existing.id, workspaceId },
          include: { conversation: { include: { contact: true } } },
        });
        if (!updated) throw new ConflictException('Project changed while this update was being confirmed. Reload and try again.');
        const actions = [
          ...(conversationChanged ? ['route.rebound'] : []),
          ...(dto.name !== undefined && name !== existing.name ? ['route.renamed'] : []),
          ...(dto.enabled !== undefined && dto.enabled !== existing.enabled
            ? [dto.enabled ? 'route.enabled' : 'route.disabled']
            : []),
        ];
        for (const action of actions) {
          await tx.projectRouteAudit.create({
            data: {
              workspaceId, projectRouteId: updated.id, actorUserId: principal.userId,
              action, routeKey: updated.routeKey, sessionId: updated.conversation.sessionId,
              targetJid: updated.conversation.contact.jid,
            },
          });
        }
        return updated;
      });
      let statuses: Map<string, string> | undefined;
      try {
        const snapshot = await this.loadSessionStatuses(await this.waConfig(principal, workspaceId));
        if (snapshot.loaded) statuses = snapshot.statuses;
      } catch {
        statuses = undefined;
      }
      return this.projectView(project, statuses);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('That WhatsApp chat is already assigned to another project.');
      }
      throw error;
    }
  }

  async remove(principal: Principal, workspaceId: string, projectId: string) {
    await this.assertHumanMember(principal, workspaceId);
    const existing = await this.prisma.projectRoute.findFirst({
      where: { id: projectId, workspaceId },
      include: { conversation: { include: { contact: true } } },
    });
    if (!existing) throw new NotFoundException('Project not found');
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
        select: { id: true },
      });
      if (!member) throw new ForbiddenException('Not a member of this workspace');
      await tx.projectRouteAudit.create({
        data: {
          workspaceId, projectRouteId: existing.id, actorUserId: principal.userId,
          action: 'route.deleted', routeKey: existing.routeKey,
          sessionId: existing.conversation.sessionId, targetJid: existing.conversation.contact.jid,
        },
      });
      await tx.projectRoute.delete({ where: { id: existing.id } });
    });
    return { success: true };
  }
}
