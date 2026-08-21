import { useState, useCallback, useRef } from 'react';
import type { DashboardPlane, CanvasElementProps, ChildWidget, LineChartWidget, WidgetType, CanvasKind } from './types';
import { createWidget } from './types';
import { validatePlane, validateGroupTemplate, type LayoutIssue } from './utils/collision';
import {
  useDashboardHistory,
  type DashboardEditorSnapshot,
} from './hooks/useDashboardHistory';

import {
  DASHBOARD_LAYOUT_SEED_KEY as LAYOUT_SEED_KEY,
  DASHBOARD_PLANES_STORAGE_KEY as STORAGE_KEY,
} from '../../lib/canvasCacheReset';
import { createBlankVehicleForContainer } from '../vehicle-editor/storage/vehicleDefinitionStorage';
import { canAddWidgetToCanvas } from './utils/widgetPlacementRules';
import { cloneDemoPlane, DEMO_LAYOUT_SEED } from './constants/demoPlane';
import {
  ensureDeploymentDataStatsPanel,
  buildVehicleOpsTitlePanel,
  DEPLOYMENT_PLANE_NAME,
  DEPLOY_VEHICLE_TITLE_PANEL_ID,
  DEPLOY_VEHICLE_OPS_GROUP_ID,
} from './constants/deploymentPlane';
import {
  applyWidgetFormat,
  canApplyWidgetFormat,
  extractWidgetFormat,
  type WidgetFormatSnapshot,
} from './utils/widgetFormatPainter';
import {
  getDefaultChildren,
  patchGroupChildrenByLane,
  type DualCanvasLane,
} from './utils/dualCanvas';
import { migrateChildWidgetGenerics } from './utils/migrateWidgetGenerics';
import { needsDashboardRuntimePatch, patchDashboardRuntimeFixes } from './utils/migrateVehicleMonitorProtocol';

const REMOVED_WIDGET_TYPES = new Set([
  'schematic-track',
  'event-center-panel',
  'shift-center-panel',
  'shift-progress-block',
  'event-log',
]);

const DEMO_BEHAVIOR_KEYS = [
  'demoAnimate',
  'demoAnimateSequence',
  'demoAnimateIntervalMs',
  'demoSyncShiftPct',
  'demoSpeed',
  'demoLoad',
] as const;

function stripWidgetDemoBehavior(child: ChildWidget): ChildWidget {
  const next = { ...child } as Record<string, unknown>;
  for (const key of DEMO_BEHAVIOR_KEYS) delete next[key];
  return migrateChildWidgetGenerics(next as unknown as ChildWidget);
}

function migrateCanvasElement(el: CanvasElementProps): CanvasElementProps {
  let next: CanvasElementProps = {
    ...el,
    children: (el.children ?? [])
      .filter(c => !REMOVED_WIDGET_TYPES.has(c.type))
      .map(stripWidgetDemoBehavior),
  };
  if (next.canvasKind === 'map-platform') {
    if (next.mapId === 'vtms-main-loop' || next.mapId === 'vtms-current') {
      next = { ...next, mapId: 't3-main-version' };
    }
    if (next.label === '即時圖台') {
      next = {
        ...next,
        mapId: next.mapId || 't3-main-version',
      };
    }
    return next;
  }

  const mapChild = next.children.find(c => c.type === 'map-canvas');
  if (mapChild && mapChild.type === 'map-canvas') {
    const overlays = next.children.filter(c => c.type !== 'map-canvas');
    const legacyMapId = mapChild.mapId === 'vtms-main-loop' || mapChild.mapId === 'vtms-current';
    next = {
      ...next,
      canvasKind: 'map-platform',
      mapId: legacyMapId ? 't3-main-version' : (mapChild.mapId || 't3-main-version'),
      zoomFactor: mapChild.zoomFactor ?? 1.35,
      backgroundColor: '#020617',
      children: overlays,
    };
  }
  return next;
}

const DEMO_LAYOUT_VERSION = 114;

function freshDemoPlane(): DashboardPlane {
  return { ...cloneDemoPlane(), demoLayoutVersion: DEMO_LAYOUT_VERSION } as DashboardPlane;
}

/** 內建範例應有的核心畫布標籤（用於偵測損壞的本機快取） */
const DEMO_CORE_LABELS = ['事件中心', '班次中心', '運能趨勢', '即時圖台'] as const;

const SHIFT_GROUP_LABELS = new Set(['正線班次', '整備班表']);

/** 依 SQL 重複渲染的群組：範本子元件或資料綁定遺失時從內建範例補回 */
const DATA_GROUP_LABELS = new Set([
  '車輛狀態', '車輛分佈', '整備分佈', '事件輪播',
  ...SHIFT_GROUP_LABELS,
]);

function isDemoPlaneBroken(plane: DashboardPlane): boolean {
  if (plane.id !== 'demo-plane') return false;
  const elements = plane.elements ?? [];
  if (elements.length < 8) return true;
  const labels = new Set(elements.map((e) => e.label ?? ''));
  for (const required of DEMO_CORE_LABELS) {
    if (!labels.has(required)) return true;
  }
  for (const panelLabel of ['事件中心', '班次中心', '運能趨勢'] as const) {
    const panel = elements.find((e) => e.label === panelLabel);
    if (panel && (panel.children?.length ?? 0) === 0) return true;
  }
  for (const groupLabel of DATA_GROUP_LABELS) {
    const group = elements.find((e) => e.label === groupLabel);
    if (!group) continue;
    if ((group.children?.length ?? 0) === 0) return true;
    if (!group.dataSourceId || !group.sqlQuery?.trim()) return true;
  }
  return false;
}

