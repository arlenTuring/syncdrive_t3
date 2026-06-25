import type { DashboardPlane } from '../types';
import type { DataSourceConfig } from '../store/useDataSourceStore';

/** 儀表板樣板 JSON 格式版本 */
export const DASHBOARD_TEMPLATE_VERSION = 1;

/**
 * 儀表板樣板檔（.json）
 * - 檔首 `dataSources`：資料庫 / REST / MQTT 連線定義
 * - `plane`：平面尺寸與所有畫布、子元件屬性
 */
export interface DashboardTemplateFile {
  /** 固定識別，便於工具辨識 */
  kind: 'syncdrive-dashboard-template';
  version: number;
  exportedAt: string;
  meta: {
    name: string;
    description?: string;
    author?: string;
    tags?: string[];
  };
  /** 樣板建議的資料來源（匯入時可合併至本機） */
  dataSources: DataSourceConfig[];
  plane: Omit<DashboardPlane, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface TemplateImportResult {
  plane: DashboardPlane;
  dataSourceWarnings: string[];
  bindingIssueCount: number;
}
