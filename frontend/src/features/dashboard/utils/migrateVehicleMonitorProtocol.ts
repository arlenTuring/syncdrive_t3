import type { DashboardPlane, ChildWidget, TextWidget, RouteProgressWidget, StatusBadgeWidget, SlotGridWidget, CanvasElementProps, ColorBlockWidget, MaintenanceDistributionWidget } from '../types';
import { createWidget } from '../types';
import {
  VEHICLE_STATUS_ROW_SQL,
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  MAINLINE_FLEET_STATUS_SQL,
  VEHICLE_DISTRIBUTION_INVALIDATE_TAGS,
  VEHICLE_DISTRIBUTION_URL,
  SHIFT_CENTER_URL,
  CAPACITY_SUMMARY_URL,
  CAPACITY_TREND_URL,
  OPERATION_METRICS_INVALIDATE_TAGS,
  maintenanceSlotsSql,
  maintenanceZoneCountSql,
} from '../constants/demoSql';
import {
  SHIFT_ROSTER_REFRESH_INTERVAL,
  MAINLINE_FLEET_REFRESH_INTERVAL,
} from './resolveBuiltinGroupSql';
import { migrateChildWidgetGenerics } from './migrateWidgetGenerics';
import { patchEventDrivenSqlRefresh } from './patchEventDrivenSqlRefresh';
import { inferInvalidateTagsFromSql } from './inferInvalidateTagsFromSql';

const DS_INTERNAL = 'default-internal';

/** 車輛狀態名冊多久重查一次（秒） */
export const VEHICLE_STATUS_REFRESH_INTERVAL = 1;

const MAINT_ZONE_FROM_SQL = /WHERE\s+fs\.zone\s*=\s*'(整備-[^']+)'/;

/** 舊版整備分布 SQL 將保養／維修格位標籤寫死為 M1/M2 */
export function isStaleMaintenanceSlotSql(sql: string | undefined): boolean {
  if (!sql?.includes('facility_slots')) return false;
  return sql.includes("THEN 'M1'") || sql.includes("THEN 'M2'");
}

function patchMaintenanceDistributionChild(child: ChildWidget): ChildWidget {
  let patched: ChildWidget = child;

  if (child.type === 'slot-grid') {
    const sg = child as SlotGridWidget;
    const sql = sg.sqlQuery;
    if (sg.nameField === 'slot_label' && isStaleMaintenanceSlotSql(sql)) {
      const zone = sql?.match(MAINT_ZONE_FROM_SQL)?.[1];
      if (zone) {
        patched = { ...sg, sqlQuery: maintenanceSlotsSql(zone) };
      }
    }
  }

  if (child.type === 'text') {
    const text = child as TextWidget;
    const sql = text.sqlQuery;
    if (text.valueField === 'total' && sql?.includes('facility_slots') && isStaleMaintenanceSlotSql(sql)) {
      const zone = sql?.match(MAINT_ZONE_FROM_SQL)?.[1];
      if (zone) {
        patched = { ...text, sqlQuery: maintenanceZoneCountSql(zone) };
      }
    }
  }

  const nested = (patched as { children?: ChildWidget[] }).children;
  if (Array.isArray(nested) && nested.length > 0) {
    return {
      ...patched,
      children: nested.map(patchMaintenanceDistributionChild),
    } as unknown as ChildWidget;
  }

  return patched;
}

/** 整備分布格位標籤：M1–M4 由 slot_id 推導（修正 localStorage 殘留 M1 寫死） */
export function patchMaintenanceDistributionSql(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => ({
      ...el,
      children: (el.children ?? []).map(patchMaintenanceDistributionChild),
    })),
  };
}

export function needsVehicleMonitorBadgeProtocolFix(plane: DashboardPlane): boolean {
  const el = plane.elements.find((e) => e.label === '車輛狀態' && e.isGroup);
  if (!el) return false;
  if (!(el.sqlQuery ?? '').includes('active_order.line_kind')) return true;
  const badge = (el.children ?? []).find(
    (c) =>
      c.type === 'status-badge'
      && String((c as { valueField?: string }).valueField ?? '').includes('badge_label'),
  );
  return !!(badge && !(badge as { mqttTopic?: string }).mqttTopic);
}

