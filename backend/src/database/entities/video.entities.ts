import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * 影像監控標籤頁與歷史錄影的資料表（migration 20261023-video-monitoring.sql）。
 * 約束與索引名稱和 migration 一致，開發環境 synchronize 才不會改動它們。
 * 影片本身不在資料庫：只存設定、索引與狀態。
 */

const bigintNumber = { to: (v: number | null) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('video_settings')
@Check('CHK_VIDEO_SETTINGS_SINGLETON', `id = 1`)
@Check('CHK_VIDEO_SETTINGS_MAX_TABS', `max_tabs BETWEEN 1 AND 500`)
@Check('CHK_VIDEO_SETTINGS_MAX_SOURCES', `max_sources BETWEEN 1 AND 2000`)
export class VideoSettings {
  @PrimaryColumn({ type: 'smallint', default: 1, primaryKeyConstraintName: 'PK_VIDEO_SETTINGS' })
  id: number;

  @Column({ name: 'max_tabs', type: 'int', default: 50 })
  maxTabs: number;

  @Column({ name: 'max_sources', type: 'int', default: 200 })
  maxSources: number;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => '(EXTRACT(epoch FROM now()) * (1000)::numeric)', transformer: bigintNumber })
  updatedAt: number;
}

export type RecordingProfile = 'original' | 'balanced' | 'saving';

@Entity('video_sources')
@Check('CHK_VIDEO_SOURCE_PROFILE', `recording_profile IN ('original', 'balanced', 'saving')`)
@Check('CHK_VIDEO_SOURCE_TAGS', `jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 10`)
@Index('UQ_VIDEO_SOURCE_REQUEST', ['requestId'], { unique: true, where: 'request_id IS NOT NULL' })
export class VideoSource {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_SOURCES' })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'current_revision_id', type: 'uuid', nullable: true })
  currentRevisionId: string | null;

  @ManyToOne(() => VideoSourceRevision, { onDelete: 'RESTRICT', nullable: true, createForeignKeyConstraints: true })
  @JoinColumn({ name: 'current_revision_id', foreignKeyConstraintName: 'FK_VIDEO_SOURCE_CURRENT_REVISION' })
  currentRevision?: VideoSourceRevision | null;

  @Column({ name: 'recording_profile', type: 'varchar', length: 16, default: 'original' })
  recordingProfile: RecordingProfile;

  /** 來源是否儲存錄影（錄影以來源為準，不再看格子）；新來源預設 true */
  @Column({ name: 'recording_enabled', type: 'boolean', default: true })
  recordingEnabled: boolean;

  /** 來源分類標籤（顯示文字，最多 10 個；與監控標籤頁無關） */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  tags: string[];

  /** 一鍵複製的冪等鍵：同一請求重送不建立第二份 */
  @Column({ name: 'request_id', type: 'varchar', length: 80, nullable: true })
  requestId: string | null;

  /** worker 回報的實際狀態（與需求分開） */
  @Column({ name: 'actual_status', type: 'jsonb', default: () => `'{}'::jsonb` })
  actualStatus: Record<string, unknown>;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;

  @Column({ name: 'deleted_at', type: 'bigint', nullable: true, transformer: bigintNumber })
  deletedAt: number | null;
}

export type SourceProtocol = 'rtsp' | 'rtsps' | 'rtmp' | 'rtmps' | 'http' | 'https' | 'srt';

