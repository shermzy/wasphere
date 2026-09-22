import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AutomationRunStatus, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { InboxService } from '../inbox/inbox.service';
import { hasCapability } from '../lib/capabilities';
import {
  AutomationConfirmationDto,
  CreateAutomationDto,
  MAX_AUTOMATION_KEYWORD_LENGTH,
  MAX_AUTOMATION_NAME_LENGTH,
  MAX_AUTOMATION_RESPONSE_LENGTH,
  MAX_PROVIDER_SESSION_ID_LENGTH,
  UpdateAutomationDto,
} from './dto/automation.dto';

type Principal = { userId: string; apiKeyId?: string };
type InboundMessage = {
  workspaceId: string;
  providerSessionId: string;
  providerMessageId: string;
  conversationId: string;
  type: string;
  body: string | null;
  fromMe: boolean;
  isGroup: boolean;
};

const DELIVERY_REJECTED = 'Provider rejected delivery';
const DELIVERY_UNKNOWN = 'Delivery outcome unknown';

function providerFailureStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const source = error as Record<string, unknown>;
  const value = typeof source.getStatus === 'function'
    ? source.getStatus()
    : source.status ?? source.statusCode;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function providerFailureCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(code)) return code;
  if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 999) return String(code);
  return null;
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly inbox: InboxService,
  ) {}

  private async assertHumanMessagesMember(principal: Principal, workspaceId: string): Promise<void> {
    if (principal.apiKeyId) throw new ForbiddenException('Automations require a human workspace member');
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
      select: { id: true, role: true, customRole: { select: { capabilities: true } } },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');
    if (!hasCapability(member.role, member.customRole?.capabilities, 'messages')) {
      throw new ForbiddenException('You need the messages permission in this workspace');
    }
  }

  private normalize(value: string | undefined, field: string, max: number): string {
    if (typeof value !== 'string') throw new BadRequestException(`${field} is required`);
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException(`${field} cannot be empty`);
    if (normalized.length > max) throw new BadRequestException(`${field} is too long`);
    return normalized;
  }

  private normalizeKeyword(value: string | undefined): string {
    return this.normalize(value, 'Keyword', MAX_AUTOMATION_KEYWORD_LENGTH).toLowerCase();
  }

  private exactSession(value: string | undefined): string {
    if (typeof value !== 'string' || !value || value.trim() !== value || value.length > MAX_PROVIDER_SESSION_ID_LENGTH) {
      throw new BadRequestException('An exact provider session ID is required');
    }
    return value;
  }

  private async assertRuleSession(principal: Principal, workspaceId: string, providerSessionId: string): Promise<void> {
    await this.workspaces.assertProviderSession(principal.userId, workspaceId, providerSessionId);
  }

  private async getRule(principal: Principal, workspaceId: string, automationId: string) {
    await this.assertHumanMessagesMember(principal, workspaceId);
    const rule = await this.prisma.automationRule.findFirst({ where: { id: automationId, workspaceId } });
    if (!rule) throw new NotFoundException('Automation rule not found');
    return rule;
  }

  private ruleView(rule: any, recentRun?: any) {
    return {
      id: rule.id,
      workspaceId: rule.workspaceId,
      providerSessionId: rule.providerSessionId,
      name: rule.name,
      keyword: rule.keyword,
      responseText: rule.responseText,
      enabled: rule.enabled,
      createdBy: rule.createdBy,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      ...(recentRun === undefined ? {} : { recentRun: recentRun ? this.runView(recentRun) : null }),
    };
  }

  private runView(run: any) {
    return {
      id: run.id,
      workspaceId: run.workspaceId,
      automationRuleId: run.automationRuleId,
      providerSessionId: run.providerSessionId,
      providerMessageId: run.providerMessageId,
      status: run.status,
      error: run.errorMessage,
      history: run.history,
      claimedAt: run.claimedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private async audit(workspaceId: string, sessionId: string | null, method: string, endpoint: string, statusCode = 200) {
    await this.prisma.auditLog.create({
      data: { workspaceId, sessionId, method, endpoint, statusCode },
    });
  }

  async list(principal: Principal, workspaceId: string) {
    await this.assertHumanMessagesMember(principal, workspaceId);
    const rules = await this.prisma.automationRule.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { runs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return rules.map((rule) => this.ruleView(rule, rule.runs[0]));
  }

  async detail(principal: Principal, workspaceId: string, automationId: string) {
    const rule = await this.getRule(principal, workspaceId, automationId);
    const recentRun = await this.prisma.automationRun.findFirst({
      where: { workspaceId, automationRuleId: rule.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return this.ruleView(rule, recentRun);
  }

  async runs(principal: Principal, workspaceId: string, automationId: string) {
    const rule = await this.getRule(principal, workspaceId, automationId);
    const rows = await this.prisma.automationRun.findMany({
      where: { workspaceId, automationRuleId: rule.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.runView(row));
  }

  async create(principal: Principal, workspaceId: string, dto: CreateAutomationDto) {
    await this.assertHumanMessagesMember(principal, workspaceId);
    const providerSessionId = this.exactSession(dto.providerSessionId);
    await this.assertRuleSession(principal, workspaceId, providerSessionId);
    const name = this.normalize(dto.name, 'Name', MAX_AUTOMATION_NAME_LENGTH);
    const keyword = this.normalizeKeyword(dto.keyword);
    const responseText = this.normalize(dto.responseText, 'Response text', MAX_AUTOMATION_RESPONSE_LENGTH);
    const rule = await this.prisma.automationRule.create({
      data: { workspaceId, providerSessionId, name, keyword, responseText, createdBy: principal.userId },
    });
    await this.audit(workspaceId, providerSessionId, 'AUTOMATION_CREATE', `/automations/${rule.id}`, 201);
    return this.detail(principal, workspaceId, rule.id);
  }

  async update(principal: Principal, workspaceId: string, automationId: string, dto: UpdateAutomationDto) {
    const existing = await this.getRule(principal, workspaceId, automationId);
    const providerSessionId = dto.providerSessionId === undefined
      ? existing.providerSessionId
      : this.exactSession(dto.providerSessionId);
    if (dto.providerSessionId !== undefined) await this.assertRuleSession(principal, workspaceId, providerSessionId);
    const data: Prisma.AutomationRuleUpdateInput = {
      ...(dto.name === undefined ? {} : { name: this.normalize(dto.name, 'Name', MAX_AUTOMATION_NAME_LENGTH) }),
      ...(dto.keyword === undefined ? {} : { keyword: this.normalizeKeyword(dto.keyword) }),
      ...(dto.responseText === undefined ? {} : { responseText: this.normalize(dto.responseText, 'Response text', MAX_AUTOMATION_RESPONSE_LENGTH) }),
      ...(dto.providerSessionId === undefined ? {} : { providerSessionId }),
    };
    await this.prisma.automationRule.update({ where: { id: existing.id }, data });
    await this.audit(workspaceId, providerSessionId, 'AUTOMATION_UPDATE', `/automations/${existing.id}`);
    return this.detail(principal, workspaceId, existing.id);
  }

  async enable(principal: Principal, workspaceId: string, automationId: string, dto: AutomationConfirmationDto) {
    if (dto.confirm !== true) throw new BadRequestException('Explicit confirmation is required to enable an automation');
    const existing = await this.getRule(principal, workspaceId, automationId);
    await this.assertRuleSession(principal, workspaceId, existing.providerSessionId);
    await this.prisma.automationRule.update({ where: { id: existing.id }, data: { enabled: true } });
    await this.audit(workspaceId, existing.providerSessionId, 'AUTOMATION_ENABLE', `/automations/${existing.id}`);
    return this.detail(principal, workspaceId, existing.id);
  }

  async disable(principal: Principal, workspaceId: string, automationId: string, dto: AutomationConfirmationDto) {
    if (dto.confirm !== true) throw new BadRequestException('Explicit confirmation is required to disable an automation');
    const existing = await this.getRule(principal, workspaceId, automationId);
    await this.prisma.automationRule.update({ where: { id: existing.id }, data: { enabled: false } });
    await this.audit(workspaceId, existing.providerSessionId, 'AUTOMATION_DISABLE', `/automations/${existing.id}`);
    return this.detail(principal, workspaceId, existing.id);
  }

  private async claimRun(message: InboundMessage, rule: any) {
    try {
      return await this.prisma.automationRun.create({
        data: {
          workspaceId: message.workspaceId,
          automationRuleId: rule.id,
          providerSessionId: message.providerSessionId,
          providerMessageId: message.providerMessageId,
          status: AutomationRunStatus.CLAIMED,
          history: [{ status: AutomationRunStatus.CLAIMED, at: new Date().toISOString() }] as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2002') return null;
      throw error;
    }
  }

  private async finishRun(runId: string, workspaceId: string, ruleId: string, sessionId: string, status: AutomationRunStatus, errorMessage: string | null) {
    const current = await this.prisma.automationRun.findUnique({ where: { id: runId }, select: { history: true } });
    const history = Array.isArray(current?.history) ? [...current.history] : [];
    history.push({ status, at: new Date().toISOString(), ...(errorMessage ? { error: errorMessage } : {}) });
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status, errorMessage, completedAt: new Date(), history: history as Prisma.InputJsonValue },
    });
    await this.audit(workspaceId, sessionId, 'AUTOMATION_RUN', `/automations/${ruleId}/runs/${runId}?status=${status}`, status === AutomationRunStatus.SENT ? 200 : 500);
  }

  private async preflight(message: InboundMessage, ruleId: string, creatorId: string): Promise<string | null> {
    const [rule, member, session, conversation] = await Promise.all([
      this.prisma.automationRule.findFirst({ where: { id: ruleId, workspaceId: message.workspaceId, enabled: true, providerSessionId: message.providerSessionId } }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: message.workspaceId, userId: creatorId } },
        select: { role: true, customRole: { select: { capabilities: true } } },
      }),
      this.prisma.workspaceSession.findUnique({ where: { providerSessionId: message.providerSessionId }, select: { workspaceId: true } }),
      this.prisma.conversation.findFirst({ where: { id: message.conversationId, workspaceId: message.workspaceId, sessionId: message.providerSessionId }, select: { id: true } }),
    ]);
    if (!rule) return 'Rule is disabled, deleted, or no longer assigned to this session';
    if (!member || !hasCapability(member.role, member.customRole?.capabilities, 'messages')) return 'Rule creator is no longer authorized';
    if (!session || session.workspaceId !== message.workspaceId) return 'Provider session is not assigned to this workspace';
    if (!conversation) return 'Inbound conversation is not assigned to this session';
    return null;
  }

  async evaluateInbound(message: InboundMessage): Promise<void> {
    if (message.fromMe || message.isGroup || message.type !== 'text' || !message.body) return;
    const rules = await this.prisma.automationRule.findMany({
      where: { workspaceId: message.workspaceId, providerSessionId: message.providerSessionId, enabled: true },
    });
    // ponytail: case-insensitive substring matching only; add token/locale/cooldown rules when trigger semantics need them.
    const matches = rules.filter((rule) => message.body!.toLowerCase().includes(rule.keyword));
    for (const rule of matches) {
      const run = await this.claimRun(message, rule);
      if (!run) continue;
      const blocked = await this.preflight(message, rule.id, rule.createdBy);
      if (blocked) {
        await this.finishRun(run.id, message.workspaceId, rule.id, message.providerSessionId, AutomationRunStatus.SKIPPED, blocked);
        continue;
      }
      try {
        await this.inbox.sendReply(rule.createdBy, message.workspaceId, message.conversationId, { kind: 'text', text: rule.responseText });
        await this.finishRun(run.id, message.workspaceId, rule.id, message.providerSessionId, AutomationRunStatus.SENT, null);
      } catch (error) {
        const status = providerFailureStatus(error);
        const outcome = status !== null && status >= 400 && status < 500
          ? AutomationRunStatus.FAILED
          : AutomationRunStatus.INDETERMINATE;
        const errorMessage = outcome === AutomationRunStatus.FAILED ? DELIVERY_REJECTED : DELIVERY_UNKNOWN;
        const code = providerFailureCode(error);
        this.logger.warn(
          `[Automations] run=${run.id} ${outcome} status=${status ?? 'unknown'}${code ? ` code=${code}` : ''}`,
        );
        await this.finishRun(run.id, message.workspaceId, rule.id, message.providerSessionId, outcome, errorMessage);
      }
    }
  }
}
