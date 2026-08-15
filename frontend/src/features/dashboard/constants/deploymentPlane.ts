/**
 * 班表部署管理平面 — 由設計稿逐步組裝。
 * 已完成：頂列四卡（目前模式、數據統計、執行班表、重大事件）；
 *         中間層：即時影像元件（圖片 + 標題文字 + 色塊框架）。
 */
import type {
  CanvasElementProps,
  ChildWidget,
  ColorBlockWidget,
  DashboardPlane,
  GaugeWidget,
  ImageWidget,
  TabListWidget,
  StatusBadgeWidget,
  TextWidget,
} from '../types';
import { createWidget } from '../types';
import {
  DEPLOYMENT_CURRENT_MODE_SQL,
  DEPLOYMENT_DATA_STATS_SQL,
  DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
  DEPLOYMENT_MAJOR_EVENTS_SQL,
  DEPLOYMENT_VEHICLE_LIST_SQL,
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
} from './demoSql';

const DS = 'default-internal';
const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

export const DEPLOYMENT_PLANE_NAME = '班表部署管理';
export const DEPLOY_CURRENT_MODE_PANEL_ID = 'deploy-current-mode-panel';
export const DEPLOY_DATA_STATS_PANEL_ID = 'deploy-data-stats-panel';
export const DEPLOY_EXECUTING_SCHEDULE_PANEL_ID = 'deploy-executing-schedule-panel';
export const DEPLOY_MAJOR_EVENTS_PANEL_ID = 'deploy-major-events-panel';
export const DEPLOY_VEHICLE_PHOTO_PANEL_ID = 'deploy-vehicle-photo-panel';
export const DEPLOY_VEHICLE_OPS_GROUP_ID   = 'deploy-vehicle-ops-group';
export const DEPLOY_SHIFT_LIST_PANEL_ID    = 'deploy-shift-list-panel';

/** 1920×1080 頂列四卡 */
const PLANE_PAD = 24;
const CARD_GAP = 16;
const CARD_W = 380;
const CARD_H = 210;
const MODE_X = PLANE_PAD;
const MODE_Y = PLANE_PAD;
const STATS_X = PLANE_PAD + CARD_W + CARD_GAP;
const STATS_Y = PLANE_PAD;
const EXEC_X = PLANE_PAD + (CARD_W + CARD_GAP) * 2;
const EXEC_Y = PLANE_PAD;
const EVENTS_X = PLANE_PAD + (CARD_W + CARD_GAP) * 3;
const EVENTS_Y = PLANE_PAD;

/** 第二列：載具操作群組（全寬單行 11 台車） */
const ROW2_Y   = PLANE_PAD + CARD_H + CARD_GAP;  // = 250
const PHOTO_X  = PLANE_PAD;
const PHOTO_W  = CARD_W;   // 380
const PHOTO_H  = CARD_H;   // 210

const OPS_X    = PLANE_PAD;                       // = 24
const OPS_W    = 1920 - PLANE_PAD * 2;            // = 1872
const OPS_H    = 150;

/** 每個車輛操作卡寬高（單行 11 台車，寬約 159px，高 150px） */
const VEH_CARD_GAP = 12;
const VEH_CARD_W  = Math.floor((OPS_W - VEH_CARD_GAP * 10) / 11); // = 159
const VEH_CARD_H  = OPS_H;

/** 第三列：班次清單（全寬，第二列載具正下方） */
const ROW3_Y   = ROW2_Y + OPS_H + CARD_GAP;      // = 250 + 150 + 16 = 416
const ROW3_W   = 1920 - PLANE_PAD * 2;            // = 1872
const ROW3_H   = 1080 - ROW3_Y - PLANE_PAD;       // = 1080 - 416 - 24 = 640

/** 設計稿：正常營運狀態區塊底色 */
const MODE_STATUS_BG = '#1B4332';
const INNER_CARD_BG = '#212124';
const EVENT_ALERT_BORDER = '#F87171';
const EVENT_ALERT_BG = 'rgba(127, 29, 29, 0.18)';
const PERIOD_DOTS = ['#A78BFA', '#22C55E', '#F97316'] as const;

const ICON = {
  delayed: 'Clock',
  abnormal: 'AlertTriangle',
  cancelled: 'CircleX',
} as const;

