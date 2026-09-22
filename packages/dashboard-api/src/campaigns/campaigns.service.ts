import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignRecipientStatus, CampaignStatus, Prisma } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { InboxService } from '../inbox/inbox.service';
import { hasCapability } from '../lib/capabilities';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_MESSAGE_LENGTH,
  MAX_CAMPAIGN_RECIPIENTS,
  ScheduleCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

export interface CampaignPrincipal {
  userId: string;
  apiKeyId?: string;
  sessionScope?: string | null;
}

interface ContactSnapshot {
  contactId: string;
  targetKey: string;
  phone: string;
  jid: string;
  displayName: string;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeErrorMessage(error: unknown, unknownDelivery: boolean): string {
  if (unknownDelivery) return 'Delivery outcome is unknown; automatic retry is disabled.';
  return 'Provider rejected the message.';
}

function isKnownProviderFailure(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'getStatus' in error && typeof error.getStatus === 'function'
    ? error.getStatus()
    : 500;
  return status >= 400 && status < 500;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly inbox: InboxService,
  ) {}

  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, customRole: { select: { capabilities: true } } },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');
    if (!hasCapability(member.role, member.customRole?.capabilities, 'messages')) {
      throw new ForbiddenException('You need the messages permission in this workspace');
    }
  }

  private async assertSession(principal: CampaignPrincipal, workspaceId: string, providerSessionId: string): Promise<void> {
    if (principal.apiKeyId && principal.sessionScope && principal.sessionScope !== providerSessionId) {
      throw new ForbiddenException('API key is not authorized for this session');
    }
    await this.workspaces.assertProviderSession(principal.userId, workspaceId, providerSessionId);
  }

  private campaignWhere(principal: CampaignPrincipal, workspaceId: string): Prisma.CampaignWhereInput {
    return {
      workspaceId,
      ...(principal.apiKeyId && principal.sessionScope ? { providerSessionId: principal.sessionScope } : {}),
    };
  }

  private async getCampaign(principal: CampaignPrincipal, workspaceId: string, campaignId: string, includeRecipients = false) {
    await this.assertMember(workspaceId, principal.userId);
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, ...this.campaignWhere(principal, workspaceId) },
      ...(includeRecipients ? { include: { recipients: { orderBy: { createdAt: 'asc' } } } } : {}),
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private requireMessage(value: string | undefined): string {
    if (typeof value !== 'string') throw new BadRequestException('Message text is required');
    const message = value.trim();
    if (!message) throw new BadRequestException('Message text cannot be empty');
    if (message.length > MAX_CAMPAIGN_MESSAGE_LENGTH) throw new BadRequestException('Message text is too long');
    return message;
  }

  private requireName(value: string | undefined): string {
    if (typeof value !== 'string') throw new BadRequestException('Campaign name is required');
    const name = value.trim();
    if (!name) throw new BadRequestException('Campaign name cannot be empty');
    if (name.length > MAX_CAMPAIGN_NAME_LENGTH) throw new BadRequestException('Campaign name is too long');
    return name;
  }

  private requireSessionId(value: string | undefined): string {
    if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 200) {
      throw new BadRequestException('An exact provider session ID is required');
    }
    return value;
  }

  private async snapshotContacts(workspaceId: string, contactIds: string[]): Promise<ContactSnapshot[]> {
    const ids = [...new Set(contactIds)];
    if (ids.length < 1 || ids.length > MAX_CAMPAIGN_RECIPIENTS) {
      throw new BadRequestException(`Select between 1 and ${MAX_CAMPAIGN_RECIPIENTS} contacts`);
    }
    const contacts = await this.prisma.contact.findMany({
      where: { workspaceId, id: { in: ids } },
      select: { id: true, phone: true, jid: true, savedName: true, whatsappName: true },
    });
    if (contacts.length !== ids.length) throw new BadRequestException('Every selected contact must belong to this workspace');

    const snapshots = contacts.map((contact) => {
      const phone = contact.phone.replace(/[^0-9]/g, '');
      if (phone.length < 6 || contact.jid.endsWith('@g.us')) {
        throw new BadRequestException('Campaign recipients must be direct contacts with a phone number');
      }
      return {
        contactId: contact.id,
        targetKey: contact.jid,
        phone,
        jid: contact.jid,
        displayName: contact.savedName?.trim() || contact.whatsappName?.trim() || phone,
      };
    });
    if (!snapshots.length) throw new BadRequestException('Select at least one direct-phone recipient');
    return snapshots;
  }

  private async audit(workspaceId: string, sessionId: string | null, action: string, outcome: string, statusCode = 200): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        sessionId,
        method: `CAMPAIGN_${action}`,
        endpoint: `/campaigns?outcome=${encodeURIComponent(outcome)}`,
        statusCode,
      },
    });
  }

  private recipientView(recipient: any) {
    return {
      id: recipient.id,
      contactId: recipient.contactId,
      targetKey: recipient.targetKey,
      phone: recipient.phone,
      jid: recipient.jid,
      displayName: recipient.displayName,
      status: recipient.status,
      claimedAt: iso(recipient.claimedAt),
      completedAt: iso(recipient.completedAt),
      conversationId: recipient.conversationId,
      errorMessage: recipient.errorMessage,
    };
  }

  private campaignView(campaign: any) {
    const recipients = Array.isArray(campaign.recipients) ? campaign.recipients.map((r: any) => this.recipientView(r)) : undefined;
    const counts = recipients
      ? recipients.reduce((out: Record<string, number>, recipient: { status: string }) => {
          out[recipient.status] = (out[recipient.status] ?? 0) + 1;
          return out;
        }, {})
      : {};
    return {
      id: campaign.id,
      workspaceId: campaign.workspaceId,
      name: campaign.name,
      providerSessionId: campaign.providerSessionId,
      message: campaign.message,
      createdBy: campaign.createdBy,
      status: campaign.status,
      scheduledAt: iso(campaign.scheduledAt),
      startedAt: iso(campaign.startedAt),
      finishedAt: iso(campaign.finishedAt),
      createdAt: iso(campaign.createdAt),
      updatedAt: iso(campaign.updatedAt),
      recipientCount: campaign._count?.recipients ?? recipients?.length ?? 0,
      resultCounts: counts,
      ...(recipients ? { recipients } : {}),
    };
  }

  async list(principal: CampaignPrincipal, workspaceId: string, query: ListCampaignsQueryDto) {
    await this.assertMember(workspaceId, principal.userId);
    const where: Prisma.CampaignWhereInput = { ...this.campaignWhere(principal, workspaceId) };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const search = { contains: query.search.trim(), mode: 'insensitive' } as const;
      where.OR = [{ name: search }, { message: search }];
    }
    const campaigns = await this.prisma.campaign.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { _count: { select: { recipients: true } } },
    });
    return campaigns.map((campaign) => this.campaignView(campaign));
  }

  async detail(principal: CampaignPrincipal, workspaceId: string, campaignId: string) {
    return this.campaignView(await this.getCampaign(principal, workspaceId, campaignId, true));
  }

  async create(principal: CampaignPrincipal, workspaceId: string, dto: CreateCampaignDto) {
    await this.assertMember(workspaceId, principal.userId);
    const name = this.requireName(dto.name);
    const providerSessionId = this.requireSessionId(dto.providerSessionId);
    const message = this.requireMessage(dto.message);
    await this.assertSession(principal, workspaceId, providerSessionId);
    const recipients = await this.snapshotContacts(workspaceId, dto.contactIds);
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: { workspaceId, name, providerSessionId, message, createdBy: principal.userId, status: CampaignStatus.DRAFT },
      });
      await tx.campaignRecipient.createMany({
        data: recipients.map((recipient) => ({
          workspaceId,
          campaignId: created.id,
          contactId: recipient.contactId,
          targetKey: recipient.targetKey,
          phone: recipient.phone,
          jid: recipient.jid,
          displayName: recipient.displayName,
        })),
      });
      return created;
    });
    await this.audit(workspaceId, providerSessionId, 'CREATE', 'created', 201);
    return this.detail(principal, workspaceId, campaign.id);
  }

  async update(principal: CampaignPrincipal, workspaceId: string, campaignId: string, dto: UpdateCampaignDto) {
    const existing = await this.getCampaign(principal, workspaceId, campaignId);
    if (existing.status !== CampaignStatus.DRAFT) throw new ConflictException('Only draft campaigns can be updated');
    const name = dto.name === undefined ? existing.name : this.requireName(dto.name);
    const providerSessionId = dto.providerSessionId === undefined
      ? existing.providerSessionId
      : this.requireSessionId(dto.providerSessionId);
    if (dto.providerSessionId !== undefined) await this.assertSession(principal, workspaceId, providerSessionId);
    const message = dto.message === undefined ? existing.message : this.requireMessage(dto.message);
    const recipients = dto.contactIds === undefined ? null : await this.snapshotContacts(workspaceId, dto.contactIds);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.updateMany({
        where: { id: campaignId, workspaceId, status: CampaignStatus.DRAFT },
        data: { name, providerSessionId, message },
      });
      if (updated.count !== 1) throw new ConflictException('Only draft campaigns can be updated');
      if (recipients) {
        await tx.campaignRecipient.deleteMany({ where: { campaignId, workspaceId } });
        await tx.campaignRecipient.createMany({
          data: recipients.map((recipient) => ({ workspaceId, campaignId, ...recipient })),
        });
      }
    });
    await this.audit(workspaceId, providerSessionId, 'UPDATE', 'updated');
    return this.detail(principal, workspaceId, campaignId);
  }

  async schedule(principal: CampaignPrincipal, workspaceId: string, campaignId: string, dto: ScheduleCampaignDto) {
    const existing = await this.getCampaign(principal, workspaceId, campaignId);
    if (existing.status !== CampaignStatus.DRAFT) throw new ConflictException('Only draft campaigns can be scheduled');
    await this.assertSession(principal, workspaceId, existing.providerSessionId);
    const scheduledAt = new Date(dto.scheduledAt);
    const now = Date.now();
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= now || scheduledAt.getTime() > now + MAX_SCHEDULE_AHEAD_MS) {
      throw new BadRequestException('Schedule time must be in the future and within one year');
    }
    const updated = await this.prisma.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: CampaignStatus.DRAFT },
      data: { status: CampaignStatus.SCHEDULED, scheduledAt },
    });
    if (updated.count !== 1) throw new ConflictException('Campaign is no longer a draft');
    await this.audit(workspaceId, existing.providerSessionId, 'SCHEDULE', 'scheduled');
    return this.detail(principal, workspaceId, campaignId);
  }

  async cancel(principal: CampaignPrincipal, workspaceId: string, campaignId: string) {
    const existing = await this.getCampaign(principal, workspaceId, campaignId);
    const updated = await this.prisma.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: { in: [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED] } },
      data: { status: CampaignStatus.CANCELLED, finishedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('Only draft or scheduled campaigns can be cancelled');
    await this.audit(workspaceId, existing.providerSessionId, 'CANCEL', 'cancelled');
    return this.detail(principal, workspaceId, campaignId);
  }

  async launch(principal: CampaignPrincipal, workspaceId: string, campaignId: string, confirmed: boolean) {
    if (confirmed !== true) throw new BadRequestException('Explicit confirmation is required to launch a campaign');
    const existing = await this.getCampaign(principal, workspaceId, campaignId, true);
    if (existing.status !== CampaignStatus.DRAFT && existing.status !== CampaignStatus.SCHEDULED) {
      throw new ConflictException('Campaign was already claimed or cannot be launched');
    }
    await this.assertSession(principal, workspaceId, existing.providerSessionId);

    const claimed = await this.prisma.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: { in: [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED] } },
      data: { status: CampaignStatus.RUNNING, startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.audit(workspaceId, existing.providerSessionId, 'LAUNCH', 'claim-rejected', 409);
      throw new ConflictException('Campaign was already claimed or cannot be launched');
    }
    await this.audit(workspaceId, existing.providerSessionId, 'LAUNCH', 'claimed');

    const recipients = await this.prisma.campaignRecipient.findMany({
      where: { campaignId, workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    for (const recipient of recipients) {
      const recipientClaim = await this.prisma.campaignRecipient.updateMany({
        where: { id: recipient.id, campaignId, workspaceId, status: CampaignRecipientStatus.PENDING },
        // Claim as indeterminate before the provider call. If the process dies
        // after this write, the UI shows the target as unknown and no runner
        // can select it again.
        data: { status: CampaignRecipientStatus.INDETERMINATE, claimedAt: new Date() },
      });
      if (recipientClaim.count !== 1) continue;

      try {
        const result = await this.inbox.startConversation(principal.userId, workspaceId, {
          kind: 'text',
          sessionId: existing.providerSessionId,
          to: recipient.phone,
          text: existing.message,
        });
        await this.prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, campaignId, workspaceId, status: CampaignRecipientStatus.INDETERMINATE },
          data: { status: CampaignRecipientStatus.SENT, conversationId: result.conversationId, completedAt: new Date() },
        });
      } catch (error) {
        const knownFailure = isKnownProviderFailure(error);
        await this.prisma.campaignRecipient.updateMany({
          where: { id: recipient.id, campaignId, workspaceId, status: CampaignRecipientStatus.INDETERMINATE },
          data: {
            status: knownFailure ? CampaignRecipientStatus.FAILED : CampaignRecipientStatus.INDETERMINATE,
            errorMessage: safeErrorMessage(error, !knownFailure),
            completedAt: new Date(),
          },
        });
        if (!knownFailure) break;
      }
    }

    const resultRows = await this.prisma.campaignRecipient.findMany({ where: { campaignId, workspaceId } });
    const statuses = resultRows.map((row) => row.status);
    const hasIndeterminate = statuses.some((status) => status === CampaignRecipientStatus.INDETERMINATE || status === CampaignRecipientStatus.CLAIMED || status === CampaignRecipientStatus.PENDING);
    const sent = statuses.filter((status) => status === CampaignRecipientStatus.SENT).length;
    const failed = statuses.filter((status) => status === CampaignRecipientStatus.FAILED).length;
    const status = hasIndeterminate
      ? CampaignStatus.INDETERMINATE
      : sent === statuses.length
        ? CampaignStatus.COMPLETED
        : sent > 0
          ? CampaignStatus.PARTIAL
          : failed === statuses.length
            ? CampaignStatus.FAILED
            : CampaignStatus.INDETERMINATE;
    await this.prisma.campaign.updateMany({
      where: { id: campaignId, workspaceId, status: CampaignStatus.RUNNING },
      data: { status, finishedAt: new Date() },
    });
    const outcomeCode = status === CampaignStatus.PARTIAL ? 207 : status === CampaignStatus.COMPLETED ? 200 : 500;
    await this.audit(workspaceId, existing.providerSessionId, 'OUTCOME', status.toLowerCase(), outcomeCode);
    return this.detail(principal, workspaceId, campaignId);
  }
}
