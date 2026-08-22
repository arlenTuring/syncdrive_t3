import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §資源配置層 · 場域管理模組 · 圖資資料管理
 *
 * 場域圖資主檔。一筆代表一份地圖，內容（節點、路段、站點、設施、區域）逐版保存於
 * {@link MapVersion}；本表只記錄地圖身分、目前啟用狀態與最新版本號。
 *
 * <strong>為什麼要有這張表。</strong>圖資原本的保存方式是：編輯中的草稿與地圖清單
 * 都存在瀏覽器 localStorage，只有按下發布才會寫成伺服器端 JSON 檔
 * （backend/data/published-maps）。後果是一個人建的地圖別人看不到、換一台電腦連
 * 有哪些地圖都不知道，發布後的檔案也沒有版本歷史與稽核。圖資是整個系統共用的資產，
 * 必須集中保存並對所有帳號一致（2026-08-21 使用者裁決）。
 */
@Entity('maps')
@Index('IDX_MAP_ID', ['mapId'], { unique: true })
@Index('IDX_MAP_ACTIVE', ['isActive'])
export class MapEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 地圖識別碼（沿用既有命名，如 map-1785414999691-6mn3kdm）
  @Column({ name: 'map_id' })
  mapId: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // 目前啟用的地圖；全系統僅一份為 true
  @Column({ name: 'is_active', default: false })
  isActive: boolean;

  // 最新已發布版本號；尚未發布為 0
  @Column({ name: 'current_version', type: 'int', default: 0 })
  currentVersion: number;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
