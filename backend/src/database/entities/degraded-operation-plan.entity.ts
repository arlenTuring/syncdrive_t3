import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('degraded_operation_plans')
export class DegradedOperationPlan {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'plan_id' })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'integer' })
  level: number;

  @Column({ type: 'double precision', name: 'speed_limit_kmh' })
  speedLimitKmh: number;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at' })
  updatedAt: string;
}
