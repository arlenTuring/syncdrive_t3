import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TimeTemplate,
  TimeTemplatePublishStatus,
  TimeTemplateUsageStatus,
} from '../database/entities/time-template.entity';

const SEED_ROWS: Array<{
  id: string;
  name: string;
  publishStatus: TimeTemplatePublishStatus;
  createdAt: string;
  updatedAt: string;
}> = [
  {
    id: 'TT-BASIC-OPS',
    name: '基礎常規營運',
    publishStatus: TimeTemplatePublishStatus.PUBLISHED,
    createdAt: String(new Date('2026-05-01T08:00:00').getTime()),
    updatedAt: String(new Date('2026-05-02T14:30:00').getTime()),
  },
  {
    id: 'TT-HOLIDAY-FIXED',
    name: '法定假日恆定',
    publishStatus: TimeTemplatePublishStatus.PUBLISHED,
    createdAt: String(new Date('2026-04-15T09:00:00').getTime()),
    updatedAt: String(new Date('2026-04-20T11:00:00').getTime()),
  },
  {
    id: 'TT-EXTREME-WEATHER',
    name: '極端天氣限制',
    publishStatus: TimeTemplatePublishStatus.DRAFT,
    createdAt: String(new Date('2026-06-01T10:00:00').getTime()),
    updatedAt: String(new Date('2026-06-01T10:00:00').getTime()),
  },
];

@Injectable()
export class TimeTemplateSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimeTemplateSeedService.name);

  constructor(
    @InjectRepository(TimeTemplate)
    private readonly repo: Repository<TimeTemplate>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.repo.count();
    if (count > 0) return;

    for (const row of SEED_ROWS) {
      await this.repo.save(
        this.repo.create({
          id: row.id,
          name: row.name,
          publishStatus: row.publishStatus,
          usageStatus: TimeTemplateUsageStatus.IDLE,
          body: {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      );
    }
    this.logger.log(`Seeded ${SEED_ROWS.length} time templates`);
  }
}