function cid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function staticText(
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  fontSize: number,
  color: string,
  fontWeight: 'bold' | 'normal' = 'bold',
  textAlign: 'left' | 'right' | 'center' = 'left',
  opts?: {
    verticalAlign?: TextWidget['verticalAlign'];
    backgroundColor?: string;
    borderRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    contentPadding?: string;
    icon?: string;
    iconGap?: number;
  },
): TextWidget {
  const t = createWidget('text', x, y) as TextWidget;
  return {
    ...t,
    id: cid('text'),
    width: w,
    height: h,
    content,
    fontSize,
    color,
    fontWeight,
    textAlign,
    lineHeight: 1.2,
    fontFamily: FONT_UI,
    verticalAlign: opts?.verticalAlign ?? 'center',
    backgroundColor: opts?.backgroundColor ?? 'transparent',
    borderRadius: opts?.borderRadius ?? 0,
    borderWidth: opts?.borderWidth ?? 0,
    borderColor: opts?.borderColor ?? 'transparent',
    contentPadding: opts?.contentPadding,
    icon: opts?.icon,
    iconGap: opts?.iconGap,
  };
}

function boundText(
  x: number,
  y: number,
  w: number,
  h: number,
  valueField: string,
  sql: string,
  fontSize: number,
  color: string,
  opts?: {
    fontWeight?: 'bold' | 'normal';
    textAlign?: 'left' | 'right' | 'center';
    backgroundColor?: string;
    borderRadius?: number;
    contentPadding?: string;
    verticalAlign?: TextWidget['verticalAlign'];
    borderWidth?: number;
    borderColor?: string;
    icon?: string;
    iconGap?: number;
  },
): TextWidget {
  const t = staticText(
    x,
    y,
    w,
    h,
    '',
    fontSize,
    color,
    opts?.fontWeight ?? 'normal',
    opts?.textAlign ?? 'center',
    { verticalAlign: opts?.verticalAlign },
  );
  return {
    ...t,
    dataSourceId: DS,
    sqlQuery: sql,
    valueField,
    refreshInterval: 0,
    refreshMode: 'event',
    backgroundColor: opts?.backgroundColor ?? 'transparent',
    borderRadius: opts?.borderRadius ?? 0,
    contentPadding: opts?.contentPadding,
    borderWidth: opts?.borderWidth ?? 0,
    borderColor: opts?.borderColor ?? 'transparent',
    icon: opts?.icon,
    iconGap: opts?.iconGap,
  };
}

function ringGauge(x: number, y: number, size: number): GaugeWidget {
  const g = createWidget('gauge', x, y) as GaugeWidget;
  return {
    ...g,
    id: cid('gauge'),
    width: size,
    height: size,
    title: '達成進度',
    valueField: 'achievement_pct',
    unit: '%',
    min: 0,
    max: 100,
    gaugeVariant: 'ring',
    gaugeValueFontSize: 28,
    gaugeUnitFontSize: 12,
    gaugeArcStrokeWidth: 10,
    panelBackgroundColor: 'transparent',
    panelBorderRadius: 0,
    dataSourceId: DS,
    sqlQuery: DEPLOYMENT_DATA_STATS_SQL,
    refreshInterval: 0,
    refreshMode: 'event',
    colorStops: [
      { at: 0, color: '#3B82F6' },
      { at: 1, color: '#60A5FA' },
    ],
  };
}

function colorBlock(
  x: number,
  y: number,
  w: number,
  h: number,
  backgroundColor: string,
  borderRadius = 10,
  opts?: { borderWidth?: number; borderColor?: string },
): ColorBlockWidget {
  const b = createWidget('color-block', x, y) as ColorBlockWidget;
  return {
    ...b,
    id: cid('block'),
    width: w,
    height: h,
    backgroundColor,
    borderRadius,
    borderWidth: opts?.borderWidth ?? 0,
    borderColor: opts?.borderColor ?? 'transparent',
    opacity: 100,
  };
}

