import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MediaLibraryItem,
  MediaLibraryKind,
} from '../database/entities/media-library-item.entity';

const NOW = String(new Date('2026-07-01T10:00:00').getTime());

const SEED_MEDIA: Array<{ id: string; name: string; body?: Record<string, unknown> }> = [
  { id: 'MED-ARRIVAL-CHIME', name: '到站提示音', body: { durationSeconds: 3 } },
  { id: 'MED-DEPART-CHIME', name: '發車提示音', body: { durationSeconds: 3 } },
  { id: 'MED-DOOR-OPEN', name: '開門提示', body: { durationSeconds: 2 } },
  { id: 'MED-DOOR-CLOSE', name: '關門提示', body: { durationSeconds: 2 } },
  { id: 'MED-WELCOME-A', name: '歡迎音樂 A', body: { durationSeconds: 15 } },
  { id: 'MED-WELCOME-B', name: '歡迎音樂 B', body: { durationSeconds: 18 } },
  { id: 'MED-SAFETY-ANN', name: '安全廣播', body: { durationSeconds: 12 } },
];

const SEED_GROUPS: Array<{ id: string; name: string; mediaIds: string[] }> = [
  {
    id: 'MGR-ARRIVAL-PACK',
    name: '進站廣播組合',
    mediaIds: ['MED-ARRIVAL-CHIME', 'MED-WELCOME-A', 'MED-DOOR-OPEN'],
  },
  {
    id: 'MGR-DEPART-PACK',
    name: '離站廣播組合',
    mediaIds: ['MED-DOOR-CLOSE', 'MED-DEPART-CHIME'],
  },
  {
    id: 'MGR-SAFETY-PACK',
    name: '安全提示組合',
    mediaIds: ['MED-SAFETY-ANN', 'MED-DOOR-CLOSE'],
  },
];

@Injectable()
export class MediaLibrarySeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaLibrarySeedService.name);

  constructor(
    @InjectRepository(MediaLibraryItem)
    private readonly repo: Repository<MediaLibraryItem>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.repo.count();
    if (count > 0) return;

    for (const row of SEED_MEDIA) {
      await this.repo.save(
        this.repo.create({
          id: row.id,
          name: row.name,
          kind: MediaLibraryKind.MEDIA,
          body: row.body ?? {},
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
    }

    for (const row of SEED_GROUPS) {
      await this.repo.save(
        this.repo.create({
          id: row.id,
          name: row.name,
          kind: MediaLibraryKind.GROUP,
          body: { mediaIds: row.mediaIds },
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
    }

    this.logger.log(
      `Seeded ${SEED_MEDIA.length} media + ${SEED_GROUPS.length} media groups`,
    );
  }
}
