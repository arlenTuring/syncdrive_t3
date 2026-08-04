import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/** 單一媒體 或 媒體群組（一連串媒體） */
export enum MediaLibraryKind {
  MEDIA = 'media',
  GROUP = 'group',
}

@Entity('media_library_items')
@Index('IDX_MEDIA_LIBRARY_KIND', ['kind'])
export class MediaLibraryItem {
  @PrimaryColumn({ type: 'varchar', name: 'media_id' })
  id: string;

  @Column({ name: 'name' })
  name: string;

  @Column({
    type: 'varchar',
    name: 'kind',
    default: MediaLibraryKind.MEDIA,
  })
  kind: MediaLibraryKind;

  /**
   * media：可放 durationSeconds、fileKey 等
   * group：{ mediaIds: string[] } 組成順序
   */
  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
