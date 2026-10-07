// ─── 資料綁定介面 ──────────────────────────────────────────────

/**
 * 使用者面向的「資料新鮮度」策略（取代讓使用者背 refreshMode / invalidate tag）。
 * 平台依此 + 資料來源型別，自動決定底層機制（stream / event / poll / once）。
 * - auto：自動（建議）。平台依資料來源推斷：MQTT→即時、可推斷失效標籤的 SQL→有變更就更新、其餘→僅載入一次。
 * - live：即時串流（MQTT）。
 * - on_change：有變更就更新（寫庫後由後端推送，重查一次）。
 * - interval：定時輪詢（需指定秒數；僅建議用於無法推送的來源）。
 * - once：僅載入一次。
 */
export type FreshnessPolicy = 'auto' | 'live' | 'on_change' | 'interval' | 'once';

export interface WidgetDataBinding {
  // 模式 A: 直接輸入 REST URL
  dataUrl?: string;

  // 模式 B: SQL 查詢（需選擇 internal 資料來源）
  dataSourceId?: string;
  sqlQuery?: string;

  // 模式 C: MQTT 訂閱（需選擇 mqtt 資料來源）
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string; // JSON 路徑，如 'payload.speed'

  // ── 使用者面向（建議只暴露這個）──────────────────
  /** 資料新鮮度策略（預設 auto，由平台決定底層機制）。 */
  freshnessPolicy?: FreshnessPolicy;

  // ── 通用設定 ──────────────────────────────────────
  refreshInterval?: number; // 秒，僅 freshnessPolicy='interval' / 舊 poll 模式使用
  /**
   * 底層更新機制（平台內部；一般使用者不應手動設定，由 freshnessPolicy 推導）：
   * - stream：不走 SQL（綁 MQTT）
   * - once：載入時查一次
   * - event：寫庫後由後端推送失效標籤，觸發重查
   * - poll：定時輪詢（legacy）
   */
  refreshMode?: 'stream' | 'once' | 'event' | 'poll';
  /** 訂閱失效標籤；省略時由 inferInvalidateTagsFromSql(sqlQuery) 推斷 */
  invalidateTags?: string[];
}

// ─── Widget (子元件) 型別 ──────────────────────────────────────────

export interface WidgetBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 元件旋轉角度（度）；0 或未設時行為與原本相同 */
  rotationDeg?: number;
  /** 編輯模式無即時資料時的預覽文字，方便辨識元件位置 */
  editPlaceholder?: string;
}

export interface ColorRule {
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains' | 'status_eq';
  threshold: string;
  textColor: string;
  bgColor: string;
  borderColor?: string;
}

export interface TextWidget extends WidgetBase, WidgetDataBinding {
  type: 'text';
  content: string;
  /** 滑鼠移上去的提示（可帶 {變數}）；例如過渡卡標題顯示短名稱，提示完整的任務代號與訂單 ID */
  tooltip?: string;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  color: string; // 這是文字顏色
  textAlign: 'left' | 'center' | 'right';
  /** 文字在元件框內的縱向對齊；預設置中 */
  verticalAlign?: 'top' | 'center' | 'bottom';
  
  // 外框與背景
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  backgroundColor: string; // 內部填滿顏色
  
  // 圖示
  icon?: string; // Lucide icon name
  iconImage?: string; // Custom image URL for icon
  /** 圖示與文字間距（px）；未設時單行 4、多行 8 */
  iconGap?: number;
  
  // 條件著色
  valueField?: string;
  colorRulesEnabled: boolean;
  colorRules?: ColorRule[];
  /** 依群組變數 severity 套用文字色 */
  severityTextColor?: boolean;
  /** 單行不換行（狀態 pill 等窄元件，避免中文直排） */
  textWrap?: 'wrap' | 'nowrap';
  /** 自訂內距，如 "2px 4px"（未設則依類型使用預設） */
  contentPadding?: string;
  /** 僅供條件著色，不取代 content 顯示文字（如子系統 pill） */
  colorOnlyField?: string;
}

export interface ImageWidget extends WidgetBase {
  type: 'image';
  src: string;
  objectFit: 'cover' | 'contain' | 'fill' | 'none';
  borderRadius: number;

  /** 元件整體透明度 0~100（100 = 完全不透明） */
  opacity?: number;

  /** 外框 */
  borderWidth?: number;
  borderColor?: string;

  /** 圖片後方背景色（圖片 contain/none 模式時可見） */
  backgroundColor?: string;

  /** 疊加在圖片上的文字標籤 */
  overlayText?: string;
  /** 疊加文字顏色 */
  overlayTextColor?: string;
  /** 疊加文字字級（px） */
  overlayFontSize?: number;
  /** 疊加文字位置 */
  overlayPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center';
  /** 疊加文字背景色（半透明遮罩） */
  overlayBgColor?: string;
  /** 疊加文字字重 */
  overlayFontWeight?: 'normal' | 'bold';
}

export interface LineChartStatusSegment {
  /** 此段結束時間（含），與 X 軸 time 欄位比對 */
  untilTime: string;
  color: string;
}

/** 區段識別值 → 色帶顏色（由元件設定，不存於資料庫） */
export interface ChartAxisBandColorRule {
  /** 與 segmentField 欄位值比對（字串） */
  value: string;
  color: string;
}

/** 以資料欄位驅動的軸向區段著色（班次/班表：DB 只存區段識別與時間界線） */
export interface ChartAxisBandConfig {
  /** 套用軸向：X（時間帶）或 Y（值域帶） */
  axis: 'x' | 'y';
  /** 起點欄位；未填時 X 用 xField、Y 用第一個 yField */
  startField?: string;
  /** 終點欄位；未填時用下一筆同軸值（最後一筆延伸到視窗邊界） */
  endField?: string;
  /** 區段識別欄位（來自 SQL，如 segment_code） */
  segmentField: string;
  /** 依區段值對應顏色 */
  colorRules: ChartAxisBandColorRule[];
  /** 無匹配規則時的預設色 */
  defaultColor?: string;
  /** 區段條厚度（px） */
  thickness?: number;
  /** 區段條透明度 0~1 */
  opacity?: number;
}

/** 軸資料單位：數字或時間（當日分鐘 / HH:mm） */
export type ChartAxisUnit = 'number' | 'time';
export type ChartTimeStyle = 'hm';
export type ChartTimeClock = '12h' | '24h';

/** 時間軸：以目前時間為中心滑動視窗（過去:未來 比例） */
export interface ChartAxisTimeWindowConfig {
  enabled?: boolean;
  pastRatio?: number;
  futureRatio?: number;
  /** 視窗總長（分鐘） */
  totalMinutes?: number;
  /** 刻度對齊整點 */
  snapToHour?: boolean;
}

export interface ChartAxisConfig {
  unit: ChartAxisUnit;
  /** 軸下限（數字或 "07:00"） */
  min?: number | string;
  /** 軸上限 */
  max?: number | string;
  /** 時間軸：顯示樣式 */
  timeStyle?: ChartTimeStyle;
  /** 時間軸：12 / 24 小時制 */
  timeClock?: ChartTimeClock;
  /** 軸標籤（可選） */
  label?: string;
  /** 時間軸專用：與目前時間同步的滑動視窗 */
  timeWindow?: ChartAxisTimeWindowConfig;
  /** 關閉 timeWindow 時可指定高亮時刻（HH:mm） */
  highlightTime?: string;
  /** 自動高亮「當前運能＋預期走勢」交會點（offset 0 示範列） */
  highlightPivot?: boolean;
}

/** 折線上的事件標籤樣式 */
export interface LineChartEventLabelStyle {
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fill?: string;
  /** 外框描邊色 */
  stroke?: string;
  strokeWidth?: number;
  /** 標籤底色 */
  backgroundFill?: string;
}

/** 單條折線系列設定 */
export interface LineChartSeriesConfig {
  id: string;
  yField: string;
  /** 圖例顯示名（未填則用 yField） */
  label?: string;
  color?: string;
  strokeWidth?: number;
  /** 啟用特殊事件標籤（預設關閉） */
  eventLabelsEnabled?: boolean;
  /** 事件標籤文字欄位（有值時顯示） */
  eventLabelField?: string;
  /** 可選：僅當此旗標欄位為真時顯示事件標籤 */
  eventFlagField?: string;
  eventLabelStyle?: LineChartEventLabelStyle;
  /** 折線下方漸層區域填充 */
  areaFill?: boolean;
}

/**
 * fixed-axis：軸範圍固定，資料依實際值落在圖上（定軸）
 * data-centered：視窗跟隨資料，軸刻度在允許區間內平移（以資料為中心）
 */
export type ChartViewportMode = 'fixed-axis' | 'data-centered';