function isLegacyVtmsLayout(plane: DashboardPlane): boolean {
  const labels = (plane.elements ?? []).map(e => e.label ?? '');
  if (labels.some(l => /班次格位|事件滾動|格位/.test(l))) return true;
  // 單一複合面板鎖死子元件時，強制還原為可編輯子元件版面
  for (const el of plane.elements ?? []) {
    if (el.label !== '事件中心' && el.label !== '班次中心') continue;
    const ch = el.children ?? [];
    if (ch.some(c => ['event-center-panel', 'shift-center-panel', 'shift-progress-block'].includes(c.type))) {
      return true;
    }
  }
  return false;
}

/** 種子變更時清除舊平面，強制從內建快照重新載入 */
function ensureLayoutSeed(): void {
  try {
    const stored = localStorage.getItem(LAYOUT_SEED_KEY);
    if (!stored) {
      localStorage.setItem(LAYOUT_SEED_KEY, DEMO_LAYOUT_SEED);
      return;
    }
    if (stored !== DEMO_LAYOUT_SEED) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(LAYOUT_SEED_KEY, DEMO_LAYOUT_SEED);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

const SHIFT_GROUP_KEYS: (keyof CanvasElementProps)[] = [
  'groupRepeatMode', 'slotCount', 'slotKeyField', 'groupSlotAssignment', 'groupTransition',
  'layoutMode', 'gridColumns', 'groupTileFit', 'groupTileAlign', 'groupTilePadding', 'groupTilePadX', 'groupTilePadY',
  'templateHideChrome', 'gapX', 'templateWidth', 'templateHeight',
  'dataSourceId', 'sqlQuery', 'refreshInterval', 'variableName', 'iteratorField',
];

function patchRouteProgressMqtt(child: ChildWidget): ChildWidget {
  return child;
}

function ensureDemoGroupChildren(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refByLabel = new Map(ref.elements.map(el => [el.label, el]));
  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (!el.isGroup) return el;
      const seed = refByLabel.get(el.label ?? '');
      if (!seed) return el;

      let next = el;
      if (DATA_GROUP_LABELS.has(el.label ?? '')) {
        const merged: Partial<CanvasElementProps> = {};
        for (const key of SHIFT_GROUP_KEYS) {
          const current = el[key];
          const missing = current === undefined
            || (key === 'sqlQuery' && typeof current === 'string' && !current.trim())
            || (key === 'dataSourceId' && typeof current === 'string' && !current.trim());
          if (!missing) continue;
          const val = seed[key];
          if (val !== undefined) (merged as Record<string, unknown>)[key] = val;
        }
        if (Object.keys(merged).length > 0) {
          next = { ...el, ...merged };
        }
      }

      if ((next.children?.length ?? 0) === 0 && seed.children?.length) {
        return { ...next, children: JSON.parse(JSON.stringify(seed.children)) as ChildWidget[] };
      }

      if (SHIFT_GROUP_LABELS.has(el.label ?? '') && next.children?.length) {
        return {
          ...next,
          children: next.children!.map(patchRouteProgressMqtt),
        };
      }

      return next;
    }),
  };
}

/** 事件輪播：索引變數模式 + 子元件各自 SQL */
function migrateEventScrollLayout(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refScroll = ref.elements.find(e => e.label === '事件輪播');
  if (!refScroll?.children?.length) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '事件輪播') return el;
      const firstChild = el.children?.[0];
      const hasIndexSql = firstChild?.type === 'color-block'
        && !!(firstChild as { dataSourceId?: string }).dataSourceId;
      const needsFix =
        el.groupVariableMode !== 'index'
        || !hasIndexSql
        || el.groupTileFit !== 'fixed'
        || (el.children?.length ?? 0) !== refScroll.children!.length;
      if (!needsFix) return el;
      return {
        ...el,
        groupVariableMode: 'index',
        groupTileFit: 'fixed',
        groupTileAlign: 'center',
        templateWidth: refScroll.templateWidth,
        templateHeight: refScroll.templateHeight,
        iteratorField: undefined,
        children: JSON.parse(JSON.stringify(refScroll.children)) as ChildWidget[],
      };
    }),
  };
}

/** 事件中心：移除舊疊層空狀態，輪播群組改雙畫板 + 索引變數 item */
function migrateEventCenterLayout(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refParent = ref.elements.find(e => e.label === '事件中心');
  const refScroll = ref.elements.find(e => e.label === '事件輪播');
  if (!refParent || !refScroll) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label === '事件中心') {
        const hasListOverlay = (el.children ?? []).some(
          c => c.type === 'empty-state'
            || (c.type === 'color-block' && (c.y ?? 0) >= EVENT_KPI_H - 4),
        );
        if (!hasListOverlay) return el;
        return {
          ...el,
          children: JSON.parse(JSON.stringify(refParent.children)) as ChildWidget[],
        };
      }
      if (el.label !== '事件輪播') return el;
      const normal = refScroll.childrenNormal ?? refScroll.children ?? [];
      return {
        ...el,
        dualCanvasEnabled: true,
        defaultPanelEnabled: refScroll.defaultPanelEnabled ?? true,
        displayGate: refScroll.displayGate ?? { signal: 'rowCount', operator: 'gte', compareValue: '1' },
        groupVariableMode: 'index',
        variableName: refScroll.variableName ?? 'item',
        groupTileFit: 'fixed',
        groupTileAlign: 'center',
        templateWidth: refScroll.templateWidth,
        templateHeight: refScroll.templateHeight,
        childrenNormal: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
        childrenDefault: JSON.parse(JSON.stringify(refScroll.childrenDefault ?? [])) as ChildWidget[],
        children: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
      };
    }),
  };
}

