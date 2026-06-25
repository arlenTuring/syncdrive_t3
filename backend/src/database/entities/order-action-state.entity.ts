import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { RouteActionStatus } from './operation-route-station-action.entity';

@Entity('order_action_states')
@Index('IDX_ORDER_ACTION_ORDER', ['orderId'])
export class OrderActionState {
  @PrimaryColumn({ type: 'varchar', name: 'action_id' })
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'station_id' })
  stationId: string;

  @Column({ name: 'action_type' })
  actionType: string;

  @Column({
    type: 'enum',
    enum: RouteActionStatus,
    name: 'action_status',
    default: RouteActionStatus.PENDING,
  })
  actionStatus: RouteActionStatus;

  @Column({ name: 'trigger_offset_m', type: 'float', default: 0 })
  triggerOffsetM: number;

  @Column({ name: 'node_id', nullable: true })
  nodeId?: string;

  @Column({ type: 'bigint', name: 'actual_start_time', nullable: true })
  actualStartTime?: string;

  @Column({ type: 'bigint', name: 'actual_end_time', nullable: true })
  actualEndTime?: string;

  @Column({ type: 'text', nullable: true })
  note?: string;
}
