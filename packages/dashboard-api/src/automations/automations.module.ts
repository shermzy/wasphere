import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AutomationsController } from './automations.controller';

@Module({
  imports: [InboxModule, AuthModule, ApiKeysModule],
  controllers: [AutomationsController],
})
export class AutomationsModule {}
