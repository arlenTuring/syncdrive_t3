import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum InterlockStatus {
  REQUESTED = 'REQUESTED', // 車端請求路權
  GRANTED = 'GRANTED', // 中心端授予路權
  ACTIVE = 'ACTIVE', // 車輛持有路權中（進入路口）
  RELEASED = 'RELEASED', // 車輛釋放路權（離開路口）
  DENIED = 'DENIED', // 路權被拒絕（路口已被其他車占用）
}

/**
 * 規格書 §車道路口閉鎖 (Lane & Junction Lock Manager)
 * 記錄路口閉鎖的完整生命週期（請求→授予→持有→釋放），
 * 確保同一時間只有一台車能進入特定路口，防止路權重疊。
 */
@Entity('junction_interlock_logs')
@Index('IDX_INTERLOCK_JUNCTION_STATUS', ['junctionId', 'status'])
@Index('IDX_INTERLOCK_VEHICLE_TIME', ['vehicleCode', 'requestedAt'])
export class JunctionInterlockLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 路口識別碼（對應地圖節點）
  @Column({ name: 'junction_id' })
  junctionId: string;

  // 持有路權的車輛代號
  @Column({ name: 'vehicle_code' })
  vehicleCode: string;

  // 聯鎖狀態（嚴格狀態機）
  @Column({
    type: 'enum',
    enum: InterlockStatus,
    default: InterlockStatus.REQUESTED,
  })
  status: InterlockStatus;

  // 請求時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'requested_at' })
  requestedAt: string;

  // 授予時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'granted_at', nullable: true })
  grantedAt: string;

  // 釋放時間 (Epoch ms)
  @Column({ type: 'bigint', name: 'released_at', nullable: true })
  releasedAt: string;

  // 路口座標快照 {lat, lng}
  @Column({ type: 'jsonb', nullable: true })
  location: any;

  // 申請時的號誌燈色快照
  @Column({ type: 'jsonb', name: 'signal_state', nullable: true })
  signalState: any;

  // 若被拒絕，記錄原因
  @Column({ name: 'denial_reason', type: 'text', nullable: true })
  denialReason: string;
}
