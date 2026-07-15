import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MaintenanceTask,
  MaintenanceTaskPublishStatus,
  MaintenanceTaskUsageStatus,
} from '../database/entities/maintenance-task.entity';

const SEED_ROWS: Array<{
  id: string;
  name: string;
  usageStatus: MaintenanceTaskUsageStatus;
  createdAt: string;
  updatedAt: string;
}> = [
  {
    id: 'MT-ROUTINE-A',
    name: '全能-例行維運A案',
    usageStatus: MaintenanceTaskUsageStatus.IN_USE,
    createdAt: String(new Date('2027-05-01T08:30:00').getTime()),
    updatedAt: String(new Date('2027-05-01T09:15:00').getTime()),
  },
  {
    id: 'MT-ROUTINE-B',
    name: '全能-例行維運B案',
    usageStatus: MaintenanceTaskUsageStatus.IN_USE,
    createdAt: String(new Date('2027-05-01T08:30:00').getTime()),
    updatedAt: String(new Date('2027-05-01T09:15:00').getTime()),
  },
  {
    id: 'MT-ROUTINE-C',
    name: '全能-例行維運C案',
    usageStatus: MaintenanceTaskUsageStatus.IDLE,
    createdAt: String(new Date('2027-05-01T08:30:00').getTime()),
    updatedAt: String(new Date('2027-05-01T09:15:00').getTime()),
  },
];

@Injectable()
export class MaintenanceTaskSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceTaskSeedService.name);

  constructor(
    @InjectRepository(MaintenanceTask)
    private readonly repo: Repository<MaintenanceTask>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.repo.count();
    if (count > 0) return;

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