const EVENT_KPI_H = 100;

/** 整備班表：對齊 Figma Card 299×196 */
function migrateMaintenanceShiftCardFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '整備班表');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '整備班表') return el;
      return {
        ...el,
        templateWidth: refPanel.templateWidth,
        templateHeight: refPanel.templateHeight,
        groupTilePadY: refPanel.groupTilePadY,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 正線班表：對齊 Figma Card 299×196 */
function migrateMainlineShiftCardFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '正線班次');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '正線班次') return el;
      return {
        ...el,
        templateWidth: refPanel.templateWidth,
        templateHeight: refPanel.templateHeight,
        groupTilePadY: refPanel.groupTilePadY,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 載具監控列：對齊 Figma Card 306×192 */
function migrateVehicleMonitorFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '車輛狀態');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '車輛狀態') return el;
      return {
        ...el,
        height: refPanel.height,
        backgroundColor: refPanel.backgroundColor,
        templateWidth: refPanel.templateWidth,
        templateHeight: refPanel.templateHeight,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 車輛分佈：對齊 Figma Card 652×91 + 分段色條 */
function migrateVehicleDistributionFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '車輛分佈');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '車輛分佈') return el;
      return {
        ...el,
        height: refPanel.height,
        backgroundColor: refPanel.backgroundColor,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 整備分布：對齊 Figma Card 652×227 + 2×3 格位卡 */
function migrateMaintenanceDistributionFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '整備分佈');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '整備分佈') return el;
      return {
        ...el,
        height: refPanel.height,
        backgroundColor: refPanel.backgroundColor,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 運能趨勢：對齊 Figma Card 652×298 + KPI + 折線圖 */
function migrateCapacityTrendFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '運能趨勢');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '運能趨勢') return el;
      return {
        ...el,
        height: refPanel.height,
        backgroundColor: refPanel.backgroundColor,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 班次中心：對齊 Figma Card 330×196 + 達成卡 306×84 */
function migrateShiftCenterFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refPanel = ref.elements.find(e => e.label === '班次中心');
  if (!refPanel) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '班次中心') return el;
      return {
        ...el,
        height: refPanel.height,
        backgroundColor: refPanel.backgroundColor,
        children: JSON.parse(JSON.stringify(refPanel.children)) as ChildWidget[],
      };
    }),
  };
}

/** 事件中心／輪播：對齊 Figma Card 330×196 + Event Card 306×84 */
function migrateEventCenterFigma(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refParent = ref.elements.find(e => e.label === '事件中心');
  const refScroll = ref.elements.find(e => e.label === '事件輪播');
  if (!refParent || !refScroll) return plane;

  const normal = refScroll.childrenNormal ?? refScroll.children ?? [];
  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label === '事件中心') {
        return {
          ...el,
          height: refParent.height,
          backgroundColor: refParent.backgroundColor,
          children: JSON.parse(JSON.stringify(refParent.children)) as ChildWidget[],
        };
      }
      if (el.label === '事件輪播') {
        return {
          ...el,
          y: refScroll.y,
          height: refScroll.height,
          templateWidth: refScroll.templateWidth,
          templateHeight: refScroll.templateHeight,
          children: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
          childrenNormal: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
          childrenDefault: JSON.parse(JSON.stringify(refScroll.childrenDefault ?? [])) as ChildWidget[],
        };
      }
      return el;
    }),
  };
}

/** 事件輪播：對齊設計稿事件卡範本 */
function migrateEventBarDesign(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refScroll = ref.elements.find(e => e.label === '事件輪播');
  if (!refScroll) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '事件輪播') return el;
      const normal = refScroll.childrenNormal ?? refScroll.children ?? [];
      return {
        ...el,
        templateWidth: refScroll.templateWidth,
        templateHeight: refScroll.templateHeight,
        childrenNormal: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
        childrenDefault: JSON.parse(JSON.stringify(refScroll.childrenDefault ?? [])) as ChildWidget[],
        children: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
      };
    }),
  };
}

/** 事件輪播：啟用雙畫板（預設／常態互斥） */
function migrateDualCanvasEventScroll(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refScroll = ref.elements.find(e => e.label === '事件輪播');
  if (!refScroll?.dualCanvasEnabled) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '事件輪播') return el;
      if (el.dualCanvasEnabled && (el.childrenDefault?.length ?? 0) > 0) return el;
      const normal = refScroll.childrenNormal ?? refScroll.children ?? [];
      return {
        ...el,
        dualCanvasEnabled: true,
        defaultPanelEnabled: refScroll.defaultPanelEnabled ?? true,
        displayGate: refScroll.displayGate ?? { signal: 'rowCount', operator: 'gte', compareValue: '1' },
        childrenNormal: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
        childrenDefault: JSON.parse(JSON.stringify(refScroll.childrenDefault ?? [])) as ChildWidget[],
        children: JSON.parse(JSON.stringify(normal)) as ChildWidget[],
      };
    }),
  };
}

/** 運能趨勢：還原四欄 KPI + 固定視窗折線圖（對照設計稿） */
function migrateCapacityTrendLayout(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refTrend = ref.elements.find(e => e.label === '運能趨勢');
  if (!refTrend?.children?.length) return plane;

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '運能趨勢') return el;
      const statCount = (el.children ?? []).filter(c => c.type === 'stat-card').length;
      const chart = (el.children ?? []).find(
        (c): c is LineChartWidget => c.type === 'line-chart',
      );
      const rollingWindow = chart?.xAxis?.timeWindow?.enabled === true;
      if (statCount >= 4 && !rollingWindow && chart?.xAxis?.highlightPivot) return el;
      return {
        ...el,
        children: JSON.parse(JSON.stringify(refTrend.children)) as ChildWidget[],
      };
    }),
  };
}

