import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { CreateProjectRouteDto, UpdateProjectRouteDto } from './dto/project-route.dto';
import { ProjectTargetsQueryDto } from './dto/project-targets-query.dto';
import { ProjectsService } from './projects.service';

interface ProjectRequest extends Request {
  user: { userId: string; apiKeyId?: string };
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(CombinedAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  @ApiOperation({ summary: 'List project routes' })
  list(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string) {
    return this.projects.list(req.user, workspaceId);
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a project route' })
  create(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string, @Body() dto: CreateProjectRouteDto) {
    return this.projects.create(req.user, workspaceId, dto);
  }

  @Patch('projects/:projectId')
  @ApiParam({ name: 'projectId', description: 'Project route UUID' })
  update(
    @Req() req: ProjectRequest,
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectRouteDto,
  ) {
    return this.projects.update(req.user, workspaceId, projectId, dto);
  }

  @Delete('projects/:projectId')
  @ApiParam({ name: 'projectId', description: 'Project route UUID' })
  remove(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string) {
    return this.projects.remove(req.user, workspaceId, projectId);
  }

  @Get('project-targets')
  @ApiOperation({ summary: 'Discover live groups and observed direct-chat targets' })
  targets(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string, @Query() query: ProjectTargetsQueryDto) {
    return this.projects.targets(req.user, workspaceId, query);
  }

  @Post('project-targets/sync')
  @ApiOperation({ summary: 'Sync chat metadata from a connected WA session' })
  syncTargets(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string, @Body('sessionId') sessionId: string) {
    return this.projects.syncTargets(req.user, workspaceId, sessionId);
  }

  @Get('projects/audit')
  @ApiOperation({ summary: 'List project route classification history' })
  audit(@Req() req: ProjectRequest, @Param('workspaceId') workspaceId: string, @Query('limit') limit?: string) {
    return this.projects.audit(req.user, workspaceId, limit);
  }
}
