import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('operation_route_stations')
export class OperationRouteStation {
  @PrimaryColumn({ type: 'varchar', name: 'station_row_id' })
  id: string;

  @Column({ name: 'route_id' })
  routeId: string;

  @Column({ name: 'sequence_order', type: 'int' })
  sequenceOrder: number;

  @Column({ name: 'station_id' })
  stationId: string;

  /** 路徑進度條上的相對位置 0–100 */
  @Column({ name: 'remain_pct', type: 'int', default: 0 })
  remainPct: number;
}
