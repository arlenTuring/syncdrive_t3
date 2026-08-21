import type {
  CurrentModeData,
  DataStatsData,
  ExecutingScheduleData,
  MajorEventData,
  ShiftRow,
} from './types';

export const FALLBACK_MODE: CurrentModeData = {
  modeLabel: '正常營運',
  modeLevel: 'Level 1',
};

export const FALLBACK_STATS: DataStatsData = {
  ontimePct: 92.3,
  achievementPct: 16.9,
  totalCount: 313,
  completedCount: 53,
  delayedCount: 1,
  abnormalCount: 0,
  cancelledCount: 0,
};

export const FALLBACK_SCHEDULE: ExecutingScheduleData = {
  scheduleMeta: '當前班表 執行於 00:00',
  statusLabel: '進行中',
  scheduleName: '高運量班表',
  reviewerName: 'Jack',
  periods: [
    '凌晨時段 班距 540 秒 運量 400 pphp',
    '離峰時段 班距 360 秒 運量 600 pphp',
    '尖峰時段 班距 180 秒 運量 1,200 pphp',
  ],
  pending: false,
};

export const FALLBACK_EVENT: MajorEventData = {
  title: '降級運轉事件',
  level: 'Level 2',
  date: '2027.05.01',
  time: '10:00:00',
};

export const FALLBACK_VEHICLES = Array.from({ length: 12 }, (_, i) =>
  `PMS-${String(i + 1).padStart(2, '0')}`,
);

export const FALLBACK_MAINLINE: ShiftRow[] = [
  {
    shiftKey: 'D0954',
    tripCode: 'D0954',
    directionLabel: '下行',
    vehicleCode: 'PMS-01',
    routeStations: '[{"name":"S2W"},{"name":"T3"},{"name":"N2W"}]',
    routeProgress: 35,
    segmentIndex: 0,
    segmentRemainPct: 30,
    statusLabel: '延遲+5分',
    statusBg: 'rgba(249,115,22,0.2)',
    statusColor: '#FB923C',
    departTime: '09:54 → 09:59',
  },
  {
    shiftKey: 'U1000',
    tripCode: 'U1000',
    directionLabel: '上行',
    vehicleCode: 'PMS-02',
    routeStations: '[{"name":"S2W"},{"name":"T3"},{"name":"N2W"}]',
    routeProgress: 62,
    segmentIndex: 1,
    segmentRemainPct: 40,
    statusLabel: '準點',
    statusBg: 'rgba(34,197,94,0.2)',
    statusColor: '#4ADE80',
    departTime: '10:00 → 10:00',
  },
];

export const FALLBACK_MAINTENANCE: ShiftRow[] = [
  {
    shiftKey: 'M-01',
    tripCode: 'M-01',
    directionLabel: '—',
    vehicleCode: 'PMS-08',
    routeStations: '[{"name":"S2W"},{"name":"W1"}]',
    routeProgress: 50,
    segmentIndex: 0,
    segmentRemainPct: 50,
    statusLabel: '整備中',
    statusBg: 'rgba(59,130,246,0.2)',
    statusColor: '#60A5FA',
    departTime: '11:20',
    maintTypeLabel: '洗車',
  },
];
