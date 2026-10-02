import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('data_admin_audits')
@Index('IDX_DATA_ADMIN_AUDIT_TIME', ['createdAt'])
export class DataAdminAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'operator_id' })
  operatorId: string;

  @Column({ name: 'source_ip', type: 'text', nullable: true })
  sourceIp: string | null;

  @Column({ name: 'request_id' })
  requestId: string;

  @Column()
  mode: string;

  @Column({ type: 'text' })
  statement: string;

  @Column()
  result: string;

  @Column({ name: 'row_count', type: 'integer', nullable: true })
  rowCount: number | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({
    name: 'created_at',
    type: 'bigint',
    default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)',
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) },
  })
  createdAt: number;
}
