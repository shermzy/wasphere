import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, CapabilityGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
