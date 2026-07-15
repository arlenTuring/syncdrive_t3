import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('operation_route_stations')
export class OperationRouteStation {
  @PrimaryColumn({ type: 'varchar', name: 'station_row_id' })
  id: string;

  @Column({ name: 'route_id' })
  routeId: string;

  @Column({ name: 'sequence_order', type: 'int' })
  sequenceOrder: number;

  /** 地圖停靠點 stationId（例 station_1） */
  @Column({ name: 'station_id' })
  stationId: string;

  /** 停靠點別名（例 N2W上行站） */
  @Column({ name: 'station_display_name', default: '' })
  stationDisplayName: string;
}