export function needsShiftPanelsSimulationSqlFix(plane: DashboardPlane): boolean {
  for (const label of ['正線班次', '整備班表'] as const) {
    const el = plane.elements.find((e) => e.label === label && e.isGroup);
    if (!el) continue;
    const sql = el.sqlQuery ?? '';
    if (sql.includes('${DAY_MS}')) return true;
    if ((el.refreshInterval ?? 0) === 0) return true;
    if (label === '正線班次') {
      if (!sql.includes('operation_route_stations')) return true;
      if (!sql.includes('order_action_states')) return true;
      if (sql.includes('DEMO-ORD')) return true;
      if (!sql.includes('trip_start_minutes')) return true;
      if (!sql.includes("payload->'current_leg'")) return true;
      if (sql.includes('rs.remain_pct')) return true;
      if (sql.includes("'T3' AS st_b")) return true;
      if (!sql.includes('station_display_name')) return true;
      if (!sql.includes('business_kind')) return true;
    }
    if (label === '整備班表') {
      if (!sql.includes('FROM operation_orders o')) return true;
      if (sql.includes("'PMS' || LPAD(row_no")) return true;
      if (sql.includes("'進行中' AS status_label")) return true;
    }
  }
  return false;
}

/** 圖台標題「正線營運」：只綁 SQL，不改元件座標／字級 */
export function patchMainlineFleetStatusWidget(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => ({
      ...el,
      children: (el.children ?? []).map((child) => patchFleetTextChild(child)),
    })),
  };
}

/** 圖台標題「班距 03:00」原本是寫死的文字；改接營運指標（時間模板目前時段的目標班距） */
export function isUnboundHeadwayText(child: ChildWidget): boolean {
  if (child.type !== 'text') return false;
  const text = child as TextWidget;
  return /^\s*班距/.test(text.content ?? '') && !text.dataUrl && !text.sqlQuery?.trim() && !text.mqttTopic;
}

/** 圖台標題「正線營運 X / Y」還沒接上查詢 */
export function isUnboundFleetText(child: ChildWidget): boolean {
  if (child.type !== 'text') return false;
  const text = child as TextWidget;
  return !!text.content?.includes('正線營運') && !text.sqlQuery?.includes('mainline_fleet_line');
}

function patchFleetTextChild(child: ChildWidget): ChildWidget {
  if (child.type !== 'text') return child;
  const text = child as TextWidget;
  if (isUnboundHeadwayText(child)) {
    return {
      ...text,
      dataUrl: CAPACITY_SUMMARY_URL,
      valueField: 'headway_line',
      refreshMode: 'event',
      refreshInterval: 0,
      invalidateTags: [...OPERATION_METRICS_INVALIDATE_TAGS],
    };
  }
  if (text.valueField === 'mainline_fleet_line' && text.dataSourceId) {
    return {
      ...text,
      sqlQuery: MAINLINE_FLEET_STATUS_SQL,
      refreshInterval: MAINLINE_FLEET_REFRESH_INTERVAL,
      refreshMode: 'event',
      invalidateTags: ['domain:mainline_shifts', 'table:operation_orders'],
    };
  }
  if (!text.content?.includes('正線營運')) return child;
  if (text.dataSourceId && text.sqlQuery?.includes('mainline_fleet_line')) return child;
  return {
    ...text,
    dataSourceId: DS_INTERNAL,
    sqlQuery: MAINLINE_FLEET_STATUS_SQL,
    valueField: 'mainline_fleet_line',
    refreshInterval: MAINLINE_FLEET_REFRESH_INTERVAL,
    refreshMode: 'event',
    invalidateTags: ['domain:mainline_shifts', 'table:operation_orders'],
  };
}

