import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CapabilityGuard } from '../auth/capability.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { CreateAiReplyDraftDto } from './dto/create-ai-reply-draft.dto';
import { AiRepliesService } from './ai-replies.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('AI Replies')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/ai-replies')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@RequireCapability('inbox')
export class AiRepliesController {
  constructor(private readonly aiReplies: AiRepliesService) {}

  @Get('status')
  @ApiOperation({ summary: 'Report whether the operator configured the AI reply provider' })
  status() {
    return this.aiReplies.status();
  }

  @Post('draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate an editable AI reply draft without sending it' })
  draft(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateAiReplyDraftDto,
  ) {
    return this.aiReplies.createDraft(req.user.userId, workspaceId, dto);
  }
}
