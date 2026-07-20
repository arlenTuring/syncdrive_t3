import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';

const SEED_ROWS: Array<{
  id: string;
  name: string;
  usageStatus: OperationShiftUsageStatus;
  publishStatus: OperationShiftPublishStatus;
  body: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}> = [
  {
    id: 'OS-DRAFT-01',
    name: '試行調整班表',
    usageStatus: OperationShiftUsageStatus.IDLE,
    publishStatus: OperationShiftPublishStatus.DRAFT,
    body: { version: 'v0.0.1', timeTemplateName: '基礎常規' },
    createdAt: String(new Date('2027-05-02T10:00:00').getTime()),
    updatedAt: String(new Date('2027-05-02T11:20:00').getTime()),
  },
];

@Injectable()
export class OperationShiftSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OperationShiftSeedService.name);

  constructor(
    @InjectRepository(OperationShift)
    private readonly repo: Repository<OperationShift>,
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
          usageStatus: row.usageStatus,
          body: row.body,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      );
    }
    this.logger.log(`Seeded ${SEED_ROWS.length} operation shifts`);
  }
}