@Entity('video_source_revisions')
@Unique('UQ_VIDEO_REVISION_NO', ['sourceId', 'revisionNo'])
@Unique('UQ_VIDEO_REVISION_MEDIA_PATH', ['mediaPath'])
@Index('IDX_VIDEO_REVISION_SOURCE', ['sourceId', 'validFrom'])
@Check('CHK_VIDEO_REVISION_PROTOCOL', `protocol IN ('rtsp', 'rtsps', 'rtmp', 'rtmps', 'http', 'https', 'srt')`)
@Check('CHK_VIDEO_REVISION_PORT', `port IS NULL OR port BETWEEN 1 AND 65535`)
@Check('CHK_VIDEO_REVISION_TIME_BASIS', `timestamp_basis IN ('center', 'source')`)
export class VideoSourceRevision {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_SOURCE_REVISIONS' })
  id: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @ManyToOne(() => VideoSource, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'FK_VIDEO_REVISION_SOURCE' })
  source?: VideoSource;

  @Column({ name: 'revision_no', type: 'int' })
  revisionNo: number;

  @Column({ type: 'varchar', length: 8 })
  protocol: SourceProtocol;

  @Column({ type: 'varchar', length: 255 })
  host: string;

  @Column({ type: 'int', nullable: true })
  port: number | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  path: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  query: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  username: string | null;

  @Column({ name: 'secret_ciphertext', type: 'text', nullable: true })
  secretCiphertext: string | null;

  @Column({ name: 'substream_path', type: 'varchar', length: 500, nullable: true })
  substreamPath: string | null;

  @Column({ name: 'vehicle_code', type: 'varchar', length: 64, nullable: true })
  vehicleCode: string | null;

  @Column({ name: 'camera_id', type: 'varchar', length: 120, nullable: true })
  cameraId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string | null;

  @Column({ name: 'media_path', type: 'varchar', length: 80 })
  mediaPath: string;

  @Column({ name: 'timestamp_basis', type: 'varchar', length: 8, default: 'center' })
  timestampBasis: 'center' | 'source';

  @Column({ name: 'valid_from', type: 'bigint', transformer: bigintNumber })
  validFrom: number;

  @Column({ name: 'valid_to', type: 'bigint', nullable: true, transformer: bigintNumber })
  validTo: number | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;
}

@Entity('video_monitor_tabs')
@Index('IDX_VIDEO_TAB_POSITION', ['position'], { where: 'deleted_at IS NULL' })
@Check('CHK_VIDEO_TAB_TILE_COUNT', `tile_count BETWEEN 1 AND 12`)
@Check('CHK_VIDEO_TAB_ASPECT', `canvas_aspect_ratio BETWEEN 0.25 AND 4`)
export class VideoMonitorTab {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_MONITOR_TABS' })
  id: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ name: 'tile_count', type: 'int', default: 4 })
  tileCount: number;

  @Column({ name: 'layout_schema_version', type: 'int', default: 1 })
  layoutSchemaVersion: number;

  /** 監看畫布長寬比（初值 16:9，與影像比例無關）；格子座標是 0–10000 正規化整數 */
  @Column({ name: 'canvas_aspect_ratio', type: 'numeric', precision: 6, scale: 4, default: 1.7778, transformer: { to: (v: number) => v, from: (v: string | number) => Number(v) } })
  canvasAspectRatio: number;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;

  @Column({ name: 'deleted_at', type: 'bigint', nullable: true, transformer: bigintNumber })
  deletedAt: number | null;
}

@Entity('video_monitor_tiles')
@Unique('UQ_VIDEO_TILE_POSITION', ['tabId', 'position'], { deferrable: 'INITIALLY DEFERRED' })
@Index('IDX_VIDEO_TILE_SOURCE', ['sourceId'])
@Check('CHK_VIDEO_TILE_POSITION', `position BETWEEN 0 AND 11`)
@Check('CHK_VIDEO_TILE_RECT', `x >= 0 AND y >= 0 AND w >= 500 AND h >= 500 AND x + w <= 10000 AND y + h <= 10000`)
export class VideoMonitorTile {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_MONITOR_TILES' })
  id: string;

  @Column({ name: 'tab_id', type: 'uuid' })
  tabId: string;

  @ManyToOne(() => VideoMonitorTab, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tab_id', foreignKeyConstraintName: 'FK_VIDEO_TILE_TAB' })
  tab?: VideoMonitorTab;

  @Column({ type: 'int' })
  position: number;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @ManyToOne(() => VideoSource, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'FK_VIDEO_TILE_SOURCE' })
  source?: VideoSource | null;

  @Column({ name: 'display_name', type: 'varchar', length: 120, nullable: true })
  displayName: string | null;

  /** 正規化矩形（0–10000）；版面由使用者決定，不依格數自動排 */
  @Column({ type: 'int' })
  x: number;

  @Column({ type: 'int' })
  y: number;

  @Column({ type: 'int' })
  w: number;

  @Column({ type: 'int' })
  h: number;

  /** @deprecated 錄影改以來源 recording_enabled 為準；欄位保留到確認沒有舊呼叫者後移除 */
  @Column({ name: 'recording_requested', type: 'boolean', default: true })
  recordingRequested: boolean;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'template_vars', type: 'jsonb', default: () => `'{}'::jsonb` })
  templateVars: Record<string, string>;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;
}

