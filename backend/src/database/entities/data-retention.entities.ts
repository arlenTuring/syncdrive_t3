import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('data_retention_policies')
export class DataRetentionPolicy {
  @PrimaryColumn({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'integer', name: 'retention_value', default: 30 })
  retentionValue: number;

  @Column({ type: 'varchar', length: 8, name: 'retention_unit', default: 'day' })
  retentionUnit: 'hour' | 'day';

  @Column({ type: 'integer', name: 'interval_minutes', default: 1440 })
  intervalMinutes: number;

  @Column({ type: 'bigint', name: 'next_run_at', nullable: true })
  nextRunAt: string | null;

  @Column({ type: 'bigint', name: 'last_success_at', nullable: true })
  lastSuccessAt: string | null;

  @Column({ type: 'bigint', name: 'last_failure_at', nullable: true })
  lastFailureAt: string | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @Column({ type: 'varchar', length: 64, name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}

@Entity('data_cleanup_plans')
@Index('IDX_DATA_CLEANUP_PLAN_EXPIRY', ['expiresAt'])
export class DataCleanupPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, name: 'operator_id' })
  operatorId: string;

  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'jsonb' })
  criteria: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  preview: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, name: 'protection_fingerprint' })
  protectionFingerprint: string;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'expires_at' })
  expiresAt: string;

  @Column({ type: 'bigint', name: 'consumed_at', nullable: true })
  consumedAt: string | null;
}

@Entity('data_cleanup_jobs')
@Index('UQ_DATA_CLEANUP_JOB_PLAN', ['planId'], { unique: true, where: 'plan_id IS NOT NULL' })
@Index('IDX_DATA_CLEANUP_JOB_REQUESTED', ['requestedAt'])
export class DataCleanupJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId: string | null;

  @Column({ type: 'varchar', length: 40 })
  category: string;

  @Column({ type: 'varchar', length: 12 })
  trigger: 'manual' | 'policy';

  @Column({ type: 'varchar', length: 20 })
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped';

  @Column({ type: 'jsonb' })
  criteria: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, name: 'requested_by', nullable: true })
  requestedBy: string | null;

  @Column({ type: 'bigint', name: 'requested_at' })
  requestedAt: string;

  @Column({ type: 'bigint', name: 'started_at', nullable: true })
  startedAt: string | null;

  @Column({ type: 'bigint', name: 'finished_at', nullable: true })
  finishedAt: string | null;

  @Column({ type: 'boolean', name: 'stop_requested', default: false })
  stopRequested: boolean;

  @Column({ type: 'bigint', name: 'deleted_count', default: 0 })
  deletedCount: string;

  @Column({ type: 'bigint', name: 'estimated_bytes', default: 0 })
  estimatedBytes: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  result: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
