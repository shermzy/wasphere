import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { ApiKeyPermissionGuard } from '../auth/api-key-permission.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { AutomationService } from './automations.service';
import { AutomationConfirmationDto, CreateAutomationDto, UpdateAutomationDto } from './dto/automation.dto';

interface AutomationRequest extends Request {
  user: { userId: string; apiKeyId?: string };
}

@ApiTags('Automations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/automations')
@UseGuards(CombinedAuthGuard, ApiKeyPermissionGuard, CapabilityGuard)
@RequireCapability('messages')
export class AutomationsController {
  constructor(private readonly automations: AutomationService) {}

  @Get()
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'List workspace automations with their latest run' })
  list(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string) {
    return this.automations.list(req.user, workspaceId);
  }

  @Get(':automationId')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'Get one automation rule' })
  detail(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string) {
    return this.automations.detail(req.user, workspaceId, automationId);
  }

  @Get(':automationId/runs')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'List recent automation runs' })
  runs(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string) {
    return this.automations.runs(req.user, workspaceId, automationId);
  }

  @Post()
  @RequiresPermission('messages:send')
  @ApiOperation({ summary: 'Create a disabled keyword automation' })
  create(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Body() dto: CreateAutomationDto) {
    return this.automations.create(req.user, workspaceId, dto);
  }

  @Patch(':automationId')
  @RequiresPermission('messages:send')
  @ApiOperation({ summary: 'Update an automation rule' })
  update(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string, @Body() dto: UpdateAutomationDto) {
    return this.automations.update(req.user, workspaceId, automationId, dto);
  }

  @Post(':automationId/enable')
  @RequiresPermission('messages:send')
  @ApiOperation({ summary: 'Enable an automation with explicit confirmation' })
  enable(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string, @Body() dto: AutomationConfirmationDto) {
    return this.automations.enable(req.user, workspaceId, automationId, dto);
  }

  @Post(':automationId/disable')
  @RequiresPermission('messages:send')
  @ApiOperation({ summary: 'Disable an automation with explicit confirmation' })
  disable(@Req() req: AutomationRequest, @Param('workspaceId') workspaceId: string, @Param('automationId') automationId: string, @Body() dto: AutomationConfirmationDto) {
    return this.automations.disable(req.user, workspaceId, automationId, dto);
  }
}
