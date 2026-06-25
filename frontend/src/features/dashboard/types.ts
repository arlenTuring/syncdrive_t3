// ─── 資料綁定介面 ──────────────────────────────────────────────

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

  // 通用設定
  refreshInterval?: number; // 秒，針對 REST/SQL
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
  objectFit: 'cover' | 'contain' | 'fill';
  borderRadius: number;
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
  /** semi-arc：半圓漸層弧 + 指針 + 中央數值 */
  gaugeVariant?: 'default' | 'semi-arc';
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

export interface RouteStation {
  id: string;
  name: string;
  value: number; // 軌道上的錨點位置 0–100（等距站點由系統計算）
  /** 前往此站之進度段上的剩餘距離 %（0=已到站，100=剛離開前站），供推算用 */
  remainPct?: number;
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
export interface ColorBlockWidget extends WidgetBase, Pick<WidgetDataBinding, 'dataSourceId' | 'sqlQuery' | 'refreshInterval' | 'mqttDataSourceId' | 'mqttTopic' | 'mqttValuePath'> {
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
  | VehicleContainerWidget;

export type WidgetType = ChildWidget['type'];

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
  /**
   * 比較信號：
   * - rowCount：查詢回傳列數
   * - 其他：首列欄位名（依實際 SQL 欄位命名，非固定變數名）
   */
  signal?: string;
  operator?: DualCanvasGateOperator;
  compareValue?: string;
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
  /**
   * overlay：疊在群組下方的輔助畫布（如空狀態）；未選取時點擊穿透至下層群組
   */
  canvasLayer?: 'default' | 'overlay';

  // --- 畫布群組功能 (Canvas Group) ---
  isGroup?: boolean;
  // 資料綁定
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  refreshInterval?: number;
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
}

// ─── Plane 型別 ────────────────────────────────────────────────────

export interface DashboardPlane {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: CanvasElementProps[];
  createdAt: number;
  updatedAt: number;
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
    case 'empty-state':
      return {
        id, type, x, y, width: 318, height: 58,
        label: '尚無資料',
        subLabel: '查詢結果為空',
        borderRadius: 8,
        visibilityMode: 'when-empty',
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
        mqttTopic: 'v1/vtms/PMS-01/operation/update',
      };
  }
}