export type CompressionPolicy = { enabled: boolean; codec: 'av1' | 'hevc'; replaceOriginal: boolean; minSavingPct: number; minVmaf: number; maxConcurrency: number };

@Entity('video_storage_policies')
@Check('CHK_VIDEO_STORAGE_SINGLETON', `id = 'default'`)
@Check('CHK_VIDEO_STORAGE_TYPE', `storage_type IN ('local', 'gcs')`)
@Check('CHK_VIDEO_STORAGE_RETENTION', `retention_days BETWEEN 1 AND 3650`)
@Check('CHK_VIDEO_STORAGE_MAX_BYTES', `max_bytes IS NULL OR max_bytes > 0`)
@Check('CHK_VIDEO_STORAGE_MIN_FREE', `min_free_bytes IS NULL OR min_free_bytes >= 0`)
@Check('CHK_VIDEO_STORAGE_WATERMARKS', `low_watermark_pct >= 10 AND high_watermark_pct <= 99 AND low_watermark_pct < high_watermark_pct`)
export class VideoStoragePolicy {
  @PrimaryColumn({ type: 'varchar', length: 16, default: 'default', primaryKeyConstraintName: 'PK_VIDEO_STORAGE_POLICIES' })
  id: string;

  @Column({ name: 'storage_type', type: 'varchar', length: 8, default: 'local' })
  storageType: 'local' | 'gcs';

  @Column({ name: 'retention_days', type: 'int', default: 7 })
  retentionDays: number;

  @Column({ name: 'max_bytes', type: 'bigint', nullable: true, transformer: bigintNumber })
  maxBytes: number | null;

  @Column({ name: 'min_free_bytes', type: 'bigint', nullable: true, transformer: bigintNumber })
  minFreeBytes: number | null;

  @Column({ name: 'local_cache_max_bytes', type: 'bigint', nullable: true, transformer: bigintNumber })
  localCacheMaxBytes: number | null;

  @Column({ name: 'high_watermark_pct', type: 'int', default: 85 })
  highWatermarkPct: number;

  @Column({ name: 'low_watermark_pct', type: 'int', default: 75 })
  lowWatermarkPct: number;

  @Column({ name: 'gcs_bucket', type: 'varchar', length: 222, nullable: true })
  gcsBucket: string | null;

  @Column({ name: 'gcs_prefix', type: 'varchar', length: 200, nullable: true })
  gcsPrefix: string | null;

  @Column({ type: 'jsonb', default: () => `'{"codec": "av1", "enabled": false, "minVmaf": 90, "minSavingPct": 15, "maxConcurrency": 1, "replaceOriginal": false}'::jsonb` })
  compression: CompressionPolicy;

  @Column({ name: 'auto_budget_bytes', type: 'bigint', nullable: true, transformer: bigintNumber })
  autoBudgetBytes: number | null;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'updated_by', type: 'varchar', length: 64, nullable: true })
  updatedBy: string | null;

  @Column({ name: 'updated_at', type: 'bigint', default: () => '(EXTRACT(epoch FROM now()) * (1000)::numeric)', transformer: bigintNumber })
  updatedAt: number;
}

export type SegmentStatus = 'WRITING' | 'READY' | 'UPLOADING' | 'REMOTE_READY' | 'FAILED' | 'DELETE_PENDING' | 'DELETED';

