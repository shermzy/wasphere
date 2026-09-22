import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AiRepliesController } from './ai-replies.controller';
import { AiRepliesService } from './ai-replies.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AiRepliesController],
  providers: [AiRepliesService, CapabilityGuard],
  exports: [AiRepliesService],
})
export class AiRepliesModule {}
