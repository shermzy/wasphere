import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { CapabilityGuard } from '../auth/capability.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ApiKeysModule, AuthModule],
  controllers: [ContactsController],
  providers: [ContactsService, CapabilityGuard],
})
export class ContactsModule {}
