/** 儀表板範例平面共用的 SQL（事件中心／班次中心子元件綁定） */

/** 群組列表索引變數預設名（各場景可在群組屬性自訂，非固定 evt） */
export const LIST_INDEX_VAR = 'item';

/** 示範查詢時間下界：過去 7 天（後端啟動時會 refresh 時間戳，此窗口作為雙重保險） */
export const DAY_MS = `(EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 days')) * 1000)::bigint`;

/** 將 localStorage／樣板殘留的 ${DAY_MS} 展開為可執行 SQL（避免 interpolateVariables 原樣送出） */
export function expandBuiltinSqlMacros(sql: string): string {
  return sql.replace(/\$\{DAY_MS\}/g, DAY_MS);
}

export const EVENT_CENTER_SUMMARY_SQL = `
SELECT
  COUNT(*)::int AS total_events,
  COUNT(*) FILTER (WHERE NOT COALESCE(is_acknowledged, false))::int AS unprocessed_events,
  COUNT(*) FILTER (WHERE COALESCE(is_acknowledged, false))::int AS processed_events
FROM security_event_logs
WHERE created_at >= ${DAY_MS}
`.trim();

/** 依群組索引變數（如 {item}）從列表 SQL 取單一欄位 */
export function listSqlRowFieldByIndex(
  listSql: string,
  field: string,
  indexVar: string = LIST_INDEX_VAR,
): string {
  return listSqlRowFieldsByIndex(listSql, [field], indexVar);
}

/** 依群組索引變數取多欄（供 valueField + colorOnlyField 共用一筆查詢） */
export function listSqlRowFieldsByIndex(
  listSql: string,
  fields: string[],
  indexVar: string = LIST_INDEX_VAR,
): string {
  const cols = fields.join(', ');
  return `
SELECT ${cols}
FROM (
${listSql}
) AS __rows
LIMIT 1 OFFSET GREATEST(0, COALESCE({${indexVar}}, 0)::int)
`.trim();
}

/** 未處理事件列尾藍點（已處理則回傳空字串，元件自動隱藏） */
export function listSqlRowUnreadDotByIndex(
  listSql: string,
  indexVar: string = LIST_INDEX_VAR,
): string {
  return `
SELECT CASE WHEN COALESCE(is_acknowledged, false) THEN '' ELSE '●' END AS dot
FROM (
${listSql}
) AS __rows
LIMIT 1 OFFSET GREATEST(0, COALESCE({${indexVar}}, 0)::int)
`.trim();
}

export const EVENT_CENTER_LIST_SQL = `
SELECT
  event_id,
  COALESCE(category_label, '線控') AS category,
  vehicle_code,
  CASE WHEN COALESCE(is_acknowledged, false) THEN '已處理' ELSE '尚未處理' END AS status_label,
  to_char(to_timestamp((created_at::bigint) / 1000.0), 'YYYY.MM.DD HH24:MI:SS') AS event_time,
  COALESCE(display_message, detail, event_code::text) AS message,
  COALESCE(sub_label, vehicle_code) AS sub_label,
  COALESCE(is_acknowledged, false) AS is_acknowledged,
  severity::text AS severity
FROM security_event_logs
WHERE created_at >= ${DAY_MS}
ORDER BY created_at DESC
LIMIT 12
`.trim();

export const SHIFT_CENTER_SUMMARY_SQL = `
SELECT
  COUNT(*)::int AS total_shifts,
  COUNT(*) FILTER (WHERE status = 'END')::int AS completed_shifts,
  COUNT(*) FILTER (WHERE status = 'FAULTED')::int AS delayed_shifts,
  COALESCE(
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE status = 'END')::numeric
      / NULLIF(COUNT(*)::numeric, 0)
    )::int,
    0
  ) AS achievement_pct,
  (
    '達成了 '
    || COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'END')::numeric
        / NULLIF(COUNT(*)::numeric, 0)
      )::int,
      0
    )::text
    || '%'
  ) AS achievement_line,
  (COUNT(*) - COUNT(*) FILTER (WHERE status = 'END'))::int AS remaining_shifts,
  CASE
    WHEN COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'END')::numeric
        / NULLIF(COUNT(*)::numeric, 0)
      )::int,
      0
    ) >= 100 THEN ''
    ELSE (
      '剩餘'
      || (COUNT(*) - COUNT(*) FILTER (WHERE status = 'END'))::text
      || '班次'
    )
  END AS remaining_line
FROM operation_orders
WHERE created_at >= ${DAY_MS}
  AND (order_id LIKE 'DEMO-%' OR vehicle_code LIKE 'PMS%')
`.trim();

/** 班表部署管理 — 目前模式卡（示意；之後可改綁營運模式狀態） */
export const DEPLOYMENT_CURRENT_MODE_SQL = `
SELECT
  '正常營運'::text AS mode_label,
  'Level 1'::text AS mode_level
`.trim();