/** 運能趨勢折線圖：補上第二條預期走勢線與雙欄位 SQL */
function migrateCapacityTrendLineChart(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refTrend = ref.elements.find(e => e.label === '運能趨勢');
  const seedChart = refTrend?.children?.find((c): c is LineChartWidget => c.type === 'line-chart');
  if (!seedChart) return plane;

  const patchChart = (ch: ChildWidget): ChildWidget => {
    if (ch.type !== 'line-chart') return ch;
    const chart = ch as LineChartWidget;
    const hasForecast =
      chart.yFields?.includes('forecast_util')
      || chart.series?.some(s => s.yField === 'forecast_util');
    if (hasForecast && (chart.series?.length ?? 0) >= 2) return chart;
    return {
      ...chart,
      series: seedChart.series,
      yFields: seedChart.yFields,
      strokeColors: seedChart.strokeColors,
      sqlQuery: seedChart.sqlQuery,
      xField: seedChart.xField,
      xAxis: seedChart.xAxis ?? chart.xAxis,
    };
  };

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (el.label !== '運能趨勢') return el;
      return { ...el, children: (el.children ?? []).map(patchChart) };
    }),
  };
}

function widgetSqlBindingMissing(c: ChildWidget): boolean {
  if (!['stat-card', 'text', 'progress-bar', 'line-chart'].includes(c.type)) return false;
  const w = c as { dataSourceId?: string; sqlQuery?: string; valueField?: string };
  return !!w.valueField?.trim() && (!w.dataSourceId?.trim() || !w.sqlQuery?.trim());
}

/** 班次中心／運能趨勢：子元件 SQL 綁定遺失時從內建範例還原 */
function migrateShiftCenterPanels(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refByLabel = new Map(ref.elements.map(el => [el.label, el]));
  const panelLabels = new Set(['班次中心', '運能趨勢']);

  return {
    ...plane,
    elements: plane.elements.map(el => {
      if (!panelLabels.has(el.label ?? '')) return el;
      const seed = refByLabel.get(el.label ?? '');
      if (!seed?.children?.length) return el;
      const children = el.children ?? [];
      const needsRestore = children.length === 0 || children.some(widgetSqlBindingMissing);
      if (!needsRestore) return el;
      return {
        ...el,
        children: JSON.parse(JSON.stringify(seed.children)) as ChildWidget[],
      };
    }),
  };
}

function migrateDemoMapPlatformId(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.canvasKind !== 'map-platform') return el;
      if (el.mapId === 'vtms-current' || el.mapId === 'vtms-main-loop') {
        return { ...el, mapId: 't3-main-version' };
      }
      return el;
    }),
  };
}

function migrateMapPlatformVehicleContainer(plane: DashboardPlane): DashboardPlane {
  const ref = cloneDemoPlane();
  const refMap = ref.elements.find((e) => e.label === '即時圖台');
  const refVehicle = refMap?.children?.find((c) => c.type === 'vehicle-container');
  if (!refVehicle) return plane;

  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label !== '即時圖台' || el.canvasKind !== 'map-platform') return el;
      if (el.children?.some((c) => c.type === 'vehicle-container')) return el;
      return {
        ...el,
        children: [
          ...(el.children ?? []),
          JSON.parse(JSON.stringify(refVehicle)) as ChildWidget,
        ],
      };
    }),
  };
}