/** 設計稿第 1 張：目前模式 */
export function buildCurrentModePanel(
  x = MODE_X,
  y = MODE_Y,
): CanvasElementProps {
  const pad = 12;
  const titleH = 24;
  const boxX = pad;
  const boxY = pad + titleH + 10;
  const boxW = CARD_W - pad * 2;
  const boxH = CARD_H - boxY - pad;
  const labelH = 36;
  const levelH = 22;
  const stackH = labelH + 6 + levelH;
  const stackY = boxY + Math.round((boxH - stackH) / 2);

  const children: ChildWidget[] = [
    staticText(pad, pad, 200, titleH, '目前模式', 16, '#F3F4F6', 'bold', 'left'),
    colorBlock(boxX, boxY, boxW, boxH, MODE_STATUS_BG, 14),
    boundText(
      boxX + 12,
      stackY,
      boxW - 24,
      labelH,
      'mode_label',
      DEPLOYMENT_CURRENT_MODE_SQL,
      28,
      '#FFFFFF',
      { fontWeight: 'bold', textAlign: 'center', verticalAlign: 'center' },
    ),
    boundText(
      boxX + 12,
      stackY + labelH + 6,
      boxW - 24,
      levelH,
      'mode_level',
      DEPLOYMENT_CURRENT_MODE_SQL,
      14,
      'rgba(255,255,255,0.85)',
      { fontWeight: 'normal', textAlign: 'center', verticalAlign: 'center' },
    ),
  ];

  return {
    id: DEPLOY_CURRENT_MODE_PANEL_ID,
    type: 'canvas',
    x,
    y,
    width: CARD_W,
    height: CARD_H,
    label: '目前模式',
    backgroundColor: '#18181B',
    backgroundImage: '',
    opacity: 100,
    children,
  };
}

/** 設計稿第 2 張：數據統計（左圓環＋膠囊｜分隔線｜右狀態列） */
export function buildDataStatsPanel(
  x = STATS_X,
  y = STATS_Y,
): CanvasElementProps {
  const pad = 14;
  const titleH = 24;
  const bodyY = pad + titleH + 10;
  const bodyH = CARD_H - bodyY - pad;

  /** 左欄寬（圓環區），右欄吃剩餘 */
  const leftW = 168;
  const dividerX = pad + leftW + 10;
  const rightX = dividerX + 12;
  const rightW = CARD_W - rightX - pad;

  const ringSize = 112;
  const ringX = pad + Math.round((leftW - ringSize) / 2);
  const ringY = bodyY;
  const pillY = ringY + ringSize + 10;
  const pillH = 26;
  const pillGap = 6;
  const pillW = Math.floor((leftW - pillGap) / 2);

  const rowH = 40;
  const rowGap = 10;
  const rowsBlockH = rowH * 3 + rowGap * 2;
  const rowsY = bodyY + Math.round((bodyH - rowsBlockH) / 2);

  const children: ChildWidget[] = [
    staticText(pad, pad, 140, titleH, '數據統計', 16, '#F3F4F6', 'bold', 'left'),
    boundText(
      CARD_W - pad - 112,
      pad,
      112,
      24,
      'ontime_badge',
      DEPLOYMENT_DATA_STATS_SQL,
      12,
      '#E2E8F0',
      {
        fontWeight: 'normal',
        textAlign: 'center',
        backgroundColor: '#27272A',
        borderRadius: 999,
        contentPadding: '2px 10px',
      },
    ),

    // 左：達成進度環
    ringGauge(ringX, ringY, ringSize),

    // 左下：總共／完成膠囊
    boundText(pad, pillY, pillW, pillH, 'total_pill', DEPLOYMENT_DATA_STATS_SQL, 11, '#E2E8F0', {
      fontWeight: 'normal',
      textAlign: 'center',
      backgroundColor: '#27272A',
      borderRadius: 999,
      contentPadding: '2px 8px',
    }),
    boundText(pad + pillW + pillGap, pillY, pillW, pillH, 'completed_pill', DEPLOYMENT_DATA_STATS_SQL, 11, '#E2E8F0', {
      fontWeight: 'normal',
      textAlign: 'center',
      backgroundColor: '#27272A',
      borderRadius: 999,
      contentPadding: '2px 8px',
    }),

    // 中：垂直分隔線
    colorBlock(dividerX, bodyY + 4, 1, bodyH - 8, 'rgba(255,255,255,0.12)', 1),

    // 右：延遲／異常／取消
    ...buildStatusRows(rightX, rowsY, rightW, rowH, rowGap),
  ];

  return {
    id: DEPLOY_DATA_STATS_PANEL_ID,
    type: 'canvas',
    x,
    y,
    width: CARD_W,
    height: CARD_H,
    label: '數據統計',
    backgroundColor: '#18181B',
    backgroundImage: '',
    opacity: 100,
    children,
  };
}