@Entity('video_recording_segments')
@Unique('UQ_VIDEO_SEGMENT_KEY', ['segmentKey'])
@Index('IDX_VIDEO_SEGMENT_SOURCE_TIME', ['sourceId', 'startAt', 'endAt'])
@Index('IDX_VIDEO_SEGMENT_STATUS_TIME', ['status', 'startAt'])
@Check('CHK_VIDEO_SEGMENT_STATUS', `status IN ('WRITING', 'READY', 'UPLOADING', 'REMOTE_READY', 'FAILED', 'DELETE_PENDING', 'DELETED')`)
@Check('CHK_VIDEO_SEGMENT_RANGE', `end_at >= start_at`)
export class VideoRecordingSegment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_RECORDING_SEGMENTS' })
  id: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @ManyToOne(() => VideoSource, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_id', foreignKeyConstraintName: 'FK_VIDEO_SEGMENT_SOURCE' })
  source?: VideoSource;

  @Column({ name: 'revision_id', type: 'uuid' })
  revisionId: string;

  @ManyToOne(() => VideoSourceRevision, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'revision_id', foreignKeyConstraintName: 'FK_VIDEO_SEGMENT_REVISION' })
  revision?: VideoSourceRevision;

  @Column({ name: 'segment_key', type: 'varchar', length: 400 })
  segmentKey: string;

  @Column({ name: 'start_at', type: 'bigint', transformer: bigintNumber })
  startAt: number;

  @Column({ name: 'end_at', type: 'bigint', transformer: bigintNumber })
  endAt: number;

  @Column({ type: 'varchar', length: 16 })
  status: SegmentStatus;

  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  bytes: number | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  codec: string | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  fps: string | null;

  @Column({ name: 'timestamp_basis', type: 'varchar', length: 8, default: 'center' })
  timestampBasis: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  checksum: string | null;

  @Column({ name: 'protected_until', type: 'bigint', nullable: true, transformer: bigintNumber })
  protectedUntil: number | null;

  @Column({ name: 'failure_reason', type: 'varchar', length: 300, nullable: true })
  failureReason: string | null;

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;
}

@Entity('video_segment_objects')
@Unique('UQ_VIDEO_SEGMENT_OBJECT', ['segmentId', 'rendition', 'storageType'])
@Check('CHK_VIDEO_OBJECT_STORAGE', `storage_type IN ('local', 'gcs')`)
@Check('CHK_VIDEO_OBJECT_STATUS', `status IN ('READY', 'DELETING', 'DELETED')`)
export class VideoSegmentObject {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_SEGMENT_OBJECTS' })
  id: string;

  @Column({ name: 'segment_id', type: 'uuid' })
  segmentId: string;

  @ManyToOne(() => VideoRecordingSegment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'segment_id', foreignKeyConstraintName: 'FK_VIDEO_OBJECT_SEGMENT' })
  segment?: VideoRecordingSegment;

  @Column({ type: 'varchar', length: 24, default: 'original' })
  rendition: string;

  @Column({ name: 'storage_type', type: 'varchar', length: 8 })
  storageType: 'local' | 'gcs';

  @Column({ name: 'object_key', type: 'varchar', length: 500 })
  objectKey: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  generation: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  checksum: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  bytes: number | null;

  @Column({ type: 'varchar', length: 16 })
  status: 'READY' | 'DELETING' | 'DELETED';

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;
}

export type VideoJobKind = 'probe' | 'preview' | 'upload' | 'compress' | 'delete' | 'export' | 'apply';
export type VideoJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

@Entity('video_jobs')
@Index('UQ_VIDEO_JOB_DEDUPE', ['dedupeKey'], { unique: true, where: `dedupe_key IS NOT NULL AND status IN ('queued', 'running')` })
@Index('IDX_VIDEO_JOB_PENDING', ['status', 'kind', 'createdAt'])
@Check('CHK_VIDEO_JOB_KIND', `kind IN ('probe', 'preview', 'upload', 'compress', 'delete', 'export', 'apply')`)
@Check('CHK_VIDEO_JOB_STATUS', `status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')`)
export class VideoJob {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_VIDEO_JOBS' })
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: VideoJobKind;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 200, nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: VideoJobStatus;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 })
  progress: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts: number;

  @Column({ name: 'lease_owner', type: 'varchar', length: 80, nullable: true })
  leaseOwner: string | null;

  @Column({ name: 'lease_until', type: 'bigint', nullable: true, transformer: bigintNumber })
  leaseUntil: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @Column({ name: 'created_at', type: 'bigint', transformer: bigintNumber })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', transformer: bigintNumber })
  updatedAt: number;

  @Column({ name: 'expires_at', type: 'bigint', nullable: true, transformer: bigintNumber })
  expiresAt: number | null;
}

export const VIDEO_ENTITIES = [
  VideoSettings,
  VideoSource,
  VideoSourceRevision,
  VideoMonitorTab,
  VideoMonitorTile,
  VideoStoragePolicy,
  VideoRecordingSegment,
  VideoSegmentObject,
  VideoJob,
];
