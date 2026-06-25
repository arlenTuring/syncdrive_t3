import { buildExportFilename } from '../../../lib/exportFilename';
import type { DashboardPlane, ChildWidget, WidgetDataBinding } from '../types';
import {
  getDataSources,
  type DataSourceConfig,
} from '../store/useDataSourceStore';
import {
  DASHBOARD_TEMPLATE_VERSION,
  type DashboardTemplateFile,
} from './types';

function collectBindingFromWidget(w: WidgetDataBinding, ids: Set<string>, mqttIds: Set<string>) {
  if (w.dataSourceId) ids.add(w.dataSourceId);
  if (w.mqttDataSourceId) mqttIds.add(w.mqttDataSourceId);
}

function collectFromPlane(plane: DashboardPlane) {
  const dataSourceIds = new Set<string>();
  const mqttIds = new Set<string>();

  for (const el of plane.elements) {
    if (el.dataSourceId) dataSourceIds.add(el.dataSourceId);
    for (const child of el.children) {
      collectBindingFromWidget(child as ChildWidget & WidgetDataBinding, dataSourceIds, mqttIds);
    }
  }

  return { dataSourceIds, mqttIds: mqttIds };
}

function pickReferencedDataSources(
  dataSourceIds: Set<string>,
  mqttIds: Set<string>,
): DataSourceConfig[] {
  const all = getDataSources();
  const needed = new Set([...dataSourceIds, ...mqttIds]);
  return all.filter(ds => needed.has(ds.id));
}

/** 將目前平面匯出為可部署的樣板 JSON */
export function buildDashboardTemplate(
  plane: DashboardPlane,
  meta?: Partial<DashboardTemplateFile['meta']>,
): DashboardTemplateFile {
  const { dataSourceIds, mqttIds } = collectFromPlane(plane);
  const dataSources = pickReferencedDataSources(dataSourceIds, mqttIds);

  const { id: _id, createdAt: _c, updatedAt: _u, ...planeBody } = plane;

  return {
    kind: 'syncdrive-dashboard-template',
    version: DASHBOARD_TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      name: meta?.name ?? plane.name,
      description: meta?.description,
      author: meta?.author,
      tags: meta?.tags,
    },
    dataSources,
    plane: planeBody,
  };
}

export function downloadTemplateJson(template: DashboardTemplateFile, filename?: string) {
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    buildExportFilename(template.meta.name, { kind: 'dashboard-template' });
  a.click();
  URL.revokeObjectURL(url);
}
