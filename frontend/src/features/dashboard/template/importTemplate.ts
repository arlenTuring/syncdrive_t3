import type { DashboardPlane, CanvasElementProps, ChildWidget } from '../types';
import {
  DASHBOARD_TEMPLATE_VERSION,
  type DashboardTemplateFile,
  type TemplateImportResult,
} from './types';
import { mergeTemplateDataSources } from '../store/useDataSourceStore';
import { countBindingIssues } from './bindingHealth';
import { patchDashboardRuntimeFixes } from '../utils/migrateVehicleMonitorProtocol';
import { mapAllChildArrays } from './childArrayVariants';

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function remapChildIds(children: ChildWidget[]): ChildWidget[] {
  return children.map(child => ({
    ...child,
    id: newId(child.type),
  })) as ChildWidget[];
}

/** 匯入時重新產生 ID，避免與現有平面元件衝突 */
export function clonePlaneWithNewIds(
  body: DashboardTemplateFile['plane'],
  name?: string,
): DashboardPlane {
  // 走過所有樣板變體（見 collectAllChildArrays 註解）重建 ID，不是只顧
  // children／childrenDefault／childrenNormal——漏掉哪一種，那個變體裡的子
  // 元件會跟來源平面共用 ID，兩邊互相干擾。
  const elements: CanvasElementProps[] = body.elements.map(el => ({
    ...mapAllChildArrays(el, remapChildIds),
    id: newId('canvas'),
  }));

  return patchDashboardRuntimeFixes({
    id: newId('plane'),
    name: name ?? body.name,
    width: body.width,
    height: body.height,
    elements,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function parseTemplateFile(json: unknown): DashboardTemplateFile {
  if (!json || typeof json !== 'object') {
    throw new Error('無效的 JSON 檔案');
  }
  const o = json as Record<string, unknown>;
  if (o.kind !== 'syncdrive-dashboard-template') {
    throw new Error('不是 SyncDrive 儀表板樣板檔（缺少 kind: syncdrive-dashboard-template）');
  }
  if (typeof o.version !== 'number' || o.version > DASHBOARD_TEMPLATE_VERSION) {
    throw new Error(`樣板版本 v${o.version} 過新，請升級應用程式`);
  }
  if (!o.plane || typeof o.plane !== 'object') {
    throw new Error('樣板缺少 plane 區塊');
  }
  if (!Array.isArray(o.dataSources)) {
    throw new Error('樣板缺少 dataSources 陣列');
  }
  return o as unknown as DashboardTemplateFile;
}

export interface ImportTemplateOptions {
  /** 是否以樣板中的連線設定覆寫同 ID 的現有資料來源 */
  applyTemplateConnections?: boolean;
  planeName?: string;
}

/** 解析樣板、合併資料來源、建立新平面 */
export async function importDashboardTemplate(
  file: DashboardTemplateFile,
  options: ImportTemplateOptions = {},
): Promise<TemplateImportResult> {
  const { warnings } = await mergeTemplateDataSources(file.dataSources, {
    overwriteExisting: options.applyTemplateConnections ?? false,
  });

  const plane = clonePlaneWithNewIds(file.plane, options.planeName ?? file.meta?.name ?? file.plane.name);

  return {
    plane,
    dataSourceWarnings: warnings,
    bindingIssueCount: countBindingIssues(plane).length,
  };
}
