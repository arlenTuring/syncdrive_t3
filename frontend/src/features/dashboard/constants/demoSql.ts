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

/**
 * 車輛分布資料來源：後端依車輛即時位置、進行中訂單與部署班表判定
 * （跟整備分佈同一套判斷），回傳 status_code／pct／vehicle_count。
 */
export const VEHICLE_DISTRIBUTION_URL = '/syncdrive-api/facility/vehicle-distribution';
/** 車輛狀態只在訂單狀態改變或車進出格位時會變 */
export const VEHICLE_DISTRIBUTION_INVALIDATE_TAGS = ['domain:maintenance_slots', 'table:operation_orders'] as const;

/** @deprecated 「整備中」讀 slot_statuses 示範表；已改用 VEHICLE_DISTRIBUTION_URL */
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
        WHERE o.vehicle_code = v.vehicle_code
          AND o.line_kind IN ('MAINLINE', 'TEST')
          AND o.status = 'PROCESSING'
          AND o.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
          AND COALESCE(o.planned_end, o.planned_start + 600000)
              >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
      ) THEN 'IN_SERVICE'
      WHEN EXISTS (
        SELECT 1 FROM operation_orders o
        WHERE o.vehicle_code = v.vehicle_code
          AND o.line_kind = 'MAINTENANCE'
          AND o.status = 'PROCESSING'
          AND o.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
          AND COALESCE(o.planned_end, o.planned_start + 1800000)
              >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
      ) THEN 'MAINTENANCE'
      WHEN EXISTS (
        SELECT 1 FROM slot_statuses ss
        JOIN facility_slots fs ON fs.slot_id = ss.slot_id
        WHERE ss.vehicle_code = v.vehicle_code
          AND fs.zone LIKE '整備-%'
          AND ss.status IN ('OCCUPIED', 'CHARGING', 'ERROR')
          AND ss.last_updated >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 120000
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
/**
 * 車輛狀態卡一車一列。
 *
 * 速度、電量、四項健康度平常走 MQTT（telemetry/update、health/heartbeat），這支 SQL
 * 是車子沒在線時的底稿，也負責算 MQTT 不報的東西：現在執行哪一張單、人在哪裡。
 */
export const VEHICLE_STATUS_ROW_SQL = `
WITH deployed AS (
  SELECT body
  FROM operation_shifts
  WHERE usage_status = 'in_use'
  ORDER BY updated_at DESC
  LIMIT 1
), clock AS (
  SELECT
    EXTRACT(HOUR FROM timezone('Asia/Taipei', now())) * 60
    + EXTRACT(MINUTE FROM timezone('Asia/Taipei', now()))
    + EXTRACT(SECOND FROM timezone('Asia/Taipei', now())) / 60 AS minute_now
)
SELECT
  v.vehicle_code,
  COALESCE(v.display_name, v.vehicle_code) AS vehicle_display,
  CASE WHEN schedule_block.task_type = 'passenger' THEN 50 ELSE 40 END AS priority_level,
  CASE WHEN schedule_block.task_type = 'passenger' THEN 'MAINLINE' ELSE 'MAINTENANCE' END AS line_kind,
  CASE WHEN schedule_block.block IS NULL THEN NULL ELSE 'PROCESSING' END AS order_status,
  schedule_block.trip_code,
  CASE WHEN schedule_block.task_type <> 'passenger' THEN schedule_block.card_label END AS maint_type_label,
  CASE WHEN schedule_block.task_type <> 'passenger' THEN '#422006' END AS maint_type_bg,
  CASE WHEN schedule_block.task_type <> 'passenger' THEN '#FD9A00' END AS maint_type_color,
  CASE
    WHEN schedule_block.task_type = 'passenger' THEN schedule_block.trip_code
    WHEN schedule_block.block IS NOT NULL THEN schedule_block.card_label
    ELSE NULL
  END AS badge_label,
  CASE
    WHEN schedule_block.task_type = 'passenger' THEN 'mainline'
    WHEN schedule_block.block IS NOT NULL THEN 'maintenance'
    ELSE NULL
  END AS badge_kind,
  CASE
    WHEN schedule_block.task_type <> 'passenger' THEN '#422006'
    ELSE COALESCE(m.trip_badge_bg, '#7e57c2')
  END AS trip_badge_bg,
  CASE
    WHEN schedule_block.task_type <> 'passenger' THEN '#FD9A00'
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
  COALESCE(NULLIF(TRIM(m.segment_label), ''), '—') AS segment_label,
  CASE WHEN m.location_kind = 'FACILITY' THEN NULLIF(TRIM(m.segment_label), '') END AS yard_slot_id,
  COALESCE(m.demo_speed, 0)::numeric AS demo_speed,
  COALESCE(m.demo_load, 0)::numeric AS demo_load
FROM vehicles v
LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
LEFT JOIN deployed d ON true
LEFT JOIN LATERAL (
  SELECT
    block,
    block->>'taskType' AS task_type,
    CASE WHEN block->>'taskType' = 'passenger' THEN
      UPPER(COALESCE(block->>'routeCode', ''))
      || LPAD(FLOOR((block->>'plannedStartMinute')::numeric / 60)::text, 2, '0')
      || LPAD(FLOOR(MOD((block->>'plannedStartMinute')::numeric, 60))::text, 2, '0')
    END AS trip_code,
    CASE
      WHEN block->>'source' = 'hold' THEN '暫停'
      WHEN block->>'taskType' = 'passenger' THEN COALESCE(
        (SELECT route->>'cardLabel'
         FROM jsonb_array_elements(COALESCE(d.body->'selectedRoutes', '[]'::jsonb)) route
         WHERE route->>'routeId' = block->>'routeId'
         LIMIT 1),
        '營運'
      )
      ELSE COALESCE(
        NULLIF(d.body->'maintenanceSectionCardLabelBySection'->>CASE block->>'taskType'
          WHEN 'washing' THEN 'carWash'
          WHEN 'servicing' THEN 'maintenance'
          WHEN 'inspection' THEN 'preTrip'
          WHEN 'standby' THEN 'mobile'
          ELSE block->>'taskType'
        END, ''),
        NULLIF(block->>'cardLabel', ''),
        CASE block->>'taskType'
          WHEN 'charging' THEN '充電'
          WHEN 'washing' THEN '洗車'
          WHEN 'servicing' THEN '保養'
          WHEN 'inspection' THEN '行檢'
          WHEN 'standby' THEN '待命'
          WHEN 'idle' THEN '暫停'
          WHEN 'dispatch' THEN '調度'
          ELSE NULLIF(block->>'label', '')
        END,
        '整備'
      )
    END AS card_label
  FROM jsonb_array_elements(COALESCE(d.body->'scheduleOutput'->'plan'->'timelines', '[]'::jsonb)) timeline
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(timeline->'blocks', '[]'::jsonb)) block
  CROSS JOIN clock
  WHERE COALESCE((timeline->>'row')::int, (block->>'timelineRow')::int)
        = NULLIF(regexp_replace(v.vehicle_code, '\\D', '', 'g'), '')::int
    AND (block->>'plannedStartMinute')::numeric <= clock.minute_now
    AND (block->>'plannedEndMinute')::numeric > clock.minute_now
  ORDER BY (block->>'plannedStartMinute')::numeric DESC
  LIMIT 1
) schedule_block ON true
WHERE v.is_active = true
  AND v.vehicle_code LIKE 'PMS%'
ORDER BY v.vehicle_code
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
    COALESCE(NULLIF(TRIM(o.payload->>'card_label'), ''), '營運') AS card_label,
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
    last_st.station_id AS route_destination,
    /*
     * 一台車只列一張單，而且<strong>車實際在做的那張優先</strong>。
     *
     * 以前先比「計畫時間窗有沒有涵蓋現在」：前班晚了幾十秒、下一班的時間窗已經開始，
     * 卡片就先換成下一班——畫面上顯示下一班待發，車卻還在跑上一班。現在依實際狀態排：
     * 故障、執行中的單永遠排前面，不管計畫結束時間過了沒；接下來要發的 PENDING 只有在這台
     * 車沒有進行中的單時才會出現。
     */
    ROW_NUMBER() OVER (
      PARTITION BY o.vehicle_code
      ORDER BY
        CASE o.status WHEN 'FAULTED' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
        (
          o.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
          AND COALESCE(o.planned_end, o.planned_start + 600000)
              >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
        ) DESC,
        o.planned_start
    ) AS vehicle_rank,
    /* 車端最後一次回報距今多久（毫秒）；從沒回報過就當作很久 */
    (EXTRACT(EPOCH FROM now()) * 1000)::bigint
      - COALESCE((o.payload->>'updated_at')::bigint, 0) AS report_age_ms,
    /* 這班還在跑，但計畫結束時間已經過了 15 秒以上：逾時仍在執行 */
    (
      o.status = 'PROCESSING'
      AND o.planned_end IS NOT NULL
      AND o.planned_end < (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 15000
    ) AS is_overdue,
    /* 同一台車有下一班已經到點、只是被這班佔住 */
    EXISTS (
      SELECT 1 FROM operation_orders nx
      WHERE nx.vehicle_code = o.vehicle_code
        AND nx.order_id <> o.order_id
        AND nx.status = 'PENDING'
        AND nx.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
        AND COALESCE(nx.planned_end, nx.planned_start + 600000)
            >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
    ) AS next_due_waiting
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
  WHERE o.line_kind IN ('MAINLINE', 'TEST')
    AND NULLIF(TRIM(o.trip_code), '') IS NOT NULL
    AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    /*
     * 只看今天。
     *
     * 少了這一條，同一個班次代號會把每一天的那一筆都撈出來——實測 TS1217 一次回
     * 十九列（8/29 到 9/16 各一），畫面上看起來像重複的卡片。而且排序從最早的
     * 00:00 開始，正在跑的 13:20 那幾班反而看不到。
     */
    AND o.planned_start >= (
      EXTRACT(EPOCH FROM timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', now())))) * 1000
    )::bigint
    AND o.planned_start < (
      EXTRACT(EPOCH FROM timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', now())) + interval '1 day')) * 1000
    )::bigint
    /*
     * 只留還沒跑完的。
     *
     * 排班引擎跑完一班不一定會把狀態收成 END：今天 218 筆裡有 208 筆掛在 PROCESSING，
     * 其中 204 筆的 planned_end 早就過了。真正在跑的只有 4 筆（四台車各一筆，payload
     * 的 updated_at 是幾秒前）。不擋掉的話卡片會被半夜那幾百筆殭屍班次塞滿。
     *
     * 留 60 秒寬限，剛到站的那一班不會瞬間消失。
     *
     * 執行中的單<strong>不看計畫結束時間</strong>：晚到的班次就算過了計畫結束仍在跑，卡片不能
     * 消失、也不能被下一班取代。改看車端有沒有回報——十分鐘內回報過的才是真的在跑，更久
     * 沒有回報的是前幾班留下的殭屍單，不列。半分鐘到十分鐘之間標成「資料過期」，不自動換成
     * 別的班次。
     */
    AND (
      COALESCE(o.planned_end, o.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
      OR (
        o.status = 'PROCESSING'
        AND COALESCE((o.payload->>'updated_at')::bigint, 0)
          >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 600000
      )
    )
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
  o.card_label AS direction_label,
  '#2B7FFF' AS direction_pill_bg,
  '#FFFFFF' AS direction_pill_color,
  '下一站' AS station_label,
  CASE
    WHEN o.status = 'PROCESSING' AND o.report_age_ms > 30000 THEN '通訊中斷，資料過期'
    WHEN o.is_overdue AND o.next_due_waiting THEN '逾時，後續班次等待前班完成'
    WHEN o.is_overdue THEN '逾時，仍在執行'
    ELSE '剩餘到站'
  END AS eta_label,
  o.status AS order_status,
  CASE
    WHEN o.status = 'FAULTED' THEN '故障'
    WHEN o.status = 'PENDING' THEN '待發'
    WHEN o.status = 'PROCESSING' AND o.report_age_ms > 30000 THEN '資料過期'
    WHEN COALESCE(o.delay_minutes, 0) > 0 OR o.is_overdue THEN '延誤'
    WHEN o.status = 'PROCESSING' THEN '準時'
    ELSE '待命'
  END AS status_label,
  CASE
    WHEN o.status = 'FAULTED' THEN '#450a0a'
    WHEN o.status = 'PENDING' THEN '#27272a'
    WHEN o.status = 'PROCESSING' AND o.report_age_ms > 30000 THEN '#27272a'
    WHEN COALESCE(o.delay_minutes, 0) > 0 OR o.is_overdue THEN '#422006'
    WHEN o.status = 'PROCESSING' THEN 'rgba(0, 212, 146, 0.3)'
    ELSE '#27272a'
  END AS status_bg,
  CASE
    WHEN o.status = 'FAULTED' THEN '#f87171'
    WHEN o.status = 'PENDING' THEN '#a1a1aa'
    WHEN o.status = 'PROCESSING' AND o.report_age_ms > 30000 THEN '#a1a1aa'
    WHEN COALESCE(o.delay_minutes, 0) > 0 OR o.is_overdue THEN '#fb923c'
    WHEN o.status = 'PROCESSING' THEN '#00BC7D'
    ELSE '#a1a1aa'
  END AS status_color,
  CASE
    WHEN o.status = 'FAULTED' THEN 'rgba(239,68,68,0.75)'
    WHEN o.status = 'PROCESSING' AND o.report_age_ms > 30000 THEN 'rgba(113,113,122,0.55)'
    WHEN COALESCE(o.delay_minutes, 0) > 0 OR o.is_overdue THEN 'rgba(249,115,22,0.75)'
    WHEN o.status = 'PROCESSING' THEN '#009966'
    WHEN o.status = 'PENDING' THEN 'rgba(113,113,122,0.45)'
    ELSE 'rgba(113,113,122,0.35)'
  END AS card_border_color,
  /*
   * 起／中／訖三站直接取 payload 的站序。
   *
   * 這三欄原本是照方向寫死的字串，方向一 null 就整排一樣。真正的站序在
   * payload->'stations' 裡，每一班都不同，照它取才是這一班真的會停的站。
   */
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int ASC LIMIT 1),
    NULLIF(o.payload->'origin'->>'name', ''),
    NULLIF(o.route_origin, ''),
    '—'
  ) AS st_a,
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int ASC OFFSET 1 LIMIT 1),
    NULLIF(o.route_mid, ''),
    NULLIF(o.payload->'destination'->>'name', ''),
    '—'
  ) AS st_b,
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int DESC LIMIT 1),
    NULLIF(o.payload->'destination'->>'name', ''),
    NULLIF(o.route_destination, ''),
    '—'
  ) AS st_c,
  COALESCE(
    NULLIF(rj.route_stations, '[]'),
    -- 即時調度引擎下的訂單沒有 route_id（那張表只有兩筆舊的 D/U 路線），
    -- 站序改放在 payload。這一支才是新班表的真站序，優先於下面的固定備援。
    (
      SELECT json_agg(
        json_build_object(
          'name', COALESCE(NULLIF(st->>'station_name', ''), st->>'station_id'),
          'station_id', st->>'station_id',
          -- 這一站是停靠還是只是經過。班表裡「上行轉N2W正線起點」這種轉線點也算一站，
          -- 但車不停，停留秒數是 0。卡片要不要畫它由元件決定，這裡只把事實帶上去。
          'role', st->>'role',
          'dwell_seconds', COALESCE(FLOOR((st->>'dwell_seconds')::numeric)::int, 0),
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
    '[]'
  ) AS route_stations,
  COALESCE(o.payload->'leg_eta_max', '{}'::jsonb)::text AS leg_eta_max,
  0 AS trip_leg_hint,
  /*
   * 車子現在跑在第幾段（0 = 第一站到第二站）。
   *
   * 原本是拿 current_leg 的目標站去跟 route_mid 比，對到就 0、對不到就 1——route_mid
   * 來自 route_id，而這裡每一筆 route_id 都是 null，所以永遠是 1。班次的站數又不是固定
   * 三站（實測 2 到 5 站都有），只有 0/1 兩種值也不夠用。
   *
   * 改成去 payload 的站序裡找目標站排第幾，減一就是段號。
   */
  CASE
    WHEN o.status = 'PENDING' THEN 0
    ELSE COALESCE(
      (
        SELECT GREATEST((st->>'order')::int - 2, 0)
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(o.payload->'stations') = 'array' THEN o.payload->'stations' ELSE '[]'::jsonb END
        ) st
        WHERE st->>'station_id' = o.payload->'current_leg'->>'target_station_id'
        LIMIT 1
      ),
      (o.payload->>'segment_index')::int,
      0
    )
  END AS segment_index,
  -- 這一段還剩幾 %。引擎算出來的值會超過 100（實測 121，因為 eta 比這段的基準還長），
  -- 夾回 0–100 再送出去，免得進度條倒著長。
  LEAST(100, GREATEST(0, CASE
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
  END)) AS segment_remain_pct,
  /*
   * 下一站。
   *
   * 原本整段都靠 route_id 去 operation_route_stations 撈站名，route_id 是 null 就
   * 整排顯示同一個固定字串（實測每張卡都寫「N2W下行」）。真正的下一站在
   * payload->'current_leg'->>'target_station_id'，站名在 payload->'stations' 裡。
   * 還沒發車的就顯示起站，其餘退回終點站名。
   */
  COALESCE(
    (
      SELECT COALESCE(NULLIF(TRIM(rs.station_display_name), ''), rs.station_id)
      FROM operation_route_stations rs
      WHERE rs.route_id = o.route_id
        AND rs.station_id = NULLIF(TRIM(o.next_station), '')
      LIMIT 1
    ),
    (
      /*
       * 「下一站」要說的是下一個會停的站。
       *
       * 車端回報的目標站可能是轉線點（「上行轉N2W正線起點」，停留 0 秒），那是路徑上的
       * 一個點，不是一站。從目標站往後找第一個真的會停的站——起站、終點站，或停留
       * 秒數大於 0 的中間站。
       */
      SELECT st->>'station_name'
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.payload->'stations') = 'array' THEN o.payload->'stations' ELSE '[]'::jsonb END
      ) st
      WHERE (st->>'order')::int >= COALESCE(
        (
          SELECT (target->>'order')::int
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(o.payload->'stations') = 'array' THEN o.payload->'stations' ELSE '[]'::jsonb END
          ) target
          WHERE target->>'station_id' = COALESCE(
            NULLIF(TRIM(o.next_station), ''),
            o.payload->'current_leg'->>'target_station_id'
          )
          LIMIT 1
        ),
        1
      )
      AND (
        st->>'role' IN ('origin', 'terminal')
        OR COALESCE((st->>'dwell_seconds')::numeric, 0) > 0
      )
      ORDER BY (st->>'order')::int
      LIMIT 1
    ),
    CASE WHEN o.status = 'PENDING' THEN o.payload->'origin'->>'name' END,
    o.payload->'destination'->>'name',
    '—'
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
  -- 到站時間。原本是「開車時間 + 6 分」的假值，但每一筆都有 planned_end，照它寫。
  to_char(
    timezone(
      'Asia/Taipei',
      to_timestamp(COALESCE(o.planned_end, (o.payload->'destination'->>'arrive_at')::bigint, o.created_at + 360000) / 1000.0)
    ),
    'HH24:MI'
  ) AS end_time,
  COALESCE(FLOOR((o.payload->>'route_progress')::numeric)::int, CASE WHEN o.status = 'PENDING' THEN 0 ELSE 18 END) AS route_progress,
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
WHERE o.vehicle_rank = 1
ORDER BY
  CASE o.status WHEN 'FAULTED' THEN 0 WHEN 'PROCESSING' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
  o.planned_start,
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
  WHERE o.line_kind IN ('MAINLINE', 'TEST')
    AND NULLIF(TRIM(o.trip_code), '') IS NOT NULL
    -- 跟班次卡同一套「還在跑」的定義。少了這一條會把歷來每一天沒收乾淨的
    -- PROCESSING 全部算進去，標題列會寫成「正線營運 208 / 415」。
    AND COALESCE(o.planned_end, o.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
    AND (
      o.status <> 'PENDING'
      OR o.planned_start BETWEEN
        (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
        AND (EXTRACT(EPOCH FROM now()) * 1000)::bigint + 90000
    )
) s
`.trim();

/** 整備班表：一卡一任務，軌道 S2W→格位；示範模式車已在格上 */
export const MAINTENANCE_SHIFTS_SQL = `
WITH deployed AS (
  SELECT body
  FROM operation_shifts
  WHERE usage_status = 'in_use'
  ORDER BY updated_at DESC
  LIMIT 1
), clock AS (
  SELECT EXTRACT(HOUR FROM timezone('Asia/Taipei', now())) * 60
    + EXTRACT(MINUTE FROM timezone('Asia/Taipei', now()))
    + EXTRACT(SECOND FROM timezone('Asia/Taipei', now())) / 60 AS minute_now
), current_blocks AS (
  SELECT
    timeline->>'row' AS row_no,
    block,
    d.body,
    clock.minute_now
  FROM deployed d
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.body->'scheduleOutput'->'plan'->'timelines', '[]'::jsonb)) timeline
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(timeline->'blocks', '[]'::jsonb)) block
  CROSS JOIN clock
  WHERE block->>'taskType' <> 'passenger'
    AND (block->>'plannedStartMinute')::numeric <= clock.minute_now
    AND (block->>'plannedEndMinute')::numeric > clock.minute_now
)
SELECT
  block->>'id' AS shift_key,
  'PMS' || LPAD(row_no, 2, '0') AS vehicle_code,
  '—' AS trip_code,
  'PMS' || LPAD(row_no, 2, '0') AS trip_header,
  CASE
    WHEN block->>'source' = 'hold' THEN '暫停'
    ELSE COALESCE(
      NULLIF(body->'maintenanceSectionCardLabelBySection'->>CASE block->>'taskType'
        WHEN 'washing' THEN 'carWash'
        WHEN 'servicing' THEN 'maintenance'
        WHEN 'inspection' THEN 'preTrip'
        WHEN 'standby' THEN 'mobile'
        ELSE block->>'taskType'
      END, ''),
      NULLIF(block->>'cardLabel', ''),
      CASE block->>'taskType'
        WHEN 'charging' THEN '充電'
        WHEN 'washing' THEN '洗車'
        WHEN 'servicing' THEN '保養'
        WHEN 'inspection' THEN '行檢'
        WHEN 'standby' THEN '待命'
        WHEN 'idle' THEN '暫停'
        WHEN 'dispatch' THEN '調度'
        ELSE NULLIF(block->>'label', '')
      END,
      '整備'
    )
  END AS maint_type_label,
  '#422006' AS maint_type_bg,
  '#FD9A00' AS maint_type_color,
  '進行中' AS status_label,
  'rgba(0, 212, 146, 0.3)' AS status_bg,
  '#00BC7D' AS status_color,
  '#009966' AS card_border_color,
  COALESCE(NULLIF(m.segment_label, ''), '—') AS st_a,
  COALESCE(NULLIF(block->>'yardFacilityLabel', ''), NULLIF(m.segment_label, ''), '—') AS st_b,
  COALESCE(NULLIF(block->>'yardFacilityLabel', ''), NULLIF(m.segment_label, ''), '—') AS st_c,
  json_build_array(
    json_build_object('name', COALESCE(NULLIF(m.segment_label, ''), '—'), 'remain_pct', 0),
    json_build_object('name', COALESCE(NULLIF(block->>'yardFacilityLabel', ''), NULLIF(m.segment_label, ''), '—'), 'remain_pct', 100)
  )::text AS route_stations,
  0 AS segment_index,
  0 AS segment_remain_pct,
  COALESCE(NULLIF(block->>'yardFacilityLabel', ''), NULLIF(m.segment_label, ''), '—') AS next_station,
  '整備站點' AS station_label,
  '完成預估' AS eta_label,
  LPAD(FLOOR(GREATEST(0, (block->>'plannedEndMinute')::numeric - minute_now) / 60)::text, 2, '0')
    || ':' || LPAD(FLOOR(MOD(GREATEST(0, (block->>'plannedEndMinute')::numeric - minute_now), 60))::text, 2, '0') AS eta_remain,
  LPAD(FLOOR((block->>'plannedStartMinute')::numeric / 60)::text, 2, '0') || ':'
    || LPAD(FLOOR(MOD((block->>'plannedStartMinute')::numeric, 60))::text, 2, '0') AS depart_time,
  LPAD(FLOOR((block->>'plannedEndMinute')::numeric / 60)::text, 2, '0') || ':'
    || LPAD(FLOOR(MOD((block->>'plannedEndMinute')::numeric, 60))::text, 2, '0') AS end_time,
  LEAST(100, GREATEST(0, ROUND(100 * (minute_now - (block->>'plannedStartMinute')::numeric)
    / NULLIF((block->>'plannedEndMinute')::numeric - (block->>'plannedStartMinute')::numeric, 0))))::int AS route_progress,
  false AS is_alert,
  CASE
    WHEN block->>'taskType' = 'washing' THEN 'wash'
    WHEN block->>'taskType' = 'idle' THEN 'parking'
    ELSE block->>'taskType'
  END AS operation_action,
  '#51A2FF' AS icon_bg_color,
  'maintenance' AS line_kind
FROM current_blocks
LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = 'PMS' || LPAD(row_no, 2, '0')
ORDER BY row_no::int
LIMIT 12
`.trim();