function buildStatusRows(
  x: number,
  y: number,
  w: number,
  rowH: number,
  rowGap: number,
): ChildWidget[] {
  const rows: Array<{ label: string; field: string; icon: string }> = [
    { label: '延遲', field: 'delayed_count', icon: ICON.delayed },
    { label: '異常', field: 'abnormal_count', icon: ICON.abnormal },
    { label: '取消', field: 'cancelled_count', icon: ICON.cancelled },
  ];
  const labelW = Math.min(96, Math.floor(w * 0.55));
  const valueW = w - labelW - 8;

  return rows.flatMap((row, index) => {
    const rowY = y + index * (rowH + rowGap);
    const label = staticText(x, rowY, labelW, rowH, row.label, 14, '#A1A1AA', 'normal', 'left', {
      verticalAlign: 'center',
    });
    label.icon = row.icon;
    label.iconGap = 8;
    return [
      label,
      boundText(x + labelW + 8, rowY, valueW, rowH, row.field, DEPLOYMENT_DATA_STATS_SQL, 20, '#F8FAFC', {
        fontWeight: 'bold',
        textAlign: 'right',
        verticalAlign: 'center',
      }),
    ];
  });
}

function statusBadge(
  x: number,
  y: number,
  w: number,
  h: number,
): StatusBadgeWidget {
  const b = createWidget('status-badge', x, y) as StatusBadgeWidget;
  return {
    ...b,
    id: cid('badge'),
    width: w,
    height: h,
    valueField: 'status_code',
    dataSourceId: DS,
    sqlQuery: DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
    refreshInterval: 0,
    refreshMode: 'event',
    defaultLabel: '進行中',
    defaultBgColor: '#14532D',
    defaultTextColor: '#86EFAC',
    showDot: true,
    fontSize: 11,
    borderRadius: 999,
    badgeStyle: 'filled',
    rules: [
      {
        value: 'RUNNING',
        label: '進行中',
        bgColor: '#14532D',
        textColor: '#86EFAC',
      },
    ],
  };
}

