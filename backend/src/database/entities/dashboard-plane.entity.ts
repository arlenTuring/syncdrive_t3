import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum DashboardViewportMode {
  FIXED_SCALE = 'fixed-scale', // 固定等比大屏（戰情室）
  FIT_WIDTH = 'fit-width', // 寬度自適應撐滿（嵌入頁）
}

/**
 * 規格書 §營運核心層 · 數據監控模組 · 營運全景圖台
 *
 * 圖台版面（plane）的伺服器端保存。版面內容為畫布元件樹，結構隨元件型別擴充，
 * 以 jsonb 整包保存；查詢一律以 planeId 為單位取整份，不對元件樹做關聯查詢。
 *
 * <strong>為什麼要有這張表。</strong>版面原本只存在瀏覽器 localStorage
 * （syncdrive_dashboard_planes），換一台電腦或清快取就沒了，匯入匯出也只是瀏覽器
 * 讀寫本機 JSON 檔，沒有任何伺服器端版本紀錄。營運全景圖台是規範要求的核心功能，
 * 其版面屬於系統資產，必須集中保存並可稽核（2026-08-21 使用者裁決）。
 */
@Entity('dashboard_planes')
@Index('IDX_DASHBOARD_PLANE_ID', ['planeId'], { unique: true })
export class DashboardPlane {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 前端使用的版面識別碼（如 demo-plane、班表部署管理）
  @Column({ name: 'plane_id' })
  planeId: string;

  @Column()
  name: string;

  // 畫布設計尺寸（像素）
  @Column({ type: 'int' })
  width: number;

  @Column({ type: 'int' })
  height: number;

  /**
   * 畫布適配模式：固定等比大屏或寬度自適應。
   * 未設定時視為 fixed-scale，與前端預設一致。
   */
  @Column({
    type: 'enum',
    enum: DashboardViewportMode,
    name: 'viewport_mode',
    default: DashboardViewportMode.FIXED_SCALE,
  })
  viewportMode: DashboardViewportMode;

  // 畫布元件樹（含群組、元件屬性與資料來源綁定）
  @Column({ type: 'jsonb' })
  elements: any;

  /**
   * 這張儀表板自己的資料設定（2026-10-05）。
   *
   * sourceMap：元件引用的資料來源 ID → 這張儀表板實際使用的連線定義 ID。沒列到的照元件原本的 ID。
   * 連線定義（data_sources）全系統共用、可以重用；這裡只記「這張選了哪一份」，所以改 A 的選擇
   * 不會動到 B。只存 ID，不存任何連線帳密。
   */
  @Column({ name: 'data_settings', type: 'jsonb', nullable: true })
  dataSettings: { sourceMap?: Record<string, string> } | null;

  // 版本序號；每次存檔遞增，供版面異動追溯與樂觀鎖使用
  @Column({ type: 'int', default: 1 })
  version: number;

  // 是否為範本版面（範本不隨營運資料異動）
  @Column({ name: 'is_template', default: false })
  isTemplate: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @Column({
    name: 'created_at',
    type: 'bigint',
    default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  createdAt: number;

  @Column({
    name: 'updated_at',
    type: 'bigint',
    default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000',
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  updatedAt: number;
}
