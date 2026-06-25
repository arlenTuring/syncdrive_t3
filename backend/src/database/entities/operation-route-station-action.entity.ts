import { Entity, Column, PrimaryColumn } from 'typeorm';

export enum RouteActionStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('operation_route_station_actions')
export class OperationRouteStationAction {
  @PrimaryColumn({ type: 'varchar', name: 'action_template_id' })
  id: string;

  @Column({ name: 'station_row_id' })
  stationRowId: string;

  @Column({ name: 'route_id' })
  routeId: string;

  @Column({ name: 'sequence_order', type: 'int' })
  sequenceOrder: number;

  @Column({ name: 'action_type' })
  actionType: string;

  /** 觸發點相對於該站點的距離（公尺，負值表示進站前） */
  @Column({ name: 'trigger_offset_m', type: 'float', default: 0 })
  triggerOffsetM: number;

  @Column({ name: 'node_id', nullable: true })
  nodeId?: string;
}