export interface LineChartWidget extends WidgetBase, WidgetDataBinding {
  type: 'line-chart';
  title: string;
  xField: string;
  /** 多線系列（屬性面板「新增」）；與 yFields 同步寫入以利舊版相容 */
  series?: LineChartSeriesConfig[];
  yFields: string[];
  xTickInterval: number;
  strokeColors: string[];
  xAxis?: ChartAxisConfig;
  yAxis?: ChartAxisConfig;
  viewportMode?: ChartViewportMode;
  /** data-centered 時視窗相對資料的留白比例 0–0.45 */
  viewportPadding?: number;
  /** @deprecated 請改用 xAxis.timeWindow；live-time-sync 表示與目前時間同步的滑動視窗 */
  chartVariant?: 'standard' | 'live-time-sync';
  /** @deprecated 請改用 xAxis.highlightTime */
  highlightTime?: string;
  /** @deprecated 請改用 series[].normalColor */
  normalLineColor?: string;
  /** @deprecated 請改用 series[].degradedColor */
  degradedLineColor?: string;
  /** @deprecated 請改用 series[].eventFlagField */
  anomalyFlagField?: string;
  /** @deprecated 請改用 series[].eventLabelField */
  anomalyLabelField?: string;
  /** @deprecated 請改用 series[].segmentField */
  lineSegmentField?: string;
  statusBarSegments?: LineChartStatusSegment[];
  /** 以資料欄位繪製 X/Y 軸區段色帶（通用能力） */
  axisBands?: ChartAxisBandConfig[];
  chartFootnote?: string;
  /** 座標軸刻度字級（px） */
  chartAxisFontSize?: number;
  /** 圖表註腳字級（px） */
  chartFootnoteFontSize?: number;
  /** 即時／事件標註字級（px，系列未指定時的預設） */
  chartCalloutFontSize?: number;
  /** @deprecated 請改用 xAxis.timeWindow */
  syncCurrentTime?: boolean;
  /** @deprecated 請改用 xAxis.timeWindow.totalMinutes */
  timeWindowMinutes?: number;
  /** @deprecated 請改用 xAxis.timeWindow.pastRatio */
  timePastRatio?: number;
  /** @deprecated 請改用 xAxis.timeWindow.futureRatio */
  timeFutureRatio?: number;
  /** 圖表內邊距（內縮繪圖區，元件外框仍由 width/height 決定） */
  chartPadding?: Partial<{ top: number; right: number; bottom: number; left: number }>;
  chartGridColor?: string;
  chartAxisLabelColor?: string;
  chartAxisLineColor?: string;
  hideYAxisLabels?: boolean;
  chartHideLegend?: boolean;
  chartCalloutFill?: string;
  chartCalloutTextColor?: string;
}

export interface DatabaseWidget extends WidgetBase, WidgetDataBinding {
  type: 'database';
  title: string;
  displayMode: 'table' | 'json';
  maxRows: number;
}

export interface GaugeWidget extends WidgetBase, WidgetDataBinding {
  type: 'gauge';
  title: string;
  valueField: string;
  unit: string;
  min: number;
  max: number;
  colorStops: Array<{ at: number; color: string }>; // at: 0~1
  /** semi-arc：半圓漸層弧 + 指針 + 中央數值；ring：全圓達成進度環 */
  gaugeVariant?: 'default' | 'semi-arc' | 'ring';
  /** semi-arc 時：速度弧（綠→紅）或 電量弧（紅→綠） */
  arcVariant?: 'speed' | 'load';
  /** 中央顯示數值字級（px） */
  gaugeValueFontSize?: number;
  /** 單位文字字級（px） */
  gaugeUnitFontSize?: number;
  /** 半圓弧線寬（px）；未設時 semi-arc 依尺寸自動計算、default 為 12 */
  gaugeArcStrokeWidth?: number;
  /** 面板內距：弧線／數值與外框距離（px） */
  gaugeContentPadding?: Partial<{ top: number; right: number; bottom: number; left: number }>;
  /** 中央數值與半圓弧線之間的額外垂直間距（px）；正值＝文字下移、離弧線更遠 */
  gaugeTextGap?: number;
  /** 儀表面板底色（填滿元件框；semi-arc 預設 #1a2332） */
  panelBackgroundColor?: string;
  panelBorderRadius?: number;
}

/** 格位依狀態著色 */
export interface SlotStatusColorRule {
  status: string;
  bgColor: string;
  textColor?: string;
}

export interface SlotGridWidget extends WidgetBase, WidgetDataBinding {
  type: 'slot-grid';
  title: string;
  nameField: string;     // 格內顯示欄位（如 slot_label）
  statusField: string;   // 狀態欄位
  activeValues: string[]; // 舊版二元高亮；有 statusColorRules 時以規則為主
  layout: 'horizontal' | 'grid';
  slotWidth: number;
  slotHeight: number;
  activeColor: string;
  inactiveColor: string;
  /** 依狀態對應底色／文字色；列數由 SQL 回傳筆數決定（自動增長） */
  statusColorRules?: SlotStatusColorRule[];
  defaultSlotTextColor?: string;
  /** compact-row：無標題列、格位等寬填滿 */
  variant?: 'default' | 'compact-row';
  hideTitle?: boolean;
  slotGap?: number;
  /** 格位內文字字級（px） */
  slotFontSize?: number;
  /** 標題列字級（px） */
  titleFontSize?: number;
  emptyHintFontSize?: number;
}

/**
 * 整備分佈：類別與格位都來自後端（部署中班表的整備區塊、整備任務的格位、車輛即時位置），
 * 元件本身不寫死任何類別或格位代號。資料預設取
 * <code>/syncdrive-api/facility/maintenance-distribution</code>。
 */
export interface MaintenanceDistributionWidget extends WidgetBase, WidgetDataBinding {
  type: 'maintenance-distribution';
  title: string;
  titleIconImage?: string;
  /** 各整備區塊的圖示（key：charging／carWash／maintenance／preTrip／mobile） */
  sectionIconImages?: Record<string, string>;
  /** 一列幾張卡（預設 2） */
  columns?: number;
  titleFontSize?: number;
  headerFontSize?: number;
  cardTitleFontSize?: number;
  slotFontSize?: number;
}

export interface RouteStation {
  id: string;
  name: string;
  /** 地圖停靠點 stationId（與 MQTT current_leg.target_station_id 對應） */
  stationId?: string;
  value: number; // 軌道上的錨點位置 0–100（等距站點由系統計算）
  /** 前往此站之進度段上的剩餘距離 %（0=已到站，100=剛離開前站），供推算用 */
  remainPct?: number;
  /**
   * 不畫這一站的點與站名。
   *
   * 站還在序列裡——車子的位置是照完整站序算的，抽掉會讓進度跳位——只是不顯示。
   */
  hidden?: boolean;
}

/** 作動行為對應：變數符合條件時在巴士上顯示圖示（檔案放 public/vehicle-operation-actions/icons/） */
export type RouteActionMatchOp = 'present' | 'eq' | 'gte' | 'gt';

export interface RouteActionIconRule {
  id: string;
  /** 設定面板用說明 */
  label?: string;
  /** 群組變數或 SQL 欄位鍵名 */
  sourceVarKey: string;
  matchOp: RouteActionMatchOp;
  /** eq / gte / gt 的比較值 */
  threshold?: string | number;
  /** 圖示檔名，如 charging.png */
  iconFile: string;
  /** 多條命中時，數字越大越優先 */
  priority?: number;
}

export type RouteStationSource = 'manual' | 'json' | 'legacy-columns';

export interface RouteProgressWidget extends WidgetBase, WidgetDataBinding {
  type: 'route-progress';
  stations: RouteStation[];
  valueField: string;
  activeColor: string;   // 走過路線顏色
  inactiveColor: string; // 未走過路線顏色
  /** 車輛圖示：Lucide 名稱（Bus）或圖檔（vehicle.svg） */
  vehicleIcon: string;
  iconColor: string;
  iconBgColor: string;
  /** 車體底色變數鍵（載具狀態 SQL，如 icon_bg_color） */
  vehicleIconBgVarKey?: string;
  /** 無底色欄位時，依健康狀態欄位 fallback（如 health_status → 藍／橘／紅） */
  vehicleHealthVarKey?: string;
  /** 站點來源：手動 / JSON 陣列 / 舊版三欄位站名 */
  stationSource?: RouteStationSource;
  /** JSON 陣列欄位鍵名，例：[{ "name":"S2W", "remain_pct": 40 }, ...] */
  stationsJsonVarKey?: string;
  /**
   * 要畫哪些站。
   *
   * <code>stops</code>（預設）只畫車會停的站；轉線點那種「經過但不停」的站仍算在
   * 站序裡，只是不畫點也不寫名字——一條路線常常有一半以上是這種點，全部畫出來
   * 站名會疊成一團。<code>all</code> 是全部都畫。
   */
  stationDisplayFilter?: 'all' | 'stops';
  /** 目前所在區段索引（0 = 第 1 站→第 2 站） */
  segmentIndexVarKey?: string;
  /** 該區段剩餘距離 %（100=剛離開前站，0=快到下一站） */
  segmentRemainPctVarKey?: string;
  /** 依 segment 連續前進動畫 */
  animateSegmentMovement?: boolean;
  /** 動作執行對應表（圖示顯示於巴士上方） */
  actionIconRules?: RouteActionIconRule[];
  /** detail-card / service-card：卡片版型（站點、ETA、起訖時間） */
  variant?: 'track' | 'detail-card' | 'service-card';
  /** 軌道站點標籤樣式：mainline 起點灰／整備中點為當前站 */
  trackStyle?: 'mainline' | 'maintenance';
  /** 卡片版型：站點欄標籤 */
  cardStationLabel?: string;
  /** 卡片版型：時間／指標欄標籤 */
  cardMetricLabel?: string;
  /** 卡片版型：出發時間標籤 */
  cardDepartLabel?: string;
  /** 卡片版型：結束時間標籤 */
  cardEndLabel?: string;
  /** 卡片版型：metric 標籤等於這些值時以警示色顯示 */
  cardMetricAlertValues?: string[];
  /** 軌道站點標籤字級（px）；未設時軌道版用 14、卡片版依縮放 */
  fontSize?: number;
  /** 已通過／目前站點的文字色；未設時沿用走過路線顏色 */
  stationLabelActiveColor?: string;
  /** 尚未到達站點的文字色；未設時沿用未走路線顏色 */
  stationLabelInactiveColor?: string;
  /** 站名是否自動換行；舊資料預設啟用 */
  stationLabelWrap?: boolean;
  /** 自動換行最多顯示幾行 */
  stationLabelMaxLines?: number;
  unitLabel?: string;
  statusLabel?: string;
  statusBgColor?: string;
  statusTextColor?: string;
  originLabel?: string;
  destLabel?: string;
  etaText?: string;
  alertBorder?: boolean;
  alertBorderVarKey?: string;
  /** 調度卡外框色（如 card_border_color） */
  cardBorderVarKey?: string;
  /** 自 MQTT 完整 JSON 取進度 0–100 的點號路徑（與 sql 欄位 route_progress 擇優） */
  mqttProgressPath?: string;
  /** 三站名稱改由 Repeater 列資料／變數鍵（如 st_a,st_b,st_c） */
  dynamicStationFields?: [string, string, string];
  /** 調度卡標題等改由變數鍵對應 SQL 欄位 */
  unitLabelVarKey?: string;
  statusLabelVarKey?: string;
  statusBgVarKey?: string;
  statusTextColorVarKey?: string;
  originVarKey?: string;
  destVarKey?: string;
  etaVarKey?: string;
  departTimeVarKey?: string;
  endTimeVarKey?: string;
}

