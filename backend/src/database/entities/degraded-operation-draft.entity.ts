import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('degraded_operation_drafts')
@Index('IDX_DEGRADED_DRAFT_OPERATOR', ['operatorId', 'updatedAt'])
export class DegradedOperationDraft {
  @PrimaryColumn({ type: 'varchar', length: 220, name: 'draft_key' })
  key: string;

  @Column({ type: 'varchar', length: 120, name: 'operator_id' })
  operatorId: string;

  @Column({ type: 'varchar', length: 40, name: 'draft_kind' })
  kind: string;

  @Column({ type: 'jsonb', name: 'draft_value' })
  value: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
