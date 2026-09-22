import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule, WorkspacesModule, AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, CapabilityGuard],
})
export class ProjectsModule {}