/** 正線班次卡 route-progress：恢復 MQTT operation/update（進度由 current_leg.eta_seconds） */
export function patchShiftCardRouteProgressMqtt(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if ((el.label !== '正線班次' && el.label !== '整備班表') || !el.isGroup) return el;
      return {
        ...el,
        children: (el.children ?? []).map((child) => patchShiftRouteProgressChild(child)),
      };
    }),
  };
}

function patchShiftRouteProgressChild(child: ChildWidget): ChildWidget {
  if (child.type !== 'route-progress') return child;
  const rp = child as RouteProgressWidget;
  if (rp.variant !== 'track') return rp;
  return {
    ...rp,
    mqttDataSourceId: rp.mqttDataSourceId ?? 'default-mqtt',
    mqttTopic: rp.mqttTopic ?? 'v1/vtms/${vehicle_code}/operation/update',
    mqttProgressPath: undefined,
    sqlQuery: '',
    refreshInterval: 0,
    animateSegmentMovement: true,
  };
}

/** 拿掉 SQL 綁定（改接 REST 時，留著 SQL 會被 useWidgetData 優先採用） */
function withoutSqlBinding<T extends { sqlQuery?: string; dataSourceId?: string }>(widget: T): T {
  const copy = { ...widget };
  delete copy.sqlQuery;
  delete copy.dataSourceId;
  return copy;
}

/** 車輛分佈 segment-bar：修正高度裁切；資料改接後端（見 patchVehicleDistributionSource） */
function patchVehicleDistributionSegmentBar(children: ChildWidget[]): ChildWidget[] {
  return children.map((child) => {
    if (child.type !== 'segment-bar') return child;
    const bar = withoutSqlBinding(child as import('../types').SegmentBarWidget);
    return {
      ...bar,
      height: Math.max(bar.height ?? 0, 75),
      refreshMode: 'event',
      refreshInterval: 0,
      dataUrl: VEHICLE_DISTRIBUTION_URL,
      invalidateTags: [...VEHICLE_DISTRIBUTION_INVALIDATE_TAGS],
    };
  });
}

/** 整備班表卡：沒有實際訂單狀態時使用中性色，不假造正常或進行中。 */
function patchMaintenanceCardTemplateDefaults(children: ChildWidget[]): ChildWidget[] {
  return children.map((child) => {
    if (child.type === 'color-block') {
      const cb = child as ColorBlockWidget;
      if (cb.bindBorderColorVar === 'card_border_color' && cb.borderColor === '#FB2C36') {
        return { ...cb, borderColor: '#52525b' };
      }
    }
    if (child.type === 'status-badge') {
      const sb = child as StatusBadgeWidget;
      if (sb.variableBgKey === 'status_bg' && sb.defaultTextColor === '#FF6467') {
        return {
          ...sb,
          defaultBgColor: '#27272a',
          defaultTextColor: '#a1a1aa',
        };
      }
    }
    return child;
  });
}

/** 班次／整備任務列：強制套用最新 SQL（避免 localStorage 殘留舊 DEMO-ORD 查詢） */
export function patchShiftPanelsSimulationSql(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label === '正線班次' && el.isGroup) {
        return {
          ...el,
          sqlQuery: MAINLINE_SHIFTS_SQL,
          refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL,
          genericGroup: {
            enabled: true,
            sources: [{
              id: 'shift-roster',
              label: '正線與過渡班次',
              dataSourceId: el.dataSourceId,
              sqlQuery: MAINLINE_SHIFTS_SQL,
              refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL,
              refreshMode: 'event',
              invalidateTags: ['table:operation_orders', 'domain:mainline_shifts'],
              itemIdField: 'shift_key',
            }],
            itemIdField: 'shift_key',
            arrangeMode: 'priority',
            defaultPriority: 0,
            priorityRules: [
              { id: 'shift-emergency', priority: 1000, conditions: [{ field: 'order_status', operator: 'eq', value: 'FAULTED' }] },
              { id: 'shift-mainline', priority: 300, conditions: [{ field: 'business_kind', operator: 'eq', value: 'MAINLINE' }] },
              { id: 'shift-transition', priority: 200, conditions: [{ field: 'business_kind', operator: 'eq', value: 'TRANSITION' }] },
              { id: 'shift-maintenance', priority: 100, conditions: [{ field: 'business_kind', operator: 'eq', value: 'MAINTENANCE' }] },
            ],
            capacityConfig: { capacity: el.slotCount ?? 6 },
          },
        };
      }
      if (el.label === '整備班表' && el.isGroup) {
        return {
          ...el,
          sqlQuery: MAINTENANCE_SHIFTS_SQL,
          refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL,
          children: patchMaintenanceCardTemplateDefaults(el.children ?? []),
        };
      }
      if (el.label === '車輛分佈' && el.isGroup) {
        return {
          ...el,
          children: patchVehicleDistributionSegmentBar(el.children ?? []),
        };
      }
      return el;
    }),
  };
}