function migratePlane(plane: DashboardPlane): DashboardPlane {
  if (plane.id !== 'demo-plane') {
    // 班表部署管理：若尚未有「載具控制」標題，自動插入一個獨立標題元件，其餘元件與設定 100% 保留
    if (plane.name === DEPLOYMENT_PLANE_NAME) {
      const hasTitle = (plane.elements ?? []).some(
        (e) => e.id === DEPLOY_VEHICLE_TITLE_PANEL_ID || e.label === '載具控制',
      );
      if (!hasTitle) {
        const opsGroup = (plane.elements ?? []).find(
          (e) => e.id === DEPLOY_VEHICLE_OPS_GROUP_ID || e.label === '載具操作',
        );
        const titlePanel = buildVehicleOpsTitlePanel(
          opsGroup ? opsGroup.x : 24,
          opsGroup ? Math.max(0, opsGroup.y - 26) : 224,
        );
        return {
          ...plane,
          elements: [titlePanel, ...(plane.elements ?? []).map(migrateCanvasElement)],
        };
      }
    }
    // 其餘自訂平面：僅進行畫布元件基礎相容性處理，絕對不覆寫使用者自訂的子元件或版型
    return {
      ...plane,
      elements: (plane.elements ?? []).map(migrateCanvasElement),
    };
  }
  const version = (plane as DashboardPlane & { demoLayoutVersion?: number }).demoLayoutVersion ?? 0;
  const legacy = isLegacyVtmsLayout(plane);
  // 僅在版面結構確實損壞或為舊版不可編輯版型時才整包還原；不因版本號或解析度變更覆寫使用者編輯
  if (legacy || isDemoPlaneBroken(plane)) {
    return {
      ...freshDemoPlane(),
      id: plane.id,
      name: plane.name,
      createdAt: plane.createdAt,
      updatedAt: Date.now(),
    } as DashboardPlane;
  }
  let next = ensureDemoGroupChildren({
    ...plane,
    elements: (plane.elements ?? []).map(migrateCanvasElement),
  } as DashboardPlane);
  if (version < 79) {
    next = migrateCapacityTrendLineChart(next);
  }
  if (version < 81) {
    next = migrateCapacityTrendLayout(next);
  }
  if (version < 84) {
    next = migrateEventScrollLayout(next);
  }
  if (version < 85) {
    next = migrateDualCanvasEventScroll(next);
  }
  if (version < 86) {
    next = migrateEventCenterLayout(next);
  }
  if (version < 87) {
    next = migrateEventBarDesign(next);
  }
  if (version < 89) {
    next = migrateShiftCenterPanels(next);
  }
  if (version < 90) {
    next = migrateEventCenterFigma(next);
  }
  if (version < 91) {
    next = migrateShiftCenterFigma(next);
  }
  if (version < 93) {
    next = migrateCapacityTrendFigma(next);
  }
  if (version < 94) {
    next = migrateMaintenanceDistributionFigma(next);
  }
  if (version < 95) {
    next = migrateVehicleDistributionFigma(next);
  }
  if (version < 96) {
    next = migrateVehicleDistributionFigma(next);
  }
  if (version < 97) {
    next = migrateVehicleMonitorFigma(next);
  }
  if (version < 98) {
    next = migrateMainlineShiftCardFigma(next);
  }
  if (version < 99) {
    next = migrateMaintenanceShiftCardFigma(next);
  }
  if (version < 100) {
    next = migrateShiftCenterFigma(next);
  }
  if (version < 101) {
    next = migrateCapacityTrendFigma(next);
  }
  if (version < 102) {
    next = migrateCapacityTrendFigma(next);
  }
  if (version < DEMO_LAYOUT_VERSION) {
    next = migrateDemoMapPlatformId(next);
    next = migrateMapPlatformVehicleContainer(next);
    next = patchDashboardRuntimeFixes(next);
    next = { ...next, demoLayoutVersion: DEMO_LAYOUT_VERSION } as DashboardPlane;
  }
  if (needsDashboardRuntimePatch(next)) {
    next = patchDashboardRuntimeFixes(next);
  }
  next = ensureDeploymentDataStatsPanel(next);
  return next;
}

function getInitialPlanes(): DashboardPlane[] {
  return loadPlanes();
}

function loadPlanes(): DashboardPlane[] {
  ensureLayoutSeed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [migratePlane(freshDemoPlane())];
    const planes: DashboardPlane[] = JSON.parse(raw);
    if (planes.length === 0) return [migratePlane(freshDemoPlane())];
    return planes.map(migratePlane);
  } catch {
    return [migratePlane(freshDemoPlane())];
  }
}

function savePlanes(planes: DashboardPlane[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(planes));
  } catch (err) {
    console.error('Failed to save dashboard planes to localStorage:', err);
  }
}