/** 設計稿第 3 張：執行班表 */
export function buildExecutingSchedulePanel(
  x = EXEC_X,
  y = EXEC_Y,
): CanvasElementProps {
  const pad = 12;
  const titleH = 24;
  const btnW = 108;
  const innerX = pad;
  const innerY = pad + titleH + 8;
  const innerW = CARD_W - pad * 2;
  const innerH = CARD_H - innerY - pad;
  const innerPad = 10;

  const metaY = innerY + innerPad;
  const nameY = metaY + 22;
  const reviewerY = nameY + 28;
  const dividerY = reviewerY + 22;
  const periodStartY = dividerY + 8;
  const periodH = 18;
  const periodGap = 4;

  const children: ChildWidget[] = [
    staticText(pad, pad, 120, titleH, '執行班表', 16, '#F3F4F6', 'bold', 'left'),
    staticText(
      CARD_W - pad - btnW,
      pad,
      btnW,
      24,
      '班表調整申請',
      11,
      '#38BDF8',
      'normal',
      'center',
      {
        borderWidth: 1,
        borderColor: '#0EA5E9',
        borderRadius: 8,
        backgroundColor: 'transparent',
        contentPadding: '2px 6px',
        verticalAlign: 'center',
      },
    ),

    // 內層卡片
    colorBlock(innerX, innerY, innerW, innerH, INNER_CARD_BG, 12),

    boundText(
      innerX + innerPad,
      metaY,
      innerW - innerPad * 2 - 72,
      18,
      'schedule_meta',
      DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
      11,
      '#A1A1AA',
      { fontWeight: 'normal', textAlign: 'left', verticalAlign: 'center' },
    ),
    statusBadge(innerX + innerW - innerPad - 64, metaY - 1, 64, 20),

    // 綠條 + 班表名稱
    colorBlock(innerX + innerPad, nameY + 4, 3, 20, '#22C55E', 2),
    boundText(
      innerX + innerPad + 10,
      nameY,
      innerW - innerPad * 2 - 10,
      28,
      'schedule_name',
      DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
      18,
      '#F8FAFC',
      { fontWeight: 'bold', textAlign: 'left', verticalAlign: 'center' },
    ),

    // 審核人
    staticText(
      innerX + innerPad,
      reviewerY,
      48,
      18,
      '審核人',
      11,
      '#71717A',
      'normal',
      'left',
      { verticalAlign: 'center' },
    ),
    boundText(
      innerX + innerPad + 48,
      reviewerY,
      100,
      18,
      'reviewer_name',
      DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
      12,
      '#E4E4E7',
      {
        fontWeight: 'normal',
        textAlign: 'left',
        verticalAlign: 'center',
        icon: 'User',
        iconGap: 4,
      },
    ),

    colorBlock(innerX + innerPad, dividerY, innerW - innerPad * 2, 1, 'rgba(255,255,255,0.1)', 1),

    // 三時段
    ...([1, 2, 3] as const).flatMap((n, index) => {
      const rowY = periodStartY + index * (periodH + periodGap);
      const field = `period_${n}` as 'period_1' | 'period_2' | 'period_3';
      return [
        colorBlock(innerX + innerPad, rowY + 5, 8, 8, PERIOD_DOTS[index], 999),
        boundText(
          innerX + innerPad + 14,
          rowY,
          innerW - innerPad * 2 - 14,
          periodH,
          field,
          DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
          11,
          '#A1A1AA',
          { fontWeight: 'normal', textAlign: 'left', verticalAlign: 'center' },
        ),
      ];
    }),
  ];

  return {
    id: DEPLOY_EXECUTING_SCHEDULE_PANEL_ID,
    type: 'canvas',
    x,
    y,
    width: CARD_W,
    height: CARD_H,
    label: '執行班表',
    backgroundColor: '#18181B',
    backgroundImage: '',
    opacity: 100,
    children,
  };
}

/** 設計稿第 4 張：重大事件 */
export function buildMajorEventsPanel(
  x = EVENTS_X,
  y = EVENTS_Y,
): CanvasElementProps {
  const pad = 12;
  const titleH = 24;
  const bodyY = pad + titleH + 10;
  const bodyW = CARD_W - pad * 2;
  const alertH = 72;
  const gap = 10;
  const emptyY = bodyY + alertH + gap;
  const emptyH = CARD_H - emptyY - pad;
  const alertPad = 12;
  const iconSize = 28;
  const timeW = 88;

  const children: ChildWidget[] = [
    staticText(pad, pad, 160, titleH, '重大事件', 16, '#F3F4F6', 'bold', 'left'),

    // 警示事件框
    colorBlock(pad, bodyY, bodyW, alertH, EVENT_ALERT_BG, 12, {
      borderWidth: 1,
      borderColor: EVENT_ALERT_BORDER,
    }),
    staticText(
      pad + alertPad,
      bodyY + Math.round((alertH - iconSize) / 2),
      iconSize,
      iconSize,
      '',
      18,
      '#F87171',
      'normal',
      'center',
      {
        icon: 'AlertTriangle',
        verticalAlign: 'center',
      },
    ),
    boundText(
      pad + alertPad + iconSize + 8,
      bodyY + 14,
      bodyW - alertPad * 2 - iconSize - 8 - timeW,
      22,
      'event_title',
      DEPLOYMENT_MAJOR_EVENTS_SQL,
      14,
      '#F8FAFC',
      { fontWeight: 'bold', textAlign: 'left', verticalAlign: 'center' },
    ),
    boundText(
      pad + alertPad + iconSize + 8,
      bodyY + 38,
      bodyW - alertPad * 2 - iconSize - 8 - timeW,
      18,
      'event_level',
      DEPLOYMENT_MAJOR_EVENTS_SQL,
      12,
      '#A1A1AA',
      { fontWeight: 'normal', textAlign: 'left', verticalAlign: 'center' },
    ),
    boundText(
      pad + bodyW - alertPad - timeW,
      bodyY + 14,
      timeW,
      18,
      'event_date',
      DEPLOYMENT_MAJOR_EVENTS_SQL,
      11,
      '#A1A1AA',
      { fontWeight: 'normal', textAlign: 'right', verticalAlign: 'center' },
    ),
    boundText(
      pad + bodyW - alertPad - timeW,
      bodyY + 34,
      timeW,
      18,
      'event_time',
      DEPLOYMENT_MAJOR_EVENTS_SQL,
      11,
      '#A1A1AA',
      { fontWeight: 'normal', textAlign: 'right', verticalAlign: 'center' },
    ),

    // 無更多事件
    colorBlock(pad, emptyY, bodyW, emptyH, INNER_CARD_BG, 12),
    boundText(
      pad,
      emptyY,
      bodyW,
      emptyH,
      'empty_hint',
      DEPLOYMENT_MAJOR_EVENTS_SQL,
      13,
      '#71717A',
      { fontWeight: 'normal', textAlign: 'center', verticalAlign: 'center' },
    ),
  ];

  return {
    id: DEPLOY_MAJOR_EVENTS_PANEL_ID,
    type: 'canvas',
    x,
    y,
    width: CARD_W,
    height: CARD_H,
    label: '重大事件',
    backgroundColor: '#18181B',
    backgroundImage: '',
    opacity: 100,
    children,
  };
}

