import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum MapVersionStatus {
  DRAFT = 'DRAFT', // 編輯中（伺服器端草稿，可跨帳號接手）
  PUBLISHED = 'PUBLISHED', // 已發布
  ARCHIVED = 'ARCHIVED', // 已封存
}

/**
 * 規格書 §資源配置層 · 場域管理模組 · 圖資資料管理
 *
 * 圖資版本內容。每一次發布保存一份完整快照，草稿亦存於此（status = DRAFT），
 * 使編輯中的圖資同樣對所有帳號可見、可接手。
 *
 * 圖資內容（節點、有向邊與行駛時間、站點、設施、區域、底圖尺寸與原點）為一整份
 * 結構化資料，結構會隨場域需求擴充，故以 jsonb 整包保存；查詢一律以
 * (mapId, version) 取整份，不對節點與邊做關聯查詢。
 */
@Entity('map_versions')
@Index('IDX_MAP_VERSION', ['mapId', 'version'], { unique: true })
@Index('IDX_MAP_VERSION_STATUS', ['mapId', 'status'])
export class MapVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'map_id' })
  mapId: string;

  // 版本號；草稿以 0 表示，發布後遞增
  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'enum', enum: MapVersionStatus, default: MapVersionStatus.DRAFT })
  status: MapVersionStatus;

  // 完整圖資內容（pointTopology、routes、areas、pixelSize、pixelOrigin 等）
  @Column({ type: 'jsonb' })
  body: any;

  // 圖資結構版本，供日後格式演進時判讀
  @Column({ name: 'schema_version', nullable: true })
  schemaVersion: string;

  // 版本說明（本次改了什麼）
  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'published_at', type: 'bigint', nullable: true, transformer: { to: (v: number) => v, from: (v: string) => (v == null ? null : Number(v)) } })
  publishedAt: number;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
