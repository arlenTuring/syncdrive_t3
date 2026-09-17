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
/**
 * 車輛狀態卡一車一列。
 *
 * 速度、電量、四項健康度平常走 MQTT（telemetry/update、health/heartbeat），這支 SQL
 * 是車子沒在線時的底稿，也負責算 MQTT 不報的東西：現在執行哪一張單、人在哪裡。
 */
export const VEHICLE_STATUS_ROW_SQL = `
SELECT
  v.vehicle_code,
  COALESCE(v.display_name, v.vehicle_code) AS vehicle_display,
  live_order.priority_level,
  live_order.line_kind,
  live_order.status AS order_status,
  live_order.trip_code,
  live_order.maint_type_label,
  live_order.maint_type_bg,
  live_order.maint_type_color,
  CASE
    WHEN live_order.line_kind = 'MAINLINE'
      AND NULLIF(TRIM(live_order.trip_code), '') IS NOT NULL
      THEN live_order.trip_code
    WHEN live_order.line_kind = 'MAINTENANCE'
      THEN COALESCE(
        NULLIF(TRIM(live_order.maint_type_label), ''),
        CASE
          WHEN live_order.yard_slot_id LIKE 'E%' THEN '充電'
          WHEN live_order.yard_slot_id LIKE 'P%' THEN '臨停'
          WHEN live_order.yard_slot_id LIKE 'W%' THEN '洗車'
          WHEN live_order.yard_slot_id LIKE 'H%' THEN '調度'
          WHEN live_order.yard_slot_id LIKE 'M%' THEN '保養'
          ELSE '整備'
        END
      )
    ELSE NULL
  END AS badge_label,
  CASE
    WHEN live_order.line_kind = 'MAINLINE'
      AND NULLIF(TRIM(live_order.trip_code), '') IS NOT NULL THEN 'mainline'
    WHEN live_order.line_kind = 'MAINTENANCE' THEN 'maintenance'
    ELSE NULL
  END AS badge_kind,
  CASE
    WHEN live_order.line_kind = 'MAINTENANCE' THEN COALESCE(live_order.maint_type_bg, '#422006')
    ELSE COALESCE(m.trip_badge_bg, '#7e57c2')
  END AS trip_badge_bg,
  CASE
    WHEN live_order.line_kind = 'MAINTENANCE' THEN COALESCE(live_order.maint_type_color, '#fdba74')
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
  /*
   * 位置。
   *
   * 這一欄原本有一段 ('D' || (32 + 車號 % 18))，車號 4 就寫 D20、車號 6 就寫 U08——
   * 那是拿車號算出來的假格位，跟車子真正在哪裡沒有關係，畫面上看到的 D20／D28／U08
   * 就是它。整備車的格位是真的（派單時就指定了），正線車的位置則只能說到「正往哪一站」。
   *
   * 欄位寬度只有 79px，站名放不下（「上行轉N2W正線起點」有九個字），所以壓成站牌代號
   * 加方向：t3_d 寫成 T3下、n2w_u2d_back_start 寫成 N2W。
   */
  COALESCE(
    CASE
      WHEN live_order.line_kind = 'MAINTENANCE' THEN NULLIF(TRIM(live_order.yard_slot_id), '')
      WHEN live_order.line_kind = 'MAINLINE' THEN (
        SELECT UPPER(SPLIT_PART(sid.id, '_', 1))
          || CASE SPLIT_PART(sid.id, '_', 2) WHEN 'u' THEN '上' WHEN 'd' THEN '下' ELSE '' END
        FROM (
          SELECT COALESCE(
            NULLIF(TRIM(live_order.next_station), ''),
            live_order.payload->'current_leg'->>'target_station_id',
            live_order.payload->'origin'->>'id'
          ) AS id
        ) sid
        WHERE NULLIF(sid.id, '') IS NOT NULL
      )
      ELSE NULL
    END,
    NULLIF(TRIM(maint_order.yard_slot_id), ''),
    '待命'
  ) AS segment_label,
  CASE
    WHEN live_order.line_kind = 'MAINTENANCE' THEN NULLIF(TRIM(live_order.yard_slot_id), '')
    ELSE NULLIF(TRIM(maint_order.yard_slot_id), '')
  END AS yard_slot_id,
  /*
   * 速度。MQTT telemetry/update 有報就用那個，這裡只是沒車在線時的底稿。
   *
   * 原本寫成 18 + 車號 % 8 + 車號 * 0.3，停在保養格的車也會顯示 16.8 km/h。沒有回報
   * 就是不知道它在動，填 0 比編一個數字誠實。
   */
  0::numeric AS demo_speed,
  COALESCE(m.demo_load, 0)::numeric AS demo_load
FROM vehicles v
LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = v.vehicle_code
LEFT JOIN LATERAL (
  /*
   * 車子現在真正在執行的那一張單。
   *
   * 排班引擎跑完不一定會把狀態收成 END，今天光是 MAINLINE 就有兩百多張掛在
   * PROCESSING、planned_end 早就過了的殭屍單。原本這裡只看狀態不看時間，撈到的
   * 常常是清晨那一班——卡片上顯示 NT0837，車其實在跑 NT1325。
   *
   * 排序先看「現在是否落在這張單的時間窗內」，同分再比狀態與開始時間。
   */
  SELECT o3.priority_level, o3.line_kind, o3.status, o3.trip_code,
         o3.maint_type_label, o3.maint_type_bg, o3.maint_type_color,
         o3.next_station, o3.payload,
         UPPER(NULLIF(TRIM(o3.payload->>'yard_slot_id'), '')) AS yard_slot_id
  FROM operation_orders o3
  WHERE o3.vehicle_code = v.vehicle_code
    AND o3.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    AND COALESCE(o3.planned_end, o3.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
  ORDER BY
    (
      o3.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
      AND COALESCE(o3.planned_end, o3.planned_start + 600000)
          >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
    ) DESC,
    CASE o3.status WHEN 'FAULTED' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
    o3.priority_level DESC,
    o3.planned_start DESC,
    o3.created_at DESC
  LIMIT 1
) live_order ON true
LEFT JOIN LATERAL (
  -- 正線車沒單的時候拿來當位置的備援，同樣只認還沒過期的整備單：不擋時間的話，
  -- 早上進過保養格的車一整天都會顯示在那一格。
  SELECT UPPER(NULLIF(TRIM(o4.payload->>'yard_slot_id'), '')) AS yard_slot_id
  FROM operation_orders o4
  WHERE o4.vehicle_code = v.vehicle_code
    AND o4.line_kind = 'MAINTENANCE'
    AND o4.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    AND NULLIF(TRIM(o4.payload->>'yard_slot_id'), '') IS NOT NULL
    AND COALESCE(o4.planned_end, o4.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
  ORDER BY o4.created_at DESC
  LIMIT 1
) maint_order ON true
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
    /*
     * 方向。
     *
     * 即時調度引擎產的訂單沒有 route_id（operation_routes 只有兩筆舊的 D/U 路線），
     * 於是 direction_letter 一律是 null，下面的 CASE 全部落到同一邊——實測整排卡片
     * 都顯示「上行」，下一站都是「N2W下行」。
     *
     * 站名本身就帶方向（「S2W上行出發」「N2W下行出發」），那是最可靠的來源。
     */
    COALESCE(
      r.direction_letter,
      CASE
        WHEN o.payload->'origin'->>'name' LIKE '%下行%' THEN 'D'
        WHEN o.payload->'origin'->>'name' LIKE '%上行%' THEN 'U'
        ELSE NULL
      END
    ) AS trip_direction,
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
     * 一台車只列一張單。
     *
     * 上一班的時間窗還在寬限期內、下一班已經開始的那幾十秒，同一台車會有兩張單都算
     * 「還在跑」，卡片就出現兩張同車不同班次的。正在跑的那張優先，其次才是接下來要發的。
     */
    ROW_NUMBER() OVER (
      PARTITION BY o.vehicle_code
      ORDER BY
        (
          o.planned_start <= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
          AND COALESCE(o.planned_end, o.planned_start + 600000)
              >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint
        ) DESC,
        CASE o.status WHEN 'FAULTED' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
        o.planned_start
    ) AS vehicle_rank
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
     */
    AND COALESCE(o.planned_end, o.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
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
  /*
   * 起／中／訖三站直接取 payload 的站序。
   *
   * 這三欄原本是照方向寫死的字串，方向一 null 就整排一樣。真正的站序在
   * payload->'stations' 裡，每一班都不同，照它取才是這一班真的會停的站。
   */
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int ASC LIMIT 1),
    CASE WHEN o.trip_direction = 'U' THEN 'S2W上行' ELSE 'N2W下行' END
  ) AS st_a,
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int ASC OFFSET 1 LIMIT 1),
    CASE WHEN o.trip_direction = 'U' THEN 'T3上行' ELSE 'T3下行' END
  ) AS st_b,
  COALESCE(
    (SELECT st->>'station_name' FROM jsonb_array_elements(o.payload->'stations') st
      ORDER BY (st->>'order')::int DESC LIMIT 1),
    CASE WHEN o.trip_direction = 'U' THEN 'N2W上行' ELSE 'S2W下行' END
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
          'dwell_seconds', COALESCE((st->>'dwell_seconds')::int, 0),
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
        OR COALESCE((st->>'dwell_seconds')::int, 0) > 0
      )
      ORDER BY (st->>'order')::int
      LIMIT 1
    ),
    CASE WHEN o.status = 'PENDING' THEN o.payload->'origin'->>'name' END,
    o.payload->'destination'->>'name',
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
  -- 到站時間。原本是「開車時間 + 6 分」的假值，但每一筆都有 planned_end，照它寫。
  to_char(
    timezone(
      'Asia/Taipei',
      to_timestamp(COALESCE(o.planned_end, (o.payload->'destination'->>'arrive_at')::bigint, o.created_at + 360000) / 1000.0)
    ),
    'HH24:MI'
  ) AS end_time,
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
  WHERE o.line_kind = 'MAINLINE'
    AND NULLIF(TRIM(o.trip_code), '') IS NOT NULL
    -- 跟班次卡同一套「還在跑」的定義。少了這一條會把歷來每一天沒收乾淨的
    -- PROCESSING 全部算進去，標題列會寫成「正線營運 208 / 415」。
    AND COALESCE(o.planned_end, o.planned_start + 600000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
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
  WHERE o.line_kind = 'MAINTENANCE'
    AND o.status IN ('PENDING', 'PROCESSING', 'FAULTED')
    /*
     * 原本這裡綁 order_id LIKE 'DEMO-ORD-%'，只認早期那批手寫的示範單。現在整備單由
     * 排班引擎發（MT-M1-R3-48600 這種），一筆都對不上，整個整備班表是空的。
     *
     * 改成跟正線一樣：只認還沒過期的單。
     */
    AND COALESCE(o.planned_end, o.planned_start + 1800000)
        >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
    AND COALESCE(NULLIF(TRIM(o.payload->>'yard_slot_id'), ''), NULLIF(TRIM(o.next_station), '')) IS NOT NULL
    -- 同一台車如果正線也有單在跑，以正線為準，這裡不重複列。一樣只看還沒跑完的，
    -- 不然清晨那些沒收乾淨的正線單會把每一台車都擋掉。
    AND NOT EXISTS (
      SELECT 1 FROM operation_orders ml
      WHERE ml.vehicle_code = o.vehicle_code
        AND ml.line_kind = 'MAINLINE'
        AND ml.status IN ('PENDING', 'PROCESSING')
        AND COALESCE(ml.planned_end, ml.planned_start + 600000)
            >= (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 60000
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
  /*
   * 距離整備完成還剩多久，以 planned_end 直接算，格式是「時:分」。
   *
   * 原本讀 operation_orders.eta_remain 那一欄，裡面是「926:09」這種值（926 分鐘，
   * 停到隔天午夜），當成時分看就變成 926 小時。
   */
  LPAD((GREATEST(0, COALESCE(o.planned_end, o.created_at + 1800000)
        - (EXTRACT(EPOCH FROM now()) * 1000)::bigint) / 3600000)::int::text, 2, '0')
  || ':'
  || LPAD(((GREATEST(0, COALESCE(o.planned_end, o.created_at + 1800000)
        - (EXTRACT(EPOCH FROM now()) * 1000)::bigint) / 60000)::int % 60)::text, 2, '0') AS eta_remain,
  -- 時間一律換算到台北，不然跟著資料庫時區跑，畫面上會差好幾個小時。
  to_char(timezone('Asia/Taipei', to_timestamp(COALESCE(o.planned_start, o.created_at) / 1000.0)), 'HH24:MI') AS depart_time,
  to_char(timezone('Asia/Taipei', to_timestamp(COALESCE(o.planned_end, o.created_at + 1800000) / 1000.0)), 'HH24:MI') AS end_time,
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