/** 位置列：訂單 yard_slot_id（E1）；正線無格位時 fallback SQL segment_label */
export function patchVehicleMonitorLocationMqtt(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label !== '車輛狀態' || !el.isGroup) return el;
      return {
        ...el,
        children: (el.children ?? []).map((child) => patchVehicleLocationTextChild(child)),
      };
    }),
  };
}

function patchVehicleLocationTextChild(child: ChildWidget): ChildWidget {
  if (child.type !== 'text') return child;
  const text = child as TextWidget;
  if (!text.content?.includes('{segment_label}')) return child;
  const { mqttValuePath: _removed, ...rest } = text;
  return {
    ...rest,
    mqttDataSourceId: text.mqttDataSourceId ?? 'default-mqtt',
    mqttTopic: 'v1/vtms/${vehicle_code}/operation/update',
  };
}

function patchVehicleMonitorBadgeMqtt(child: ChildWidget): ChildWidget {
  if (child.type !== 'status-badge') return child;
  const badge = child as StatusBadgeWidget;
  const field = badge.valueField?.trim() ?? '';
  if (!field.includes('badge_label') && !field.includes('trip_code')) return child;
  if (badge.mqttTopic === 'v1/vtms/${vehicle_code}/operation/update') return child;
  return {
    ...badge,
    mqttDataSourceId: badge.mqttDataSourceId ?? 'default-mqtt',
    mqttTopic: 'v1/vtms/${vehicle_code}/operation/update',
  };
}

/** 車輛狀態卡：SQL 改為活躍訂單班次／整備標籤，徽章訂閱 operation/update */
export function patchVehicleMonitorBadgeProtocol(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label !== '車輛狀態' || !el.isGroup) return el;
      return {
        ...el,
        sqlQuery: VEHICLE_STATUS_ROW_SQL,
        // 位置快照後端每秒寫入；原本由 resolveBuiltinGroupSql 依群組名稱偷偷改成 1 秒，現在寫進綁定
        refreshInterval: VEHICLE_STATUS_REFRESH_INTERVAL,
        children: (el.children ?? []).map((child) =>
          patchVehicleMonitorBadgeMqtt(migrateChildWidgetGenerics(child)),
        ),
      };
    }),
  };
}

/** 舊樣板：徽章缺 MQTT 時仍補上 operation/update */
export function patchVehicleMonitorBadgeMqttOnly(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label !== '車輛狀態' || !el.isGroup) return el;
      return {
        ...el,
        children: (el.children ?? []).map((child) => patchVehicleMonitorBadgeMqtt(child)),
      };
    }),
  };
}

function widgetNeedsEventDrivenRefresh(w: ChildWidget): boolean {
  const sql = (w as { sqlQuery?: string }).sqlQuery;
  if (!sql?.trim()) return false;
  const binding = w as { refreshInterval?: number; refreshMode?: string };
  if (binding.refreshMode === 'event' || binding.refreshMode === 'stream') return false;
  if (binding.refreshMode === 'poll') return false;
  return inferInvalidateTagsFromSql(sql).length > 0
    && (binding.refreshInterval ?? 0) > 0;
}

