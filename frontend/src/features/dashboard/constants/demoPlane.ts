/**
 * SyncDrive 總控大屏 3840×1080 — 左欄三區（事件／班次／運能）+ 右欄調度／圖台／遙測
 * 左欄對照「Screen 32:9」參考：上排雙卡、下排運能趨勢
 */
import type {
  CanvasElementProps,
  ChildWidget,
  ClockWidget,
  ColorBlockWidget,
  DashboardPlane,
  LineChartWidget,
  RouteProgressWidget,
  ProgressBarWidget,
  SegmentBarWidget,
  SlotGridWidget,
  SlotStatusColorRule,
  StatCardWidget,
  StatusBadgeWidget,
  TextWidget,
  EmptyStateWidget,
  GaugeWidget,
  AlertBannerWidget,
  VehicleContainerWidget,
} from '../types';
import { createWidget } from '../types';
import { buildVehicleBehaviorActionRules } from '../../vehicle-editor/constants/behaviorActionCatalog';
import {
  createUserRestoredVtmsVehicle,
  USER_RESTORED_VEHICLE_ID,
} from '../../vehicle-editor/constants/userRestoredVtmsVehicle';
import { migrateVehicleDefinition } from '../../vehicle-editor/utils/migrateVehicleDefinition';
import { computeVehicleContainerDisplaySize } from '../../vehicle-editor/utils/vehicleContentBounds';
import { vehicleStatusAlertDemoRules } from './alertBannerDemoRules';
import { SUBSYSTEM_PILL_RULES, VEHICLE_BADGE_RULES } from './vehicleMonitorTheme';
import {
  CAPACITY_TREND_CHART_SQL,
  CAPACITY_TREND_SUMMARY_SQL,
  EVENT_CENTER_LIST_SQL,
  EVENT_CENTER_SUMMARY_SQL,
  LIST_INDEX_VAR,
  listSqlRowFieldByIndex,
  listSqlRowUnreadDotByIndex,
  MAINTENANCE_HEADER_LINE_SQL,
  maintenanceSlotsSql,
  maintenanceZoneCountSql,
  SHIFT_CENTER_SUMMARY_SQL,
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
  VEHICLE_DISTRIBUTION_SQL,
  VEHICLE_STATUS_ROW_SQL,
} from './demoSql';
import { buildCatalogActionRules } from '../vehicle-operation-actions';
import { presetIconUrl } from './iconLibrary';
import { DEMO_FS as FS } from './demoTypography';
import demoPlaneSnapshot from './demoPlane.snapshot.json';

const DS = 'default-internal';
const MQTT = 'default-mqtt';
const HEALTH_TOPIC = 'v1/vtms/${vehicle_code}/health/heartbeat';
const CAPACITY_TOPIC = 'v1/vtms/dashboard/capacity/live';

/** 平台預設圖示（泛用分類路徑） */
const ICON = {
  eventCenter: presetIconUrl('alerts/event_center.png'),
  shiftCenter: presetIconUrl('schedule/shift_center.png'),
  metricsList: presetIconUrl('metrics/reset_shift.png'),
  capacityTrend: presetIconUrl('charts/capacity-trend.png'),
  maintenanceDistribution: presetIconUrl('facility/maintenance_distribution.png'),
  vehicleDistribution: presetIconUrl('vehicles/vehicle_distribution.png'),
  vehicleState: presetIconUrl('vehicles/vehicle_state.png'),
  nav: presetIconUrl('navigation/nav.png'),
  position: presetIconUrl('navigation/position.png'),
  clock: presetIconUrl('time/clock.png'),
  nextScope: presetIconUrl('time/next_scpoe.png'),
  availVehicle: presetIconUrl('transport/reset_dispatch_vehicle.png'),
  facilityCharging: presetIconUrl('facility/charging.png'),
  facilityWash: presetIconUrl('facility/wash.png'),
  facilityMaintain: presetIconUrl('facility/maintainance.png'),
  facilityRepair: presetIconUrl('facility/repair.png'),
  facilityDispatch: presetIconUrl('facility/dispatch.png'),
  facilityPark: presetIconUrl('facility/park.png'),
  alert: presetIconUrl('alerts/event_center.png'),
} as const;

/** 變更此值可強制所有使用者下次載入時取得新範例版面 */
export const DEMO_LAYOUT_SEED = '121-protocol-rest-flow-enter-exit';

function cid() {
  return Math.random().toString(36).slice(2, 9);
}

const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

function staticText(
  x: number, y: number, w: number, h: number, content: string,
  fontSize: number = FS.body, color = '#f1f5f9', fontWeight: 'bold' | 'normal' = 'bold',
  textAlign: 'left' | 'right' | 'center' = 'left',
  lineHeight = 1.2,
  opts?: { severityTextColor?: boolean; icon?: string; iconImage?: string },
): TextWidget {
  const t = createWidget('text', x, y) as TextWidget;
  return {
    ...t, id: cid(), width: w, height: h, content, fontSize, color, fontWeight,
    textAlign, lineHeight, fontFamily: FONT_UI,
    severityTextColor: opts?.severityTextColor,
    icon: opts?.iconImage ? undefined : opts?.icon,
    iconImage: opts?.iconImage,
  };
}

function boundText(
  x: number, y: number, w: number, h: number,
  valueField: string,
  sql: string,
  fontSize: number,
  color: string,
  fontWeight: 'bold' | 'normal' = 'normal',
  textAlign: 'left' | 'right' | 'center' = 'left',
  opts?: {
    icon?: string;
    iconImage?: string;
    content?: string;
    contentPadding?: string;
    textWrap?: 'wrap' | 'nowrap';
  },
): TextWidget {
  const t = staticText(x, y, w, h, opts?.content ?? '', fontSize, color, fontWeight, textAlign);
  return {
    ...t,
    dataSourceId: DS,
    sqlQuery: sql,
    valueField,
    refreshInterval: 15,
    icon: opts?.iconImage ? undefined : opts?.icon,
    iconImage: opts?.iconImage,
    contentPadding: opts?.contentPadding,
    textWrap: opts?.textWrap,
  };
}

function colorBlock(
  x: number, y: number, w: number, h: number,
  backgroundColor: string,
  borderRadius = 10,
): ColorBlockWidget {
  const b = createWidget('color-block', x, y) as ColorBlockWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    backgroundColor,
    borderRadius,
    borderWidth: 0,
    borderColor: 'transparent',
    opacity: 100,
  };
}

const MAINT_SLOT_STATUS_RULES: SlotStatusColorRule[] = [
  { status: 'AVAILABLE', bgColor: 'rgba(98, 116, 142, 0.2)', textColor: '#99A1AF' },
  { status: 'OCCUPIED', bgColor: 'rgba(255, 255, 255, 0.5)', textColor: '#030712' },
  { status: 'CHARGING', bgColor: 'rgba(255, 255, 255, 0.5)', textColor: '#030712' },
  { status: 'ERROR', bgColor: '#FB2C36', textColor: '#030712' },
  { status: 'OFFLINE', bgColor: 'rgba(98, 116, 142, 0.2)', textColor: '#99A1AF' },
];

function maintenanceSlotGrid(
  x: number,
  y: number,
  w: number,
  h: number,
  zone: string,
): SlotGridWidget {
  const base = createWidget('slot-grid', x, y) as SlotGridWidget;
  return {
    ...base,
    id: cid(),
    width: w,
    height: h,
    title: '',
    variant: 'compact-row',
    hideTitle: true,
    layout: 'horizontal',
    nameField: 'slot_label',
    statusField: 'status',
    statusColorRules: MAINT_SLOT_STATUS_RULES,
    inactiveColor: 'rgba(98, 116, 142, 0.2)',
    activeColor: 'rgba(255, 255, 255, 0.5)',
    defaultSlotTextColor: '#99A1AF',
    slotWidth: 40,
    slotHeight: h,
    slotGap: 4,
    slotFontSize: 14,
    emptyHintFontSize: 14,
    dataSourceId: DS,
    sqlQuery: maintenanceSlotsSql(zone),
    refreshInterval: 15,
  };
}

/** 整備分布單卡：Figma Card/Occupied status 312×56 */
function maintenanceCategoryCard(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  iconImage: string,
  zone: string,
): ChildWidget[] {
  const padX = 8;
  const padTop = 4;
  const headlineH = 20;
  const slotH = 20;
  const innerGap = 4;
  const slotY = y + padTop + headlineH + innerGap;
  const slotW = w - padX * 2;
  const countW = 24;
  return [
    colorBlock(x, y, w, h, 'rgba(212, 212, 216, 0.1)', 8),
    {
      ...staticText(x + padX, y + padTop, w - padX * 2 - countW, headlineH, label, 16, '#F3F4F6', 'bold', 'left', 1.25, { iconImage }),
      id: cid(),
    },
    boundText(x + w - padX - countW, y + padTop, countW, headlineH, 'total', maintenanceZoneCountSql(zone), 16, '#D1D5DC', 'bold', 'right'),
    maintenanceSlotGrid(x + padX, slotY, slotW, slotH, zone),
  ];
}

