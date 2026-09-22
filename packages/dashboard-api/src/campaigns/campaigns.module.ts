import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InboxModule } from '../inbox/inbox.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { CampaignsController } from './campaigns.controller';
import { CampaignsRunner } from './campaigns.runner';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [PrismaModule, WorkspacesModule, InboxModule, AuthModule, ApiKeysModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsRunner, CapabilityGuard],
  exports: [CampaignsService],
})
export class CampaignsModule {}
