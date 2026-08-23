import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 規格書 §營運核心層 · 數據監控模組 · 營運全景圖台
 *
 * 各功能模組與圖台版面之對應。決定側欄各模組點進去要開哪一份版面。
 *
 * <strong>為什麼要有這張表。</strong>原存於瀏覽器 localStorage
 * （syncdrive_vtms_module_dashboard_pages）。此對應是系統配置而非個人偏好——
 * 管理者設定好之後，所有操作人員看到的模組頁面必須一致（2026-08-21）。
 */
@Entity('module_dashboard_pages')
@Index('IDX_MODULE_PAGE_MODULE', ['moduleId'])
@Index('IDX_MODULE_PAGE_PLANE', ['planeId'])
@Index('IDX_MODULE_PAGE_KEY', ['pageKey'], { unique: true })
export class ModuleDashboardPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 前端使用的頁面識別碼（如 <code>mdp-msrfby96-i4756</code>）。
   *
   * <strong>不能直接拿它當主鍵。</strong>側欄導覽的 view 識別是
   * <code>mdp:{pageKey}</code>，那個值散在畫面狀態與使用者當下的導覽位置裡，往返
   * 一次若被換成資料庫 uuid，正在看的頁面就會對不上。但它也不是 uuid，硬塞進
   * uuid 主鍵會被 Postgres 直接拒絕（2026-08-23 實測：PUT 一律 500，
   * invalid input syntax for type uuid）。所以與 vehicle_definitions、
   * dashboard_planes 一致——前端 key 是對外身分，uuid 只是內部主鍵。
   */
  @Column({ name: 'page_key' })
  pageKey: string;

  // 側欄模組群組識別碼
  @Column({ name: 'module_id' })
  moduleId: string;

  // 頁面顯示名稱
  @Column()
  label: string;

  // 對應的圖台版面（dashboard_planes.plane_id）
  @Column({ name: 'plane_id' })
  planeId: string;

  // 同一模組下的排列順序
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

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
