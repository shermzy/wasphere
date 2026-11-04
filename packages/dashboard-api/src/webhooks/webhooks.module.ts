import { Module } from '@nestjs/common';
import { WebhooksController, WebhooksReadController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, ApiKeysModule, PrismaModule],
  controllers: [WebhooksReadController, WebhooksController],
  providers: [WebhooksService, CapabilityGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
