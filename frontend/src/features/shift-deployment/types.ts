export type ShiftListTab = 'mainline' | 'maintenance';

export type ShiftDeploymentAction =
  | { kind: 'schedule-adjust' }
  | { kind: 'event-open' }
  | { kind: 'vehicle-stop'; vehicleCode: string }
  | { kind: 'vehicle-start'; vehicleCode: string }
  | { kind: 'vehicle-reset'; vehicleCode: string }
  | { kind: 'shift-detail'; tab: ShiftListTab; row: ShiftRow }
  | { kind: 'shift-cancel'; row: ShiftRow }
  | { kind: 'dispatch-pause' }
  | { kind: 'dispatch-start' };

export type CurrentModeData = {
  modeLabel: string;
  modeLevel: string;
};

export type DataStatsData = {
  ontimePct: number;
  achievementPct: number;
  totalCount: number;
  completedCount: number;
  delayedCount: number;
  abnormalCount: number;
  cancelledCount: number;
};

export type ExecutingScheduleData = {
  scheduleMeta: string;
  statusLabel: string;
  scheduleName: string;
  reviewerName: string;
  periods: string[];
  pending: boolean;
};

export type MajorEventData = {
  title: string;
  level: string;
  date: string;
  time: string;
};

export type ShiftRow = {
  shiftKey: string;
  tripCode: string;
  directionLabel: string;
  vehicleCode: string;
  routeStations: string;
  routeProgress: number;
  segmentIndex: number;
  segmentRemainPct: number;
  statusLabel: string;
  statusBg: string;
  statusColor: string;
  departTime: string;
  maintTypeLabel?: string;
  /**
   * 原始訂單狀態（PENDING／PROCESSING／END／FAULTED）。
   *
   * 整備班次的 shiftKey 來自班表計畫區塊（block id），不是真的 operation_orders
   * 訂單，這個欄位在那裡會是空字串——取消只對正線班次的真訂單開放。
   */
  orderStatus: string;
};
