import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { InboxModule } from '../inbox/inbox.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [ApiKeysModule, InboxModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