/** 班表部署管理 — 數據統計卡（示意數值；之後可改綁真實彙總表） */
export const DEPLOYMENT_DATA_STATS_SQL = `
SELECT
  92.3::float AS ontime_pct,
  ('準點率 ' || TO_CHAR(92.3::numeric, 'FM990.0') || '%') AS ontime_badge,
  16.9::float AS achievement_pct,
  313::int AS total_count,
  53::int AS completed_count,
  1::int AS delayed_count,
  0::int AS abnormal_count,
  0::int AS cancelled_count,
  ('總共 ' || 313::text) AS total_pill,
  ('完成 ' || 53::text) AS completed_pill
`.trim();

/** 班表部署管理 — 執行班表卡（示意） */
export const DEPLOYMENT_EXECUTING_SCHEDULE_SQL = `
SELECT
  '當前班表 執行於 00:00'::text AS schedule_meta,
  '進行中'::text AS status_label,
  'RUNNING'::text AS status_code,
  '高運量班表'::text AS schedule_name,
  'Jack'::text AS reviewer_name,
  '凌晨時段 班距 540 秒 運量 400 pphp'::text AS period_1,
  '離峰時段 班距 360 秒 運量 600 pphp'::text AS period_2,
  '尖峰時段 班距 180 秒 運量 1,200 pphp'::text AS period_3
`.trim();

/** 班表部署管理 — 重大事件卡（示意） */
export const DEPLOYMENT_MAJOR_EVENTS_SQL = `
SELECT
  '降級運轉事件'::text AS event_title,
  'Level 2'::text AS event_level,
  '2027.05.01'::text AS event_date,
  '10:00:00'::text AS event_time,
  '無更多事件'::text AS empty_hint
`.trim();

/** 班表部署管理 — 載具操作群組（每列一台車，供畫布群組迭代） */
export const DEPLOYMENT_VEHICLE_LIST_SQL = `
SELECT
  vehicle_code
FROM vehicles
WHERE vehicle_code LIKE 'PMS%'
ORDER BY vehicle_code
`.trim();

/** 運能趨勢區 KPI 列（即時／目標／可用／下段）— 不依固定 offset 格點，避免 tick 後 JOIN 失敗 */
export const CAPACITY_TREND_SUMMARY_SQL = `
SELECT
  (
    SELECT utilization FROM capacity_trend_demo_points
    WHERE demo_set_id = 'DEMO'
    ORDER BY ABS(offset_minutes)
    LIMIT 1
  )::int AS live_val,
  1200 AS target_val,
  200 AS avail_val,
  '可調度2輛' AS avail_hint,
  (
    SELECT utilization FROM capacity_trend_demo_points
    WHERE demo_set_id = 'DEMO' AND offset_minutes >= 30
    ORDER BY offset_minutes ASC
    LIMIT 1
  )::int AS next_val,
  to_char(date_trunc('minute', timezone('Asia/Taipei', NOW())) + interval '60 minutes', 'HH24:MI') AS next_hint
`.trim();

/** 運能趨勢折線：當前運能（過去～現在）+ 預期走勢（現在～未來） */
export const CAPACITY_TREND_CHART_SQL = `
SELECT
  to_char(
    date_trunc('minute', timezone('Asia/Taipei', NOW())) + (offset_minutes || ' minutes')::interval,
    'HH24:MI'
  ) AS time,
  actual_util,
  forecast_util,
  segment_code,
  is_anomaly,
  anomaly_label
FROM capacity_trend_demo_points
WHERE demo_set_id = 'DEMO'
ORDER BY offset_minutes
`.trim();

