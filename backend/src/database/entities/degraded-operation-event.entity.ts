import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('degraded_operation_events')
@Index('IDX_DEGRADED_EVENT_EXECUTION_TIME', ['executionId', 'realAt'])
export class DegradedOperationEvent {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'event_id' })
  id: string;

  @Column({ type: 'varchar', length: 36, name: 'execution_id', nullable: true })
  executionId: string | null;

  @Column({ type: 'varchar', length: 220, name: 'draft_key', nullable: true })
  draftKey: string | null;

  @Column({ type: 'varchar', length: 36, name: 'plan_id', nullable: true })
  planId: string | null;

  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ type: 'varchar', length: 120, name: 'operator_id' })
  operatorId: string;

  @Column({ type: 'bigint', name: 'real_at' })
  realAt: string;

  @Column({ type: 'bigint', name: 'operating_at', nullable: true })
  operatingAt: string | null;

  @Column({ type: 'jsonb', name: 'before_value', nullable: true })
  beforeValue: unknown;

  @Column({ type: 'jsonb', name: 'after_value', nullable: true })
  afterValue: unknown;

  @Column({ type: 'varchar', length: 20 })
  result: string;

  @Column({ type: 'text', name: 'error_reason', nullable: true })
  errorReason: string | null;
}
