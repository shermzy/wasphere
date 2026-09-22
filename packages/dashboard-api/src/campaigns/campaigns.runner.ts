import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CampaignStatus } from '.prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from './campaigns.service';

@Injectable()
export class CampaignsRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Interval(30_000)
  async runScheduled(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.campaign.findMany({
      where: { status: CampaignStatus.SCHEDULED, scheduledAt: { lte: now } },
      select: { id: true, workspaceId: true, createdBy: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    for (const campaign of due) {
      try {
        await this.campaigns.launch({ userId: campaign.createdBy }, campaign.workspaceId, campaign.id, true);
      } catch {
        // Preflight failures leave the scheduled row intact; a claimed row is
        // never scheduled again, and unknown delivery is terminal.
      }
    }
  }
}