// ─── 新增元件型別 ─────────────────────────────────────────────────

/** 色塊：純背景色矩形，作為底層裝飾，其他元件可覆蓋其上 */
export interface ColorBlockWidget extends WidgetBase, Pick<WidgetDataBinding, 'dataSourceId' | 'sqlQuery' | 'refreshInterval' | 'refreshMode' | 'freshnessPolicy' | 'invalidateTags' | 'mqttDataSourceId' | 'mqttTopic' | 'mqttValuePath'> {
  type: 'color-block';
  backgroundColor: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  opacity: number; // 0~100
  /** 依群組變數 severity 套用嚴重度色帶 */
  severityStripColor?: boolean;
  /** 邊框色由群組變數鍵提供（如 card_border_color） */
  bindBorderColorVar?: string;
  /** 自 MQTT／SQL 健康狀態欄位映射邊框色（優先於 bindBorderColorVar） */
  bindBorderFromHealthField?: boolean;
  /** bindBorderFromHealthField 時讀取的欄位鍵名 */
  healthFieldForBorder?: string;
}

/** 資料警示觸發模式 */
export type AlertTriggerMode = 'non-empty' | 'equals' | 'not-equals';

/** 警示列顯示方式 */
export type AlertDisplayMode = 'blink' | 'static';

/** 單條警示規則（可同時多條顯示） */
export interface AlertRule {
  id: string;
  content: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  /** 預設閃爍 */
  displayMode: AlertDisplayMode;
  /** 開始條件：欄位 */
  startField: string;
  startMode: AlertTriggerMode;
  startValue?: string;
  /** 結束條件：命中則隱藏此列 */
  endEnabled: boolean;
  endField?: string;
  endMode?: AlertTriggerMode;
  endValue?: string;
}

/** @deprecated 請改用 AlertRule */
export interface AlertTriggerCondition {
  field?: string;
  mode?: AlertTriggerMode;
  value?: string;
  content?: string;
  startField?: string;
  startMode?: AlertTriggerMode;
  startValue?: string;
  id?: string;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  displayMode?: AlertDisplayMode;
  endEnabled?: boolean;
  endField?: string;
  endMode?: AlertTriggerMode;
  endValue?: string;
}

/** 資料觸發警示：預覽隱藏，編輯模式可見；支援文字＋圖示／圖片 */
export interface AlertBannerWidget extends WidgetBase, WidgetDataBinding {
  type: 'alert-banner';
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  backgroundColor: string;
  icon?: string;
  iconImage?: string;
  textWrap?: 'wrap' | 'nowrap';
  contentPadding?: string;
  /** 警示規則（可多條同時顯示，每條獨立樣式與起訖條件） */
  triggerConditions?: AlertRule[];
  /** 無規則命中時的後備顯示文字（建議改在 triggerConditions[].content 設定） */
  content?: string;
  /** @deprecated 請改用 triggerConditions */
  triggerField?: string;
  /** @deprecated */
  triggerMode?: AlertTriggerMode;
  /** @deprecated */
  triggerValue?: string;
  /** 嚴重度變數鍵（WARNING / ERROR 配色） */
  severityVarKey?: string;
  /** 編輯模式佔位文字 */
  editPlaceholder?: string;
  /** stack：多條並列；carousel：命中規則輪播（一次一條） */
  alertPresentation?: 'stack' | 'carousel';
  /** 輪播間隔（毫秒） */
  carouselIntervalMs?: number;
}

/** @deprecated 請改用 alert-banner */
export interface VehicleAlertBannerWidget extends WidgetBase {
  type: 'vehicle-alert-banner';
  messageVarKey?: string;
  severityVarKey?: string;
  fontSize?: number;
  zIndex?: number;
}

/** 狀態徽章：根據資料值顯示不同顏色的 pill 形標籤 */
export interface StatusBadgeRule {
  value: string;
  label: string;
  bgColor: string;
  textColor: string;
}

export interface StatusBadgeWidget extends WidgetBase, WidgetDataBinding {
  type: 'status-badge';
  valueField: string;
  defaultLabel: string;
  defaultBgColor: string;
  defaultTextColor: string;
  showDot: boolean;
  fontSize: number;
  borderRadius: number;
  rules: StatusBadgeRule[];
  /** 車輛狀態卡右上角班次標籤：緊湊內距 */
  badgeVariant?: 'default' | 'compact';
  /** 自變數覆寫底色（如 trip_badge_bg） */
  variableBgKey?: string;
  /** 自變數覆寫文字色（如 trip_badge_color） */
  variableColorKey?: string;
  /** 離線等狀態：細框描邊 */
  outlineFromVarKey?: string;
  /** outline：透明底 + 描邊；filled：實心底（預設） */
  badgeStyle?: 'filled' | 'outline';
  /** outline 描邊色（預設 zinc-300） */
  outlineBorderColor?: string;
}

/** 標籤相對於「數值＋單位」的方位 */
export type StatCardLabelPosition = 'top' | 'bottom' | 'left' | 'right';

/** KPI 數值卡：大數字 + 標籤 + 單位的單一指標展示 */
export interface StatCardWidget extends WidgetBase, WidgetDataBinding {
  type: 'stat-card';
  label: string;
  valueField: string;
  unit: string;
  valueFontSize: number;
  labelFontSize: number;
  unitFontSize?: number;
  valueColor: string;
  labelColor: string;
  unitColor: string;
  /** 標籤在數值＋單位的上／下／左／右，預設 top */
  labelPosition?: StatCardLabelPosition;
  /** 整體水平對齊 */
  contentAlign?: 'left' | 'center' | 'right';
  /** 標籤與數值區塊間距（px） */
  layoutGap?: number;
  /** 標籤是否全大寫，預設 true（舊版 KPI 行為） */
  labelUppercase?: boolean;
  labelFontWeight?: 'normal' | 'bold' | '500' | '600' | '700';
  valueFontWeight?: 'normal' | 'bold' | '500' | '600' | '700';
  backgroundColor: string;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  icon?: string;
  iconColor?: string;
  colorRulesEnabled: boolean;
  colorRules?: ColorRule[];
  /** 與目標值比較著色（達標藍 / 偏離紅），需同一 SQL 列含 target 欄位；不顯示第二組數字 */
  compareTargetField?: string;
  /** 誤差容許百分比（±），預設 5 */
  tolerancePct?: number;
  inBandColor?: string;
  outOfBandColor?: string;
  /** 數值下方提示（如 可調度2輛） */
  hintField?: string;
  /** 提示相對數值的位置，預設 below */
  hintPosition?: 'below' | 'value-right';
  /** 整卡垂直對齊，預設 center */
  contentVAlign?: 'center' | 'start';
  hintIconSize?: number;
  hintIcon?: string;
  hintIconImage?: string;
  hintColor?: string;
}

/** 線性進度條：水平或垂直填充條 */
export interface ProgressBarWidget extends WidgetBase, WidgetDataBinding {
  type: 'progress-bar';
  valueField: string;
  min: number;
  max: number;
  orientation: 'horizontal' | 'vertical';
  showValue: boolean;
  showLabel: boolean;
  label: string;
  trackColor: string;
  borderRadius: number;
  colorStops: Array<{ at: number; color: string }>; // at: 0~1
  /** 進度條數值／標籤字級（px） */
  valueFontSize?: number;
  labelFontSize?: number;
}

/** 即時時鐘 */
export interface ClockWidget extends WidgetBase {
  type: 'clock';
  format: '24h' | '12h';
  showDate: boolean;
  showSeconds: boolean;
  dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
  fontSize: number;
  dateFontSize: number;
  color: string;
  dateColor: string;
  fontFamily: string;
}