// ─── 第二列：即時影像元件 ────────────────────────────────────────────

/**
 * 即時影像卡：以圖片（image）+ 說明文字（text）+ 色塊框架（color-block）
 * 三種現有元件組合而成，顯示在儀表板中間層第二列。
 */
export function buildVehiclePhotoPanel(
  x = PHOTO_X,
  y = ROW2_Y,
): CanvasElementProps {
  const pad = 12;
  const titleH = 22;
  const imgY = pad + titleH + 6;
  const imgH = PHOTO_H - imgY - pad;
  const imgW = PHOTO_W - pad * 2;

  /* ── 圖片元件（使用 image widget） ── */
  const photo = createWidget('image', pad, imgY) as ImageWidget;
  const photoWidget: ImageWidget = {
    ...photo,
    id: cid('photo'),
    width: imgW,
    height: imgH,
    src: '',                // 由使用者在屬性面板填入 URL / 留空顯示佔位
    objectFit: 'cover',
    borderRadius: 8,
    backgroundColor: '#0f172a',
  };

  /* ── 標題文字 ── */
  const titleWidget = staticText(
    pad,
    pad,
    220,
    titleH,
    '即時影像',
    14,
    '#F3F4F6',
    'bold',
    'left',
    { verticalAlign: 'center' },
  );

  /* ── 右上角狀態標籤（LIVE 指示）── */
  const liveLabel = staticText(
    PHOTO_W - pad - 56,
    pad,
    56,
    titleH,
    'LIVE',
    11,
    '#86EFAC',
    'bold',
    'center',
    {
      backgroundColor: '#14532D',
      borderRadius: 999,
      contentPadding: '2px 8px',
      verticalAlign: 'center',
      icon: 'Circle',
      iconGap: 4,
    },
  );

  /* ── 圖片底部說明文字（疊在圖片上方，透過絕對座標對齊） ── */
  const captionBg = colorBlock(
    pad,
    imgY + imgH - 28,
    imgW,
    28,
    'rgba(0,0,0,0.55)',
    8,
  );
  const captionText = staticText(
    pad + 8,
    imgY + imgH - 26,
    imgW - 16,
    24,
    'CAM-01  |  即時串流',
    11,
    'rgba(255,255,255,0.85)',
    'normal',
    'left',
    { verticalAlign: 'center' },
  );

  const children: ChildWidget[] = [
    titleWidget,
    liveLabel,
    photoWidget,
    captionBg,
    captionText,
  ];

  return {
    id: DEPLOY_VEHICLE_PHOTO_PANEL_ID,
    type: 'canvas',
    x,
    y,
    width: PHOTO_W,
    height: PHOTO_H,
    label: '即時影像',
    backgroundColor: '#18181B',
    backgroundImage: '',
    opacity: 100,
    children,
  };
}

// ─── 第二列：載具操作群組 ──────────────────────────────────────────────

/**
 * 每個車輛卡片的子元件範本（共 5 個現有元件）：
 *   ① text  — 公車圖示 + 車輛代碼（Bus icon）
 *   ② text  — 「自駕停駛」按鈕（藍色邊框）
 *   ③ text  — 「自駕啟動」按鈕（藍色邊框）
 *   ④ text  — 「系統重置」按鈕（紅色邊框）
 *   ⑤ color-block — 卡片底色框
 */
