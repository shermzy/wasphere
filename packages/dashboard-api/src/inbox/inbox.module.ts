import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { InboxController } from './inbox.controller';
import { RoutesController } from './routes.controller';
import { InboxSseController } from './inbox-sse.controller';
import { InboxService } from './inbox.service';
import { InboxIngestService } from './inbox-ingest.service';
import { InboxEventsService } from './inbox-events.service';
import { InboxSseService } from './inbox-sse.service';
import { AutomationService } from '../automations/automations.service';

// PrismaModule imported explicitly (its @Global export wasn't resolving into this
// module's injector inside the ApiKeys<->Auth resolution chain).
// ApiKeysModule -> CombinedAuthGuard depends on ApiKeysService.
// JwtModule -> InboxSseService verifies the SSE token (same secret as AuthModule).
@Module({
  imports: [
    PrismaModule,
    WorkspacesModule,
    ApiKeysModule,
    AuthModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [InboxController, InboxSseController, RoutesController],
  providers: [InboxService, InboxIngestService, InboxEventsService, InboxSseService, AutomationService, CapabilityGuard],
  // InboxIngestService -> consumed by InternalModule (ingestion hook)
  // InboxEventsService -> consumed by the SSE layer
  exports: [InboxService, InboxIngestService, InboxEventsService, AutomationService],
})
export class InboxModule {}
