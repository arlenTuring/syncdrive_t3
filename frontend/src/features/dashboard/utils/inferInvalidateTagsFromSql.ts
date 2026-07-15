/**
 * 依 SQL 內容推斷失效標籤（與後端 DatasourceInvalidationService 對齊）。
 * 泛用元件未手動設定 invalidateTags 時，useWidgetData 自動訂閱。
 */
export function inferInvalidateTagsFromSql(sql: string | undefined): string[] {
  if (!sql?.trim()) return [];
  const s = sql.toUpperCase();
  const tags = new Set<string>();

  if (s.includes('SECURITY_EVENT_LOG') || s.includes('EVENT_CENTER')) {
    tags.add('domain:event_center');
    tags.add('table:security_event_log');
  }
  if (s.includes('OPERATION_ORDERS')) {
    tags.add('table:operation_orders');
    tags.add('domain:shift_center');
  }
  if (s.includes('SHIFT_CENTER') || s.includes('ACHIEVEMENT_PCT') || s.includes('TOTAL_SHIFTS')) {
    tags.add('domain:shift_center');
  }
  if (s.includes('MAINLINE_SHIFTS') || (s.includes('LINE_KIND') && s.includes('MAINLINE'))) {
    tags.add('domain:mainline_shifts');
  }
  if (s.includes('MAINTENANCE_SHIFTS') || (s.includes('LINE_KIND') && s.includes('MAINTENANCE'))) {
    tags.add('domain:maintenance_shifts');
  }
  if (s.includes('VEHICLE_MONITOR_DEMO')) {
    tags.add('domain:vehicle_monitor');
    tags.add('table:vehicle_monitor_demo');
  }
  if (s.includes('SLOT_STATUS') || s.includes('SLOT_STATUSES') || s.includes('FACILITY_SLOTS') || s.includes('MAINTENANCE_SLOT') || s.includes('YARD_SLOT')) {
    tags.add('domain:maintenance_slots');
    tags.add('table:slot_status');
  }
  if (s.includes('CAPACITY_TREND')) {
    tags.add('domain:capacity_trend');
  }
  if (s.includes('VEHICLE_DISTRIBUTION') || (s.includes('FROM VEHICLES') && s.includes('GROUP BY'))) {
    tags.add('domain:vehicle_distribution');
  }

  return [...tags];
}

export function tagsOverlap(subscribed: string[], incoming: string[]): boolean {
  if (subscribed.length === 0 || incoming.length === 0) return false;
  const incomingSet = new Set(incoming);
  return subscribed.some((tag) => incomingSet.has(tag));
}
