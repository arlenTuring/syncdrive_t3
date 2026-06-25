import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('telemetry_logs')
@Index('IDX_TELEMETRY_VEHICLE_TIME', ['vehicleCode', 'timestamp'])
export class TelemetryLog {
  // 對於超表 (Hypertable) 來說，必須有一個唯一主鍵組合。
  // 我們使用 UUID 作為主鍵，但由於超表分割需要，主鍵必須包含分割用的時間欄位
  @PrimaryColumn({ type: 'uuid', generated: 'uuid' })
  id: string;

  // Hypertable 必須的時間戳
  // TypeORM 預設的 timestamp 轉譯有時會有問題，我們使用 timestamptz 確保包含時區
  @PrimaryColumn({ type: 'timestamptz', name: 'timestamp' })
  timestamp: Date;

  @Column({ name: 'vehicle_code' })
  vehicleCode: string;

  // 100% 無損保存車端傳來的原始 JSON
  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload: any;
}