function canvasNeedsEventDrivenRefresh(el: CanvasElementProps): boolean {
  if (
    el.sqlQuery?.trim()
    && inferInvalidateTagsFromSql(el.sqlQuery).length > 0
    && (el.refreshInterval ?? 0) > 0
    && el.refreshMode !== 'poll'
  ) {
    return true;
  }
  for (const child of el.children ?? []) {
    if (widgetNeedsEventDrivenRefresh(child)) return true;
  }
  for (const child of [...(el.childrenDefault ?? []), ...(el.childrenNormal ?? [])]) {
    if (widgetNeedsEventDrivenRefresh(child)) return true;
  }
  return false;
}

/** 執行期 patch 是否仍需要（已是最新樣板時跳過整棵樹 walk） */
export function needsDashboardRuntimePatch(plane: DashboardPlane): boolean {
  const vehicleStatus = plane.elements.find((el) => el.label === '車輛狀態' && el.isGroup);
  if (vehicleStatus && (
    (vehicleStatus.refreshInterval ?? 0) === 0
    // 舊版查詢沒有健康資料時一律補 'OK'，畫面看起來全部正常，其實是沒資料
    || (vehicleStatus.sqlQuery ?? '').includes("COALESCE(m.overall_health, 'OK')")
    || !(vehicleStatus.sqlQuery ?? '').includes('FROM operation_orders o')
    || (vehicleStatus.sqlQuery ?? '').includes("scheduleOutput'->'plan'->'timelines")
  )) {
    return true;
  }
  const mainline = plane.elements.find((el) => el.label === '正線班次' && el.isGroup);
  if (mainline && !(mainline.sqlQuery ?? '').includes("payload->>'card_label'")) {
    return true;
  }
  const distribution = plane.elements.find((el) => el.label === '車輛分佈' && el.isGroup);
  if (distribution) {
    const segment = (distribution.children ?? []).find((child) => child.type === 'segment-bar');
    if (segment && !((segment as { sqlQuery?: string }).sqlQuery ?? '').includes('ss.last_updated')) {
      return true;
    }
  }
  if (needsVehicleMonitorBadgeProtocolFix(plane)) return true;
  if (planeHasLegacyLiteralDefaults(plane)) return true;
  if (plane.elements.some((el) => (el.children ?? []).some((child) =>
    isUnboundHeadwayText(child) || isUnboundFleetText(child) || operationMetricsUrlFor(child) !== null))) {
    return true;
  }
  if (needsShiftPanelsSimulationSqlFix(plane)) return true;
  if (isStaleMaintenanceSlotSqlOnPlane(plane)) return true;
  if (canvasNeedsEventDrivenRefreshOnPlane(plane)) return true;
  return false;
}

function isStaleMaintenanceSlotSqlOnPlane(plane: DashboardPlane): boolean {
  for (const el of plane.elements) {
    for (const child of el.children ?? []) {
      if (child.type === 'slot-grid' || child.type === 'text') {
        const sql = (child as { sqlQuery?: string }).sqlQuery;
        if (isStaleMaintenanceSlotSql(sql)) return true;
      }
    }
  }
  return false;
}

function canvasNeedsEventDrivenRefreshOnPlane(plane: DashboardPlane): boolean {
  return plane.elements.some(canvasNeedsEventDrivenRefresh);
}

/** 執行期資料修補（不變更版面座標） */
/**
 * 舊版整備分佈：六張寫死類別的卡（充電／洗車／保養／維修／調度／臨停），每張各一個
 * 綁 facility_slots／slot_statuses 示範表的格位陣列。那兩張表的格位是寫死的
 * （E／W／M／H／P），狀態也只有示範模擬會寫，接真車或模擬器時永遠是 0。
 *
 * 整組換成一個「整備分佈」元件：類別跟著部署班表的整備區塊、格位跟著整備任務、
 * 有車跟著車輛即時位置（後端 /syncdrive-api/facility/maintenance-distribution）。
 */
