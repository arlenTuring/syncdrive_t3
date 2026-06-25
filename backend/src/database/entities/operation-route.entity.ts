import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('operation_routes')
export class OperationRoute {
  @PrimaryColumn({ type: 'varchar', name: 'route_id' })
  id: string;

  @Column({ name: 'route_name' })
  routeName: string;

  @Column({ name: 'line_kind', default: 'MAINLINE' })
  lineKind: string;

  /** D = 下行, U = 上行 */
  @Column({ name: 'direction_letter', length: 1 })
  directionLetter: string;
}
