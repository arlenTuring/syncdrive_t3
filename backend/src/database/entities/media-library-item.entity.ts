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
   * media：{ mediaType, description, textContent? } 或 { ..., file: { storageKey,
   * originalName, mimeType, sizeBytes, sha256, durationSeconds?, width?, height? } }
   * group：{ mediaIds: string[] } 組成順序
   */
  @Column({ type: 'jsonb', default: {} })
  body: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;

  /**
   * 樂觀鎖版本：每次寫入 +1（分組成員異動、更名、媒體刪除時移除分組引用）。
   * 不用 updated_at 判斷衝突，同一毫秒的兩次寫入也分得出來。
   */
  @Column({ type: 'int', name: 'row_version', default: 1 })
  version: number;
}