function buildVehicleCardTemplate(
  cardW: number,
  cardH: number,
): ChildWidget[] {
  const pad = 10;
  const iconH = 36;
  const btnH = 28;
  const btnGap = 6;
  const btnY  = pad + iconH + 8;
  const singleBtnW = Math.floor((cardW - pad * 2 - btnGap) / 2);
  const resetBtnY  = btnY + btnH + btnGap;

  /* ① 卡片底色框 */
  const bg = colorBlock(0, 0, cardW, cardH, '#18181B', 10, {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  });

  /* ② 公車圖示 + 車輛代碼 */
  const vehicleLabel = staticText(
    pad,
    pad,
    cardW - pad * 2,
    iconH,
    '{vehicle_code}',
    13,
    '#D4D4D8',
    'normal',
    'left',
    { verticalAlign: 'center', icon: 'Bus', iconGap: 6 },
  );

  /* ③ 自駕停駛（左側，藍框） */
  const btnStop = staticText(
    pad,
    btnY,
    singleBtnW,
    btnH,
    '自駕停駛',
    11,
    '#60A5FA',
    'normal',
    'center',
    {
      verticalAlign: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '#3B82F6',
      borderRadius: 6,
      contentPadding: '2px 4px',
    },
  );

  /* ④ 自駕啟動（右側，藍框） */
  const btnStart = staticText(
    pad + singleBtnW + btnGap,
    btnY,
    singleBtnW,
    btnH,
    '自駕啟動',
    11,
    '#60A5FA',
    'normal',
    'center',
    {
      verticalAlign: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '#3B82F6',
      borderRadius: 6,
      contentPadding: '2px 4px',
    },
  );

  /* ⑤ 系統重置（全寬，紅框） */
  const btnReset = staticText(
    pad,
    resetBtnY,
    cardW - pad * 2,
    btnH,
    '系統重置',
    11,
    '#F87171',
    'normal',
    'center',
    {
      verticalAlign: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '#EF4444',
      borderRadius: 6,
      contentPadding: '2px 4px',
    },
  );

  return [bg, vehicleLabel, btnStop, btnStart, btnReset];
}

/**
 * 載具操作畫布群組：
 * - isGroup = true，每列資料 = 一台載具
 * - 子範本 = buildVehicleCardTemplate（5 個現有元件組合）
 * - layoutMode = grid，自動換行排列（截圖中 6×2 = 12 台）
 */
export function buildVehicleOpsGroup(
  x = OPS_X,
  y = ROW2_Y,
): CanvasElementProps {
  const gridCols = Math.floor(OPS_W / (VEH_CARD_W + VEH_CARD_GAP));

  return {
    id: DEPLOY_VEHICLE_OPS_GROUP_ID,
    type: 'canvas',
    x,
    y,
    width: OPS_W,
    height: OPS_H,
    label: '載具操作',
    backgroundColor: 'transparent',
    backgroundImage: '',
    opacity: 100,

    /* ─── canvas-group 設定 ─── */
    isGroup: true,
    groupRepeatMode: 'tile',
    dataSourceId: DS,
    sqlQuery: DEPLOYMENT_VEHICLE_LIST_SQL,
    refreshInterval: 0,
    refreshMode: 'event',
    variableName: 'row',
    iteratorField: 'vehicle_code',
    layoutMode: 'grid',
    gridColumns: gridCols,
    gapX: VEH_CARD_GAP,
    gapY: VEH_CARD_GAP,
    groupTileFit: 'fixed',
    groupTileAlign: 'start',
    groupTilePadding: 0,
    templateHideChrome: true,
    templateWidth: VEH_CARD_W,
    templateHeight: VEH_CARD_H,

    /* ─── 子範本元件（5 種現有元件） ─── */
    children: buildVehicleCardTemplate(VEH_CARD_W, VEH_CARD_H),
  };
}

