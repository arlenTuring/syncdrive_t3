import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_code', unique: true, length: 10 })
  vehicleCode: string; // e.g. PMS-01

  @Column({ name: 'display_name', nullable: true })
  displayName: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

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