function isLegacyMaintenanceDistributionChildren(children: ChildWidget[]): boolean {
  const legacyGrids = children.filter(
    (child) =>
      child.type === 'slot-grid'
      && String((child as SlotGridWidget).sqlQuery ?? '').includes('facility_slots')
      && String((child as SlotGridWidget).sqlQuery ?? '').includes("'整備-"),
  );
  return legacyGrids.length >= 2;
}

export function patchMaintenanceDistributionWidget(plane: DashboardPlane): DashboardPlane {
  let changed = false;
  const elements = plane.elements.map((el) => {
    const children = el.children ?? [];
    if (!isLegacyMaintenanceDistributionChildren(children)) return el;
    changed = true;
    const titleChild = children.find(
      (child) => child.type === 'text' && String((child as TextWidget).content ?? '').includes('整備分'),
    ) as (TextWidget & { iconImage?: string }) | undefined;
    // 原本的內容區：標題左上角起算，到最後一列格位為止
    const x = titleChild?.x ?? 12;
    const y = titleChild?.y ?? 12;
    const right = Math.max(...children.map((child) => child.x + child.width));
    const bottom = Math.max(...children.map((child) => child.y + child.height));
    const widget: MaintenanceDistributionWidget = {
      ...(createWidget('maintenance-distribution', x, y) as MaintenanceDistributionWidget),
      id: `${el.id}-maintenance-distribution`,
      width: Math.max(200, right - x),
      height: Math.max(80, bottom - y),
      ...(titleChild?.iconImage ? { titleIconImage: titleChild.iconImage } : {}),
      ...(titleChild?.fontSize ? { titleFontSize: titleChild.fontSize } : {}),
    };
    return { ...el, children: [widget] };
  });
  return changed ? { ...plane, elements } : plane;
}

/**
 * 舊版車輛分佈：SQL 裡「整備中」讀 slot_statuses 示範表，接真車或模擬器時永遠不會變。
 * 改接後端 /syncdrive-api/facility/vehicle-distribution（跟整備分佈同一套判斷）。
 * 欄位（status_code／pct／vehicle_count）不變，只換資料來源。
 */
function isLegacyVehicleDistributionWidget(child: ChildWidget): boolean {
  if (child.type !== 'segment-bar') return false;
  const sql = String((child as { sqlQuery?: string }).sqlQuery ?? '');
  return sql.includes('status_code') && sql.includes("'IN_SERVICE'") && sql.includes("'MAINTENANCE'");
}

export function patchVehicleDistributionSource(plane: DashboardPlane): DashboardPlane {
  let changed = false;
  const patchChild = (child: ChildWidget): ChildWidget => {
    if (!isLegacyVehicleDistributionWidget(child)) return child;
    changed = true;
    return {
      ...withoutSqlBinding(child as ChildWidget & { sqlQuery?: string; dataSourceId?: string }),
      dataUrl: VEHICLE_DISTRIBUTION_URL,
      refreshMode: 'event',
      invalidateTags: [...VEHICLE_DISTRIBUTION_INVALIDATE_TAGS],
    } as ChildWidget;
  };
  const elements = plane.elements.map((el) => {
    const children = el.children ?? [];
    if (!children.some(isLegacyVehicleDistributionWidget)) return el;
    return { ...el, children: children.map(patchChild) };
  });
  return changed ? { ...plane, elements } : plane;
}

/**
 * 班次中心、運能趨勢：舊 SQL 讀近 7 天全部訂單與 capacity_trend_demo_points 示範表。
 * 依 SQL 認出是哪一種，改接後端營運指標（欄位名稱不變，只換資料來源）。
 */
function operationMetricsUrlFor(child: ChildWidget): string | null {
  const sql = String((child as { sqlQuery?: string }).sqlQuery ?? '');
  if (!sql) return null;
  if (sql.includes('total_shifts') && sql.includes('FROM operation_orders')) return SHIFT_CENTER_URL;
  if (sql.includes('capacity_trend_demo_points') && sql.includes('live_val')) return CAPACITY_SUMMARY_URL;
  if (sql.includes('capacity_trend_demo_points') && sql.includes('forecast_util')) return CAPACITY_TREND_URL;
  return null;
}