/** 站點到站／出發清單的資料來源（登入端內部端點，不需要車端金鑰） */
export const STATION_ETA_URL = '/syncdrive-api/operation-metrics/station-eta';
/**
 * 什麼時候重查：訂單開始／結束（含取消、故障）、車換路段（後端每秒最多一次）、營運時鐘換段、
 * 每日計畫切換。加速重播時另外照營運時間補查（useWidgetData）。
 */
export const STATION_ETA_INVALIDATE_TAGS = [
  'table:operation_orders',
  'domain:vehicle_monitor',
  'domain:operating_clock',
  'domain:shift_center',
] as const;

/**
 * 站點到站／出發清單（N2W、S2W、T3…）：後端 /operation-metrics/station-eta，營運時間。
 * 每列：幾分幾秒到站／出發（倒數）、車號、方向／停靠點、即時或計畫。
 */
export interface StationEtaWidget extends WidgetBase, WidgetDataBinding {
  type: 'station-eta';
  /** 標題（站名） */
  title: string;
  /**
   * 要列的停靠點：真實站點 ID、每列顯示的方向／停靠點名稱、列到站還是出發（或兩者）。
   * events 省略時只列到站（舊設定）。
   */
  stations: Array<{ stationId: string; label: string; events?: Array<'arrive' | 'depart'> }>;
  /** 最多幾筆（預設 3） */
  limit: number;
  fontSize: number;
  color: string;
  mutedColor: string;
  backgroundColor: string;
  borderColor: string;
  borderRadius: number;
}

/** 查詢無資料時的佔位（可疊在輪播群組底層，由資料綁定控制顯示） */
export interface EmptyStateWidget extends WidgetBase, WidgetDataBinding {
  type: 'empty-state';
  label: string;
  subLabel?: string;
  borderRadius?: number;
  /** minimal-center：透明底＋置中圖示 */
  emptyStateVariant?: 'default' | 'minimal-center';
  /** when-empty：查詢成功且 0 筆時顯示（預設） */
  visibilityMode?: 'when-empty' | 'when-has-data';
  labelFontSize?: number;
  subLabelFontSize?: number;
  markFontSize?: number;
}

/** 分段比例條色對照（狀態碼 → 顏色／標籤，定義於元件內） */
export interface SegmentBarColorRule {
  status: string;
  label: string;
  color: string;
}

/** 分段比例條：單一橫條依比例分段，SQL 每列一個狀態 */
export interface SegmentBarWidget extends WidgetBase, WidgetDataBinding {
  type: 'segment-bar';
  title?: string;
  /** 標題左側自訂圖示（dashboard-icons） */
  titleIconImage?: string;
  statusField: string;
  pctField: string;
  countField: string;
  countUnit?: string;
  colorRules: SegmentBarColorRule[];
  showLegend?: boolean;
  titleFontSize?: number;
  legendFontSize?: number;
  barTextFontSize?: number;
  tagFontSize?: number;
  emptyHintFontSize?: number;
}

/** 長條圖 */
export interface BarChartWidget extends WidgetBase, WidgetDataBinding {
  type: 'bar-chart';
  title: string;
  xField: string;
  yFields: string[];
  orientation: 'vertical' | 'horizontal';
  strokeColors: string[];
  showValues: boolean;
  barPadding: number; // 0~1
}

/** 地圖畫布 - 嵌入地圖編輯器製作的地圖（唯讀展示） */
export interface MapCanvasWidget extends WidgetBase {
  type: 'map-canvas';
  mapId: string;      // '' = 未選擇; builtin map id  or official saved map id
  zoomFactor: number; // 2.0 = 顯示整個 2km×1km 世界; 數字越小可視範圍越小（放大）
}

export interface TelemetryStatusFlag {
  key: string;
  label: string;
  activeColor: string;
  inactiveColor: string;
  /** MQTT 子系統鍵名（未設則用 key 大寫） */
  mqttSubsystemKey?: string;
}

/** 載具遙測卡：雙半圓儀表 + 底部狀態燈 */
export interface UnitTelemetryCardWidget extends WidgetBase, WidgetDataBinding {
  type: 'unit-telemetry-card';
  unitLabel: string;
  speedField: string;
  loadField: string;
  speedUnit: string;
  loadUnit: string;
  speedMin: number;
  speedMax: number;
  loadMin: number;
  loadMax: number;
  statusFlags: TelemetryStatusFlag[];
  /** 預設亮起的狀態 key */
  activeFlagKey?: string;
  /** Telemetry topic，支援 {vehicle_code} */
  mqttTelemetryTopic?: string;
  /** Health topic，支援 {vehicle_code} */
  mqttHealthTopic?: string;
  mqttHealthDataSourceId?: string;
  /** 自 telemetry JSON 取速度（點號路徑） */
  telemetrySpeedPath?: string;
  /** 自 telemetry JSON 取電量（點號路徑） */
  telemetryBatteryPath?: string;
  /** 底部軌道段顯示（如 D33），MQTT operation 路徑 */
  segmentLabelPath?: string;
  mqttOperationTopic?: string;
  /** instrument-row：儀表列版型（雙儀表、狀態 pill、底部標籤） */
  cardVariant?: 'default' | 'instrument-row';
  /** 健康狀態變數／欄位鍵名 */
  healthStatusField?: string;
  badgeLabelField?: string;
  badgeBgField?: string;
  badgeColorField?: string;
  alertMessageField?: string;
  segmentLabelField?: string;
}

/** 班次清單 Widget：含正線 / 整備兩個 Tab，每列一班次資料 */
export interface TabCanvasTab {
  /** Tab 唯一 ID */
  id: string;
  /** Tab 顯示名稱 */
  label: string;
  /** 此 Tab 的資料來源 */
  dataSourceId?: string;
  /** 此 Tab 的 SQL（首列欄位注入子畫布變數） */
  sqlQuery?: string;
  /** 此 Tab 的刷新策略 */
  freshnessPolicy?: string;
  /** 子元件樹（不用於存儲，僅作描述；實際存儲於 CanvasElementProps.children / childrenTab1... ） */
  children: ChildWidget[];
}

/** Tab 清單單一欄位定義 */
export interface TabListColumn {
  id: string;
  name: string; // 欄位標題名稱 (如 "班次代號"、"路線進度")
  fieldKey?: string; // 綁定的 SQL 資料別名/欄位鍵 (如 "trip_code", "direction_label")
  width: number; // 欄位寬度 px
  align?: 'left' | 'center' | 'right';
  fontSize?: number; // 該欄單元格字體大小 (px，可選覆寫)
  textColor?: string; // 該欄單元格文字顏色 (可選覆寫)
  format?: 'text' | 'countdown';
  children: ChildWidget[]; // 該欄位單元格的子畫布範本
}

export interface TabListRowCoupling {
  enabled: boolean;
  /** 同一業務事件的關聯鍵（例如同一車輛的同一次停靠） */
  relationKeyField: string;
  /** React 列 key 使用的穩定欄位 */
  stableKeyField: string;
  statusField: string;
  /** 由早到晚；同一關聯鍵只顯示目前最晚的狀態。 */
  statusOrder: string[];
  /** 每個狀態可把輸出欄位映射到該狀態的來源路徑。 */
  fieldMappings?: Record<string, Record<string, string>>;
}

/** Tab 清單單一分頁定義 */
export interface TabListTab extends WidgetDataBinding {
  id: string;
  label: string; // Tab 顯示名稱 (如 "正線班次")
  align?: 'left' | 'center' | 'right'; // 此 Tab 預設整體對齊方式
  dataSourceId?: string;
  sqlQuery?: string;
  freshnessPolicy?: FreshnessPolicy;
  refreshInterval?: number;
  /** REST/JSON 回應中列陣列的路徑（例如 events） */
  dataRowPath?: string;
  /** REST 與 MQTT 合併時必填；只合併相同事件識別 */
  mergeKeyField?: string;
  rowKeyField?: string;
  rowCoupling?: TabListRowCoupling;
  columns: TabListColumn[];
}

/** 可切換 Tab 的動態清單／子畫布表格元件 */
export interface TabListWidget extends WidgetBase {
  /**
   * <code>'shift-list'</code> 與 <code>'tab-list'</code> <strong>結構完全相同</strong>
   * （見下方 <code>ShiftListWidget</code> 別名），差別只在算繪：有 tabs 就當 Tab 表格，
   * 沒有就走班表專用檢視（見 WidgetRenderer）。因此 type 收兩個字面值——
   * 少了 <code>'shift-list'</code> 的話 ChildWidget 聯集裡沒有這個成員，
   * WidgetRenderer 的 <code>case 'shift-list'</code> 就比對不到、narrowing 塌成 never。
   */
  type: 'tab-list' | 'shift-list';
  /** 元件顯示名稱；子畫布編輯的標題會用到（與其他元件的 label 同義） */
  label?: string;
  tabs: TabListTab[];
  activeTabId?: string;
  align?: 'left' | 'center' | 'right'; // 全域表格欄位對齊方式
  rowHeight?: number; // 每列高度 (px)，預設 48
  fontSize?: number; // 內容字級 (px)，預設 13
  textColor?: string; // 內容文字顏色，預設 #e2e8f0
  headerHeight?: number; // 表頭高度 (px)，預設 36
  /** 舊元件預設顯示；false 時整列與高度都移除。 */
  showHeader?: boolean;
  headerFontSize?: number; // 表頭字級 (px)，預設 12
  headerBgColor?: string;
  headerTextColor?: string; // 表頭文字顏色，預設 #94a3b8
  tabFontSize?: number; // Tab 標籤字級 (px)，預設 14
  tabActiveColor?: string; // Tab 活躍文字與底線顏色，預設 #3b82f6
  tabInactiveColor?: string; // Tab 非活躍文字顏色，預設 #64748b
  backgroundColor?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  stripeBgColor?: string;
  defaultTab?: string; // 預設選取 Tab ID
  showTabBar?: boolean;
  dataSourceId?: string;
  mainlineSqlQuery?: string; // 相容既有快捷設定
  maintenanceSqlQuery?: string; // 相容既有快捷設定
  currentScheduleSqlQuery?: string; // 目前班表 SQL（右上角輔助標籤）
  currentScheduleLabel?: string; // 右側標籤說明，預設 "目前班表"
}

