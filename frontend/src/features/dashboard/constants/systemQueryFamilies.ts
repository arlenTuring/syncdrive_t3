/**
 * 系統內建查詢的種類（demoSql.ts 裡會被直接放進使用者版面的那幾支）。
 *
 * markers 只用來「認出長得像系統查詢、但跟任何一版原文都對不上」的 SQL，好列出來給人看；
 * 不會拿 markers 決定要不要覆寫——覆寫只看完整指紋（見 utils/systemQueries.ts）。
 */
export interface SystemQueryFamily {
  id: string;
  /** demoSql.ts 裡目前版本的常數名稱 */
  constantName: string;
  label: string;
  markers: RegExp[];
}

export const SYSTEM_QUERY_FAMILIES: SystemQueryFamily[] = [
  {
    id: 'mainline-shifts',
    constantName: 'MAINLINE_SHIFTS_SQL',
    label: '正線與過渡班次名冊',
    markers: [/\bshift_key\b/, /trip_start_minutes|station_display_name/],
  },
  {
    id: 'maintenance-shifts',
    constantName: 'MAINTENANCE_SHIFTS_SQL',
    label: '整備班次名冊',
    markers: [/\bshift_key\b/, /\bmaint_type_label\b/],
  },
  {
    id: 'vehicle-status',
    constantName: 'VEHICLE_STATUS_ROW_SQL',
    label: '車輛狀態列',
    markers: [/\bbadge_label\b/, /\bsegment_label\b/, /\bdemo_speed\b/],
  },
  {
    id: 'event-center-list',
    constantName: 'EVENT_CENTER_LIST_SQL',
    label: '事件中心清單',
    markers: [/\bsecurity_event_logs\b/, /\bstatus_label\b/, /\bevent_time\b/],
  },
  {
    id: 'mainline-fleet',
    constantName: 'MAINLINE_FLEET_STATUS_SQL',
    label: '正線營運車數',
    markers: [/\bmainline_fleet_line\b/],
  },
];
