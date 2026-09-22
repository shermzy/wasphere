import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from './internal-secret.guard';
import { InternalService } from './internal.service';
import { InboxIngestService } from '../inbox/inbox-ingest.service';
import { AuditEventDto } from './dto/audit-event.dto';
import { WebhookEventDto } from './dto/webhook-event.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';

@ApiTags('Internal')
@Controller('internal')
@UseGuards(InternalSecretGuard)
export class InternalController {
  constructor(
    private readonly internalService: InternalService,
    private readonly inboxIngest: InboxIngestService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Post('audit')
  @HttpCode(HttpStatus.CREATED)
  async audit(@Body() dto: AuditEventDto) {
    await this.internalService.ingestAudit(dto);
    return { success: true };
  }

  @Post('webhook-event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a WhatsApp event from wa-server and fan out to subscribed webhooks',
    description:
      'Called by wa-server only. The exact provider session is resolved to its owning ' +
      'workspace before delivery. Returns 200 after Inbox ingestion and webhook fanout complete.',
  })
  @ApiResponse({ status: 200, description: 'Completed — Inbox ingestion and webhook fanout finished' })
  @ApiResponse({ status: 400, description: 'Invalid event type or payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-Internal-Secret' })
  async webhookEvent(@Body() dto: WebhookEventDto) {
    const workspaceId = await this.workspaces.workspaceForProviderSession(dto.sessionId);
    if (!workspaceId) throw new NotFoundException('Session is not assigned to a workspace');
    await Promise.all([
      this.internalService.fanoutWebhookEvent(workspaceId, dto),
      this.inboxIngest.ingestAndWait(workspaceId, dto),
    ]);
    return { success: true };
  }
}