export type ShiftListWidget = TabListWidget;

/** 圖台內載具樣板：定義車體樣式與作動行為，執行期套用至場域內所有即時車輛 */
export interface VehicleContainerWidget extends WidgetBase, WidgetDataBinding {
  type: 'vehicle-container';
  /** 載具編輯器 localStorage 中的定義 id */
  vehicleDefinitionId: string;
  /** 顯示用標籤 */
  label?: string;
  /** 作動行為圖示規則（與路線進度相同資料流模式） */
  actionIconRules?: RouteActionIconRule[];
  /** 行為圖示相對於載具中心的偏移（px） */
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  /** 單一作動圖示邊長（px） */
  behaviorIconSize?: number;
}

export type ChildWidget = 
  | TextWidget 
  | ImageWidget 
  | LineChartWidget 
  | DatabaseWidget 
  | GaugeWidget 
  | SlotGridWidget
  | MaintenanceDistributionWidget
  | RouteProgressWidget
  | ColorBlockWidget
  | StatusBadgeWidget
  | StatCardWidget
  | ProgressBarWidget
  | ClockWidget
  | EmptyStateWidget
  | SegmentBarWidget
  | BarChartWidget
  | MapCanvasWidget
  | UnitTelemetryCardWidget
  | AlertBannerWidget
  | VehicleAlertBannerWidget
  | VehicleContainerWidget
  | TabListWidget
  | StationEtaWidget;

export type WidgetType = ChildWidget['type'] | 'shift-list';

export type CanvasKind = 'standard' | 'map-platform';

/** 雙畫板切換條件運算子 */
export type DualCanvasGateOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'empty'
  | 'not_empty';

/** 雙畫板：依查詢結果決定顯示預設或常態畫板 */
export interface DualCanvasDisplayGate {
  /** 閘道專用 SQL（未設時沿用群組 list SQL） */
  dataSourceId?: string;
  sqlQuery?: string;
  refreshInterval?: number;
  refreshMode?: WidgetDataBinding['refreshMode'];
  invalidateTags?: string[];
  /**
   * 比較信號：
   * - rowCount：查詢回傳列數
   * - 其他：首列欄位名（依實際 SQL 欄位命名，非固定變數名）
   */
  signal?: string;
  operator?: DualCanvasGateOperator;
  compareValue?: string;
}

// ─── 泛用群組：多來源／有效性／優先程度／多樣板 ──────────────────────
//
// 群組展示的是「符合條件的候選項目」，不限定車輛或班次；正線班次、緊急調度、
// 告警都只是資料來源的例子，不在這裡寫死任何場域分類。候選資料數量由來源
// 決定，可見容量由使用者設定的版面決定——資料超過容量時低優先項目進入候補、
// 不刪除來源資料；資料不足時由 `overflowFill` 決定撐滿或留空。

/** 單一資料來源設定：每個來源各自管理連線、載入、失敗與更新時間。 */
export interface GroupDataSource {
  /** 來源在這個群組內的識別 id（不是資料庫 id），組成候選項目唯一鍵的一部分 */
  id: string;
  label?: string;
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
  freshnessPolicy?: FreshnessPolicy;
  refreshInterval?: number;
  refreshMode?: WidgetDataBinding['refreshMode'];
  invalidateTags?: string[];
  /** 項目識別欄位（辨識同一資訊項目）；未設時用群組層級的 itemIdField */
  itemIdField?: string;
  /** 內容版本欄位：值改變視為換頁，不是原地更新 */
  contentVersionField?: string;
  /** 這筆資料的更新時間欄位，供新鮮度／過期判斷 */
  updatedAtField?: string;
  /** 有效開始／結束時間欄位；沒有就不設定，視為一直有效 */
  validStartField?: string;
  validEndField?: string;
  /** 狀態欄位＋視為失效的狀態值（如 status=CANCELLED），與時間條件並用 */
  invalidStatusField?: string;
  invalidStatusValues?: string[];
  /** 這個來源候選項目的預設優先程度；命中 priorityRules 時被覆寫 */
  defaultPriority?: number;
  /** 欄位別名：把來源自身欄位名映射成樣板共用欄位名，如 { order_id: 'item_id' }。
   *  原始欄位仍保留，別名是新增鍵，不覆蓋原始欄位。 */
  fieldAliases?: Record<string, string>;
  /**
   * 候選項目建立前的後處理識別碼。平台本身不認得任何值、也不做任何判斷——
   * 純粹把這個字串原封轉給渲染這個群組的頁面自己查表用（見
   * `GroupCanvasRenderer.tsx` 的 `sourcePostProcessors`）。用來接「這批 SQL 列
   * 需要跟另一份即時資料依鍵值疊加」這類場域專屬邏輯，而不必讓平台認得任何
   * 場域分類。未設定就是原始 SQL 列直接使用，不做任何後處理。
   */
  postProcessId?: string;
}

export type GroupConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'empty' | 'not_empty'
  | 'before_now' | 'after_now';

export interface GroupFieldCondition {
  field: string;
  operator: GroupConditionOperator;
  value?: string;
}

/** 有效性規則：命中即視為失效（預設）或視為有效；規則之間為 AND。 */
export interface GroupValidityRule {
  id: string;
  label?: string;
  field: string;
  operator: GroupConditionOperator;
  value?: string;
  effect?: 'invalid' | 'valid';
}

/** 優先程度規則：由上而下依序比對，命中第一條即採用；規則順序可調整。 */
export interface GroupPriorityRule {
  id: string;
  label?: string;
  /** 只套用於此來源；未設則套用所有來源 */
  sourceId?: string;
  conditions?: GroupFieldCondition[];
  priority: number;
}

/** 同優先程度時的次排序；完全相同時保持穩定次序（不重新洗牌）。 */
export interface GroupSortRule {
  field: string;
  direction: 'asc' | 'desc';
}

export type GroupArrangeMode = 'priority' | 'keep';

/** 樣板選擇條件：規則之間為 AND，條件全部符合才選用此樣板。 */
export interface GroupTemplateCondition {
  field: string;
  operator: GroupConditionOperator;
  value?: string;
}

/** 一套樣板＝一棵獨立子元件樹＋選用條件。 */
export interface GroupTemplateDef {
  id: string;
  name: string;
  children: ChildWidget[];
  /** 依序比對，命中第一個符合條件（或設為預設）的樣板 */
  conditions?: GroupTemplateCondition[];
  /** 找不到符合條件的樣板時使用；清單中應恰有一個 */
  isDefault?: boolean;
  /**
   * 這套樣板自己的設計尺寸；未設時沿用群組層級的 `templateWidth`/`templateHeight`。
   * 不同樣板的原始卡片設計大小常常不一樣（如遷移既有卡片時，正線卡跟整備卡本來
   * 就不是同一個尺寸畫的）——沒有各自的設計尺寸，縮放比例會用「錯的那一套」的
   * 尺寸去算，內容比例跟著跑掉。
   */
  templateWidth?: number;
  templateHeight?: number;
}

export type GroupOverflowFill = 'stretch' | 'blank';

/** 可見容量與資料不足時的處理方式。 */
export interface GroupCapacityConfig {
  capacity: number;
  overflowFill?: GroupOverflowFill;
  /** 顯示候補數量提示（如「+3 未顯示」） */
  showPendingCount?: boolean;
}

export type GroupTransitionType = 'none' | 'fade' | 'flip-up';

export interface GroupTransitionConfig {
  type?: GroupTransitionType;
  durationMs?: number;
}

/** 過期資料處理：不能默默讓重要資訊消失，要有明確設定。 */
export type GroupStaleDataPolicy = 'remove' | 'keep' | 'mark';

/**
 * 泛用群組設定。所有欄位皆可選——舊群組（`enabled` 未設或 false）維持單一
 * `dataSourceId`／`children` 的既有行為，不自動遷移。
 */