export function useDashboardEditor() {
  const [planes, setPlanes] = useState<DashboardPlane[]>(() => getInitialPlanes());
  const [activePlaneId, setActivePlaneId] = useState<string | null>(() => getInitialPlanes()[0]?.id ?? null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);

  const planesRef = useRef(planes);
  const activePlaneIdRef = useRef(activePlaneId);
  const selectedElementIdRef = useRef(selectedElementId);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const selectedChildIdRef = useRef(selectedChildId);
  const selectedChildIdsRef = useRef(selectedChildIds);
  planesRef.current = planes;
  activePlaneIdRef.current = activePlaneId;
  selectedElementIdRef.current = selectedElementId;
  selectedElementIdsRef.current = selectedElementIds;
  selectedChildIdRef.current = selectedChildId;
  selectedChildIdsRef.current = selectedChildIds;

  const applyingHistoryRef = useRef(false);

  const getSnapshot = useCallback((): DashboardEditorSnapshot => ({
    planes: structuredClone(planesRef.current),
    activePlaneId: activePlaneIdRef.current,
    selectedElementId: selectedElementIdRef.current,
    selectedElementIds: [...selectedElementIdsRef.current],
    selectedChildId: selectedChildIdRef.current,
    selectedChildIds: [...selectedChildIdsRef.current],
  }), []);

  const applySnapshot = useCallback((snap: DashboardEditorSnapshot) => {
    applyingHistoryRef.current = true;
    setPlanes(snap.planes);
    setActivePlaneId(snap.activePlaneId);
    setSelectedElementId(snap.selectedElementId);
    setSelectedElementIds(snap.selectedElementIds ?? (snap.selectedElementId ? [snap.selectedElementId] : []));
    setSelectedChildId(snap.selectedChildId);
    setSelectedChildIds(snap.selectedChildIds ?? (snap.selectedChildId ? [snap.selectedChildId] : []));
    savePlanes(snap.planes);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  }, []);

  const {
    pushHistory,
    undo,
    redo,
    resetHistory,
    canUndo,
    canRedo,
  } = useDashboardHistory({ getSnapshot, applySnapshot });

  const recordHistory = useCallback(() => {
    if (applyingHistoryRef.current) return;
    pushHistory();
  }, [pushHistory]);

  // ─── 剪貼簿（記憶體內） ────────────────────────────────────────
  type ClipboardEntry =
    | { kind: 'canvas'; data: CanvasElementProps }
    | { kind: 'widget'; data: ChildWidget; parentCanvasId: string };
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [formatPainter, setFormatPainter] = useState<WidgetFormatSnapshot | null>(null);

  const activePlane = planes.find(p => p.id === activePlaneId) ?? null;
  const selectedElement = activePlane?.elements.find(e => e.id === selectedElementId) ?? null;
  const selectedChild = selectedElement?.children.find(c => c.id === selectedChildId) ?? null;

  // ─── 選取邏輯 ─────────────────────────────────────────────────────

  const selectElement = useCallback((canvasId: string | null, opts?: { additive?: boolean }) => {
    if (!canvasId) {
      setSelectedElementId(null);
      setSelectedElementIds([]);
      setSelectedChildId(null);
      setSelectedChildIds([]);
      return;
    }
    if (opts?.additive) {
      setSelectedChildId(null);
      setSelectedChildIds([]);
      setSelectedElementIds(prev => {
        const has = prev.includes(canvasId);
        const next = has ? prev.filter(id => id !== canvasId) : [...prev, canvasId];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
  }, []);

  const selectElements = useCallback((ids: string[], opts?: { additive?: boolean }) => {
    setSelectedChildId(null);
    setSelectedChildIds([]);
    if (opts?.additive) {
      setSelectedElementIds(prev => {
        const next = [...new Set([...prev, ...ids])];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
    } else {
      setSelectedElementIds(ids);
      setSelectedElementId(ids[ids.length - 1] ?? null);
    }
  }, []);

  const selectChild = useCallback((canvasId: string, childId: string, opts?: { additive?: boolean }) => {
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    if (opts?.additive) {
      setSelectedChildIds(prev => {
        const has = prev.includes(childId);
        const next = has ? prev.filter(id => id !== childId) : [...prev, childId];
        setSelectedChildId(next.length === 1 ? next[0] : null);
        return next;
      });
      return;
    }
    setSelectedChildIds([childId]);
    setSelectedChildId(childId);
  }, []);

  const selectChildren = useCallback((canvasId: string, childIds: string[], opts?: { additive?: boolean }) => {
    setSelectedElementId(canvasId);
    setSelectedElementIds([canvasId]);
    if (opts?.additive) {
      setSelectedChildIds(prev => {
        const next = [...new Set([...prev, ...childIds])];
        setSelectedChildId(next.length === 1 ? next[0] : null);
        return next;
      });
    } else {
      setSelectedChildIds(childIds);
      setSelectedChildId(childIds.length === 1 ? childIds[0] : null);
    }
  }, []);

  // ─── Plane CRUD ────────────────────────────────────────────────────

  const createPlane = useCallback((name: string, width: number, height: number) => {
    recordHistory();
    const newPlane: DashboardPlane = {
      id: `plane-${Date.now()}`, name, width, height, elements: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    setPlanes(prev => { const next = [...prev, newPlane]; savePlanes(next); return next; });
    setActivePlaneId(newPlane.id);
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
    return newPlane;
  }, [recordHistory]);

  const updatePlane = useCallback((id: string, patch: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height' | 'viewportMode'>>) => {
    setPlanes(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
  }, []);

  const deletePlane = useCallback((id: string) => {
    recordHistory();
    setPlanes(prev => { const next = prev.filter(p => p.id !== id); savePlanes(next); return next; });
    setActivePlaneId(prev => prev === id ? null : prev);
  }, [recordHistory]);

  const importPlane = useCallback((plane: DashboardPlane) => {
    recordHistory();
    setPlanes(prev => {
      const next = [...prev, plane];
      savePlanes(next);
      return next;
    });
    setActivePlaneId(plane.id);
    setSelectedElementId(null);
    setSelectedElementIds([]);
    setSelectedChildId(null);
    setSelectedChildIds([]);
    return plane;
  }, [recordHistory]);

  // ─── Canvas Element CRUD ───────────────────────────────────────────

  const addCanvasElement = useCallback((
    isGroup: boolean = false,
    dropX?: number,
    dropY?: number,
    canvasKind: CanvasKind = 'standard',
    initialWidgetType?: WidgetType,
  ) => {
    if (!activePlaneId) return;
    recordHistory();
    const x = dropX ?? 40;
    const y = dropY ?? 40;
    const isMap = canvasKind === 'map-platform';
    const isTabList = initialWidgetType === 'tab-list' || initialWidgetType === 'shift-list';

    const defaultW = isMap ? 1200 : isTabList ? 1000 : isGroup ? 500 : 400;
    const defaultH = isMap ? 680 : isTabList ? 460 : isGroup ? 320 : 250;

    let initialChildren: ChildWidget[] = [];
    if (initialWidgetType) {
      const w = createWidget(initialWidgetType, 0, 0);
      w.width = defaultW;
      w.height = defaultH;
      initialChildren = [w];
    }

    const el: CanvasElementProps = {
      id: `canvas-${Date.now()}`, type: 'canvas', x, y,
      width: defaultW,
      height: defaultH,
      label: isMap ? '圖台' : isTabList ? 'Tab 清單表格' : isGroup ? '新畫布群組' : '新畫布',
      backgroundColor: isMap ? '#020617' : isTabList ? 'transparent' : '#0f172a',
      backgroundImage: '',
      opacity: 100,
      children: initialChildren,
      canvasKind: isMap ? 'map-platform' : 'standard',
      mapId: isMap ? 't3-main-version' : '',
      zoomFactor: isMap ? 1.35 : undefined,
      isGroup: isMap ? false : isGroup,
      ...(isGroup ? {
        templateWidth: 300,
        templateHeight: 180,
        groupTileFit: 'fill' as const,
        layoutMode: 'grid' as const,
        gridColumns: 1,
        gapX: 12,
        gapY: 12,
      } : {}),
    };
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: [...p.elements, el], updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
    selectElement(el.id);
    if (initialChildren.length > 0) {
      selectChild(el.id, initialChildren[0].id);
    }
  }, [activePlaneId, selectElement, selectChild, recordHistory]);

  const updateElement = useCallback((elementId: string, patch: Partial<CanvasElementProps>) => {
    if (!activePlaneId) return;
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.map(el => el.id === elementId ? { ...el, ...patch } : el), updatedAt: Date.now() }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const updateElementsBatch = useCallback((
    updates: Array<{ elementId: string; patch: Partial<CanvasElementProps> }>,
  ) => {
    if (!activePlaneId || updates.length === 0) return;
    const patchMap = new Map(updates.map(u => [u.elementId, u.patch]));
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              const patch = patchMap.get(el.id);
              return patch ? { ...el, ...patch } : el;
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const deleteElement = useCallback((elementId: string) => {
    if (!activePlaneId) return;
    recordHistory();
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.filter(el => el.id !== elementId), updatedAt: Date.now() } : p);
      savePlanes(next); return next;
    });
    selectElement(null);
  }, [activePlaneId, selectElement, recordHistory]);

  const deleteElementsBatch = useCallback((elementIds: string[]) => {
    if (!activePlaneId || elementIds.length === 0) return;
    recordHistory();
    const idSet = new Set(elementIds);
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? { ...p, elements: p.elements.filter(el => !idSet.has(el.id)), updatedAt: Date.now() }
        : p);
      savePlanes(next); return next;
    });
    selectElement(null);
  }, [activePlaneId, selectElement, recordHistory]);

  // ─── Child Widget CRUD ─────────────────────────────────────────────

  const addChildWidget = useCallback((
    canvasId: string,
    widgetType: WidgetType,
    x: number,
    y: number,
    lane?: DualCanvasLane | null,
  ): string | undefined => {
    if (!activePlaneId) return undefined;
    const plane = planesRef.current.find((p) => p.id === activePlaneId);
    const canvas = plane?.elements.find((el) => el.id === canvasId);
    if (!canAddWidgetToCanvas(canvas, widgetType)) return undefined;
    recordHistory();
    let widget = createWidget(widgetType, x, y);
    if (widgetType === 'vehicle-container') {
      const vehicleDefinitionId = createBlankVehicleForContainer();
      widget = { ...widget, vehicleDefinitionId } as ChildWidget;
    }
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch => [...ch, widget]);
              }
              return { ...el, children: [...(el.children ?? []), widget] };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectChild(canvasId, widget.id);
    return widget.id;
  }, [activePlaneId, selectChild, recordHistory]);

  const updateChildWidget = useCallback((
    canvasId: string,
    childId: string,
    patch: Partial<ChildWidget>,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId) return;
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch =>
                  ch.map(c => (c.id === childId ? { ...c, ...patch } as ChildWidget : c)),
                );
              }
              return {
                ...el,
                children: (el.children ?? []).map(c =>
                  c.id === childId ? { ...c, ...patch } as ChildWidget : c,
                ),
              };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const updateChildrenBatch = useCallback((
    canvasId: string,
    updates: Array<{ childId: string; patch: Partial<ChildWidget> }>,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId || updates.length === 0) return;
    const patchMap = new Map(updates.map(u => [u.childId, u.patch]));
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              const apply = (ch: ChildWidget[]) =>
                ch.map(c => {
                  const patch = patchMap.get(c.id);
                  return patch ? { ...c, ...patch } as ChildWidget : c;
                });
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, apply);
              }
              return { ...el, children: apply(el.children ?? []) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
  }, [activePlaneId]);

  const deleteChildWidget = useCallback((
    canvasId: string,
    childId: string,
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId) return;
    recordHistory();
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, ch => ch.filter(c => c.id !== childId));
              }
              return { ...el, children: (el.children ?? []).filter(c => c.id !== childId) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectElement(canvasId);
  }, [activePlaneId, selectElement, recordHistory]);

  const deleteChildrenBatch = useCallback((
    canvasId: string,
    childIds: string[],
    lane?: DualCanvasLane | null,
  ) => {
    if (!activePlaneId || childIds.length === 0) return;
    recordHistory();
    const idSet = new Set(childIds);
    setPlanes(prev => {
      const next = prev.map(p => p.id === activePlaneId
        ? {
            ...p,
            elements: p.elements.map(el => {
              if (el.id !== canvasId) return el;
              const filter = (ch: ChildWidget[]) => ch.filter(c => !idSet.has(c.id));
              if (el.dualCanvasEnabled && lane) {
                return patchGroupChildrenByLane(el, lane, filter);
              }
              return { ...el, children: filter(el.children ?? []) };
            }),
            updatedAt: Date.now(),
          }
        : p);
      savePlanes(next); return next;
    });
    selectElement(canvasId);
  }, [activePlaneId, selectElement, recordHistory]);

  // ─── 複製 / 貼上 ───────────────────────────────────────────────

  const copySelected = useCallback((
    childOverride?: ChildWidget | null,
    parentCanvasIdOverride?: string | null,
  ) => {
    const child = childOverride ?? selectedChild;
    const parent = parentCanvasIdOverride ?? selectedElement?.id;
    if (child && parent) {
      setClipboard({ kind: 'widget', data: { ...child }, parentCanvasId: parent });
    } else if (selectedElement) {
      const el = selectedElement;
      setClipboard({
        kind: 'canvas',
        data: {
          ...el,
          children: [...(el.children ?? [])],
          childrenNormal: el.childrenNormal ? [...el.childrenNormal] : undefined,
          childrenDefault: el.childrenDefault ? [...el.childrenDefault] : undefined,
        },
      });
    }
  }, [selectedChild, selectedElement]);

  const armFormatPainter = useCallback((widget: ChildWidget) => {
    setFormatPainter(extractWidgetFormat(widget));
  }, []);

  const cancelFormatPainter = useCallback(() => {
    setFormatPainter(null);
  }, []);

  const applyFormatToChild = useCallback(
    (canvasId: string, child: ChildWidget, snapshot: WidgetFormatSnapshot): boolean => {
      if (!activePlaneId) return false;
      if (!canApplyWidgetFormat(snapshot, child)) return false;
      const next = applyWidgetFormat(child, snapshot);
      if (!next) return false;
      recordHistory();
      setPlanes(prev => {
        const nextPlanes = prev.map(p =>
          p.id === activePlaneId
            ? {
                ...p,
                elements: p.elements.map(el => {
                  if (el.id !== canvasId) return el;
                  if (el.dualCanvasEnabled) {
                    const lane = getDefaultChildren(el).some(c => c.id === child.id)
                      ? 'default'
                      : 'normal';
                    return patchGroupChildrenByLane(el, lane, ch =>
                      ch.map(c => (c.id === child.id ? next : c)),
                    );
                  }
                  return {
                    ...el,
                    children: (el.children ?? []).map(c => (c.id === child.id ? next : c)),
                  };
                }),
                updatedAt: Date.now(),
              }
            : p,
        );
        savePlanes(nextPlanes);
        return nextPlanes;
      });
      return true;
    },
    [activePlaneId, recordHistory],
  );

  const applyFormatPainter = useCallback(
    (canvasId: string, child: ChildWidget): boolean => {
      if (!formatPainter) return false;
      const ok = applyFormatToChild(canvasId, child, formatPainter);
      if (ok) {
        setFormatPainter(null);
        selectChild(canvasId, child.id);
      }
      return ok;
    },
    [formatPainter, applyFormatToChild, selectChild],
  );

  const pasteClipboard = useCallback((lane?: DualCanvasLane | null) => {
    if (!activePlaneId || !clipboard || !activePlane) return null;
    recordHistory();
    const offset = 20;

    if (clipboard.kind === 'canvas') {
      const src = clipboard.data;
      const remap = (list: ChildWidget[]) =>
        list.map(c => ({ ...c, id: `${c.type}-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
      const newEl: CanvasElementProps = {
        ...src,
        id: `canvas-${Date.now()}`,
        x: src.x + offset,
        y: src.y + offset,
        children: remap(src.children ?? []),
        childrenNormal: src.childrenNormal ? remap(src.childrenNormal) : undefined,
        childrenDefault: src.childrenDefault ? remap(src.childrenDefault) : undefined,
      };

      setPlanes(prev => {
        const next = prev.map(p => p.id === activePlaneId ? { ...p, elements: [...p.elements, newEl], updatedAt: Date.now() } : p);
        savePlanes(next); return next;
      });
      selectElement(newEl.id);
    } else {
      const canvasId = clipboard.parentCanvasId;
      const newWidget: ChildWidget = {
        ...clipboard.data,
        id: `${clipboard.data.type}-${Date.now()}`,
        x: clipboard.data.x + offset,
        y: clipboard.data.y + offset,
      };

      setPlanes(prev => {
        const next = prev.map(p => p.id === activePlaneId
          ? {
              ...p,
              elements: p.elements.map(el => {
                if (el.id !== canvasId) return el;
                if (el.dualCanvasEnabled && lane) {
                  return patchGroupChildrenByLane(el, lane, ch => [...ch, newWidget]);
                }
                return { ...el, children: [...(el.children ?? []), newWidget] };
              }),
              updatedAt: Date.now(),
            }
          : p);
        savePlanes(next); return next;
      });
      selectChild(canvasId, newWidget.id);
    }
    return null;
  }, [activePlaneId, clipboard, activePlane, selectElement, selectChild, recordHistory]);

  const validateActivePlane = useCallback((): { valid: boolean; error?: string; issues: LayoutIssue[] } => {
    if (!activePlane) return { valid: true, issues: [] };
    return validatePlane(activePlane);
  }, [activePlane]);

  const validateGroupTemplateById = useCallback(
    (groupId: string): { valid: boolean; error?: string; issues: LayoutIssue[] } => {
      const group = activePlane?.elements.find(e => e.id === groupId);
      if (!group?.isGroup) return { valid: true, issues: [] };
      return validateGroupTemplate(group);
    },
    [activePlane],
  );

  return {
    planes, activePlane, activePlaneId, setActivePlaneId,
    selectedElementId, selectedElement, selectedElementIds,
    selectedChildId, selectedChild, selectedChildIds,
    selectElement, selectElements, selectChild, selectChildren,
    createPlane, updatePlane, deletePlane, importPlane,
    addCanvasElement, updateElement, updateElementsBatch, deleteElement, deleteElementsBatch,
    addChildWidget, updateChildWidget, updateChildrenBatch,
    deleteChildWidget, deleteChildrenBatch,
    clipboard, copySelected, pasteClipboard,
    formatPainter,
    armFormatPainter, cancelFormatPainter, applyFormatPainter,
    validateActivePlane, validateGroupTemplateById,
    recordHistory, undo, redo, resetHistory, canUndo, canRedo,
    clearAllData: () => {
      recordHistory();
      setPlanes([]);
      setActivePlaneId(null);
      localStorage.removeItem(STORAGE_KEY);
    },
  };
}
