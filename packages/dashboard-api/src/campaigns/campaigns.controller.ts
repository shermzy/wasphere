import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { ApiKeyPermissionGuard } from '../auth/api-key-permission.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { CampaignPrincipal, CampaignsService } from './campaigns.service';
import { CreateCampaignDto, LaunchCampaignDto, ListCampaignsQueryDto, ScheduleCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

interface CampaignRequest extends Request {
  user: CampaignPrincipal;
}

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/campaigns')
@UseGuards(CombinedAuthGuard, ApiKeyPermissionGuard, CapabilityGuard)
@RequireCapability('messages')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'List workspace campaigns' })
  list(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Query() query: ListCampaignsQueryDto) {
    return this.campaigns.list(req.user, workspaceId, query);
  }

  @Get(':campaignId')
  @RequiresPermission('messages:read')
  @ApiOperation({ summary: 'Get a campaign and recipient results' })
  detail(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string) {
    return this.campaigns.detail(req.user, workspaceId, campaignId);
  }

  @Post()
  @RequiresPermission('messages:send_bulk')
  @ApiOperation({ summary: 'Create a campaign draft from workspace contacts' })
  create(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(req.user, workspaceId, dto);
  }

  @Patch(':campaignId')
  @RequiresPermission('messages:send_bulk')
  @ApiOperation({ summary: 'Update a draft campaign' })
  update(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(req.user, workspaceId, campaignId, dto);
  }

  @Post(':campaignId/schedule')
  @RequiresPermission('messages:send_bulk')
  @ApiOperation({ summary: 'Schedule a draft campaign' })
  schedule(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string, @Body() dto: ScheduleCampaignDto) {
    return this.campaigns.schedule(req.user, workspaceId, campaignId, dto);
  }

  @Post(':campaignId/launch')
  @RequiresPermission('messages:send_bulk')
  @ApiOperation({ summary: 'Launch a draft or scheduled campaign' })
  @HttpCode(200)
  launch(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string, @Body() dto: LaunchCampaignDto) {
    return this.campaigns.launch(req.user, workspaceId, campaignId, dto.confirm);
  }

  @Post(':campaignId/cancel')
  @RequiresPermission('messages:send_bulk')
  @ApiOperation({ summary: 'Cancel a draft or scheduled campaign' })
  @HttpCode(200)
  cancel(@Req() req: CampaignRequest, @Param('workspaceId') workspaceId: string, @Param('campaignId') campaignId: string) {
    return this.campaigns.cancel(req.user, workspaceId, campaignId);
  }
}