/** 班次清單全寬卡（第三列，使用全新 TabListWidget） */
function buildShiftListPanel(): CanvasElementProps {
  const tabListWidget = createWidget('tab-list', 0, 0) as TabListWidget;
  tabListWidget.id = 'shift-list-main';
  tabListWidget.width = ROW3_W;
  tabListWidget.height = ROW3_H;
  tabListWidget.dataSourceId = DS;
  tabListWidget.currentScheduleSqlQuery = `SELECT schedule_name FROM (${DEPLOYMENT_EXECUTING_SCHEDULE_SQL}) AS s LIMIT 1`;
  if (tabListWidget.tabs && tabListWidget.tabs[0]) {
    tabListWidget.tabs[0].dataSourceId = DS;
    tabListWidget.tabs[0].sqlQuery = MAINLINE_SHIFTS_SQL;
  }
  if (tabListWidget.tabs && tabListWidget.tabs[1]) {
    tabListWidget.tabs[1].dataSourceId = DS;
    tabListWidget.tabs[1].sqlQuery = MAINTENANCE_SHIFTS_SQL;
  }

  return {
    id: DEPLOY_SHIFT_LIST_PANEL_ID,
    type: 'canvas',
    label: '班次清單面板',
    x: PLANE_PAD,
    y: ROW3_Y,
    width: ROW3_W,
    height: ROW3_H,
    backgroundColor: '#18181b',
    backgroundImage: '',
    opacity: 100,
    children: [tabListWidget],
  };
}

/**
 * 以穩定 id 覆寫／插入部署卡。
 */
function upsertDeployPanel(
  elements: CanvasElementProps[],
  panel: CanvasElementProps,
  forceResetPosition = false,
): { elements: CanvasElementProps[]; changed: boolean } {
  const idx = elements.findIndex(
    (el) => el.id === panel.id || el.label === panel.label,
  );
  if (idx < 0) {
    return { elements: [...elements, panel], changed: true };
  }
  const prev = elements[idx];
  const next: CanvasElementProps = {
    ...panel,
    x: forceResetPosition ? panel.x : (prev.x ?? panel.x),
    y: forceResetPosition ? panel.y : (prev.y ?? panel.y),
    width: forceResetPosition ? panel.width : (prev.width ?? panel.width),
    height: forceResetPosition ? panel.height : (prev.height ?? panel.height),
  };
  const replaced = [...elements];
  replaced[idx] = next;
  return { elements: replaced, changed: true };
}

/** 補齊／更新班表部署管理已完成的頂列卡片與班次清單 */
export function ensureDeploymentDataStatsPanel(plane: DashboardPlane): DashboardPlane {
  if (plane.name !== DEPLOYMENT_PLANE_NAME) return plane;

  let elements = [...(plane.elements ?? [])];
  let changed = false;

  const mode = upsertDeployPanel(elements, buildCurrentModePanel());
  elements = mode.elements;
  changed = changed || mode.changed;

  const stats = upsertDeployPanel(elements, buildDataStatsPanel());
  elements = stats.elements;
  changed = changed || stats.changed;

  const exec = upsertDeployPanel(elements, buildExecutingSchedulePanel());
  elements = exec.elements;
  changed = changed || exec.changed;

  const events = upsertDeployPanel(elements, buildMajorEventsPanel());
  elements = events.elements;
  changed = changed || events.changed;

  const ops = upsertDeployPanel(elements, buildVehicleOpsGroup(), true);
  elements = ops.elements;
  changed = changed || ops.changed;

  const shiftList = upsertDeployPanel(elements, buildShiftListPanel(), true);
  elements = shiftList.elements;
  changed = changed || shiftList.changed;

  if (!changed) return plane;
  return {
    ...plane,
    elements,
    updatedAt: Date.now(),
  };
}

/** 新建完整平面（僅含已完成的卡） */
export function buildDeploymentManagementPlane(): DashboardPlane {
  const now = Date.now();
  return {
    id: `plane-deployment-${now.toString(36)}`,
    name: DEPLOYMENT_PLANE_NAME,
    width: 1920,
    height: 1080,
    elements: [
      buildCurrentModePanel(),
      buildDataStatsPanel(),
      buildExecutingSchedulePanel(),
      buildMajorEventsPanel(),
      buildVehiclePhotoPanel(),
      buildVehicleOpsGroup(),
      buildShiftListPanel(),
    ],
    createdAt: now,
    updatedAt: now,
  };
}