export interface GenericGroupConfig {
  enabled?: boolean;
  sources?: GroupDataSource[];
  /** 跨來源合併識別欄位；未設時唯一鍵＝「來源 id＋項目 id」，不同來源不互相覆蓋。
   *  這個欄位必須由使用者明確設定，平台不自動猜測共同識別欄位。 */
  mergeIdField?: string;
  /** 群組層級預設識別欄位；各來源可用自己的 itemIdField 覆寫 */
  itemIdField?: string;
  validityRules?: GroupValidityRule[];
  priorityRules?: GroupPriorityRule[];
  /** 沒有規則命中時的預設優先程度 */
  defaultPriority?: number;
  sortRules?: GroupSortRule[];
  /** 同優先程度的新項目預設不搶占目前顯示中的項目，避免畫面抖動 */
  preemptEqualPriority?: boolean;
  /**
   * 可見項目選定後怎麼排列：
   * - priority（預設）：優先程度高者在前，同優先依次排序，再相同維持目前位置
   * - keep：保留既有位置，只把空格往左補齊
   */
  arrangeMode?: GroupArrangeMode;
  templates?: GroupTemplateDef[];
  capacityConfig?: GroupCapacityConfig;
  transitionConfig?: GroupTransitionConfig;
  staleDataPolicy?: GroupStaleDataPolicy;
}

// ─── Canvas 元件型別 ───────────────────────────────────────────────

export interface CanvasElementProps {
  id: string;
  type: 'canvas';
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  backgroundColor: string;
  backgroundImage: string;
  opacity: number;
  children: ChildWidget[];
  /** 班次中心 24 小時統計窗；跟著 plane 一起存在伺服器 elements JSONB */
  shiftCenterRange?: {
    dateMode: 'operating' | 'fixed';
    date?: string;
    startTime: string;
    timezone: string;
  };

  /** 標準畫布 / 圖台容器（內嵌 Map Editor 場域圖） */
  canvasKind?: CanvasKind;
  /** 圖台容器：對應地圖編輯器 mapId */
  mapId?: string;
  /** 圖台容器：縮放倍率（越大視野越小） */
  zoomFactor?: number;
  /** 圖台容器：載具編輯器定義 id */
  vehicleDefinitionId?: string;
  /** 圖台容器：載具編輯器定義名稱（id 未設或未命中時） */
  vehicleDefinitionName?: string;
  /** 圖台容器：未指定載具時使用預設範例載具 */
  useDefaultVehicleDefinition?: boolean;
  /** 圖台容器：載具橫向顯示尺寸（px，沿軌道方向） */
  vehicleDisplayWidthPx?: number;
  /** 圖台容器：載具縱向顯示尺寸（px，垂直軌道方向） */
  vehicleDisplayHeightPx?: number;
  /** 圖台容器：車頂軌道進度指標（名稱、進度、偏移）的顯示項目與外觀 */
  vehicleRoofIndicator?: import('../map-editor/vehicles/vehicleRoofIndicator').VehicleRoofIndicatorConfig;
  /**
   * overlay：疊在群組下方的輔助畫布（如空狀態）；未選取時點擊穿透至下層群組
   */
  canvasLayer?: 'default' | 'overlay';
  /** 畫布或群組頂部自訂區塊標題（如「載具控制」） */
  headerTitle?: string;
  /** 區塊標題字級（px）；未設時 14 */
  headerTitleFontSize?: number;

  // --- 畫布群組功能 (Canvas Group) ---
  isGroup?: boolean;
  // 資料綁定
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  refreshInterval?: number;
  refreshMode?: WidgetDataBinding['refreshMode'];
  invalidateTags?: string[];
  // 變數設定
  iteratorField?: string;
  variableName?: string;
  /**
   * 群組注入子元件的變數模式：
   * - index：僅傳遞列索引（0,1,2…），子元件自行以 SQL／MQTT 承接
   * - row：傳遞整列欄位（舊版相容）
   */
  groupVariableMode?: 'index' | 'row';
  // 佈局設定
  layoutMode?: 'free' | 'grid';
  gridColumns?: number;
  gapX?: number;
  gapY?: number;
  xField?: string;
  yField?: string;
  // 子範本大小
  templateWidth?: number;
  templateHeight?: number;
  /**
   * 群組資料呈現模式：
   * - tile：重複排列所有資料列（預設）
   * - scroll：單一視窗，資料列輪播滾動
   * - slots：固定橫向格數，每格整塊替換為對應資料列
   */
  groupRepeatMode?: 'tile' | 'scroll' | 'slots';
  /** scroll 模式：每筆停留秒數 */
  groupScrollInterval?: number;
  /** slots 模式：固定格數（橫向） */
  slotCount?: number;
  /** slots 模式：用於偵測資料替換的欄位（如 order_id） */
  slotKeyField?: string;
  /**
   * slots 模式：格位如何對應資料列
   * - index：第 i 列 → 第 i 格（預設行為）
   * - sticky-pool：固定格位池，班次結束釋放格位，候補依序填入
   */
  groupSlotAssignment?: 'index' | 'sticky-pool';
  /** slots 模式：格位資料替換時的進場動畫 */
  groupTransition?: 'none' | 'fade' | 'flip';
  /**
   * tile／scroll／slots 子範本尺寸策略：
   * - fill：依資料筆數分配欄寬並撐滿（筆數少時單卡會變很寬）
   * - slot：依 gridColumns 固定槽寬，有幾筆顯示幾格、靠左，不顯示空槽
   * - fixed：使用 templateWidth × templateHeight（與槽寬無關）
   */
  groupTileFit?: 'fixed' | 'fill' | 'slot';
  /** fill 時子畫布縮放：cover 撐滿格子（預設）；contain 等比留白 */
  groupTileScaleMode?: 'contain' | 'cover';
  /** fixed 模式：水平置中（畫布比範本總寬大時） */
  groupTileAlign?: 'start' | 'center';
  /** 群組內邊距（四邊相同；可被 padX／padY 覆寫） */
  groupTilePadding?: number;
  /** 群組內邊距：左右（未設時同 groupTilePadding） */
  groupTilePadX?: number;
  /** 群組內邊距：上下（未設時同 groupTilePadding；設 0 可讓子畫布垂直貼滿群組） */
  groupTilePadY?: number;
  /** tile 模式：隱藏範本外框（車輛狀態卡等自帶邊框） */
  templateHideChrome?: boolean;

  /**
   * 泛用群組設定（多來源／有效性／優先程度／多樣板／容量與轉場）。
   *
   * 未設或 `enabled` 非 true 時，群組維持舊行為：單一 `dataSourceId`/`sqlQuery`、
   * 單一 `children` 樣板、`groupSlotAssignment` 的索引式 sticky-pool——舊文件不會
   * 被自動轉換。啟用後，`sources`/`templates` 取代單一資料綁定與 `children`，
   * 但 `children` 仍保留（作為找不到符合條件樣板時的最後備援）。
   */
  genericGroup?: GenericGroupConfig;

  // --- 雙畫板子畫布（預設／常態互斥顯示，元件樹不共用） ---
  /** 啟用雙畫板編輯與執行時 Gate 切換 */
  dualCanvasEnabled?: boolean;
  /** 是否啟用預設畫板（關閉時僅顯示常態畫板）；預設 true */
  defaultPanelEnabled?: boolean;
  /** 預設資料畫板元件樹 */
  childrenDefault?: ChildWidget[];
  /** 常態資料畫板元件樹（未設時沿用 children） */
  childrenNormal?: ChildWidget[];
  /** 顯示閘道：條件成立 → 常態；否則 → 預設（若 defaultPanelEnabled） */
  displayGate?: DualCanvasDisplayGate;

  // --- Tab 子畫布 ---
  /** 啟用 Tab 畫布模式（每個 Tab 各自一組子元件） */
  tabCanvasEnabled?: boolean;
  /** Tab 定義清單（含每個 Tab 的名稱與資料來源設定） */
  tabs?: TabCanvasTab[];
  /** Tab Bar 高度（px）；預設 40 */
  tabBarHeight?: number;
  /** Tab Bar 背景色 */
  tabBarBgColor?: string;
  /** 選中 Tab 指示線顏色；預設 #3B82F6 */
  tabActiveColor?: string;
  /** Tab 1 (index 0) 子元件樹 → 沿用既有 children 欄位 */
  /** Tab 2 (index 1) 子元件樹 */
  childrenTab1?: ChildWidget[];
  /** Tab 3 (index 2) 子元件樹 */
  childrenTab2?: ChildWidget[];
  /** Tab 4 (index 3) 子元件樹 */
  childrenTab3?: ChildWidget[];
  /** Tab 5 (index 4) 子元件樹 */
  childrenTab4?: ChildWidget[];
  /** Tab 6 (index 5) 子元件樹 */
  childrenTab5?: ChildWidget[];
  /** Tab 7 (index 6) 子元件樹 */
  childrenTab6?: ChildWidget[];
  /** Tab 8 (index 7) 子元件樹 */
  childrenTab7?: ChildWidget[];
  /** Tab 9 (index 8) 子元件樹 */
  childrenTab8?: ChildWidget[];
  /** Tab 10 (index 9) 子元件樹 */
  childrenTab9?: ChildWidget[];
}

// ─── Plane 型別 ────────────────────────────────────────────────────

