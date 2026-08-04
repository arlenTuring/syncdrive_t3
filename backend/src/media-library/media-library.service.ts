import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MediaLibraryItem,
  MediaLibraryKind,
} from '../database/entities/media-library-item.entity';

export type MediaLibraryOption = {
  id: string;
  name: string;
  kind: MediaLibraryKind;
};

@Injectable()
export class MediaLibraryService {
  constructor(
    @InjectRepository(MediaLibraryItem)
    private readonly repo: Repository<MediaLibraryItem>,
  ) {}

  /** 下拉選單用：媒體 + 媒體群組 */
  async listOptions(): Promise<{ items: MediaLibraryOption[] }> {
    const rows = await this.repo.find({
      order: { kind: 'ASC', name: 'ASC' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
      })),
    };
  }

  async listItems(args: {
    keyword?: string;
    kind?: MediaLibraryKind | 'all';
    page?: number;
    page_size?: number;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, args.page_size ?? 50));
    const qb = this.repo.createQueryBuilder('m');

    if (args.keyword?.trim()) {
      qb.andWhere('(m.name ILIKE :kw OR m.id ILIKE :kw)', {
        kw: `%${args.keyword.trim()}%`,
      });
    }
    if (args.kind === MediaLibraryKind.MEDIA || args.kind === MediaLibraryKind.GROUP) {
      qb.andWhere('m.kind = :kind', { kind: args.kind });
    }

    qb.orderBy('m.kind', 'ASC').addOrderBy('m.name', 'ASC');
    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        body: row.body,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      })),
      total,
      page,
      page_size: pageSize,
    };
  }
}
