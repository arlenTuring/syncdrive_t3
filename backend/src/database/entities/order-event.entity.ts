import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('order_events')
@Index('IDX_ORDER_EVENT_ORDER', ['orderId'])
export class OrderEvent {
  @PrimaryColumn({ type: 'varchar', name: 'event_id' })
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'request_status', default: 'PENDING' })
  requestStatus: string;

  @Column({ name: 'completion_status', nullable: true })
  completionStatus?: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @Column({ type: 'bigint', name: 'created_at' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'resolved_at', nullable: true })
  resolvedAt?: string;
}
