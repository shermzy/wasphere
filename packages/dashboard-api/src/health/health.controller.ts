import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiExcludeEndpoint()
  @Get()
  check(): Promise<{ status: 'ok' }> {
    return this.databaseReady();
  }

  @ApiExcludeEndpoint()
  @Get('live')
  live() {
    return { status: 'ok' as const };
  }

  @ApiExcludeEndpoint()
  @Get('ready')
  ready(): Promise<{ status: 'ok' }> {
    return this.databaseReady();
  }

  private async databaseReady(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        database: 'unavailable',
      });
    }
  }
}
