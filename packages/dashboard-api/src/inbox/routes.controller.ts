import { Controller, Get, Param, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { ApiKeyPermissionGuard } from '../auth/api-key-permission.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { InboxService } from './inbox.service';
import { SendReplyDto } from './dto/send-reply.dto';

interface RouteRequest extends Request {
  user: { userId: string; apiKeyId?: string; sessionScope?: string | null };
}

@ApiTags('Routes')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/routes')
@UseGuards(CombinedAuthGuard, ApiKeyPermissionGuard, CapabilityGuard)
@RequireCapability('inbox')
export class RoutesController {
  constructor(private readonly inbox: InboxService) {}

  @Get(':routeKey')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'Resolve a project route to its Inbox conversation' })
  @ApiParam({ name: 'routeKey', description: 'Project route such as project-a or #project-a' })
  list(
    @Req() req: RouteRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('routeKey') routeKey: string,
  ) {
    return this.inbox.listRouteMatches(req.user.userId, workspaceId, routeKey, req.user.sessionScope);
  }

  @Post(':routeKey/messages')
  @RequiresPermission('messages:send')
  @ApiOperation({ summary: 'Send a message through a project route' })
  @ApiParam({ name: 'routeKey', description: 'Project route such as project-a or #project-a' })
  send(
    @Req() req: RouteRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('routeKey') routeKey: string,
    @Body() dto: SendReplyDto,
  ) {
    return this.inbox.sendToRoute(req.user.userId, workspaceId, routeKey, dto, req.user.sessionScope);
  }
}
