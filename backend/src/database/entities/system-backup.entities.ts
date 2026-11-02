import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** 只有一列（id=1）：手動與自動備份的位置和排程 */
@Entity('system_backup_settings')
export class SystemBackupSettings {
  @PrimaryColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'varchar', length: 512, name: 'manual_dir' })
  manualDir: string;

  @Column({ type: 'varchar', length: 512, name: 'auto_dir' })
  autoDir: string;

  @Column({ type: 'boolean', name: 'auto_enabled', default: false })
  autoEnabled: boolean;

  @Column({ type: 'varchar', length: 5, name: 'auto_time', default: '03:00' })
  autoTime: string;

  @Column({ type: 'integer', name: 'keep_count', default: 7 })
  keepCount: number;

  @Column({ type: 'boolean', name: 'include_files', default: true })
  includeFiles: boolean;

  @Column({ type: 'bigint', name: 'next_run_at', nullable: true })
  nextRunAt: string | null;

  @Column({ type: 'bigint', name: 'updated_at', nullable: true })
  updatedAt: string | null;

  @Column({ type: 'varchar', length: 64, name: 'updated_by', nullable: true })
  updatedBy: string | null;
}

@Entity('system_backup_runs')
@Index('UQ_SYSTEM_BACKUP_RUNNING', ['status'], { unique: true, where: `status = 'running'` })
@Index('IDX_SYSTEM_BACKUP_STARTED', ['startedAt'])
export class SystemBackupRun {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 8 })
  trigger: 'manual' | 'auto';

  /** running / success / failed / stopped / deleted */
  @Column({ type: 'varchar', length: 12 })
  status: string;

  @Column({ type: 'varchar', length: 512 })
  dir: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'boolean', name: 'include_files', default: true })
  includeFiles: boolean;

  @Column({ type: 'bigint', name: 'started_at' })
  startedAt: string;

  @Column({ type: 'bigint', name: 'finished_at', nullable: true })
  finishedAt: string | null;

  @Column({ type: 'bigint', name: 'database_bytes', nullable: true })
  databaseBytes: string | null;

  @Column({ type: 'bigint', name: 'files_bytes', nullable: true })
  filesBytes: string | null;

  @Column({ type: 'varchar', length: 64, name: 'database_sha256', nullable: true })
  databaseSha256: string | null;

  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'varchar', length: 64, name: 'operator_id', nullable: true })
  operatorId: string | null;
}
