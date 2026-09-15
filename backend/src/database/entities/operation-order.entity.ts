import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum OrderStatus {
  PENDING    = 'PENDING',    // 中心端建立訂單，尚未發車
  PROCESSING = 'PROCESSING', // 車端確認啟動，執行中
  END        = 'END',        // 任務正常結案
  FAULTED    = 'FAULTED',    // 異常受困，需人工介入
}

@Entity('operation_orders')
@Index('IDX_ORDER_VEHICLE_STATUS', ['vehicleCode', 'status']) // 快速查詢某台車的當前活躍任務
export class OperationOrder {
  @PrimaryColumn({ type: 'varchar', name: 'order_id' })
  id: string; // e.g., 260422-U1030

  @Column({ name: 'trip_code' })
  tripCode: string; // e.g., U1030

  @Column({ name: 'route_id', nullable: true })
  routeId?: string;

  @Column({ name: 'vehicle_code' })
  vehicleCode: string; // e.g., PMS05

  @Column({ name: 'priority_level', type: 'int', default: 50 })
  priorityLevel: number; // 預設 50 (正線營運)

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({ type: 'jsonb', name: 'payload', nullable: true })
  payload: any;

  @Column({ type: 'bigint', name: 'created_at', default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)' })
  createdAt: string;

  @Column({ type: 'bigint', name: 'completed_at', nullable: true })
  completedAt: string | null;

  @Column({ name: 'line_kind', nullable: true })
  lineKind?: string;

  @Column({ name: 'delay_minutes', type: 'int', default: 0, nullable: true })
  delayMinutes?: number;

  @Column({ name: 'next_station', nullable: true })
  nextStation?: string;

  @Column({ name: 'eta_remain', nullable: true })
  etaRemain?: string;

  @Column({ type: 'bigint', name: 'planned_start', nullable: true })
  plannedStart?: string;

  @Column({ type: 'bigint', name: 'planned_end', nullable: true })
  plannedEnd?: string;

  @Column({ name: 'maint_type_label', nullable: true })
  maintTypeLabel?: string;

  @Column({ name: 'maint_type_bg', nullable: true })
  maintTypeBg?: string;

  @Column({ name: 'maint_type_color', nullable: true })
  maintTypeColor?: string;

  @Column({ name: 'maint_station', nullable: true })
  maintStation?: string;

  @Column({ name: 'icon_bg_color', nullable: true })
  iconBgColor?: string;

  @Column({ name: 'progress_marker_icon', nullable: true })
  progressMarkerIcon?: string;
}