/** 整備分布：Figma 2×3 格位卡（628 內容寬） */
function maintenanceDistributionBlock(
  originX: number,
  originY: number,
): ChildWidget[] {
  const rows: Array<{ label: string; iconImage: string; zone: string }> = [
    { label: '充電', iconImage: ICON.facilityCharging, zone: '整備-充電' },
    { label: '洗車', iconImage: ICON.facilityWash, zone: '整備-洗車' },
    { label: '保養', iconImage: ICON.facilityMaintain, zone: '整備-保養' },
    { label: '維修', iconImage: ICON.facilityRepair, zone: '整備-維修' },
    { label: '調度', iconImage: ICON.facilityDispatch, zone: '整備-調度' },
    { label: '臨停', iconImage: ICON.facilityPark, zone: '整備-臨停' },
  ];
  const children: ChildWidget[] = [
    staticText(originX, originY, MAINT_CONTENT_W - 48, MAINT_TITLE_H, '整備分佈', 16, '#F3F4F6', 'bold', 'left', 1.25, { iconImage: ICON.maintenanceDistribution }),
    boundText(originX + MAINT_CONTENT_W - 44, originY + 2, 44, MAINT_TITLE_H, 'header_line', MAINTENANCE_HEADER_LINE_SQL, 14, '#D1D5DC', 'normal', 'right'),
  ];
  const gridY = originY + MAINT_TITLE_H + MAINT_SECTION_GAP;
  rows.forEach((row, idx) => {
    const col = idx % 2;
    const rowIdx = Math.floor(idx / 2);
    const cx = originX + col * (MAINT_CARD_W + MAINT_COL_GAP);
    const cy = gridY + rowIdx * (MAINT_ROW_H + MAINT_ROW_GAP);
    children.push(...maintenanceCategoryCard(cx, cy, MAINT_CARD_W, MAINT_ROW_H, row.label, row.iconImage, row.zone));
  });
  return children;
}

function vehicleDistributionWidget(x: number, y: number, w: number, h: number): SegmentBarWidget {
  const base = createWidget('segment-bar', x, y) as SegmentBarWidget;
  return {
    ...base,
    id: cid(),
    width: w,
    height: h,
    title: '車輛分佈',
    titleIconImage: ICON.vehicleDistribution,
    statusField: 'status_code',
    pctField: 'pct',
    countField: 'vehicle_count',
    countUnit: '輛',
    colorRules: [
      { status: 'IN_SERVICE', label: '營運中', color: '#00D492' },
      { status: 'MAINTENANCE', label: '整備中', color: '#FF8904' },
      { status: 'STANDBY', label: '待命中', color: '#51A2FF' },
    ],
    showLegend: true,
    titleFontSize: VEH_DIST_FS.title,
    legendFontSize: VEH_DIST_FS.legend,
    barTextFontSize: VEH_DIST_FS.bar,
    tagFontSize: VEH_DIST_FS.tag,
    emptyHintFontSize: VEH_DIST_FS.legend,
    dataSourceId: DS,
    sqlQuery: VEHICLE_DISTRIBUTION_SQL,
    refreshInterval: 15,
  };
}

function shiftProgressBar(x: number, y: number, w: number, h: number): ProgressBarWidget {
  const p = createWidget('progress-bar', x, y) as ProgressBarWidget;
  return {
    ...p,
    id: cid(),
    width: w,
    height: h,
    valueField: 'achievement_pct',
    dataSourceId: DS,
    sqlQuery: SHIFT_CENTER_SUMMARY_SQL,
    refreshInterval: 15,
    min: 0,
    max: 100,
    orientation: 'horizontal',
    showValue: false,
    showLabel: false,
    label: '',
    trackColor: 'rgba(212, 212, 212, 0.15)',
    borderRadius: 400,
    colorStops: [{ at: 0, color: '#2B7FFF' }, { at: 1, color: '#2B7FFF' }],
    valueFontSize: FS.aux,
  };
}

function statCard(
  x: number, y: number, w: number, h: number,
  label: string, valueField: string,
  sql: string,
  opts?: {
    valueColor?: string;
    valueFontSize?: number;
    labelFontSize?: number;
    unitFontSize?: number;
    unit?: string;
    unitColor?: string;
    labelColor?: string;
    labelPosition?: import('../types').StatCardLabelPosition;
    contentAlign?: 'left' | 'center' | 'right';
    layoutGap?: number;
    labelUppercase?: boolean;
    valueFontWeight?: import('../types').StatCardWidget['valueFontWeight'];
    compareTargetField?: string;
    tolerancePct?: number;
    inBandColor?: string;
    outOfBandColor?: string;
    hintField?: string;
    hintIcon?: string;
    hintIconImage?: string;
    hintColor?: string;
    hintPosition?: import('../types').StatCardWidget['hintPosition'];
    contentVAlign?: import('../types').StatCardWidget['contentVAlign'];
    hintIconSize?: number;
  },
): StatCardWidget {
  const c = createWidget('stat-card', x, y) as StatCardWidget;
  return {
    ...c,
    id: cid(),
    width: w,
    height: h,
    label,
    valueField,
    dataSourceId: DS,
    sqlQuery: sql,
    refreshInterval: 15,
    valueFontSize: opts?.valueFontSize ?? FS.emphasis,
    labelFontSize: opts?.labelFontSize ?? FS.aux,
    unit: opts?.unit ?? '',
    valueColor: opts?.valueColor ?? '#f1f5f9',
    labelColor: opts?.labelColor ?? '#94a3b8',
    unitColor: opts?.unitColor ?? opts?.valueColor ?? '#64748b',
    unitFontSize: opts?.unitFontSize,
    labelPosition: opts?.labelPosition ?? 'top',
    contentAlign: opts?.contentAlign ?? 'center',
    layoutGap: opts?.layoutGap ?? 4,
    labelUppercase: opts?.labelUppercase,
    valueFontWeight: opts?.valueFontWeight,
    compareTargetField: opts?.compareTargetField,
    tolerancePct: opts?.tolerancePct,
    inBandColor: opts?.inBandColor,
    outOfBandColor: opts?.outOfBandColor,
    hintField: opts?.hintField,
    hintIcon: opts?.hintIconImage ? undefined : opts?.hintIcon,
    hintIconImage: opts?.hintIconImage,
    hintColor: opts?.hintColor,
    hintPosition: opts?.hintPosition,
    contentVAlign: opts?.contentVAlign,
    hintIconSize: opts?.hintIconSize,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 4,
  };
}

/** 事件輪播：預設畫板（雙畫板閘道不成立時顯示；不需另綁 SQL） */
function eventBarDefaultTemplate(tplW: number, tplH: number): ChildWidget[] {
  const empty = createWidget('empty-state', 0, 0) as EmptyStateWidget;
  return [{
    ...empty,
    id: cid(),
    width: tplW,
    height: tplH,
    label: '尚無事件',
    emptyStateVariant: 'minimal-center',
    labelFontSize: FS.aux,
    markFontSize: FS.emphasis,
  }];
}

/** 事件中心 Figma 字級 */
const EVENT_FS = { title: 16, label: 14, value: 16, headline: 18 } as const;

/** 事件條設計稿基準（Card/Event Card 306×84） */
const EVENT_BAR_DESIGN = { W: 306, H: 84, pad: 8, stripW: 46, gap: 10 } as const;

