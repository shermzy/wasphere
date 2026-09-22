import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, CombinedAuthGuard, CapabilityGuard],
  exports: [ApiKeysService, CombinedAuthGuard],
})
export class ApiKeysModule {}
