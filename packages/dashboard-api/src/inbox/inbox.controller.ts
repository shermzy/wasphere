import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { ApiKeyPermissionGuard } from '../auth/api-key-permission.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { InboxService } from './inbox.service';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { PatchConversationDto } from './dto/patch-conversation.dto';
import { SendReplyDto } from './dto/send-reply.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SyncJidMappingsDto } from './dto/sync-jid-mappings.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('Inbox')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/conversations')
@UseGuards(CombinedAuthGuard, ApiKeyPermissionGuard, CapabilityGuard)
@RequireCapability('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'List conversations (cursor-paginated, filterable, searchable)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace UUID' })
  @ApiResponse({ status: 200, description: '{ items: ConversationView[], nextCursor: string | null }' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  list(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.inbox.listConversations(req.user.userId, workspaceId, query);
  }

  @Post()
  @RequiresPermission('messages:send')
  @ApiOperation({
    summary: 'Start a new conversation with text or an approved Meta template',
    description: 'Text starts require kind=text. Meta starts require kind=template, an approved template name, language code, and bounded body parameters.',
  })
  @ApiResponse({ status: 201, description: '{ conversationId }' })
  start(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: StartConversationDto,
  ) {
    return this.inbox.startConversation(req.user.userId, workspaceId, dto);
  }

  @Get(':conversationId')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'Get one conversation with its contact' })
  @ApiResponse({ status: 200, description: 'ConversationView' })
  @ApiResponse({ status: 404, description: 'Conversation not found in this workspace' })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.getConversation(req.user.userId, workspaceId, conversationId);
  }

  @Get(':conversationId/messages')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'List messages in a conversation (newest-first, cursor-paginated)' })
  @ApiResponse({ status: 200, description: '{ items: Message[], nextCursor: string | null }' })
  messages(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.inbox.listMessages(req.user.userId, workspaceId, conversationId, query);
  }

  @Patch(':conversationId')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'Update conversation status and/or tags' })
  @ApiResponse({ status: 200, description: 'Updated ConversationView' })
  patch(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: PatchConversationDto,
  ) {
    return this.inbox.patchConversation(req.user.userId, workspaceId, conversationId, dto);
  }

  @Post('jid-mappings')
  @RequiresPermission('workspace:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Map verified WhatsApp LIDs to phone JIDs and merge duplicate chats' })
  syncJidMappings(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: SyncJidMappingsDto,
  ) {
    return this.inbox.syncJidMappings(req.user.userId, workspaceId, dto);
  }

  @Post(':conversationId/read')
  @RequiresPermission('messages:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a conversation read (zero unreadCount)' })
  @ApiResponse({ status: 200, description: '{ ok: true, unreadCount: 0 }' })
  read(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.markRead(req.user.userId, workspaceId, conversationId);
  }

  @Post(':conversationId/messages')
  @RequiresPermission('messages:send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a text reply (proxies to the WA Server)' })
  @ApiResponse({ status: 201, description: 'The created OUTBOUND message' })
  @ApiResponse({ status: 503, description: 'Session offline/deleted — reply not sent' })
  send(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendReplyDto,
  ) {
    return this.inbox.sendReply(req.user.userId, workspaceId, conversationId, dto);
  }
}
