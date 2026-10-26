import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ScheduledOrderState =
  | 'PENDING'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

/** 尚未送給車端的人工排程；發布後仍以 operation_orders 為唯一執行契約。 */
@Entity('scheduled_order_entries')
@Index('UQ_SCHEDULED_ORDER_REQUEST_KEY', ['requestKey'], { unique: true })
@Index('IDX_SCHEDULED_ORDER_DUE', ['state', 'plannedStart'])
@Index('IDX_SCHEDULED_ORDER_VEHICLE_TIME', ['vehicleCode', 'plannedStart'])
@Index(
  'UQ_SCHEDULED_ORDER_ACTIVE_VEHICLE_TIME',
  ['vehicleCode', 'plannedStart'],
  {
    unique: true,
    where: `"state" IN ('PENDING', 'PUBLISHED')`,
  },
)
export class ScheduledOrderEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_key', type: 'varchar', length: 100 })
  requestKey: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName: string;

  @Column({ name: 'vehicle_code', type: 'varchar', length: 64 })
  vehicleCode: string;

  @Column({ name: 'route_id', type: 'varchar' })
  routeId: string;

  @Column({ name: 'map_id', type: 'varchar', nullable: true })
  mapId: string | null;

  @Column({ name: 'planned_start', type: 'bigint' })
  plannedStart: string;

  @Column({ name: 'planned_end', type: 'bigint', nullable: true })
  plannedEnd: string | null;

  @Column({ name: 'route_snapshot', type: 'jsonb' })
  routeSnapshot: Record<string, unknown>;

  @Column({ name: 'state', type: 'varchar', length: 16, default: 'PENDING' })
  state: ScheduledOrderState;

  @Column({
    name: 'operation_order_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  operationOrderId: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy: string;

  @Column({ name: 'created_at', type: 'bigint' })
  createdAt: string;

  @Column({ name: 'cancelled_at', type: 'bigint', nullable: true })
  cancelledAt: string | null;

  @Column({ name: 'published_at', type: 'bigint', nullable: true })
  publishedAt: string | null;

  @Column({ name: 'last_attempt_at', type: 'bigint', nullable: true })
  lastAttemptAt: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
