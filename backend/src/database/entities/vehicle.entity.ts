import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_code', unique: true, length: 64 })
  vehicleCode: string; // 使用者建立時確定的穩定 MQTT／憑證身分

  @Column({ name: 'display_name', nullable: true })
  displayName: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'initial_mileage_km', default: 0 })
  initialMileageKm: string;

  /** 管理者設定的「可接新任務」，不是車端 vehicle_phase 或在線狀態。 */
  @Column({ name: 'service_enabled', default: true })
  serviceEnabled: boolean;

  @Column({ type: 'int', name: 'row_version', default: 1 })
  rowVersion: number;

  // 為了嚴格符合 13 位毫秒級 Timestamp 規範，我們以 bigint 儲存 epoch
  @Column({
    type: 'bigint',
    name: 'created_at',
    default: () => '(EXTRACT(EPOCH FROM NOW()) * 1000)',
  })
  createdAt: string;

  @Column({ type: 'bigint', name: 'updated_at', nullable: true })
  updatedAt: string;
}