/** 整備分布：單一區域格位列表（列數 = 格位數，由 facility_slots 定義） */
export function maintenanceSlotsSql(zone: string): string {
  const z = zone.replace(/'/g, "''");
  return `
SELECT
  fs.slot_id,
  COALESCE(st.status::text, 'AVAILABLE') AS status,
  (
    CASE
      WHEN fs.zone = '整備-充電' THEN 'E' || LTRIM(SPLIT_PART(fs.slot_id, '-', 3), '0')
      WHEN fs.zone = '整備-洗車' THEN 'W' || LTRIM(SPLIT_PART(fs.slot_id, '-', 3), '0')
      WHEN fs.zone = '整備-保養' THEN 'M' || LTRIM(SPLIT_PART(fs.slot_id, '-', 3), '0')
      WHEN fs.zone = '整備-維修' THEN 'M2'
      WHEN fs.zone IN ('整備-調度', '整備-整備格') THEN 'H' || LTRIM(SPLIT_PART(fs.slot_id, '-', 3), '0')
      WHEN fs.zone = '整備-臨停' THEN 'P' || LTRIM(SPLIT_PART(fs.slot_id, '-', 3), '0')
      ELSE fs.slot_id
    END
  ) AS slot_label
FROM facility_slots fs
LEFT JOIN slot_statuses st ON st.slot_id = fs.slot_id
WHERE fs.zone = '${z}' AND fs.is_active = true
ORDER BY fs.slot_id ASC
`.trim();
}

/** 整備分布：區域使用中格位數（右側總數） */
export function maintenanceZoneCountSql(zone: string): string {
  const z = zone.replace(/'/g, "''");
  return `
SELECT COALESCE(SUM(
  CASE
    WHEN COALESCE((st.raw_payload->>'occupancy')::int, 0) > 0
      THEN (st.raw_payload->>'occupancy')::int
    WHEN st.status IN ('OCCUPIED', 'CHARGING', 'ERROR') OR st.vehicle_code IS NOT NULL
      THEN 1
    ELSE 0
  END
), 0)::int AS total
FROM facility_slots fs
LEFT JOIN slot_statuses st ON st.slot_id = fs.slot_id
WHERE fs.zone = '${z}' AND fs.is_active = true
`.trim();
}

/** 整備分布標題：有使用中的區域數 / 整備區域總數 */
export const MAINTENANCE_HEADER_SQL = `
SELECT
  COUNT(DISTINCT fs.zone)::int AS active_zones,
  (SELECT COUNT(DISTINCT zone) FROM facility_slots WHERE zone LIKE '整備-%' AND is_active = true)::int AS total_zones
FROM facility_slots fs
LEFT JOIN slot_statuses st ON st.slot_id = fs.slot_id
WHERE fs.zone LIKE '整備-%' AND fs.is_active = true
  AND (
    COALESCE((st.raw_payload->>'occupancy')::int, 0) > 0
    OR st.status IN ('OCCUPIED', 'CHARGING', 'ERROR')
    OR st.vehicle_code IS NOT NULL
  )
`.trim();

/** 車輛分布：依車輛狀態彙總比例與數量（每列一個 status_code） */
export const VEHICLE_DISTRIBUTION_SQL = `
SELECT
  status_code,
  ROUND(100.0 * COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct,
  COUNT(*)::int AS vehicle_count
FROM (
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1 FROM operation_orders o
        WHERE o.vehicle_code = v.vehicle_code AND o.status = 'PROCESSING'
      ) THEN 'IN_SERVICE'
      WHEN EXISTS (
        SELECT 1 FROM slot_statuses ss
        JOIN facility_slots fs ON fs.slot_id = ss.slot_id
        WHERE ss.vehicle_code = v.vehicle_code
          AND fs.zone LIKE '整備-%'
          AND ss.status IN ('OCCUPIED', 'CHARGING', 'ERROR')
      ) THEN 'MAINTENANCE'
      ELSE 'STANDBY'
    END AS status_code
  FROM vehicles v
  WHERE v.is_active = true
    AND (v.vehicle_code LIKE 'PMS%' OR v.vehicle_code LIKE 'AMR-%' OR v.vehicle_code LIKE 'AGV-%')
) fleet
GROUP BY status_code
ORDER BY CASE status_code
  WHEN 'IN_SERVICE' THEN 1
  WHEN 'MAINTENANCE' THEN 2
  ELSE 3
END
`.trim();

/** 車輛狀態列：11 台 PMS 載具（徽章：正線 trip_code／整備 maint_type_label，來自活躍訂單） */
export const VEHICLE_STATUS_ROW_SQL = `
SELECT DISTINCT ON (v.vehicle_code)
  v.vehicle_code,
  COALESCE(v.display_name, v.vehicle_code) AS vehicle_display,
  active_order.priority_level,
  active_order.line_kind,
  active_order.status AS order_status,
  active_order.trip_code,
  active_order.maint_type_label,
  active_order.maint_type_bg,
  active_order.maint_type_color,
  CASE
    WHEN active_order.line_kind = 'MAINLINE'
      AND active_order.status IN ('PENDING', 'PROCESSING')
      AND NULLIF(TRIM(active_order.trip_code), '') IS NOT NULL
      THEN active_order.trip_code
    WHEN active_order.line_kind = 'MAINTENANCE'
      AND active_order.status IN ('PENDING', 'PROCESSING')
      AND NULLIF(TRIM(active_order.maint_type_label), '') IS NOT NULL
      THEN active_order.maint_type_label
    WHEN NULLIF(TRIM(maint_order.yard_slot_id), '') IS NOT NULL THEN
      CASE
        WHEN maint_order.yard_slot_id LIKE 'E%' THEN '充電'
        WHEN maint_order.yard_slot_id LIKE 'P%' THEN '臨停'
        WHEN maint_order.yard_slot_id LIKE 'W%' THEN '洗車'
        WHEN maint_order.yard_slot_id LIKE 'H%' THEN '調度'
        WHEN maint_order.yard_slot_id LIKE 'M%' THEN '保養'
        ELSE '整備'
      END
    ELSE NULL
  END AS badge_label,
  CASE
    WHEN active_order.line_kind = 'MAINLINE'
      AND active_order.status IN ('PENDING', 'PROCESSING')
      AND NULLIF(TRIM(active_order.trip_code), '') IS NOT NULL
      THEN 'mainline'
    WHEN active_order.line_kind = 'MAINTENANCE'
      AND active_order.status IN ('PENDING', 'PROCESSING')
      AND NULLIF(TRIM(active_order.maint_type_label), '') IS NOT NULL
      THEN 'maintenance'
    WHEN NULLIF(TRIM(maint_order.yard_slot_id), '') IS NOT NULL THEN 'maintenance'
    ELSE NULL
  END AS badge_kind,
  CASE
    WHEN active_order.line_kind = 'MAINTENANCE' THEN COALESCE(active_order.maint_type_bg, '#422006')
    ELSE COALESCE(m.trip_badge_bg, '#7e57c2')
  END AS trip_badge_bg,
  CASE
    WHEN active_order.line_kind = 'MAINTENANCE' THEN COALESCE(active_order.maint_type_color, '#fdba74')
    ELSE COALESCE(m.trip_badge_color, '#f3e8ff')
  END AS trip_badge_color,
  COALESCE(m.badge_outline, '0') AS badge_outline,
  COALESCE(m.overall_health, 'OK') AS overall_health,
  COALESCE(m.alert_message, '') AS alert_message,
  COALESCE(m.card_border_color, '#00c897') AS card_border_color,
  COALESCE(m.status_computing, 'OK') AS status_computing,
  COALESCE(m.status_sensing, 'OK') AS status_sensing,
  COALESCE(m.status_communication, 'OK') AS status_communication,
  COALESCE(m.status_chassis, 'OK') AS status_chassis,
  CASE
    WHEN active_order.line_kind = 'MAINLINE'
      AND active_order.status = 'PROCESSING'
      THEN COALESCE(
        NULLIF(NULLIF(TRIM(m.segment_label), ''), '—'),
        NULLIF(TRIM(maint_order.yard_slot_id), ''),
        ('D' || (32 + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int % 18))::text
      )
    WHEN active_order.line_kind = 'MAINLINE'
      AND active_order.status IN ('PENDING', 'FAULTED')
      THEN COALESCE(
        NULLIF(TRIM(active_order.yard_slot_id), ''),
        NULLIF(TRIM(maint_order.yard_slot_id), ''),
        NULLIF(NULLIF(TRIM(m.segment_label), ''), '—'),
        ('D' || (32 + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int % 18))::text
      )
    ELSE COALESCE(
      NULLIF(TRIM(active_order.yard_slot_id), ''),
      NULLIF(TRIM(maint_order.yard_slot_id), ''),
      NULLIF(NULLIF(TRIM(m.segment_label), ''), '—'),
      ('D' || (32 + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int % 18))::text
    )
  END AS segment_label,
  CASE
    WHEN active_order.line_kind = 'MAINLINE' AND active_order.status = 'PROCESSING'
      THEN NULLIF(TRIM(maint_order.yard_slot_id), '')
    ELSE COALESCE(
      NULLIF(TRIM(active_order.yard_slot_id), ''),
      NULLIF(TRIM(maint_order.yard_slot_id), '')
    )
  END AS yard_slot_id,
  COALESCE(
    m.demo_speed,
    ((18 + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int % 8)
      + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int * 0.3)::numeric
  ) AS demo_speed,
  COALESCE(
    m.demo_load,
    (88 + (SUBSTRING(v.vehicle_code FROM '[0-9]+'))::int * 3 % 12)::numeric
  ) AS demo_load
FROM vehicles v
LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
LEFT JOIN LATERAL (
  SELECT o3.priority_level, o3.line_kind, o3.status, o3.trip_code,
         o3.maint_type_label, o3.maint_type_bg, o3.maint_type_color,
         NULLIF(TRIM(o3.payload->>'yard_slot_id'), '') AS yard_slot_id
  FROM operation_orders o3
  WHERE o3.vehicle_code = v.vehicle_code
    AND o3.status IN ('PENDING', 'PROCESSING', 'FAULTED')
  ORDER BY
    CASE
      WHEN o3.line_kind = 'MAINLINE'
        AND o3.status = 'PENDING'
        AND NULLIF(TRIM(o3.trip_code), '') IS NOT NULL
        THEN 3
      WHEN o3.line_kind = 'MAINLINE'
        AND o3.status = 'PROCESSING'
        AND COALESCE(m.demo_speed, 0) >= 1
        THEN 3
      WHEN o3.line_kind = 'MAINTENANCE'
        AND COALESCE(m.demo_speed, 0) < 1
        THEN 2
      ELSE 1
    END DESC,
    o3.priority_level DESC,
    o3.created_at DESC
  LIMIT 1
) active_order ON true
LEFT JOIN LATERAL (
  SELECT NULLIF(TRIM(o4.payload->>'yard_slot_id'), '') AS yard_slot_id
  FROM operation_orders o4
  WHERE o4.vehicle_code = v.vehicle_code
    AND o4.line_kind = 'MAINTENANCE'
    AND o4.status IN ('PENDING', 'PROCESSING', 'FAULTED')
  ORDER BY o4.created_at DESC
  LIMIT 1
) maint_order ON true
LEFT JOIN operation_orders o
  ON o.vehicle_code = v.vehicle_code AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
WHERE v.is_active = true
  AND v.vehicle_code LIKE 'PMS%'
ORDER BY v.vehicle_code, o.created_at DESC NULLS LAST
`.trim();

export const MAINTENANCE_HEADER_LINE_SQL = `
SELECT
  COALESCE(active_zones, 0)::text || ' / ' || COALESCE(total_zones, 6)::text AS header_line
FROM (
  SELECT
    COUNT(DISTINCT fs.zone) FILTER (
      WHERE st.status IN ('OCCUPIED', 'CHARGING', 'ERROR') OR st.vehicle_code IS NOT NULL
    )::int AS active_zones,
    (SELECT COUNT(DISTINCT zone) FROM facility_slots WHERE zone LIKE '整備-%' AND is_active = true)::int AS total_zones
  FROM facility_slots fs
  LEFT JOIN slot_statuses st ON st.slot_id = fs.slot_id
  WHERE fs.zone LIKE '整備-%' AND fs.is_active = true
) sub
`.trim();

/** 正線班次：每筆訂單（YYMMDD-trip_code）+ route_id 站點巢狀結構 */
export const MAINLINE_SHIFTS_SQL = `
WITH active_orders AS (
  SELECT
    o.*,
    v.display_name,
    r.direction_letter AS trip_direction,
    CASE
      WHEN o.planned_start IS NOT NULL THEN
        EXTRACT(HOUR FROM timezone('Asia/Taipei', to_timestamp(o.planned_start / 1000)))::int * 60
        + EXTRACT(MINUTE FROM timezone('Asia/Taipei', to_timestamp(o.planned_start / 1000)))::int
      WHEN o.trip_code ~ '^[DU][0-9]{4}$'
        AND SUBSTRING(o.trip_code, 2, 2)::int BETWEEN 0 AND 23
        AND SUBSTRING(o.trip_code, 4, 2)::int BETWEEN 0 AND 59
        THEN SUBSTRING(o.trip_code, 2, 2)::int * 60 + SUBSTRING(o.trip_code, 4, 2)::int
      ELSE NULL
    END AS trip_start_minutes,
    first_st.station_id AS route_origin,
    mid_st.station_id AS route_mid,
    last_st.station_id AS route_destination
  FROM operation_orders o
  JOIN vehicles v ON v.vehicle_code = o.vehicle_code
  LEFT JOIN operation_routes r ON r.route_id = o.route_id
  LEFT JOIN LATERAL (
    SELECT station_id FROM operation_route_stations
    WHERE route_id = o.route_id ORDER BY sequence_order ASC LIMIT 1
  ) first_st ON true
  LEFT JOIN LATERAL (
    SELECT station_id FROM operation_route_stations
    WHERE route_id = o.route_id ORDER BY sequence_order ASC OFFSET 1 LIMIT 1
  ) mid_st ON true
  LEFT JOIN LATERAL (
    SELECT station_id FROM operation_route_stations
    WHERE route_id = o.route_id ORDER BY sequence_order DESC LIMIT 1
  ) last_st ON true
  WHERE o.line_kind = 'MAINLINE'
    AND NULLIF(TRIM(o.trip_code), '') IS NOT NULL
    AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
),
route_json AS (
  SELECT
    o.order_id,
    json_agg(
      json_build_object(
        'name', COALESCE(NULLIF(rs.station_display_name, ''), rs.station_id),
        'station_id', rs.station_id,
        'actions', COALESCE((
          SELECT json_agg(json_build_object(
            'action_id', a.action_id,
            'action_type', a.action_type,
            'action_status', a.action_status,
            'trigger_offset_m', a.trigger_offset_m
          ) ORDER BY a.action_id)
          FROM order_action_states a
          WHERE a.order_id = o.order_id AND a.station_id = rs.station_id
        ), '[]'::json)
      ) ORDER BY rs.sequence_order
    )::text AS route_stations
  FROM active_orders o
  JOIN operation_route_stations rs ON rs.route_id = o.route_id
  GROUP BY o.order_id
)
SELECT
  o.order_id AS shift_key,
  o.vehicle_code,
  o.trip_code,
  CONCAT(o.trip_code, ' ', COALESCE(o.display_name, o.vehicle_code)) AS trip_header,
  CASE WHEN o.trip_direction = 'D' THEN '下行' ELSE '上行' END AS direction_label,
  CASE WHEN o.trip_direction = 'D' THEN '#8E51FF' ELSE '#51A2FF' END AS direction_pill_bg,
  '#FFFFFF' AS direction_pill_color,
  '下一站' AS station_label,
  '剩餘到站' AS eta_label,
  o.status AS order_status,
  CASE
    WHEN o.status = 'FAULTED' THEN '故障'
    WHEN o.status = 'PENDING' THEN '待發'
    WHEN COALESCE(o.delay_minutes, 0) > 0 THEN '延誤'
    WHEN o.status = 'PROCESSING' THEN '準時'
    ELSE '待命'
  END AS status_label,
  CASE
    WHEN o.status = 'FAULTED' THEN '#450a0a'
    WHEN o.status = 'PENDING' THEN '#27272a'
    WHEN COALESCE(o.delay_minutes, 0) > 0 THEN '#422006'
    WHEN o.status = 'PROCESSING' THEN 'rgba(0, 212, 146, 0.3)'
    ELSE '#27272a'
  END AS status_bg,
  CASE
    WHEN o.status = 'FAULTED' THEN '#f87171'
    WHEN o.status = 'PENDING' THEN '#a1a1aa'
    WHEN COALESCE(o.delay_minutes, 0) > 0 THEN '#fb923c'
    WHEN o.status = 'PROCESSING' THEN '#00BC7D'
    ELSE '#a1a1aa'
  END AS status_color,
  CASE
    WHEN o.status = 'FAULTED' THEN 'rgba(239,68,68,0.75)'
    WHEN COALESCE(o.delay_minutes, 0) > 0 THEN 'rgba(249,115,22,0.75)'
    WHEN o.status = 'PROCESSING' THEN '#009966'
    WHEN o.status = 'PENDING' THEN 'rgba(113,113,122,0.45)'
    ELSE 'rgba(113,113,122,0.35)'
  END AS card_border_color,
  CASE WHEN o.trip_direction = 'U' THEN 'S2W上行' ELSE 'N2W下行' END AS st_a,
  CASE WHEN o.trip_direction = 'U' THEN 'T3上行' ELSE 'T3下行' END AS st_b,
  CASE WHEN o.trip_direction = 'U' THEN 'N2W上行' ELSE 'S2W下行' END AS st_c,
  COALESCE(
    NULLIF(rj.route_stations, '[]'),
    -- 即時調度引擎下的訂單沒有 route_id（那張表只有兩筆舊的 D/U 路線），
    -- 站序改放在 payload。這一支才是新班表的真站序，優先於下面的固定備援。
    (
      SELECT json_agg(
        json_build_object(
          'name', COALESCE(NULLIF(st->>'station_name', ''), st->>'station_id'),
          'station_id', st->>'station_id',
          'actions', '[]'::json
        ) ORDER BY (st->>'order')::int
      )::text
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(o.payload->'stations') = 'array' THEN o.payload->'stations'
          ELSE '[]'::jsonb
        END
      ) st
    ),
    CASE
      WHEN o.trip_direction = 'U' THEN
        '[{"name":"S2W上行","station_id":"station_6"},{"name":"T3上行","station_id":"station_4"},{"name":"N2W上行","station_id":"station_1"}]'
      ELSE '[{"name":"N2W下行","station_id":"station_2"},{"name":"T3下行","station_id":"station_3"},{"name":"S2W下行","station_id":"station_5"}]'
    END
  ) AS route_stations,
  CASE WHEN o.trip_direction = 'U' THEN 1 ELSE 0 END AS trip_leg_hint,
  CASE
    WHEN o.status = 'PENDING' THEN 0
    WHEN o.status = 'FAULTED' THEN COALESCE((o.payload->>'segment_index')::int, 0)
    WHEN COALESCE(o.payload->'current_leg'->>'target_station_id', o.route_mid) = COALESCE(o.route_mid, 'station_3') THEN 0
    ELSE 1
  END AS segment_index,
  CASE
    WHEN o.status = 'PENDING' THEN 100
    WHEN o.status = 'FAULTED' THEN COALESCE(FLOOR((o.payload->>'segment_remain_pct')::numeric)::int, 100)
    ELSE COALESCE(
      FLOOR((o.payload->>'segment_remain_pct')::numeric)::int,
      CASE
        WHEN jsonb_typeof(o.payload->'current_leg') = 'object'
          AND COALESCE((o.payload->'current_leg'->>'eta_seconds')::numeric, 0) <= 0
          AND COALESCE((o.payload->'current_leg'->>'distance_to_target_m')::numeric, 0) <= 0
        THEN 0
        WHEN COALESCE((o.payload->'current_leg'->>'eta_seconds')::numeric, 0) <= 0 THEN 100
        WHEN COALESCE(
          (o.payload->'leg_eta_max'->>(o.payload->'current_leg'->>'target_station_id'))::numeric,
          0
        ) > 0 THEN ROUND(
          (o.payload->'current_leg'->>'eta_seconds')::numeric
          / (o.payload->'leg_eta_max'->>(o.payload->'current_leg'->>'target_station_id'))::numeric
          * 100
        )::int
        ELSE 100
      END
    )
  END AS segment_remain_pct,
  COALESCE(
    (
      SELECT COALESCE(NULLIF(TRIM(rs.station_display_name), ''), rs.station_id)
      FROM operation_route_stations rs
      WHERE rs.route_id = o.route_id
        AND rs.station_id = COALESCE(
          NULLIF(TRIM(o.next_station), ''),
          CASE
            WHEN o.status = 'PENDING' THEN o.route_origin
            WHEN NOT EXISTS (
              SELECT 1 FROM order_action_states a
              WHERE a.order_id = o.order_id
                AND a.station_id = o.route_mid
                AND a.action_type = 'STATION_DEPARTURE'
                AND a.action_status = 'COMPLETED'
            ) THEN o.route_mid
            ELSE COALESCE(o.route_destination, o.route_mid)
          END
        )
      LIMIT 1
    ),
    CASE WHEN o.trip_direction = 'U' THEN 'S2W上行' ELSE 'N2W下行' END
  ) AS next_station,
  CASE
    WHEN o.status = 'PENDING' AND o.trip_start_minutes IS NOT NULL THEN
      LPAD((
        GREATEST(
          0,
          o.trip_start_minutes
            - (EXTRACT(HOUR FROM NOW())::int * 60 + EXTRACT(MINUTE FROM NOW())::int)
        ) / 60
      )::int::text, 2, '0')
      || ':'
      || LPAD((
        GREATEST(
          0,
          o.trip_start_minutes
            - (EXTRACT(HOUR FROM NOW())::int * 60 + EXTRACT(MINUTE FROM NOW())::int)
        ) % 60
      )::int::text, 2, '0')
    ELSE COALESCE(
      LPAD((FLOOR(GREATEST(0, COALESCE((o.payload->'current_leg'->>'eta_seconds')::numeric, 0))) / 60)::int::text, 2, '0')
      || ':'
      || LPAD((FLOOR(GREATEST(0, COALESCE((o.payload->'current_leg'->>'eta_seconds')::numeric, 0)))::int % 60)::text, 2, '0'),
      NULLIF(TRIM(o.eta_remain), ''),
      '00:00'
    )
  END AS eta_remain,
  CASE WHEN COALESCE(o.delay_minutes, 0) > 0 THEN CONCAT('+', o.delay_minutes, '分') ELSE '' END AS eta_delay,
  CASE
    WHEN o.trip_start_minutes IS NOT NULL THEN
      LPAD(((o.trip_start_minutes / 60) % 24)::int::text, 2, '0') || ':' ||
      LPAD((o.trip_start_minutes % 60)::int::text, 2, '0')
    ELSE to_char(to_timestamp(COALESCE(o.planned_start, o.created_at) / 1000.0), 'HH24:MI')
  END AS depart_time,
  CASE
    WHEN o.trip_start_minutes IS NOT NULL THEN
      LPAD(((((o.trip_start_minutes + 6) % 1440) / 60) % 24)::int::text, 2, '0') || ':' ||
      LPAD(((o.trip_start_minutes + 6) % 60)::int::text, 2, '0')
    ELSE to_char(to_timestamp(COALESCE(o.planned_end, o.created_at + 360000) / 1000.0), 'HH24:MI')
  END AS end_time,
  COALESCE((o.payload->>'route_progress')::int, CASE WHEN o.status = 'PENDING' THEN 0 ELSE 18 END) AS route_progress,
  (o.status = 'FAULTED') AS is_alert,
  COALESCE(o.delay_minutes, 0) AS delay_minutes,
  COALESCE(
    NULLIF(TRIM(o.payload->>'operation_action'), ''),
    (SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM order_action_states a
        WHERE a.order_id = o.order_id
          AND a.action_type = 'STATION_DEPARTURE'
          AND a.action_status = 'IN_PROGRESS'
      ) THEN 'exit'
      WHEN EXISTS (
        SELECT 1 FROM order_action_states a
        WHERE a.order_id = o.order_id
          AND a.action_type = 'PLATFORM_DOCKING'
          AND a.action_status = 'IN_PROGRESS'
      ) THEN 'enter'
      ELSE NULL
    END),
    CASE
      WHEN o.status = 'FAULTED' THEN 'alert'
      WHEN COALESCE(o.delay_minutes, 0) > 0 THEN 'dispatch'
      WHEN o.status = 'PENDING' THEN 'music'
      ELSE ''
    END
  ) AS operation_action,
  CASE
    WHEN o.status = 'PENDING' THEN '#52525b'
    WHEN o.status = 'FAULTED' THEN '#ef4444'
    WHEN COALESCE(o.delay_minutes, 0) > 0 THEN '#fb923c'
    ELSE '#51A2FF'
  END AS icon_bg_color,
  'mainline' AS line_kind
FROM active_orders o
LEFT JOIN route_json rj ON rj.order_id = o.order_id
ORDER BY
  CASE o.status WHEN 'PROCESSING' THEN 0 WHEN 'FAULTED' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
  COALESCE(o.trip_start_minutes, ((COALESCE(o.planned_start, o.created_at) / 60000) % 1440)::int),
  o.trip_code
LIMIT 12
`.trim();

/** 圖台標題列：正線營運 PROCESSING 數 / 當前正線名冊數（分母來自訂單，不寫死容量；模擬器 4 台僅為示範場景） */
export const MAINLINE_FLEET_STATUS_SQL = `
SELECT
  CONCAT(
    '正線營運 ',
    s.processing_count,
    ' / ',
    GREATEST(s.roster_count, s.processing_count, 1)
  ) AS mainline_fleet_line
FROM (
  SELECT
    COUNT(*) FILTER (WHERE o.status = 'PROCESSING')::int AS processing_count,
    COUNT(*) FILTER (
      WHERE o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    )::int AS roster_count
  FROM operation_orders o
  WHERE o.line_kind = 'MAINLINE'
    AND NULLIF(TRIM(o.trip_code), '') IS NOT NULL
) s
`.trim();

/** 整備班表：一卡一任務，軌道 S2W→格位；示範模式車已在格上 */
export const MAINTENANCE_SHIFTS_SQL = `
WITH m0 AS (
  SELECT
    o.*,
    COALESCE(
      NULLIF(TRIM(o.payload->>'yard_slot_id'), ''),
      NULLIF(TRIM(o.next_station), '')
    ) AS slot_id
  FROM operation_orders o
  WHERE o.order_id LIKE 'DEMO-ORD-%'
    AND o.line_kind = 'MAINTENANCE'
    AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    AND o.created_at >= ${DAY_MS}
    AND COALESCE(NULLIF(TRIM(o.payload->>'yard_slot_id'), ''), NULLIF(TRIM(o.next_station), '')) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM operation_orders ml
      WHERE ml.vehicle_code = o.vehicle_code
        AND ml.line_kind = 'MAINLINE'
        AND ml.status IN ('PENDING', 'PROCESSING')
    )
)
SELECT DISTINCT ON (o.vehicle_code)
  o.order_id AS shift_key,
  o.vehicle_code,
  COALESCE(o.trip_code, '—') AS trip_code,
  COALESCE(o.trip_code, '—') AS trip_header,
  CASE
    WHEN slot_id LIKE 'E%' THEN '充電'
    WHEN slot_id LIKE 'P%' THEN '臨停'
    WHEN slot_id LIKE 'W%' THEN '洗車'
    WHEN slot_id LIKE 'H%' THEN '調度'
    WHEN slot_id LIKE 'M%' THEN '保養'
    ELSE COALESCE(o.maint_type_label, '整備')
  END AS maint_type_label,
  COALESCE(o.maint_type_bg, 'transparent') AS maint_type_bg,
  CASE
    WHEN slot_id LIKE 'P%' OR COALESCE(o.maint_type_label, '') = '臨停' THEN '#FD9A00'
    ELSE COALESCE(o.maint_type_color, '#FD9A00')
  END AS maint_type_color,
  CASE
    WHEN o.status = 'FAULTED' THEN '進行中'
    WHEN o.status = 'PENDING' THEN '停留中'
    ELSE '進行中'
  END AS status_label,
  CASE
    WHEN o.status = 'END' THEN '#422006'
    WHEN o.status = 'PENDING' THEN '#27272a'
    WHEN o.status IN ('PROCESSING', 'FAULTED') THEN 'rgba(0, 212, 146, 0.3)'
    ELSE '#27272a'
  END AS status_bg,
  CASE
    WHEN o.status = 'END' THEN '#fb923c'
    WHEN o.status = 'PENDING' THEN '#a1a1aa'
    WHEN o.status IN ('PROCESSING', 'FAULTED') THEN '#00BC7D'
    ELSE '#a1a1aa'
  END AS status_color,
  CASE
    WHEN o.status = 'END' THEN 'rgba(249,115,22,0.75)'
    WHEN o.status = 'PENDING' THEN 'rgba(113,113,122,0.55)'
    WHEN o.status IN ('PROCESSING', 'FAULTED') THEN '#009966'
    ELSE 'rgba(113,113,122,0.45)'
  END AS card_border_color,
  'S2W' AS st_a,
  o.slot_id AS st_b,
  o.slot_id AS st_c,
  json_build_array(
    json_build_object('name', 'S2W', 'remain_pct', 0),
    json_build_object('name', o.slot_id, 'remain_pct', 100)
  )::text AS route_stations,
  0 AS segment_index,
  0 AS segment_remain_pct,
  o.slot_id AS next_station,
  '整備站點' AS station_label,
  CASE
    WHEN o.status = 'END' THEN '逾時滯留'
    ELSE '完成預估'
  END AS eta_label,
  COALESCE(o.eta_remain, '00:30:00') AS eta_remain,
  to_char(to_timestamp(COALESCE(o.planned_start, o.created_at) / 1000.0), 'HH24:MI') AS depart_time,
  to_char(to_timestamp(COALESCE(o.planned_end, o.created_at + 1800000) / 1000.0), 'HH24:MI') AS end_time,
  COALESCE(
    (o.payload->>'route_progress')::int,
    100
  ) AS route_progress,
  false AS is_alert,
  CASE
    WHEN slot_id LIKE 'E%' THEN 'charging'
    WHEN slot_id LIKE 'W%' THEN 'wash'
    WHEN slot_id LIKE 'P%' THEN 'parking'
    WHEN slot_id LIKE 'M%' THEN 'maintenance'
    WHEN slot_id LIKE 'H%' THEN 'dispatch'
    ELSE 'maintenance'
  END AS operation_action,
  '#51A2FF' AS icon_bg_color,
  'maintenance' AS line_kind
FROM m0 o
ORDER BY o.vehicle_code, o.created_at DESC
LIMIT 12
`.trim();