/** 事件輪播群組範本：左色條 + 狀態徽章／時間／標題／副標（皆 SQL 綁定） */
function eventBarTemplate(tplW: number, tplH: number): ChildWidget[] {
  const sx = tplW / EVENT_BAR_DESIGN.W;
  const sy = tplH / EVENT_BAR_DESIGN.H;
  const px = (n: number) => Math.round(n * sx);
  const py = (n: number) => Math.round(n * sy);
  const pad = px(EVENT_BAR_DESIGN.pad);
  const stripW = px(EVENT_BAR_DESIGN.stripW);
  const innerH = tplH - pad * 2;
  const contentX = pad + stripW + px(EVENT_BAR_DESIGN.gap);
  const contentW = tplW - contentX - pad;
  const idx = (field: string) => listSqlRowFieldByIndex(EVENT_CENTER_LIST_SQL, field, LIST_INDEX_VAR);
  const tagW = px(74);
  const rowH = py(24);
  const row1Y = pad;
  const headlineY = pad + rowH + py(2);
  const headlineH = py(24);
  const msgW = px(162);
  const dotW = px(8);

  const statusBadge = createWidget('status-badge', contentX, row1Y) as StatusBadgeWidget;
  return [
    colorBlock(0, 0, tplW, tplH, 'rgba(212, 212, 216, 0.1)', 12),
    {
      ...(createWidget('color-block', pad, pad) as ColorBlockWidget),
      id: cid(),
      width: stripW,
      height: innerH,
      borderRadius: 8,
      backgroundColor: '#FB2C36',
      opacity: 100,
      severityStripColor: true,
      dataSourceId: DS,
      sqlQuery: idx('severity'),
      refreshInterval: 15,
    },
    {
      ...boundText(pad + px(2), pad + py(6), stripW - px(4), py(18), 'category', idx('category'), EVENT_FS.label, '#030712', 'bold', 'center'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1.29,
    },
    {
      ...boundText(pad + px(2), pad + py(26), stripW - px(4), py(18), 'vehicle_code', idx('vehicle_code'), EVENT_FS.label, '#030712', 'bold', 'center'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1.29,
    },
    {
      ...statusBadge,
      id: cid(),
      width: tagW,
      height: rowH,
      dataSourceId: DS,
      sqlQuery: idx('status_label'),
      valueField: 'status_label',
      defaultLabel: '—',
      defaultBgColor: 'transparent',
      defaultTextColor: '#99A1AF',
      showDot: false,
      badgeStyle: 'outline',
      badgeVariant: 'compact',
      borderRadius: 8,
      fontSize: EVENT_FS.label,
      outlineBorderColor: '#99A1AF',
      rules: [],
    },
    {
      ...boundText(contentX + tagW, row1Y, contentW - tagW - dotW - px(4), rowH, 'event_time', idx('event_time'), EVENT_FS.label, '#99A1AF', 'normal', 'right'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1.29,
    },
    {
      ...boundText(tplW - pad - dotW, row1Y + py(8), dotW, dotW, 'dot', listSqlRowUnreadDotByIndex(EVENT_CENTER_LIST_SQL, LIST_INDEX_VAR), 8, '#51A2FF', 'bold', 'center'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1,
    },
    {
      ...boundText(contentX, headlineY, msgW, headlineH, 'message', idx('message'), EVENT_FS.headline, '#F3F4F6', 'bold', 'left'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1.33,
    },
    {
      ...boundText(contentX + msgW + px(4), headlineY + py(3), contentW - msgW - px(4), py(18), 'sub_label', idx('sub_label'), EVENT_FS.label, '#99A1AF', 'normal', 'left'),
      id: cid(),
      textWrap: 'nowrap',
      lineHeight: 1.29,
    },
  ];
}

/** 正線班表 Figma Card 299×196 */
const MAINLINE_CARD_LAYOUT = {
  W: 299,
  H: 196,
  padX: 12,
  headerY: 12,
  headerH: 24,
  contentY: 44,
  midH: 46,
  colGap: 12,
  sectionGap: 4,
  trackY: 94,
  trackH: 72,
  footerY: 166,
  footerH: 30,
} as const;

const MAINLINE_CARD_FS = {
  direction: 14,
  trip: 16,
  vehicle: 14,
  status: 14,
  label: 14,
  value: 16,
  footer: 14,
} as const;

function mainlineShiftCardMetrics(cardW: number, cardH: number) {
  const sx = cardW / MAINLINE_CARD_LAYOUT.W;
  const sy = cardH / MAINLINE_CARD_LAYOUT.H;
  const px = (n: number) => Math.round(n * sx);
  const py = (n: number) => Math.round(n * sy);
  const W = cardW;
  const H = cardH;
  const pad = px(MAINLINE_CARD_LAYOUT.padX);
  const colW = Math.floor((W - px(MAINLINE_CARD_LAYOUT.colGap)) / 2);
  return {
    pad,
    px,
    py,
    W,
    H,
    innerW: W - pad * 2,
    headerY: py(MAINLINE_CARD_LAYOUT.headerY),
    headerH: py(MAINLINE_CARD_LAYOUT.headerH),
    midY: py(MAINLINE_CARD_LAYOUT.contentY),
    midH: py(MAINLINE_CARD_LAYOUT.midH),
    colW,
    colGap: px(MAINLINE_CARD_LAYOUT.colGap),
    trackY: py(MAINLINE_CARD_LAYOUT.trackY),
    trackH: py(MAINLINE_CARD_LAYOUT.trackH),
    footerY: py(MAINLINE_CARD_LAYOUT.footerY),
    footerH: py(MAINLINE_CARD_LAYOUT.footerH),
  };
}

function mainlineShiftCardShell(cardW: number, cardH: number): ColorBlockWidget {
  return {
    ...colorBlock(0, 0, cardW, cardH, '#18181B', 12),
    borderWidth: 1,
    borderColor: '#009966',
    bindBorderColorVar: 'card_border_color',
  };
}

function mainlineDirectionBadge(x: number, y: number, w: number, h: number): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    valueField: '{direction_label}',
    defaultLabel: '—',
    defaultBgColor: '#8E51FF',
    defaultTextColor: '#FFFFFF',
    showDot: false,
    fontSize: MAINLINE_CARD_FS.direction,
    badgeVariant: 'compact',
    borderRadius: 8,
    variableBgKey: 'direction_pill_bg',
    variableColorKey: 'direction_pill_color',
    rules: [],
  };
}

function maintenanceShiftCardShell(cardW: number, cardH: number): ColorBlockWidget {
  return {
    ...colorBlock(0, 0, cardW, cardH, '#18181B', 12),
    borderWidth: 1,
    borderColor: '#FB2C36',
    bindBorderColorVar: 'card_border_color',
  };
}

function maintenanceTypeBadge(x: number, y: number, w: number, h: number): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    valueField: '{maint_type_label}',
    defaultLabel: '充電',
    defaultBgColor: 'transparent',
    defaultTextColor: '#FD9A00',
    showDot: false,
    fontSize: MAINLINE_CARD_FS.trip,
    badgeVariant: 'compact',
    badgeStyle: 'outline',
    outlineBorderColor: '#FD9A00',
    borderRadius: 8,
    variableColorKey: 'maint_type_color',
    rules: [],
  };
}

function maintenanceStatusBadge(x: number, y: number, w: number, h: number): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    valueField: '{status_label}',
    defaultLabel: '—',
    defaultBgColor: 'rgba(255, 100, 103, 0.3)',
    defaultTextColor: '#FF6467',
    showDot: true,
    fontSize: MAINLINE_CARD_FS.status,
    badgeVariant: 'compact',
    borderRadius: 8,
    variableBgKey: 'status_bg',
    variableColorKey: 'status_color',
    rules: [],
  };
}

function maintenanceRouteTrack(x: number, y: number, w: number, h: number): RouteProgressWidget {
  return {
    ...shiftRouteTrack(x, y, w, h),
    id: cid(),
    trackStyle: 'maintenance',
  };
}

function mainlineStatusBadge(x: number, y: number, w: number, h: number): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    valueField: '{status_label}',
    defaultLabel: '—',
    defaultBgColor: 'rgba(0, 212, 146, 0.3)',
    defaultTextColor: '#00BC7D',
    showDot: true,
    fontSize: MAINLINE_CARD_FS.status,
    badgeVariant: 'compact',
    borderRadius: 8,
    variableBgKey: 'status_bg',
    variableColorKey: 'status_color',
    rules: [],
  };
}

function shiftRouteTrack(x: number, y: number, w: number, h: number): RouteProgressWidget {
  const card = createWidget('route-progress', x, y) as RouteProgressWidget;
  return {
    ...card,
    id: cid(),
    width: w,
    height: h,
    variant: 'track',
    stationSource: 'json',
    stationsJsonVarKey: 'route_stations',
    segmentIndexVarKey: 'segment_index',
    segmentRemainPctVarKey: 'segment_remain_pct',
    animateSegmentMovement: true,
    valueField: 'route_progress',
    dataSourceId: DS,
    sqlQuery: '',
    refreshInterval: 0,
    mqttDataSourceId: MQTT,
    mqttTopic: 'v1/vtms/${vehicle_code}/operation/update',
    mqttProgressPath: 'current_leg.eta_seconds',
    stations: [
      { id: 's1', name: '—', value: 0 },
      { id: 's2', name: '—', value: 50 },
      { id: 's3', name: '—', value: 100 },
    ],
    activeColor: '#51A2FF',
    inactiveColor: '#99A1AF',
    vehicleIcon: 'vehicle.svg',
    iconColor: '#030712',
    iconBgColor: '#51A2FF',
    actionIconRules: [
      ...buildCatalogActionRules('operation_action'),
      {
        id: 'alert-flag',
        label: '告警旗標',
        sourceVarKey: 'is_alert',
        matchOp: 'present',
        iconFile: 'alert.png',
        priority: 100,
      },
      {
        id: 'delay',
        label: '延誤分鐘',
        sourceVarKey: 'delay_minutes',
        matchOp: 'gte',
        threshold: 1,
        iconFile: 'dispatch.png',
        priority: 90,
      },
    ],
  };
}

