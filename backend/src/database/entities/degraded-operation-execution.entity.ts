import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('degraded_operation_executions')
export class DegradedOperationExecution {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'execution_id' })
  id: string;

  @Column({
    type: 'varchar',
    length: 36,
    name: 'source_plan_id',
    nullable: true,
  })
  sourcePlanId: string | null;

  @Column({ type: 'varchar', length: 200, name: 'plan_name' })
  planName: string;

  @Column({ type: 'text', name: 'plan_description', default: '' })
  planDescription: string;

  @Column({ type: 'integer' })
  level: number;

  @Column({ type: 'double precision', name: 'speed_limit_kmh' })
  speedLimitKmh: number;

  @Column({ type: 'varchar', length: 120, name: 'operator_id' })
  operatorId: string;

  @Column({ type: 'varchar', length: 40, name: 'control_status' })
  controlStatus: string;

  @Column({
    type: 'varchar',
    length: 24,
    name: 'execution_status',
    default: 'scheduled',
  })
  executionStatus: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'schedule_mode',
    default: 'immediate',
  })
  scheduleMode: string;

  @Column({ type: 'bigint', name: 'scheduled_for_operating', nullable: true })
  scheduledForOperating: string | null;

  @Column({
    type: 'varchar',
    length: 80,
    name: 'scheduled_timezone',
    default: 'Asia/Taipei',
  })
  scheduledTimezone: string;

  @Column({ type: 'bigint', name: 'started_at_operating', nullable: true })
  startedAtOperating: string | null;

  @Column({ type: 'bigint', name: 'started_at_real', nullable: true })
  startedAtReal: string | null;

  @Column({ type: 'bigint', name: 'ended_at_operating', nullable: true })
  endedAtOperating: string | null;

  @Column({ type: 'bigint', name: 'ended_at_real', nullable: true })
  endedAtReal: string | null;

  @Column({
    type: 'double precision',
    name: 'restore_speed_limit_kmh',
    nullable: true,
  })
  restoreSpeedLimitKmh: number | null;

  @Column({ type: 'jsonb', name: 'restore_checks', nullable: true })
  restoreChecks: Record<string, boolean> | null;

  @Column({
    type: 'varchar',
    length: 200,
    name: 'error_reason',
    nullable: true,
  })
  errorReason: string | null;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'idempotency_key',
    unique: true,
  })
  idempotencyKey: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({
    type: 'jsonb',
    name: 'command_tracking',
    default: () => "'[]'::jsonb",
  })
  commandTracking: unknown[];

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