export function patchOperationMetricsSources(plane: DashboardPlane): DashboardPlane {
  let changed = false;
  const elements = plane.elements.map((el) => {
    const children = el.children ?? [];
    if (!children.some((child) => operationMetricsUrlFor(child))) return el;
    changed = true;
    return {
      ...el,
      children: children.map((child) => {
        const url = operationMetricsUrlFor(child);
        if (!url) return child;
        return {
          ...withoutSqlBinding(child as ChildWidget & { sqlQuery?: string; dataSourceId?: string }),
          dataUrl: url,
          refreshMode: 'event',
          refreshInterval: 0,
          invalidateTags: [...OPERATION_METRICS_INVALIDATE_TAGS],
        } as ChildWidget;
      }),
    };
  });
  return changed ? { ...plane, elements } : plane;
}

/**
 * 舊版查詢／綁定裡「沒資料就補一個值」的地方：
 * - 事件列表分類沒填時一律寫「線控」→ 改「未分類」
 * - 車輛狀態量表綁了遙測 MQTT，還同時讀 vehicle_monitor_demo 示範表的 demo_speed／demo_load
 *   （沒資料時是 0）→ 拿掉，只認 MQTT
 */
const LEGACY_EVENT_CATEGORY_DEFAULT = "COALESCE(category_label, '線控')";
const EVENT_CATEGORY_DEFAULT = "COALESCE(category_label, '未分類')";

function childHasLegacyLiteralDefault(child: ChildWidget): boolean {
  const w = child as { sqlQuery?: string; mqttTopic?: string; valueField?: string };
  if (w.sqlQuery?.includes(LEGACY_EVENT_CATEGORY_DEFAULT)) return true;
  return child.type === 'gauge' && !!w.mqttTopic && /^demo_/.test(w.valueField ?? '');
}

export function planeHasLegacyLiteralDefaults(plane: DashboardPlane): boolean {
  return plane.elements.some((el) =>
    !!el.sqlQuery?.includes(LEGACY_EVENT_CATEGORY_DEFAULT)
    || (el.children ?? []).some(childHasLegacyLiteralDefault));
}

export function patchLegacyLiteralDefaults(plane: DashboardPlane): DashboardPlane {
  if (!planeHasLegacyLiteralDefaults(plane)) return plane;
  const fixSql = (sql: string | undefined) =>
    sql?.split(LEGACY_EVENT_CATEGORY_DEFAULT).join(EVENT_CATEGORY_DEFAULT);
  return {
    ...plane,
    elements: plane.elements.map((el) => ({
      ...el,
      ...(el.sqlQuery ? { sqlQuery: fixSql(el.sqlQuery) } : {}),
      children: (el.children ?? []).map((child) => {
        if (!childHasLegacyLiteralDefault(child)) return child;
        const w = child as ChildWidget & { sqlQuery?: string; valueField?: string; mqttTopic?: string };
        if (child.type === 'gauge' && w.mqttTopic && /^demo_/.test(w.valueField ?? '')) {
          return { ...w, valueField: '' } as ChildWidget;
        }
        return { ...w, sqlQuery: fixSql(w.sqlQuery) } as ChildWidget;
      }),
    })),
  };
}

export function patchDashboardRuntimeFixes(plane: DashboardPlane): DashboardPlane {
  return patchLegacyLiteralDefaults(patchEventDrivenSqlRefresh(
    patchOperationMetricsSources(
    patchVehicleDistributionSource(
    patchMaintenanceDistributionWidget(
    patchMaintenanceDistributionSql(
      patchMainlineFleetStatusWidget(
        patchShiftCardRouteProgressMqtt(
          patchShiftPanelsSimulationSql(
            patchVehicleMonitorLocationMqtt(
              patchVehicleMonitorBadgeMqttOnly(
                patchVehicleMonitorBadgeProtocol(plane),
              ),
            ),
          ),
        ),
      ),
    ),
    ),
    ),
    ),
  ));
}