/** 正線班次卡：Figma Card/正線班表 299×196 */
function dispatchCardTemplate(cardW: number, cardH: number): ChildWidget[] {
  const L = mainlineShiftCardMetrics(cardW, cardH);
  const {
    pad, px, py, W, headerY, headerH, midY, colW, colGap,
    trackY, trackH, footerY, footerH,
  } = L;
  const dirW = px(45);
  const statusW = px(59);
  const titleX = pad + dirW + px(6);
  const tripW = px(48);
  const titleGap = px(4);
  const vehicleW = Math.max(px(40), W - pad - statusW - px(6) - titleX - tripW - titleGap);
  const leftColX = 0;
  const rightColX = colW + colGap;
  const colPadX = px(12);
  const colPadY = py(4);
  const iconW = px(20);
  const textX = colPadX + iconW + px(4);

  return [
    mainlineShiftCardShell(cardW, cardH),
    mainlineDirectionBadge(pad, headerY, dirW, headerH),
    {
      ...staticText(titleX, headerY, tripW, headerH, '{trip_code}', MAINLINE_CARD_FS.trip, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    {
      ...staticText(titleX + tripW + titleGap, headerY, vehicleW, headerH, '{vehicle_code}', MAINLINE_CARD_FS.vehicle, '#99A1AF', 'normal', 'left', 1.29),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    mainlineStatusBadge(W - pad - statusW, headerY, statusW, headerH),
    {
      ...staticText(leftColX + colPadX, midY + colPadY, iconW, iconW, '', MAINLINE_CARD_FS.label, '#51A2FF', 'normal', 'left'),
      id: cid(),
      iconImage: ICON.nav,
      fontSize: 16,
      contentPadding: '0',
    },
    staticText(leftColX + textX, midY + colPadY, px(58), py(18), '下一站', MAINLINE_CARD_FS.label, '#99A1AF', 'normal', 'left', 1.29),
    {
      ...staticText(leftColX + textX, midY + colPadY + py(18), px(58), py(20), '{next_station}', MAINLINE_CARD_FS.value, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    {
      ...staticText(rightColX + colPadX, midY + colPadY, iconW, iconW, '', MAINLINE_CARD_FS.label, '#51A2FF', 'normal', 'left'),
      id: cid(),
      iconImage: ICON.clock,
      fontSize: 16,
      contentPadding: '0',
    },
    staticText(rightColX + textX, midY + colPadY, px(72), py(18), '剩餘到站', MAINLINE_CARD_FS.label, '#99A1AF', 'normal', 'left', 1.29),
    {
      ...staticText(rightColX + textX, midY + colPadY + py(18), px(72), py(20), '{eta_remain}', MAINLINE_CARD_FS.value, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    shiftRouteTrack(0, trackY, W, trackH),
    {
      ...colorBlock(0, footerY, W, footerH, 'rgba(212, 212, 216, 0.1)', 0),
      id: cid(),
      borderWidth: 0,
    },
    {
      ...staticText(px(6), footerY + py(6), Math.floor(W / 2), footerH - py(12), '發車 {depart_time}', MAINLINE_CARD_FS.footer, '#F3F4F6', 'normal', 'left', 1.29),
      id: cid(),
      iconImage: ICON.clock,
      fontSize: 12,
      textWrap: 'nowrap',
      contentPadding: '0 2px',
    },
    {
      ...staticText(Math.floor(W / 2), footerY + py(6), Math.floor(W / 2), footerH - py(12), '結束 {end_time}', MAINLINE_CARD_FS.footer, '#F3F4F6', 'normal', 'right', 1.29),
      id: cid(),
      iconImage: ICON.clock,
      fontSize: 12,
      textWrap: 'nowrap',
      contentPadding: '0 2px',
    },
  ];
}

/** 整備班表卡：Figma Card/整備班表 299×196 */
function maintenanceCardTemplate(cardW: number, cardH: number): ChildWidget[] {
  const L = mainlineShiftCardMetrics(cardW, cardH);
  const {
    pad, px, py, W, headerY, headerH, midY, colW, colGap,
    trackY, trackH, footerY, footerH,
  } = L;
  const typeW = px(48);
  const statusW = px(73);
  const titleX = pad + typeW + px(6);
  const vehicleW = px(58);
  const titleGap = px(4);
  const tripW = Math.max(px(40), W - pad - statusW - px(6) - titleX - vehicleW - titleGap);
  const leftColX = 0;
  const rightColX = colW + colGap;
  const colPadX = px(12);
  const colPadY = py(4);
  const iconW = px(20);
  const textX = colPadX + iconW + px(4);

  return [
    maintenanceShiftCardShell(cardW, cardH),
    maintenanceTypeBadge(pad, headerY, typeW, headerH),
    {
      ...staticText(titleX, headerY, vehicleW, headerH, '{vehicle_code}', MAINLINE_CARD_FS.trip, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    {
      ...staticText(titleX + vehicleW + titleGap, headerY, tripW, headerH, '{trip_code}', MAINLINE_CARD_FS.vehicle, '#99A1AF', 'normal', 'left', 1.29),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    maintenanceStatusBadge(W - pad - statusW, headerY, statusW, headerH),
    {
      ...staticText(leftColX + colPadX, midY + colPadY, iconW, iconW, '', MAINLINE_CARD_FS.label, '#51A2FF', 'normal', 'left'),
      id: cid(),
      iconImage: ICON.position,
      fontSize: 16,
      contentPadding: '0',
    },
    staticText(leftColX + textX, midY + colPadY, px(58), py(18), '整備站點', MAINLINE_CARD_FS.label, '#99A1AF', 'normal', 'left', 1.29),
    {
      ...staticText(leftColX + textX, midY + colPadY + py(18), px(58), py(20), '{next_station}', MAINLINE_CARD_FS.value, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
    },
    {
      ...staticText(rightColX + colPadX, midY + colPadY, iconW, iconW, '', MAINLINE_CARD_FS.label, '#51A2FF', 'normal', 'left'),
      id: cid(),
      iconImage: ICON.alert,
      fontSize: 16,
      contentPadding: '0',
    },
    staticText(rightColX + textX, midY + colPadY, px(72), py(18), '{eta_label}', MAINLINE_CARD_FS.label, '#99A1AF', 'normal', 'left', 1.29),
    {
      ...staticText(rightColX + textX, midY + colPadY + py(18), px(72), py(20), '{eta_remain}', MAINLINE_CARD_FS.value, '#F3F4F6', 'normal', 'left', 1.25),
      id: cid(),
      textWrap: 'nowrap',
      contentPadding: '0',
      colorRulesEnabled: true,
      colorOnlyField: 'eta_label',
      colorRules: [
        {
          condition: 'status_eq',
          threshold: '逾時滯留',
          textColor: '#FB2C36',
          bgColor: 'transparent',
          borderColor: 'transparent',
        },
      ],
    },
    maintenanceRouteTrack(0, trackY, W, trackH),
    {
      ...colorBlock(0, footerY, W, footerH, 'rgba(212, 212, 216, 0.1)', 0),
      id: cid(),
      borderWidth: 0,
    },
    {
      ...staticText(px(6), footerY + py(6), Math.floor(W / 2), footerH - py(12), '發車 {depart_time}', MAINLINE_CARD_FS.footer, '#F3F4F6', 'normal', 'left', 1.29),
      id: cid(),
      iconImage: ICON.clock,
      fontSize: 12,
      textWrap: 'nowrap',
      contentPadding: '0 2px',
    },
    {
      ...staticText(Math.floor(W / 2), footerY + py(6), Math.floor(W / 2), footerH - py(12), '結束 {end_time}', MAINLINE_CARD_FS.footer, '#F3F4F6', 'normal', 'right', 1.29),
      id: cid(),
      iconImage: ICON.clock,
      fontSize: 12,
      textWrap: 'nowrap',
      contentPadding: '0 2px',
    },
  ];
}

const VSC_TYPE = {
  titleFs: 18,
  badgeFs: 16,
  pillFs: 16,
  tabFs: 14,
  gaugeValueFs: 18,
  gaugeUnitFs: 14,
} as const;

/** 車輛狀態卡 Figma 基準（Card/載具監控 306×192） */
const VS_DESIGN = {
  slotW: 306,
  slotH: 192,
  pad: 12,
  padBottom: 8,
  titleH: 24,
  sectionGap: 8,
  gaugeH: 90,
  gaugeGap: 6,
  gaugeToPill: 6,
  pillH: 24,
  pillGap: 6,
  locationH: 20,
  badgeW: 65,
  badgeH: 24,
  locationTabW: 90,
  titleIcon: 20,
} as const;

/** 車輛狀態卡：依 Figma 比例排版 */
function vehicleStatusLayoutMetrics(slotW: number, slotH: number) {
  const sx = slotW / VS_DESIGN.slotW;
  const sy = slotH / VS_DESIGN.slotH;

  const pad = Math.max(8, Math.round(VS_DESIGN.pad * sx));
  const innerW = slotW - pad * 2;
  const titleY = pad;
  const titleH = Math.max(20, Math.round(VS_DESIGN.titleH * sy));
  const badgeW = Math.max(52, Math.round(VS_DESIGN.badgeW * sx));
  const badgeH = Math.max(20, Math.round(VS_DESIGN.badgeH * sy));
  const titleW = Math.max(80, innerW - badgeW - Math.round(VS_DESIGN.titleIcon * sx) - Math.round(6 * sx));
  const gaugeY = titleY + titleH + Math.max(6, Math.round(VS_DESIGN.sectionGap * sy));
  const gaugeH = Math.max(72, Math.round(VS_DESIGN.gaugeH * sy));
  const gaugeGap = Math.max(4, Math.round(VS_DESIGN.gaugeGap * sx));
  const gaugeW = Math.max(40, Math.floor((innerW - gaugeGap) / 2));
  const pillH = Math.max(20, Math.round(VS_DESIGN.pillH * sy));
  const pillGap = Math.max(4, Math.round(VS_DESIGN.pillGap * sx));
  const pillW = Math.max(24, Math.floor((innerW - pillGap * 3) / 4));
  const pillY = gaugeY + gaugeH + Math.max(4, Math.round(VS_DESIGN.gaugeToPill * sy));
  const tabH = Math.max(18, Math.round(VS_DESIGN.locationH * sy));
  const tabTop = slotH - tabH;
  const tabW = Math.max(72, Math.round(VS_DESIGN.locationTabW * sx));
  const tabX = Math.floor((slotW - tabW) / 2);
  const alertH = Math.min(Math.max(20, Math.round(22 * sy)), gaugeH);

  return {
    W: slotW,
    pad,
    innerW,
    titleY,
    titleH,
    titleW,
    badgeW,
    badgeH,
    badgeY: titleY,
    gaugeGap,
    gaugeW,
    gaugeY,
    gaugeH,
    alertY: gaugeY,
    alertH,
    pillY,
    pillH,
    pillGap,
    pillW,
    tabTop,
    tabH,
    bodyH: slotH,
    tabW,
    tabX,
  };
}

function vehicleStatusGauge(
  x: number,
  y: number,
  w: number,
  h: number,
  valueField: string,
  unit: string,
  min: number,
  max: number,
  arcVariant: 'speed' | 'load',
  mqttValuePath: string,
): GaugeWidget {
  const g = createWidget('gauge', x, y) as GaugeWidget;
  return {
    ...g,
    id: cid(),
    width: w,
    height: h,
    title: '',
    valueField,
    unit,
    min,
    max,
    gaugeVariant: 'semi-arc',
    arcVariant,
    colorStops: [],
    gaugeValueFontSize: VSC_TYPE.gaugeValueFs,
    gaugeUnitFontSize: VSC_TYPE.gaugeUnitFs,
    panelBackgroundColor: 'rgba(212, 212, 216, 0.1)',
    panelBorderRadius: 8,
    mqttDataSourceId: MQTT,
    mqttTopic: 'v1/vtms/${vehicle_code}/telemetry/update',
    mqttValuePath,
    refreshInterval: 0,
  };
}

function vehicleStatusTripBadge(x: number, y: number, w: number, h: number): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    valueField: '{badge_label}',
    defaultLabel: '',
    defaultBgColor: '#8E51FF',
    defaultTextColor: '#FFFFFF',
    showDot: false,
    fontSize: VSC_TYPE.badgeFs,
    borderRadius: 8,
    variableBgKey: 'trip_badge_bg',
    variableColorKey: 'trip_badge_color',
    outlineFromVarKey: 'badge_outline',
    mqttDataSourceId: MQTT,
    mqttTopic: 'v1/vtms/${vehicle_code}/operation/update',
    rules: VEHICLE_BADGE_RULES,
  };
}

function vehicleStatusPill(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  statusVar: string,
): TextWidget {
  const t = staticText(x, y, w, h, label, VSC_TYPE.pillFs, '#00BC7D', 'normal', 'center');
  return {
    ...t,
    id: cid(),
    colorOnlyField: statusVar,
    colorRulesEnabled: true,
    colorRules: SUBSYSTEM_PILL_RULES,
    backgroundColor: 'rgba(0, 212, 146, 0.2)',
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 8,
    lineHeight: 1.25,
    textWrap: 'nowrap',
    contentPadding: '2px 12px',
    mqttDataSourceId: MQTT,
    mqttTopic: HEALTH_TOPIC,
  };
}

function vehicleStatusAlertBanner(x: number, y: number, w: number, h: number): AlertBannerWidget {
  const b = createWidget('alert-banner', x, y) as AlertBannerWidget;
  return {
    ...b,
    id: cid(),
    width: w,
    height: h,
    triggerConditions: vehicleStatusAlertDemoRules(),
    fontSize: FS.aux,
    iconImage: ICON.alert,
    textWrap: 'nowrap',
    contentPadding: '2px 5px',
    content: '警示規則預覽（輪播）',
    alertPresentation: 'carousel',
    carouselIntervalMs: 3200,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
    mqttDataSourceId: MQTT,
    mqttTopic: HEALTH_TOPIC,
  };
}

/** 車輛狀態群組範本（Figma Card/載具監控 306×192） */
function vehicleStatusCardTemplate(slotW: number, slotH: number): ChildWidget[] {
  const L = vehicleStatusLayoutMetrics(slotW, slotH);

  const title = staticText(
    L.pad,
    L.titleY,
    L.titleW,
    L.titleH,
    '{vehicle_code}',
    VSC_TYPE.titleFs,
    '#F3F4F6',
    'normal',
    'left',
    1.33,
  );

  const children: ChildWidget[] = [
    {
      ...colorBlock(0, 0, L.W, L.bodyH, '#18181B', 12),
      borderWidth: 1,
      borderColor: '#00BC7D',
      bindBorderColorVar: 'card_border_color',
      bindBorderFromHealthField: true,
      healthFieldForBorder: 'overall_health',
      mqttDataSourceId: MQTT,
      mqttTopic: HEALTH_TOPIC,
    },
    {
      ...colorBlock(0, 0, L.W, L.tabTop, 'rgba(212, 212, 216, 0.1)', 0),
      borderWidth: 0,
      opacity: 100,
    },
    { ...title, id: cid(), iconImage: ICON.vehicleState, iconGap: 6 },
    vehicleStatusTripBadge(L.W - L.pad - L.badgeW, L.badgeY, L.badgeW, L.badgeH),
    vehicleStatusGauge(L.pad, L.gaugeY, L.gaugeW, L.gaugeH, 'demo_speed', 'km/h', 0, 40, 'speed', 'kinematics.velocity'),
    vehicleStatusGauge(L.pad + L.gaugeW + L.gaugeGap, L.gaugeY, L.gaugeW, L.gaugeH, 'demo_load', '%', 0, 100, 'load', 'energy.battery_level'),
    vehicleStatusAlertBanner(L.pad, L.alertY, L.innerW, L.alertH),
  ];

  const pillDefs: [string, string][] = [
    ['運算', 'status_computing'],
    ['感測', 'status_sensing'],
    ['通訊', 'status_communication'],
    ['線控', 'status_chassis'],
  ];
  pillDefs.forEach(([label, statusVar], i) => {
    children.push(vehicleStatusPill(L.pad + i * (L.pillW + L.pillGap), L.pillY, L.pillW, L.pillH, label, statusVar));
  });

  children.push(
    {
      ...colorBlock(L.tabX, L.tabTop, L.tabW, L.tabH, 'rgba(212, 212, 216, 0.1)', 0),
      borderWidth: 0,
      opacity: 100,
    },
    {
      ...staticText(L.pad, L.tabTop, L.innerW, L.tabH, '{segment_label}', VSC_TYPE.tabFs, '#D1D5DC', 'normal', 'center', 1.29),
      id: cid(),
      iconImage: ICON.position,
      fontSize: 12,
      textWrap: 'nowrap',
      contentPadding: '0 10px 2px 6px',
      lineHeight: 1.29,
      mqttDataSourceId: MQTT,
      mqttTopic: 'v1/vtms/${vehicle_code}/operation/update',
      mqttValuePath: 'current_leg.target_station_id',
    },
  );

  return children;
}

// ── 3840×1080 格線 ──
const PLANE_W = 3840;
const PLANE_H = 1080;
const M = 32;
const G = 20;

/** 設計稿：事件中心／班次中心 Card 330×196 */
const PANEL_W = 330;
const PANEL_H = 198;
const EVENT_PANEL_H = 196;
const SHIFT_PANEL_H = 196;
const SHIFT_PAD = 12;
const SHIFT_TITLE_H = 24;
const SHIFT_SECTION_GAP = 6;
const SHIFT_KPI_ROW_H = 54;
const SHIFT_KPI_GAP = 12;
const SHIFT_KPI_W = 94;
const SHIFT_CARD_GAP = 4;
const SHIFT_FOOTER_H = 84;
const SHIFT_INNER_W = PANEL_W - SHIFT_PAD * 2;
const SHIFT_FOOTER_Y = SHIFT_PAD + SHIFT_TITLE_H + SHIFT_SECTION_GAP + SHIFT_KPI_ROW_H + SHIFT_CARD_GAP;
const SHIFT_FOOTER_PAD = { x: 12, y: 8 };
const SHIFT_FS = { title: 16, label: 14, value: 16, achievement: 16, unit: 12, note: 14 } as const;
const EVENT_PAD = 12;
const EVENT_TITLE_H = 24;
const EVENT_SECTION_GAP = 6;
const EVENT_KPI_ROW_H = 54;
const EVENT_KPI_GAP = 12;
const EVENT_KPI_W = 94;
const EVENT_CARD_GAP = 4;
const EVENT_KPI_BLOCK_H = EVENT_PAD + EVENT_TITLE_H + EVENT_SECTION_GAP + EVENT_KPI_ROW_H;
const EVENT_SCROLL_Y_OFFSET = EVENT_KPI_BLOCK_H + EVENT_CARD_GAP;
const EVENT_SCROLL_H = EVENT_PANEL_H - EVENT_SCROLL_Y_OFFSET - EVENT_PAD;
const EVENT_INSET = EVENT_PAD;
const EVENT_TPL_W = PANEL_W - EVENT_INSET * 2;
const EVENT_TPL_H = 84;

const LEFT_X = M;
const EVENT_X = LEFT_X;
const SHIFT_X = LEFT_X + PANEL_W + G;
const LEFT_W = PANEL_W * 2 + G;
const TOP_ROW_Y = M;
const BOT_Y = TOP_ROW_Y + PANEL_H + G;
const EVENT_SCROLL_Y = TOP_ROW_Y + EVENT_SCROLL_Y_OFFSET;

/** 右欄 */
const RIGHT_X = LEFT_X + LEFT_W + G;
const RIGHT_W = PLANE_W - RIGHT_X - M;
const TOP_RIGHT_H = PANEL_H;

/** 底列：車輛狀態（全寬，11 台；Figma 單卡 306×192） */
const VEHICLE_STATUS_ROW_H = 192;
const VEHICLE_STATUS_ROW_Y = PLANE_H - M - VEHICLE_STATUS_ROW_H;
const VEHICLE_STATUS_ROW_W = RIGHT_X + RIGHT_W - LEFT_X;
const VEHICLE_STATUS_GAP = 12;
const VEHICLE_STATUS_ROW_PAD = 12;
const VEHICLE_STATUS_SLOT_COLS = 11;
/** 子畫布垂直貼滿群組高度；僅左右留白 */
const VEHICLE_STATUS_SLOT_H = VEHICLE_STATUS_ROW_H;
const VEHICLE_STATUS_INNER_W = VEHICLE_STATUS_ROW_W - VEHICLE_STATUS_ROW_PAD * 2;
/** 11 格固定槽寬；子畫布編輯邊界 = 單槽尺寸 */
const VEHICLE_STATUS_SLOT_W = Math.floor(
  (VEHICLE_STATUS_INNER_W - VEHICLE_STATUS_GAP * (VEHICLE_STATUS_SLOT_COLS - 1)) / VEHICLE_STATUS_SLOT_COLS,
);

const LEFT_STACK_GAP = G;
/** Figma Card 652×298；圖表區 628×190、KPI 列 628×60 */
const TREND_PANEL_H = 298;
/** Figma Card 652×227；內容 628×177（3×56 列 + 間距） */
const MAINT_PANEL_H = 227;
const MAINT_H = MAINT_PANEL_H;
/** Figma Card 652×91；內容 628×71（標題 24 + 間距 6 + 條列區 45） */
const VEH_DIST_PANEL_H = 91;
const TREND_Y = BOT_Y;
const MAINT_Y = TREND_Y + TREND_PANEL_H + LEFT_STACK_GAP;
const VEH_Y = MAINT_Y + MAINT_H + LEFT_STACK_GAP;

/** 運能趨勢 Figma：padding 12/12/8、內容寬 628、KPI 四欄各 148 */
const TREND_PAD = { top: 12, x: 12, bottom: 8 };
const TREND_TITLE_H = 24;
const TREND_SECTION_GAP = 6;
const TREND_KPI_ROW_H = 60;
const TREND_KPI_GAP = 12;
const TREND_CONTENT_W = 628;
const TREND_KPI_W = 148;
const TREND_CHART_H = TREND_PANEL_H - (TREND_PAD.top + TREND_TITLE_H + TREND_SECTION_GAP + TREND_KPI_ROW_H) - TREND_PAD.bottom;
const TREND_FS = { title: 16, label: 14, value: 18 } as const;

/** 整備分布 Figma：padding 12/12/8、內容 628、卡片 312×56 */
const MAINT_PAD = { top: 12, x: 12, bottom: 8 };
const MAINT_TITLE_H = 24;
const MAINT_SECTION_GAP = 6;
const MAINT_CONTENT_W = 628;
const MAINT_ROW_H = 56;
const MAINT_ROW_GAP = 4;
const MAINT_COL_GAP = 4;
const MAINT_CARD_W = 312;

/** 車輛分佈 Figma：padding 12/12/8、內容 628、條列區 45 */
const VEH_DIST_PAD = { top: 12, x: 12, bottom: 8 };
const VEH_DIST_CONTENT_W = 628;
const VEH_DIST_FS = { title: 16, legend: 14, bar: 14, tag: 14 } as const;

/** 圖台：填滿車輛分佈左緣至狀態列上方 */
const MAP_H = VEHICLE_STATUS_ROW_Y - G - BOT_Y;
/** 圖台內載具容器（軌道中央偏右） */
const MAP_VEHICLE_X = 1180;
const MAP_VEHICLE_Y = 228;
const MAP_VEHICLE_SIZE = computeVehicleContainerDisplaySize(
  migrateVehicleDefinition(createUserRestoredVtmsVehicle()),
);

/** 正線班表 Figma 設計基準 */
export const SHIFT_CARD_DESIGN_W = 299;
export const SHIFT_CARD_DESIGN_H = 196;
/** @deprecated 請改用 SHIFT_CARD_DESIGN_* */
export const DISPATCH_CARD_DESIGN_W = SHIFT_CARD_DESIGN_W;
export const DISPATCH_CARD_DESIGN_H = SHIFT_CARD_DESIGN_H;
const MAINLINE_CARD_H = 196;
const MAINT_CARD_H = 196;

/** 上排班次群組：正線 6 格 + 整備 4 格，填滿右欄寬度 */
const TOP_SHIFT_GAP = 10;
const TOP_SHIFT_PAD = 10;
const MAINLINE_SLOT_COUNT = 6;
const MAINT_SLOT_COUNT = 4;
const TOP_SHIFT_ROW_W = RIGHT_W;
const MAINLINE_GROUP_W = Math.floor(
  (TOP_SHIFT_ROW_W - G) * MAINLINE_SLOT_COUNT / (MAINLINE_SLOT_COUNT + MAINT_SLOT_COUNT),
);
const MAINT_GROUP_W = TOP_SHIFT_ROW_W - MAINLINE_GROUP_W - G;
const MAINLINE_X = RIGHT_X;
const MAINT_X = MAINLINE_X + MAINLINE_GROUP_W + G;

function slotTemplateW(groupW: number, slotCount: number): number {
  return Math.max(
    1,
    Math.floor((groupW - TOP_SHIFT_PAD * 2 - (slotCount - 1) * TOP_SHIFT_GAP) / slotCount),
  );
}

const MAINLINE_SLOT_TEMPLATE_W = slotTemplateW(MAINLINE_GROUP_W, MAINLINE_SLOT_COUNT);
const MAINT_SLOT_TEMPLATE_W = slotTemplateW(MAINT_GROUP_W, MAINT_SLOT_COUNT);

const elements: CanvasElementProps[] = [
  {
    id: cid(), type: 'canvas', x: EVENT_X, y: TOP_ROW_Y, width: PANEL_W, height: EVENT_PANEL_H,
    label: '事件中心', backgroundColor: '#18181B', backgroundImage: '', opacity: 100, children: [],
  },
  {
    id: cid(), type: 'canvas', x: EVENT_X, y: EVENT_SCROLL_Y, width: PANEL_W, height: EVENT_SCROLL_H,
    label: '事件輪播',
    backgroundColor: 'transparent', backgroundImage: '', opacity: 100, children: [],
    isGroup: true,
    groupRepeatMode: 'scroll',
    groupScrollInterval: 4,
    slotKeyField: 'event_id',
    dataSourceId: DS,
    sqlQuery: EVENT_CENTER_LIST_SQL,
    refreshInterval: 15,
    variableName: LIST_INDEX_VAR,
    groupVariableMode: 'index',
    groupTileFit: 'fixed',
    groupTileAlign: 'center',
    templateWidth: EVENT_TPL_W,
    templateHeight: EVENT_TPL_H,
    dualCanvasEnabled: true,
    defaultPanelEnabled: true,
    displayGate: { signal: 'rowCount', operator: 'gte', compareValue: '1' },
    childrenDefault: eventBarDefaultTemplate(EVENT_TPL_W, EVENT_TPL_H),
    childrenNormal: eventBarTemplate(EVENT_TPL_W, EVENT_TPL_H),
  },
  {
    id: cid(), type: 'canvas', x: SHIFT_X, y: TOP_ROW_Y, width: PANEL_W, height: SHIFT_PANEL_H,
    label: '班次中心', backgroundColor: '#18181B', backgroundImage: '', opacity: 100, children: [],
  },
  {
    id: cid(), type: 'canvas', x: MAINLINE_X, y: TOP_ROW_Y, width: MAINLINE_GROUP_W, height: TOP_RIGHT_H,
    label: '正線班次',
    backgroundColor: '#111827', backgroundImage: '', opacity: 100, children: [],
    isGroup: true,
    groupRepeatMode: 'slots',
    slotCount: MAINLINE_SLOT_COUNT,
    slotKeyField: 'shift_key',
    groupSlotAssignment: 'sticky-pool',
    groupTransition: 'flip',
    layoutMode: 'grid',
    gridColumns: MAINLINE_SLOT_COUNT,
    groupTileFit: 'slot',
    groupTileAlign: 'start',
    groupTilePadding: TOP_SHIFT_PAD,
    groupTilePadY: 1,
    templateHideChrome: true,
    gapX: TOP_SHIFT_GAP,
    templateWidth: MAINLINE_SLOT_TEMPLATE_W,
    templateHeight: MAINLINE_CARD_H,
    dataSourceId: DS,
    sqlQuery: MAINLINE_SHIFTS_SQL,
    refreshInterval: 2,
    variableName: 'row',
    iteratorField: 'shift_key',
  },
  {
    id: cid(), type: 'canvas', x: MAINT_X, y: TOP_ROW_Y, width: MAINT_GROUP_W, height: TOP_RIGHT_H,
    label: '整備班表',
    backgroundColor: '#111827', backgroundImage: '', opacity: 100, children: [],
    isGroup: true,
    groupRepeatMode: 'slots',
    slotCount: MAINT_SLOT_COUNT,
    slotKeyField: 'shift_key',
    groupSlotAssignment: 'sticky-pool',
    groupTransition: 'flip',
    layoutMode: 'grid',
    gridColumns: MAINT_SLOT_COUNT,
    groupTileFit: 'slot',
    groupTileAlign: 'start',
    groupTilePadding: TOP_SHIFT_PAD,
    groupTilePadY: 1,
    templateHideChrome: true,
    gapX: TOP_SHIFT_GAP,
    templateWidth: MAINT_SLOT_TEMPLATE_W,
    templateHeight: MAINT_CARD_H,
    dataSourceId: DS,
    sqlQuery: MAINTENANCE_SHIFTS_SQL,
    refreshInterval: 2,
    variableName: 'row',
    iteratorField: 'shift_key',
  },
  {
    id: cid(), type: 'canvas', x: LEFT_X, y: TREND_Y, width: LEFT_W, height: TREND_PANEL_H,
    label: '運能趨勢', backgroundColor: '#18181B', backgroundImage: '', opacity: 100, children: [],
  },
  {
    id: cid(), type: 'canvas', x: LEFT_X, y: MAINT_Y, width: LEFT_W, height: MAINT_PANEL_H,
    label: '整備分佈', backgroundColor: '#18181B', backgroundImage: '', opacity: 100, children: [],
  },
  {
    id: cid(), type: 'canvas', x: LEFT_X, y: VEH_Y, width: LEFT_W, height: VEH_DIST_PANEL_H,
    label: '車輛分佈', backgroundColor: '#18181B', backgroundImage: '', opacity: 100, children: [],
  },
  {
    id: cid(), type: 'canvas', x: RIGHT_X, y: BOT_Y, width: RIGHT_W, height: MAP_H,
    label: '即時圖台',
    backgroundColor: '#020617', backgroundImage: '', opacity: 100,
    canvasKind: 'map-platform', mapId: 't3-main-version', zoomFactor: 1.15,
    useDefaultVehicleDefinition: true,
    vehicleDefinitionName: 'VTMS 巴士 · PMS-01',
    children: [],
  },
  {
    id: cid(), type: 'canvas', x: LEFT_X, y: VEHICLE_STATUS_ROW_Y, width: VEHICLE_STATUS_ROW_W, height: VEHICLE_STATUS_ROW_H,
    label: '車輛狀態', backgroundColor: '#09090b', backgroundImage: '', opacity: 100, children: [],
    isGroup: true,
    groupRepeatMode: 'tile',
    dataSourceId: DS,
    sqlQuery: VEHICLE_STATUS_ROW_SQL,
    refreshInterval: 60,
    variableName: 'row',
    iteratorField: 'vehicle_code',
    layoutMode: 'grid',
    gridColumns: 11,
    gapX: VEHICLE_STATUS_GAP,
    gapY: 0,
    groupTileFit: 'slot',
    groupTileAlign: 'start',
    groupTilePadding: VEHICLE_STATUS_ROW_PAD,
    groupTilePadX: VEHICLE_STATUS_ROW_PAD,
    groupTilePadY: 0,
    templateHideChrome: true,
    templateWidth: VEHICLE_STATUS_SLOT_W,
    templateHeight: VEHICLE_STATUS_SLOT_H,
  },
];

const eventKpiY = EVENT_PAD + EVENT_TITLE_H + EVENT_SECTION_GAP;

// 事件中心：標題 + KPI（列表區由「事件輪播」雙畫板群組負責）
elements[0].children = [
  staticText(EVENT_PAD, EVENT_PAD, 274, EVENT_TITLE_H, '事件中心', EVENT_FS.title, '#F3F4F6', 'bold', 'left', 1.25, { iconImage: ICON.eventCenter }),
  statCard(EVENT_PAD, eventKpiY, EVENT_KPI_W, EVENT_KPI_ROW_H, '今日總事件', 'total_events', EVENT_CENTER_SUMMARY_SQL, {
    valueFontSize: EVENT_FS.value,
    labelFontSize: EVENT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
  statCard(EVENT_PAD + EVENT_KPI_W + EVENT_KPI_GAP, eventKpiY, EVENT_KPI_W, EVENT_KPI_ROW_H, '未處理事件', 'unprocessed_events', EVENT_CENTER_SUMMARY_SQL, {
    valueFontSize: EVENT_FS.value,
    labelFontSize: EVENT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
  statCard(EVENT_PAD + (EVENT_KPI_W + EVENT_KPI_GAP) * 2, eventKpiY, EVENT_KPI_W, EVENT_KPI_ROW_H, '已處理事件', 'processed_events', EVENT_CENTER_SUMMARY_SQL, {
    valueFontSize: EVENT_FS.value,
    labelFontSize: EVENT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
];

// 事件輪播群組：雙畫板（預設／常態）；執行時 children 與 childrenNormal 同步
const eventScrollNormal = eventBarTemplate(EVENT_TPL_W, EVENT_TPL_H);
elements[1].children = eventScrollNormal;
elements[1].childrenNormal = eventScrollNormal;
elements[1].childrenDefault = eventBarDefaultTemplate(EVENT_TPL_W, EVENT_TPL_H);

// 班次中心：Figma Card 330×196 — 標題 + KPI + 達成卡（進度條）
const shiftKpiY = SHIFT_PAD + SHIFT_TITLE_H + SHIFT_SECTION_GAP;
const shiftCardX = SHIFT_PAD;
const shiftCardInnerX = shiftCardX + SHIFT_FOOTER_PAD.x;
const shiftCardInnerW = SHIFT_INNER_W - SHIFT_FOOTER_PAD.x * 2;
const shiftRow1Y = SHIFT_FOOTER_Y + SHIFT_FOOTER_PAD.y;
const shiftRow2Y = shiftRow1Y + 20 + 6;
const shiftNoteW = 168;
elements[2].children = [
  staticText(SHIFT_PAD, SHIFT_PAD, 254, SHIFT_TITLE_H, '班次中心', SHIFT_FS.title, '#F3F4F6', 'bold', 'left', 1.25, { iconImage: ICON.shiftCenter }),
  statCard(SHIFT_PAD, shiftKpiY, SHIFT_KPI_W, SHIFT_KPI_ROW_H, '總共班次', 'total_shifts', SHIFT_CENTER_SUMMARY_SQL, {
    valueFontSize: SHIFT_FS.value,
    labelFontSize: SHIFT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
  statCard(SHIFT_PAD + SHIFT_KPI_W + SHIFT_KPI_GAP, shiftKpiY, SHIFT_KPI_W, SHIFT_KPI_ROW_H, '完成班次', 'completed_shifts', SHIFT_CENTER_SUMMARY_SQL, {
    valueFontSize: SHIFT_FS.value,
    labelFontSize: SHIFT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
  statCard(SHIFT_PAD + (SHIFT_KPI_W + SHIFT_KPI_GAP) * 2, shiftKpiY, SHIFT_KPI_W, SHIFT_KPI_ROW_H, '延誤班次', 'delayed_shifts', SHIFT_CENTER_SUMMARY_SQL, {
    valueFontSize: SHIFT_FS.value,
    labelFontSize: SHIFT_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    contentAlign: 'left',
    labelPosition: 'top',
    labelUppercase: false,
    layoutGap: 2,
  }),
  colorBlock(shiftCardX, SHIFT_FOOTER_Y, SHIFT_INNER_W, SHIFT_FOOTER_H, 'rgba(212, 212, 216, 0.1)', 12),
  boundText(shiftCardInnerX, shiftRow1Y, 112, 20, 'achievement_line', SHIFT_CENTER_SUMMARY_SQL, SHIFT_FS.achievement, '#51A2FF', 'bold', 'left', {
    contentPadding: '0',
    textWrap: 'nowrap',
  }),
  boundText(shiftCardInnerX + shiftCardInnerW - shiftNoteW, shiftRow1Y, shiftNoteW, 18, 'remaining_line', SHIFT_CENTER_SUMMARY_SQL, SHIFT_FS.note, '#D1D5DC', 'bold', 'right', {
    iconImage: ICON.metricsList,
    contentPadding: '0',
    textWrap: 'nowrap',
  }),
  shiftProgressBar(shiftCardInnerX, shiftRow2Y, shiftCardInnerW, 24),
];

// 運能趨勢畫布：Figma 標題 y=12、KPI y=42、圖表 y=102 h=188
const trendKpiY = TREND_PAD.top + TREND_TITLE_H + TREND_SECTION_GAP;
const trendAvailColX = TREND_PAD.x + (TREND_KPI_W + TREND_KPI_GAP) * 2;
const trendNextColX = TREND_PAD.x + (TREND_KPI_W + TREND_KPI_GAP) * 3;
/** 數值列右側提示（icon+文字），不覆蓋左側 KPI 數字 */
const TREND_KPI_COL_PAD = 12;
const TREND_KPI_HINT_W = 98;
const TREND_KPI_HINT_H = 24;
const trendKpiHintY = trendKpiY + 28;
const trendKpiHintX = (colX: number) => colX + TREND_KPI_W - TREND_KPI_COL_PAD - TREND_KPI_HINT_W;
const trendChartY = trendKpiY + TREND_KPI_ROW_H;
const line = createWidget('line-chart', TREND_PAD.x, trendChartY) as LineChartWidget;
elements[3].children = dispatchCardTemplate(MAINLINE_SLOT_TEMPLATE_W, MAINLINE_CARD_H);

elements[4].children = maintenanceCardTemplate(MAINT_SLOT_TEMPLATE_W, MAINT_CARD_H);

// 運能趨勢
elements[5].children = [
  staticText(TREND_PAD.x, TREND_PAD.top, TREND_CONTENT_W, TREND_TITLE_H, '運能趨勢', TREND_FS.title, '#F3F4F6', 'bold', 'left', 1.25, { iconImage: ICON.capacityTrend }),
  {
    ...statCard(TREND_PAD.x, trendKpiY, TREND_KPI_W, TREND_KPI_ROW_H, '即時數值', 'live_val', CAPACITY_TREND_SUMMARY_SQL, {
      valueFontSize: TREND_FS.value,
      labelFontSize: TREND_FS.label,
      labelColor: '#99A1AF',
      valueColor: '#51A2FF',
      valueFontWeight: '500',
      labelUppercase: false,
      contentAlign: 'left',
      contentVAlign: 'start',
      labelPosition: 'top',
      layoutGap: 2,
    }),
    id: cid(),
    mqttDataSourceId: MQTT,
    mqttTopic: CAPACITY_TOPIC,
    refreshInterval: 0,
  },
  statCard(TREND_PAD.x + TREND_KPI_W + TREND_KPI_GAP, trendKpiY, TREND_KPI_W, TREND_KPI_ROW_H, '目標數值', 'target_val', CAPACITY_TREND_SUMMARY_SQL, {
    valueFontSize: TREND_FS.value,
    labelFontSize: TREND_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    labelUppercase: false,
    contentAlign: 'left',
    contentVAlign: 'start',
    labelPosition: 'top',
    layoutGap: 2,
  }),
  statCard(trendAvailColX, trendKpiY, TREND_KPI_W, TREND_KPI_ROW_H, '可用數值', 'avail_val', CAPACITY_TREND_SUMMARY_SQL, {
    valueFontSize: TREND_FS.value,
    labelFontSize: TREND_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    labelUppercase: false,
    contentAlign: 'left',
    contentVAlign: 'start',
    labelPosition: 'top',
    layoutGap: 2,
  }),
  boundText(trendKpiHintX(trendAvailColX), trendKpiHintY, TREND_KPI_HINT_W, TREND_KPI_HINT_H, 'avail_hint', CAPACITY_TREND_SUMMARY_SQL, TREND_FS.label, '#D1D5DC', 'normal', 'right', {
    iconImage: ICON.availVehicle,
    contentPadding: '0',
    textWrap: 'nowrap',
  }),
  statCard(trendNextColX, trendKpiY, TREND_KPI_W, TREND_KPI_ROW_H, '下段數值', 'next_val', CAPACITY_TREND_SUMMARY_SQL, {
    valueFontSize: TREND_FS.value,
    labelFontSize: TREND_FS.label,
    labelColor: '#99A1AF',
    valueColor: '#F3F4F6',
    valueFontWeight: '500',
    labelUppercase: false,
    contentAlign: 'left',
    contentVAlign: 'start',
    labelPosition: 'top',
    layoutGap: 2,
  }),
  boundText(trendKpiHintX(trendNextColX), trendKpiHintY, TREND_KPI_HINT_W, TREND_KPI_HINT_H, 'next_hint', CAPACITY_TREND_SUMMARY_SQL, TREND_FS.label, '#D1D5DC', 'normal', 'right', {
    iconImage: ICON.clock,
    contentPadding: '0',
    textWrap: 'nowrap',
  }),
  {
    ...line,
    id: cid(),
    width: TREND_CONTENT_W,
    height: TREND_CHART_H,
    title: '',
    xAxis: {
      unit: 'time',
      timeStyle: 'hm',
      timeClock: '24h',
      label: '',
      timeWindow: { enabled: true, pastRatio: 2, futureRatio: 4, totalMinutes: 360, snapToHour: true },
    },
    yAxis: { unit: 'number', min: 0, max: 1500, label: '' },
    viewportMode: 'fixed-axis',
    viewportPadding: 0.12,
    chartPadding: { top: 58, right: 32, bottom: 32, left: 33 },
    chartGridColor: 'rgba(212, 212, 212, 0.25)',
    chartAxisLabelColor: '#99A1AF',
    chartAxisLineColor: 'rgba(212, 212, 212, 0.25)',
    hideYAxisLabels: true,
    chartHideLegend: true,
    chartCalloutFill: 'rgba(81, 162, 255, 0.5)',
    chartCalloutTextColor: '#F3F4F6',
    strokeColors: ['#51A2FF', '#99A1AF'],
    series: [
      {
        id: 'capacity-forecast',
        label: '目標走勢',
        yField: 'forecast_util',
        color: '#99A1AF',
        strokeWidth: 1.5,
      },
      {
        id: 'capacity-actual',
        label: '當前運能',
        yField: 'actual_util',
        color: '#51A2FF',
        strokeWidth: 3,
        areaFill: true,
        eventLabelsEnabled: true,
        eventFlagField: 'is_anomaly',
        eventLabelField: 'anomaly_label',
        eventLabelStyle: {
          fill: '#F3F4F6',
          fontSize: 14,
          fontWeight: 500,
          stroke: '#FB2C36',
          strokeWidth: 1,
          backgroundFill: '#18181B',
        },
      },
    ],
    axisBands: [
      {
        axis: 'x',
        startField: 'time',
        segmentField: 'segment_code',
        colorRules: [
          { value: 'IN_SERVICE', color: '#FD9A00' },
          { value: 'SCHEDULED', color: '#009966' },
        ],
        defaultColor: '#64748b',
        thickness: 2,
        opacity: 1,
      },
    ],
    chartAxisFontSize: TREND_FS.label,
    chartCalloutFontSize: TREND_FS.label,
    dataSourceId: DS,
    sqlQuery: CAPACITY_TREND_CHART_SQL,
    xField: 'time',
    yFields: ['forecast_util', 'actual_util'],
    refreshInterval: 30,
  },
];

// 整備分佈畫布：Figma 標題 y=12、格位網格 y=42
elements[6].children = maintenanceDistributionBlock(MAINT_PAD.x, MAINT_PAD.top);

// 車輛分佈畫布：Figma 標題 y=12、條列區高 45
elements[7].children = [
  vehicleDistributionWidget(
    VEH_DIST_PAD.x,
    VEH_DIST_PAD.top,
    VEH_DIST_CONTENT_W,
    VEH_DIST_PANEL_H - VEH_DIST_PAD.top - VEH_DIST_PAD.bottom,
  ),
];

const clock = createWidget('clock', 24, 20) as ClockWidget;
const badge = createWidget('status-badge', 520, 20) as StatusBadgeWidget;

function mapVehicleContainerWidget(): VehicleContainerWidget {
  const base = createWidget('vehicle-container', MAP_VEHICLE_X, MAP_VEHICLE_Y) as VehicleContainerWidget;
  return {
    ...base,
    id: cid(),
    width: MAP_VEHICLE_SIZE.width,
    height: MAP_VEHICLE_SIZE.height,
    label: 'PMS-01',
    vehicleDefinitionId: USER_RESTORED_VEHICLE_ID,
    behaviorOffsetX: 0,
    behaviorOffsetY: -30,
    behaviorIconSize: 22,
    actionIconRules: buildVehicleBehaviorActionRules('operation_action'),
    mqttDataSourceId: MQTT,
    mqttTopic: 'v1/vtms/PMS-01/operation/update',
  };
}

elements[8].children = [
  {
    ...clock, id: cid(), width: 420, height: 72, format: '12h', showDate: true, showSeconds: true,
    fontSize: FS.emphasis, dateFontSize: FS.aux, color: '#f1f5f9', dateColor: '#94a3b8', fontFamily: 'monospace',
  },
  {
    ...badge, id: cid(), width: 260, height: 44, defaultLabel: '正常營運中 Level 1',
    defaultBgColor: '#064e3b', defaultTextColor: '#34d399', fontSize: FS.body, borderRadius: 8, showDot: true,
  },
  staticText(780, 24, 180, 32, '班距 03:00', FS.body, '#fdba74'),
  staticText(980, 24, 220, 32, '正線營運 4 / 4', FS.body, '#7dd3fc'),
  mapVehicleContainerWidget(),
];

elements[9].children = vehicleStatusCardTemplate(VEHICLE_STATUS_SLOT_W, VEHICLE_STATUS_SLOT_H);

const DEMO_PLANE_BASE: DashboardPlane = {
  id: 'demo-plane',
  name: 'SyncDrive 總控大屏 (3840×1080)',
  width: PLANE_W,
  height: PLANE_H,
  elements,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  demoLayoutVersion: 112,
} as DashboardPlane;

/** 從 TS 建構子產生（bake 腳本用；執行期還原請用 snapshot） */
export function buildDemoPlaneFromCode(): DashboardPlane {
  return JSON.parse(JSON.stringify(DEMO_PLANE_BASE)) as DashboardPlane;
}

/** 深拷貝內建範例快照，避免執行期意外改寫模組內快取 */
export function cloneDemoPlane(): DashboardPlane {
  return JSON.parse(JSON.stringify(demoPlaneSnapshot)) as DashboardPlane;
}

export const DEMO_PLANE = cloneDemoPlane();
