import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MaintenanceTask,
  MaintenanceTaskPublishStatus,
  MaintenanceTaskUsageStatus,
} from '../database/entities/maintenance-task.entity';

/** 預設不再灌入示範整備任務；空庫也不自動建立 A/B/C 案。 */
const SEED_ROWS: Array<{
  id: string;
  name: string;
  usageStatus: MaintenanceTaskUsageStatus;
  createdAt: string;
  updatedAt: string;
}> = [];

@Injectable()
export class MaintenanceTaskSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceTaskSeedService.name);

  constructor(
    @InjectRepository(MaintenanceTask)
    private readonly repo: Repository<MaintenanceTask>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.repo.count();
    if (count > 0 || SEED_ROWS.length === 0) return;

    for (const row of SEED_ROWS) {
      await this.repo.save(
        this.repo.create({
          id: row.id,
          name: row.name,
          publishStatus: MaintenanceTaskPublishStatus.PUBLISHED,
          usageStatus: row.usageStatus,
          body: {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      );
    }
    this.logger.log(`Seeded ${SEED_ROWS.length} maintenance tasks`);
  }
}
