import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export enum CommandType {
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  DOOR_CONTROL = 'DOOR_CONTROL',
  SET_SPEED_LIMIT = 'SET_SPEED_LIMIT',
  SET_DIRECTION = 'SET_DIRECTION',
}

@Entity('command_logs')
@Index('IDX_COMMAND_UNACKED', ['isAcked']) // 快速篩選尚未收到車端 Ack 的指令
@Index('IDX_COMMAND_VEHICLE_TIME', ['vehicleCode', 'sentAt']) // 依時間軸列出下發給車端的歷史指令
export class CommandLog {
  @PrimaryColumn({ type: 'varchar', name: 'command_id' })
  commandId: string;

  @Column({ name: 'vehicle_code' })
  vehicleCode: string;

  @Column({
    type: 'enum',
    enum: CommandType,
    name: 'action',
  })
  action: CommandType;

  @Column({ type: 'jsonb', nullable: true })
  params: any;

  @Column({ name: 'is_acked', default: false })
  isAcked: boolean;

  @Column({
    type: 'bigint',
    name: 'sent_at',
    default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)',
  })
  sentAt: string;

  @Column({ type: 'bigint', name: 'acked_at', nullable: true })
  ackedAt: string;
}
