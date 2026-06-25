import type { DashboardPlane, ChildWidget, TextWidget, RouteProgressWidget } from '../types';
import {
  VEHICLE_STATUS_ROW_SQL,
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  MAINLINE_FLEET_STATUS_SQL,
} from '../constants/demoSql';
import {
  SHIFT_ROSTER_REFRESH_INTERVAL,
  MAINLINE_FLEET_REFRESH_INTERVAL,
} from './resolveBuiltinGroupSql';
import { migrateChildWidgetGenerics } from './migrateWidgetGenerics';

const DS_INTERNAL = 'default-internal';

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
    if (!sql.includes('operation_route_stations')) return true;
    if (label === '正線班次' && !sql.includes('order_action_states')) return true;
    if (label === '正線班次' && sql.includes('DEMO-ORD')) return true;
    if (label === '正線班次' && !sql.includes('trip_start_minutes')) return true;
    if (label === '正線班次' && sql.includes('AND o.created_at >=')) return true;
    if (label === '正線班次' && (el.refreshInterval ?? 0) > SHIFT_ROSTER_REFRESH_INTERVAL && (el.refreshInterval ?? 0) <= 2) return true;
    if (label === '正線班次' && !sql.includes("payload->'current_leg'")) return true;
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

function patchFleetTextChild(child: ChildWidget): ChildWidget {
  if (child.type !== 'text') return child;
  const text = child as TextWidget;
  if (text.valueField === 'mainline_fleet_line' && text.dataSourceId) {
    return {
      ...text,
      sqlQuery: MAINLINE_FLEET_STATUS_SQL,
      refreshInterval: MAINLINE_FLEET_REFRESH_INTERVAL,
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

/** 班次／整備任務列：強制套用最新 SQL（避免 localStorage 殘留舊 DEMO-ORD 查詢） */
export function patchShiftPanelsSimulationSql(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label === '正線班次' && el.isGroup) {
        return { ...el, sqlQuery: MAINLINE_SHIFTS_SQL, refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL };
      }
      if (el.label === '整備班表' && el.isGroup) {
        return { ...el, sqlQuery: MAINTENANCE_SHIFTS_SQL, refreshInterval: SHIFT_ROSTER_REFRESH_INTERVAL };
      }
      return el;
    }),
  };
}

/** 車輛狀態卡：SQL 改為活躍訂單班次／整備標籤，徽章訂閱 operation/update */
export function patchVehicleMonitorBadgeProtocol(plane: DashboardPlane): DashboardPlane {
  if (!needsVehicleMonitorBadgeProtocolFix(plane)) return plane;
  return {
    ...plane,
    elements: plane.elements.map((el) => {
      if (el.label !== '車輛狀態' || !el.isGroup) return el;
      return {
        ...el,
        sqlQuery: VEHICLE_STATUS_ROW_SQL,
        children: (el.children ?? []).map((child) => migrateChildWidgetGenerics(child)),
      };
    }),
  };
}

/** 執行期資料修補（不變更版面座標） */
export function patchDashboardRuntimeFixes(plane: DashboardPlane): DashboardPlane {
  return patchMainlineFleetStatusWidget(
    patchShiftCardRouteProgressMqtt(
      patchShiftPanelsSimulationSql(
        patchVehicleMonitorBadgeProtocol(plane),
      ),
    ),
  );
}