export interface DashboardPlane {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 畫布適配模式：
   * - fixed-scale：固定等比大屏模式（預設，保持比例居中，適合 1920x1080 戰情室）
   * - fit-width：寬度自適應撐滿模式（100% 填滿寬度，高度垂直捲動，適合業務嵌入頁）
   */
  viewportMode?: 'fixed-scale' | 'fit-width';
  elements: CanvasElementProps[];
  createdAt: number;
  updatedAt: number;
  /** 後端資料列版本（讀取時帶回；單張更新時做樂觀鎖）。前端不自己遞增。 */
  serverVersion?: number;
  /**
   * 這張儀表板自己的資料設定（存在伺服器 dashboard_planes.data_settings）。
   * sourceMap：元件引用的資料來源 ID → 這張實際使用的連線定義 ID；沒列到的照元件原本的 ID。
   */
  dataSettings?: PlaneDataSettings;
}

export interface PlaneDataSettings {
  sourceMap?: Record<string, string>;
}

// ─── Widget 預設值工廠 ─────────────────────────────────────────────

export function createWidget(type: WidgetType, x: number, y: number): ChildWidget {
  const id = `${type}-${Date.now()}`;
  switch (type) {
    case 'text':
      return { 
        id, type, x, y, width: 200, height: 60, content: '文字內容', fontSize: 14,
        lineHeight: 1.5, fontFamily: 'system-ui', fontWeight: 'normal',
        color: '#e2e8f0', textAlign: 'center', verticalAlign: 'center',
        borderRadius: 4, borderWidth: 0, borderColor: 'transparent', backgroundColor: 'transparent',
        icon: '', iconImage: '',
        colorRulesEnabled: false, colorRules: []
      };
    case 'image':
      return { id, type, x, y, width: 220, height: 150, src: '', objectFit: 'cover', borderRadius: 4 };
    case 'line-chart':
      return {
        id, type, x, y, width: 420, height: 260, title: '折線圖',
        xField: 'time',
        series: [{ id: 'series-0', yField: 'value', color: '#38bdf8', strokeWidth: 2 }],
        yFields: ['value'],
        xTickInterval: 1,
        strokeColors: ['#38bdf8'],
        xAxis: { unit: 'time', min: '07:00', max: '12:00', timeStyle: 'hm', timeClock: '24h', label: '時間' },
        yAxis: { unit: 'number', min: 0, max: 100, label: '數值' },
        viewportMode: 'fixed-axis',
        viewportPadding: 0.12,
      };
    case 'database':
      return { id, type, x, y, width: 400, height: 280, title: '資料庫',
               displayMode: 'table', maxRows: 20 };
    case 'gauge':
      return { id, type, x, y, width: 240, height: 160, title: '儀表板', valueField: 'value',
               unit: '%', min: 0, max: 100,
               gaugeValueFontSize: 24, gaugeUnitFontSize: 12,
               colorStops: [{ at: 0, color: '#ef4444' }, { at: 0.5, color: '#f59e0b' }, { at: 1, color: '#22c55e' }] };
    case 'slot-grid':
      return { id, type, x, y, width: 480, height: 100, title: '格位陣列',
               nameField: 'slot_label', statusField: 'status', activeValues: ['OCCUPIED', 'CHARGING'],
               layout: 'horizontal', slotWidth: 48, slotHeight: 28,
               activeColor: '#94a3b8', inactiveColor: '#334155',
               statusColorRules: [
                 { status: 'AVAILABLE', bgColor: '#334155', textColor: '#64748b' },
                 { status: 'OCCUPIED', bgColor: '#94a3b8', textColor: '#0f172a' },
                 { status: 'CHARGING', bgColor: '#94a3b8', textColor: '#0f172a' },
                 { status: 'ERROR', bgColor: '#ef4444', textColor: '#ffffff' },
                 { status: 'OFFLINE', bgColor: '#334155', textColor: '#64748b' },
               ],
               defaultSlotTextColor: '#64748b', variant: 'default', hideTitle: false, slotGap: 4 };
    case 'route-progress':
      return {
        id, type, x, y, width: 400, height: 80, valueField: 'progress',
        activeColor: '#0ea5e9', inactiveColor: '#334155',
        vehicleIcon: 'vehicle.svg', iconColor: '#ffffff', iconBgColor: '#51A2FF',
        vehicleIconBgVarKey: 'icon_bg_color',
        stationSource: 'json',
        stationsJsonVarKey: 'stations_json',
        segmentIndexVarKey: 'segment_index',
        segmentRemainPctVarKey: 'segment_remain_pct',
        cardStationLabel: '站點',
        cardMetricLabel: 'ETA',
        cardDepartLabel: '開始',
        cardEndLabel: '結束',
        stations: [
          { id: 's1', name: 'A', value: 0 },
          { id: 's2', name: 'B', value: 50 },
          { id: 's3', name: 'C', value: 100 },
        ],
        actionIconRules: [],
      };
    case 'color-block':
      return {
        id, type, x, y, width: 200, height: 120,
        backgroundColor: '#1e293b', borderRadius: 8,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: 100,
      };
    case 'alert-banner':
      return {
        id, type, x, y, width: 200, height: 28,
        content: '',
        fontSize: 10,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
        color: '#fafafa',
        textAlign: 'center',
        borderRadius: 4,
        borderWidth: 0,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        icon: 'AlertCircle',
        textWrap: 'nowrap',
        contentPadding: '4px 8px',
        triggerConditions: [],
      };
    case 'vehicle-alert-banner':
      return {
        id, type, x, y, width: 200, height: 22,
        messageVarKey: 'alert_message',
        severityVarKey: 'overall_health',
        fontSize: 10,
        zIndex: 15,
      };
    case 'status-badge':
      return {
        id, type, x, y, width: 120, height: 36,
        valueField: 'status', defaultLabel: 'UNKNOWN',
        defaultBgColor: '#374151', defaultTextColor: '#9ca3af',
        showDot: true, fontSize: 12, borderRadius: 20,
        rules: [
          { value: 'ONLINE',  label: 'ONLINE',  bgColor: '#064e3b', textColor: '#34d399' },
          { value: 'OFFLINE', label: 'OFFLINE', bgColor: '#450a0a', textColor: '#f87171' },
          { value: 'IDLE',    label: 'IDLE',    bgColor: '#1e3a5f', textColor: '#60a5fa' },
        ],
      };
    case 'stat-card':
      return {
        id, type, x, y, width: 160, height: 90,
        label: '指標', valueField: 'value', unit: '',
        valueFontSize: 32, labelFontSize: 11,
        valueColor: '#f1f5f9', labelColor: '#94a3b8', unitColor: '#64748b',
        labelPosition: 'top', contentAlign: 'center', layoutGap: 4, labelUppercase: true,
        labelFontWeight: '500',
        backgroundColor: 'transparent', borderRadius: 8,
        borderWidth: 0, borderColor: 'transparent',
        icon: '', iconColor: '#06b6d4',
        colorRulesEnabled: false, colorRules: [],
      };
    case 'progress-bar':
      return {
        id, type, x, y, width: 240, height: 40,
        valueField: 'value', min: 0, max: 100,
        orientation: 'horizontal', showValue: true, showLabel: true, label: '進度',
        trackColor: 'rgba(255,255,255,0.08)', borderRadius: 6,
        colorStops: [{ at: 0, color: '#3b82f6' }, { at: 0.7, color: '#22c55e' }, { at: 1, color: '#ef4444' }],
      };
    case 'clock':
      return {
        id, type, x, y, width: 200, height: 70,
        format: '24h', showDate: true, showSeconds: true,
        dateFormat: 'YYYY-MM-DD',
        fontSize: 32, dateFontSize: 12,
        color: '#f1f5f9', dateColor: '#94a3b8', fontFamily: 'monospace',
      };
    case 'station-eta':
      return {
        id, type, x, y, width: 220, height: 96,
        title: '到站／出發',
        stations: [],
        limit: 3,
        fontSize: 13,
        color: '#F3F4F6',
        mutedColor: '#9CA3AF',
        backgroundColor: 'rgba(17,24,39,0.82)',
        borderColor: 'rgba(148,163,184,0.35)',
        borderRadius: 6,
        dataUrl: STATION_ETA_URL,
        refreshMode: 'event',
        invalidateTags: [...STATION_ETA_INVALIDATE_TAGS],
      };
    case 'empty-state':
      return {
        id, type, x, y, width: 318, height: 58,
        label: '尚無資料',
        subLabel: '查詢結果為空',
        borderRadius: 8,
        visibilityMode: 'when-empty',
      };
    case 'maintenance-distribution':
      return {
        id, type, x, y, width: 656, height: 207,
        title: '整備分佈',
        columns: 2,
        dataUrl: '/syncdrive-api/facility/maintenance-distribution',
        refreshMode: 'event',
        invalidateTags: ['domain:maintenance_slots', 'table:operation_orders'],
      };
    case 'segment-bar':
      return {
        id, type, x, y, width: 640, height: 100,
        title: '',
        statusField: 'status_code',
        pctField: 'pct',
        countField: 'count',
        countUnit: '',
        colorRules: [],
        showLegend: true,
      };
    case 'bar-chart':
      return {
        id, type, x, y, width: 420, height: 260,
        title: '長條圖', xField: 'x', yFields: ['y'],
        orientation: 'vertical', strokeColors: ['#06b6d4', '#f59e0b', '#10b981'],
        showValues: false, barPadding: 0.3,
      };
    case 'map-canvas':
      return {
        id, type, x, y, width: 600, height: 360,
        mapId: '',
        zoomFactor: 2.0,
      };
    case 'unit-telemetry-card':
      return {
        id, type, x, y, width: 130, height: 150,
        unitLabel: 'UNIT-01',
        speedField: 'speed',
        loadField: 'load',
        speedUnit: '',
        loadUnit: '%',
        speedMin: 0,
        speedMax: 100,
        loadMin: 0,
        loadMax: 100,
        statusFlags: [
          { key: 'a', label: 'A', activeColor: '#34d399', inactiveColor: '#334155' },
          { key: 'b', label: 'B', activeColor: '#38bdf8', inactiveColor: '#334155' },
          { key: 'c', label: 'C', activeColor: '#f87171', inactiveColor: '#334155' },
        ],
        activeFlagKey: 'a',
      };
    case 'vehicle-container':
      return {
        id,
        type,
        x,
        y,
        width: 69,
        height: 232,
        vehicleDefinitionId: '',
        label: '載具',
        behaviorOffsetX: 0,
        behaviorOffsetY: -28,
        behaviorIconSize: 20,
        actionIconRules: [],
        mqttDataSourceId: 'default-mqtt',
        mqttTopic: 'v1/vtms/PMS01/operation/update',
      };
    case 'tab-list':
    case 'shift-list':
      return {
        id,
        type: 'tab-list',
        x,
        y,
        width: 960,
        height: 380,
        rowHeight: 48,
        fontSize: 13,
        textColor: '#cbd5e1',
        headerHeight: 38,
        headerFontSize: 12,
        headerTextColor: '#94a3b8',
        tabFontSize: 14,
        tabActiveColor: '#3b82f6',
        tabInactiveColor: '#64748b',
        tabs: [
          {
            id: 'tab-mainline',
            label: '正線班次',
            dataSourceId: 'default-internal',
            freshnessPolicy: 'auto',
            columns: [
              {
                id: 'col-trip',
                name: '班次代號',
                fieldKey: 'trip_code',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `txt-trip-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 90,
                    height: 44,
                    content: '{trip_code}',
                    fontSize: 13,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'bold',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-dir',
                name: '運行方向',
                fieldKey: 'direction_label',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `txt-dir-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 90,
                    height: 44,
                    content: '{direction_label}',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'normal',
                    color: '#94a3b8',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-veh',
                name: '執行載具',
                fieldKey: 'vehicle_code',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `txt-veh-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 90,
                    height: 44,
                    content: '{vehicle_code}',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'normal',
                    color: '#94a3b8',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-route',
                name: '路線進度',
                fieldKey: 'route_stations',
                width: 260,
                align: 'left',
                children: [
                  {
                    id: `rp-${Date.now()}`,
                    type: 'route-progress',
                    x: 0,
                    y: 2,
                    width: 260,
                    height: 40,
                    valueField: 'route_progress',
                    activeColor: '#3b82f6',
                    inactiveColor: '#334155',
                    vehicleIcon: 'vehicle.svg',
                    iconColor: '#ffffff',
                    iconBgColor: '#3b82f6',
                    stationSource: 'json',
                    stationsJsonVarKey: 'stations_json',
                    segmentIndexVarKey: 'segment_index',
                    segmentRemainPctVarKey: 'segment_remain_pct',
                    trackStyle: 'mainline',
                    stations: [
                      { id: 's1', name: 'S2W', value: 0 },
                      { id: 's2', name: 'T3', value: 50 },
                      { id: 's3', name: 'N2W', value: 100 },
                    ],
                    actionIconRules: [],
                  },
                ],
              },
              {
                id: 'col-stat',
                name: '班次狀態',
                fieldKey: 'status_label',
                width: 100,
                align: 'left',
                children: [
                  {
                    id: `badge-stat-${Date.now()}`,
                    type: 'status-badge',
                    x: 0,
                    y: 8,
                    width: 80,
                    height: 26,
                    valueField: 'status_label',
                    defaultLabel: '{status_label}',
                    defaultBgColor: 'rgba(255,255,255,0.06)',
                    defaultTextColor: '#cbd5e1',
                    variableBgKey: 'status_bg',
                    variableColorKey: 'status_color',
                    showDot: false,
                    fontSize: 11,
                    borderRadius: 12,
                    rules: [
                      { value: '延誤', label: '延誤', bgColor: 'rgba(234, 88, 12, 0.25)', textColor: '#fdba74' },
                      { value: '準點', label: '準點', bgColor: 'rgba(34, 197, 94, 0.22)', textColor: '#86efac' },
                    ],
                  },
                ],
              },
              {
                id: 'col-time',
                name: '發車時間(預計/實際)',
                fieldKey: 'depart_time',
                width: 150,
                align: 'left',
                children: [
                  {
                    id: `txt-time-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 150,
                    height: 44,
                    content: '{depart_time}',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'normal',
                    color: '#94a3b8',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-detail',
                name: '操作',
                fieldKey: 'shift_key',
                width: 80,
                align: 'left',
                children: [
                  {
                    id: `txt-act-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 80,
                    height: 44,
                    content: '查看詳情',
                    fontSize: 11,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'bold',
                    color: '#3b82f6',
                    icon: 'ExternalLink',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
            ],
          },
          {
            id: 'tab-maintenance',
            label: '整備班次',
            dataSourceId: 'default-internal',
            freshnessPolicy: 'auto',
            columns: [
              {
                id: 'col-m-trip',
                name: '班次代號',
                fieldKey: 'trip_code',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `txt-mtrip-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 90,
                    height: 44,
                    content: '{trip_code}',
                    fontSize: 13,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'bold',
                    color: '#cbd5e1',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-m-type',
                name: '整備類型',
                fieldKey: 'maint_type_label',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `badge-mtype-${Date.now()}`,
                    type: 'status-badge',
                    x: 0,
                    y: 8,
                    width: 70,
                    height: 26,
                    valueField: 'maint_type_label',
                    defaultLabel: '{maint_type_label}',
                    defaultBgColor: '#422006',
                    defaultTextColor: '#fdba74',
                    variableBgKey: 'maint_type_bg',
                    variableColorKey: 'maint_type_color',
                    showDot: false,
                    fontSize: 11,
                    borderRadius: 6,
                    rules: [],
                  },
                ],
              },
              {
                id: 'col-m-veh',
                name: '執行載具',
                fieldKey: 'vehicle_code',
                width: 90,
                align: 'left',
                children: [
                  {
                    id: `txt-mveh-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 90,
                    height: 44,
                    content: '{vehicle_code}',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'normal',
                    color: '#94a3b8',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-m-route',
                name: '整備進度',
                fieldKey: 'route_stations',
                width: 260,
                align: 'left',
                children: [
                  {
                    id: `rp-m-${Date.now()}`,
                    type: 'route-progress',
                    x: 0,
                    y: 2,
                    width: 260,
                    height: 40,
                    valueField: 'route_progress',
                    activeColor: '#3b82f6',
                    inactiveColor: '#3f3f46',
                    vehicleIcon: 'vehicle.svg',
                    iconColor: '#ffffff',
                    iconBgColor: '#3b82f6',
                    stationSource: 'json',
                    stationsJsonVarKey: 'stations_json',
                    segmentIndexVarKey: 'segment_index',
                    segmentRemainPctVarKey: 'segment_remain_pct',
                    trackStyle: 'maintenance',
                    stations: [
                      { id: 'ms1', name: '整備站', value: 0 },
                      { id: 'ms2', name: '充電站', value: 50 },
                      { id: 'ms3', name: '主線口', value: 100 },
                    ],
                    actionIconRules: [],
                  },
                ],
              },
              {
                id: 'col-m-stat',
                name: '整備狀態',
                fieldKey: 'status_label',
                width: 100,
                align: 'left',
                children: [
                  {
                    id: `badge-mstat-${Date.now()}`,
                    type: 'status-badge',
                    x: 0,
                    y: 8,
                    width: 80,
                    height: 26,
                    valueField: 'status_label',
                    defaultLabel: '{status_label}',
                    defaultBgColor: '#27272a',
                    defaultTextColor: '#a1a1aa',
                    variableBgKey: 'status_bg',
                    variableColorKey: 'status_color',
                    showDot: true,
                    fontSize: 11,
                    borderRadius: 6,
                    rules: [],
                  },
                ],
              },
              {
                id: 'col-m-time',
                name: '預計時間',
                fieldKey: 'depart_time',
                width: 150,
                align: 'left',
                children: [
                  {
                    id: `txt-mtime-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 150,
                    height: 44,
                    content: '{depart_time}',
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'normal',
                    color: '#94a3b8',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
              {
                id: 'col-m-detail',
                name: '操作',
                fieldKey: 'shift_key',
                width: 80,
                align: 'left',
                children: [
                  {
                    id: `txt-mact-${Date.now()}`,
                    type: 'text',
                    x: 0,
                    y: 0,
                    width: 80,
                    height: 44,
                    content: '查看詳情',
                    fontSize: 11,
                    lineHeight: 1.4,
                    fontFamily: 'system-ui',
                    fontWeight: 'bold',
                    color: '#3b82f6',
                    icon: 'ExternalLink',
                    textAlign: 'left',
                    verticalAlign: 'center',
                    borderRadius: 0,
                    borderWidth: 0,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    colorRulesEnabled: false,
                    textWrap: 'nowrap',
                  },
                ],
              },
            ],
          },
        ],
      };
  }
}
