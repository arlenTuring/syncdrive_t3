import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum DataSourceType {
  INTERNAL = 'internal', // 連線至本系統 PostgreSQL（由後端代理查詢）
  REST = 'rest', // 直接呼叫外部 REST API
  MQTT = 'mqtt', // 訂閱 MQTT 主題
}

/**
 * 規格書 §營運核心層 · 數據監控模組 · 即時營運數據
 *
 * 圖台元件的資料來源定義。元件透過資料來源取得顯示內容：internal 走後端 SQL 代理、
 * rest 直接呼叫外部 API、mqtt 訂閱即時主題。
 *
 * <strong>為什麼要有這張表。</strong>資料來源原本存在瀏覽器 localStorage
 * （syncdrive_datasources）。但圖台版面會綁定資料來源，版面若集中保存、資料來源
 * 卻留在個人瀏覽器，換一台電腦所有元件都會失去資料。資料來源與版面同屬系統資產，
 * 必須一起集中保存（2026-08-21）。
 */
@Entity('data_sources')
@Index('IDX_DATASOURCE_KEY', ['sourceKey'], { unique: true })
@Index('IDX_DATASOURCE_TYPE', ['type'])
export class DataSource_ {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 前端引用的識別碼
  @Column({ name: 'source_key' })
  sourceKey: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: DataSourceType })
  type: DataSourceType;

  /**
   * 來源設定：
   *   internal — { sql, invalidateTags }
   *   rest     — { url, method, headers, bodyTemplate }
   *   mqtt     — { topic, qos }
   * 各型別欄位不同，故以 jsonb 保存。
   */
  @Column({ type: 'jsonb', default: {} })
  config: any;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  updatedAt: number;
}
