import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';
import {
  OrderService,
  type MainlineOrderLifecycleSnapshot,
  type MaintenanceOrderLifecycleSnapshot,
} from '../order/order.service';
import { CommandService } from '../command/command.service';
import { CommandType } from '../database/entities/command-log.entity';
import { VTMS_VEHICLE_CODE_PATTERN } from '../common/vehicle-codes';
import { DatasourceInvalidationService, DS_TAGS } from '../events/datasource-invalidation.service';

const requireCjs = createRequire(__filename);

const MAINLINE_LEG_MINUTES = 6;
const MAINT_TASK_MINUTES = 30;

/** 地圖設施代號 → slot_statuses（整備分佈 UI 的 E1/P1/H1… 標籤由此反查） */
const FACILITY_TO_MAINT_SLOT: Record<string, string> = {
  E1: 'MAINT-CHG-01',
  E2: 'MAINT-CHG-02',
  E3: 'MAINT-CHG-03',
  E4: 'MAINT-CHG-04',
  P1: 'MAINT-PRK-01',
  P2: 'MAINT-PRK-02',
  P3: 'MAINT-PRK-03',
  P4: 'MAINT-PRK-04',
  W1: 'MAINT-WSH-01',
  M1: 'MAINT-SVC-01',
  M2: 'MAINT-SVC-02',
  M3: 'MAINT-SVC-03',
  M4: 'MAINT-SVC-04',
  H1: 'MAINT-DSP-01',
  H2: 'MAINT-DSP-02',
  H3: 'MAINT-DSP-03',
};

const TRACK_OR_FACILITY_RE = /^([DU]\d{1,2}|E\d+|P[1-4]|H\d+|M\d+|W\d+)$/i;

function trackOrFacilityFromMotion(motion: {
  yard_slot_id?: string | null;
  track?: string;
}): string | null {
  if (typeof motion.yard_slot_id === 'string' && motion.yard_slot_id.trim()) {
    return motion.yard_slot_id.trim();
  }
  const trackPart =
    typeof motion.track === 'string' ? motion.track.replace(/→.*/, '').trim() : '';
  if (trackPart && TRACK_OR_FACILITY_RE.test(trackPart)) return trackPart;
  return null;
}

type MaintenanceSlotMotionContext = {
  VEHICLE_POOL: string[];
  elapsed: number;
  motionSimStartMs: number;
  getVehicleFleetStatus: (id: string) => 'on_field' | 'charging' | 'standby';
  getVehiclePublishMotion?: (
    id: string,
    elapsedMs: number,
    simStartMs: number,
    options?: { managed?: boolean },
  ) => Record<string, unknown> | null;
  getVehicleYardMotion?: (id: string) => Record<string, unknown> | null;
};

function formatEtaMmSs(progress: number, legMinutes: number): string {
  const totalSec = Math.max(
    0,
    Math.round((1 - Math.min(1, Math.max(0, progress))) * legMinutes * 60),
  );
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatEtaHhMmSs(progress: number, legMinutes: number): string {
  const totalSec = Math.max(
    0,
    Math.round((1 - Math.min(1, Math.max(0, progress))) * legMinutes * 60),
  );
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function tripTimesFromCode(
  tripCode: string | null | undefined,
  legMinutes: number,
): { plannedStart: number; plannedEnd: number } {
  const now = Date.now();
  const match = typeof tripCode === 'string' ? tripCode.match(/^[DU](\d{2})(\d{2})$/) : null;
  if (!match) {
    return { plannedStart: now, plannedEnd: now + legMinutes * 60_000 };
  }
  const start = new Date();
  start.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
  if (start.getTime() > now + 12 * 60 * 60_000) {
    start.setDate(start.getDate() - 1);
  }
  return { plannedStart: start.getTime(), plannedEnd: start.getTime() + legMinutes * 60_000 };
}

function mainlineStations(
  leg: string | undefined,
): { stA: string; stB: string; stC: string; segmentIndex: number } {
  const isUp = leg === 'up';
  return {
    stA: isUp ? 'station_6' : 'station_2',
    stB: isUp ? 'station_4' : 'station_3',
    stC: isUp ? 'station_1' : 'station_5',
    segmentIndex: isUp ? 1 : 0,
  };
}

function isShiftTripCode(code: unknown): code is string {
  return typeof code === 'string' && /^[DU]\d{4}$/.test(code.trim());
}

function deriveDemoOrderId(tripCode: string, departMs: number): string {
  const base = new Date(departMs);
  const yy = String(base.getFullYear()).slice(2);
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}-${tripCode.trim().toUpperCase()}`;
}

function mainlineRouteId(tripCode: string): string {
  return tripCode.startsWith('D') ? 'ROUTE-MAINLINE-DOWN' : 'ROUTE-MAINLINE-UP';
}

/** 與 MQTT operation/update 一致：正線班次（含停站中） */
function isMainlineFleetMotion(motion: {
  tripCode?: string;
  leg?: string;
  fleet_task?: string;
  preDeparture?: boolean;
}): boolean {
  if (!isShiftTripCode(motion.tripCode)) return false;
  if (motion.fleet_task === 'shift_run' || motion.fleet_task === 'pre_departure') return true;
  if (motion.preDeparture === true) return true;
  return motion.leg === 'down' || motion.leg === 'up';
}

/** 整備軌道兩站 S2W→格位；車已在格上（routeProgress=100 → remain 0%） */
function yardRouteFromSlot(_slotId?: string | null): { segmentIndex: number; routeProgress: number } {
  return { segmentIndex: 0, routeProgress: 100 };
}

export type SimulatedFaultEvent = {
  vehicleCode: string;
  eventCode: string;
  severity: string;
  message: string;
  timestamp: number;
  commandId?: string;
};

export type DemoSimulationTransport = {
  running: boolean;
  /** 傳輸暫停（程序仍運行，不自動發送；可逐幀） */
  transportPaused: boolean;
  speedMultiplier: number;
  /** 已提交之模擬經過毫秒（tick 錨點，100ms 格） */
  virtualElapsedMs: number;
  /** 上次 ack 牆鐘時刻；前端可外推：anchor + (now - lastAckWallMs) × speed */
  lastAckWallMs?: number;
  stepNonce: number;
  tickMs: number;
  /** 模擬起點（毫秒）；MQTT 子程序與 SQL 同步須一致 */
  simStartMs: number | null;
  /** 模擬器最近一次觸發的故障事件（供工具列驗收顯示） */
  lastSimulatedEvent: SimulatedFaultEvent | null;
  /** 模擬器待執行動作（CLEAR_FAULT、SIMULATE_OBSTACLE 等） */
  pendingSimulatorAction: {
    vehicleCode: string;
    action: string;
    nonce: number;
  } | null;
};

type PersistedTransportState = DemoSimulationTransport & {
  managedPid?: number;
};

export type DemoSimulationStatus = {
  running: boolean;
  paused: boolean;
  source: 'managed' | 'external' | 'none';
  startedAt: string | null;
  pid: number | null;
  transport: DemoSimulationTransport | null;
};

@Injectable()
export class DemoSimulationService {
  private readonly logger = new Logger(DemoSimulationService.name);
  private child: ChildProcess | null = null;
  private sqlTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: Date | null = null;
  private simStartMs: number | null = null;
  private paused = false;
  private transportPaused = false;
  private speedMultiplier = 1;
  private virtualElapsedMs = 0;
  private stepNonce = 0;
  private readonly tickMs = 100;
  private readonly transportStatePath = path.join(os.tmpdir(), 'syncdrive-demo-transport.json');
  private lastTransportPersistAt = 0;
  /** 上次模擬器 ack 的牆鐘時間，用於在 tick 之間外推虛擬時間 */
  private lastAckWallMs = 0;
  private lastSimulatedEvent: SimulatedFaultEvent | null = null;
  private pendingSimulatorAction: DemoSimulationTransport['pendingSimulatorAction'] = null;
  private syncVehicleTrackSqlPromise: Promise<void> | null = null;
  /** 模擬 tick 很密（8x 下約 40+ Hz）；SQL 同步節流，避免打爆 Postgres */
  private lastSyncVehicleTrackWallMs = 0;
  private static readonly SYNC_TRACK_MIN_WALL_MS = 3000;
  private cachedMotionModulePath: string | null = null;
  private cachedMotionModule: Record<string, unknown> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dashboardDemoSeed: DashboardDemoSeedService,
    private readonly orderService: OrderService,
    private readonly commandService: CommandService,
    private readonly datasourceInvalidation: DatasourceInvalidationService,
  ) {}

  async getStatus(): Promise<DemoSimulationStatus> {
    const managedPid = this.resolveManagedPid();
    if (managedPid != null) {
      this.rehydrateTransportFromFileIfOrphaned();
      return {
        running: true,
        paused: false,
        source: 'managed',
        startedAt: this.startedAt?.toISOString() ?? null,
        pid: managedPid,
        transport: this.buildTransportState(true),
      };
    }

    const externalPid = await this.findExternalSimulatorPid();
    if (externalPid) {
      return {
        running: true,
        paused: false,
        source: 'external',
        startedAt: null,
        pid: externalPid,
        transport: null,
      };
    }

    return {
      running: false,
      paused: this.paused,
      source: 'none',
      startedAt: null,
      pid: null,
      transport: null,
    };
  }

  getTransport(): DemoSimulationTransport {
    this.rehydrateTransportFromFileIfOrphaned();
    const running = this.isManagedRunning();
    return this.emitTransportState(running, { persist: true });
  }

  updateTransport(patch: { transportPaused?: boolean; speedMultiplier?: number }) {
    if (!this.isManagedRunning()) {
      throw new Error('模擬未運行，無法調整傳輸設定');
    }
    if (patch.transportPaused !== undefined) {
      this.transportPaused = patch.transportPaused;
    }
    if (patch.speedMultiplier !== undefined) {
      this.speedMultiplier = Math.max(0.25, Math.min(8, patch.speedMultiplier));
    }
    return this.getTransport();
  }

  stepTransportFrame(direction: 'next' | 'prev' = 'next'): DemoSimulationTransport {
    if (!this.isManagedRunning()) {
      throw new Error('模擬未運行，無法逐幀播放');
    }
    if (!this.transportPaused) {
      this.transportPaused = true;
    }
    if (direction === 'prev') {
      this.virtualElapsedMs = Math.max(0, this.virtualElapsedMs - this.tickMs);
    } else {
      this.virtualElapsedMs += this.tickMs;
    }
    this.stepNonce += 1;
    void this.syncVehicleTrackSql(true);
    return this.getTransport();
  }

  ackTransportTick(
    virtualElapsedMs: number,
    simulatedEvent?: SimulatedFaultEvent | null,
  ): DemoSimulationTransport {
    if (Number.isFinite(virtualElapsedMs) && virtualElapsedMs >= 0) {
      this.virtualElapsedMs = virtualElapsedMs;
      this.lastAckWallMs = Date.now();
    }
    if (simulatedEvent?.vehicleCode && simulatedEvent?.eventCode) {
      this.lastSimulatedEvent = simulatedEvent;
    }
    void this.syncVehicleTrackSql(false);
    return this.buildTransportState(this.isManagedRunning());
  }

  async triggerVehicleEmergencyStop(vehicleCode: string): Promise<{
    commandId: string;
    vehicleCode: string;
    action: string;
    expectedEvent: Pick<SimulatedFaultEvent, 'eventCode' | 'severity' | 'message'>;
  }> {
    const code = String(vehicleCode ?? '').trim().toUpperCase();
    if (!VTMS_VEHICLE_CODE_PATTERN.test(code)) {
      throw new Error(`無效的 vehicle_code：${vehicleCode}（須為 PMS01～PMS11）`);
    }
    if (!this.isManagedRunning()) {
      throw new Error('模擬未運行，請先按「開始模擬」');
    }

    const expectedMessage = '緊急停車指令：路徑受阻，車輛已安全停車（PATH_BLOCKED / CRITICAL）';
    const command = await this.commandService.executeCommand({
      vehicle_code: code,
      action: CommandType.EMERGENCY_STOP,
      params: { deceleration: 'MAX', hazard_light: true },
    });

    return {
      commandId: command.commandId,
      vehicleCode: code,
      action: CommandType.EMERGENCY_STOP,
      expectedEvent: {
        eventCode: 'PATH_BLOCKED',
        severity: 'CRITICAL',
        message: expectedMessage,
      },
    };
  }

  /** 與 MQTT 子程序共用固定模擬起點，避免 ack 改寫 simStartMs 導致車隊狀態重設 */
  private getMotionSimStartMs(): number | null {
    return this.startedAt?.getTime() ?? this.simStartMs;
  }

  /** 圖台／SQL 取樣用虛擬時間：運行中依速度倍率在 tick 之間連續外推 */
  private resolveMotionElapsedMs(): number {
    const motionSimStartMs = this.getMotionSimStartMs();
    if (!motionSimStartMs) return 0;
    if (this.transportPaused) {
      return this.virtualElapsedMs;
    }
    if (this.lastAckWallMs > 0) {
      return Math.max(
        0,
        this.virtualElapsedMs + (Date.now() - this.lastAckWallMs) * this.speedMultiplier,
      );
    }
    return Math.max(0, Date.now() - motionSimStartMs);
  }

  private buildTransportState(running: boolean): DemoSimulationTransport {
    return {
      running,
      transportPaused: this.transportPaused,
      speedMultiplier: this.speedMultiplier,
      virtualElapsedMs: this.virtualElapsedMs,
      lastAckWallMs: this.lastAckWallMs > 0 ? this.lastAckWallMs : undefined,
      stepNonce: this.stepNonce,
      tickMs: this.tickMs,
      simStartMs: this.getMotionSimStartMs(),
      lastSimulatedEvent: this.lastSimulatedEvent,
      pendingSimulatorAction: this.pendingSimulatorAction,
    };
  }

  private emitTransportState(running: boolean, options?: { persist?: boolean }): DemoSimulationTransport {
    const state = this.buildTransportState(running);
    const shouldPersist =
      options?.persist === true ||
      (options?.persist !== false && Date.now() - this.lastTransportPersistAt >= 1000);
    if (shouldPersist) {
      this.persistTransportState(state);
      this.lastTransportPersistAt = Date.now();
    }
    return state;
  }

  private resolveManagedPid(): number | null {
    if (this.child?.pid && !this.child.killed && this.isPidAlive(this.child.pid)) {
      return this.child.pid;
    }
    const file = this.loadTransportStateFromFile();
    if (file?.managedPid && this.isPidAlive(file.managedPid)) {
      return file.managedPid;
    }
    return null;
  }

  private isManagedRunning(): boolean {
    return this.resolveManagedPid() != null;
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private loadTransportStateFromFile(): PersistedTransportState | null {
    try {
      const raw = fs.readFileSync(this.transportStatePath, 'utf8');
      return JSON.parse(raw) as PersistedTransportState;
    } catch {
      return null;
    }
  }

  private rehydrateTransportFromFileIfOrphaned() {
    if (this.child?.pid && !this.child.killed) return;
    const file = this.loadTransportStateFromFile();
    if (!file?.managedPid || !this.isPidAlive(file.managedPid)) return;
    if (typeof file.simStartMs === 'number' && Number.isFinite(file.simStartMs) && file.simStartMs > 0) {
      this.simStartMs = file.simStartMs;
      this.startedAt = new Date(file.simStartMs);
    }
    if (typeof file.transportPaused === 'boolean') {
      this.transportPaused = file.transportPaused;
    }
    if (typeof file.speedMultiplier === 'number') {
      this.speedMultiplier = Math.max(0.25, Math.min(8, file.speedMultiplier));
    }
    if (typeof file.virtualElapsedMs === 'number') {
      this.virtualElapsedMs = file.virtualElapsedMs;
      this.lastAckWallMs = Date.now();
    }
    if (typeof file.stepNonce === 'number') {
      this.stepNonce = file.stepNonce;
    }
    if (file.lastSimulatedEvent?.vehicleCode) {
      this.lastSimulatedEvent = file.lastSimulatedEvent;
    }
    if (file.pendingSimulatorAction?.nonce) {
      this.pendingSimulatorAction = file.pendingSimulatorAction;
    }
  }

  private persistTransportState(state: DemoSimulationTransport) {
    const managedPid = this.resolveManagedPid() ?? undefined;
    const payload: PersistedTransportState = { ...state, managedPid };
    try {
      fs.writeFileSync(this.transportStatePath, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn('Failed to persist transport state', err);
    }
  }

  private clearTransportStateFile() {
    try {
      fs.unlinkSync(this.transportStatePath);
    } catch {
      /* ignore */
    }
  }

  private resetTransportState() {
    this.transportPaused = false;
    this.speedMultiplier = 1;
    this.virtualElapsedMs = 0;
    this.stepNonce = 0;
    this.lastSimulatedEvent = null;
    this.pendingSimulatorAction = null;
  }

  private enqueueSimulatorAction(vehicleCode: string, action: string) {
    if (!this.isManagedRunning()) {
      throw new Error('模擬未運行，請先按「開始模擬」');
    }
    const code = String(vehicleCode ?? '').trim().toUpperCase();
    if (!VTMS_VEHICLE_CODE_PATTERN.test(code)) {
      throw new Error(`無效的 vehicle_code：${vehicleCode}`);
    }
    this.pendingSimulatorAction = {
      vehicleCode: code,
      action,
      nonce: Date.now(),
    };
    this.persistTransportState(this.buildTransportState(true));
  }

  async clearVehicleFault(vehicleCode: string) {
    this.enqueueSimulatorAction(vehicleCode, 'CLEAR_FAULT');
    await this.orderService.recoverFaultedOrderForVehicle(
      String(vehicleCode).trim().toUpperCase(),
    );
    return { vehicleCode: String(vehicleCode).trim().toUpperCase(), action: 'CLEAR_FAULT' };
  }

  async simulateVehicleObstacle(vehicleCode: string) {
    this.enqueueSimulatorAction(vehicleCode, 'SIMULATE_OBSTACLE');
    return { vehicleCode: String(vehicleCode).trim().toUpperCase(), action: 'SIMULATE_OBSTACLE' };
  }

  /**
   * 已停用：中心端不再自己生車輛資料。
   *
   * 這裡以前會 spawn vtms-shift-demo-simulator.js，那支程式代替全部 PMS01～11
   * 發布 telemetry。問題是模擬器<strong>只該有一份</strong>：它跑在開發者機器上
   * （simulator/），以外部廠商身分連線。兩邊同時跑會搶同一批車號，輪流蓋掉對方
   * 的位置，圖台上的車就散在莫名其妙的地方（實測那支回報 x=1025，超出圖資的
   * x 上限 900）。
   *
   * 而且它啟動時會 TRUNCATE telemetry_logs。那對一個「示範」功能來說權限太大了。
   *
   * 端點保留並明確回絕，不是靜靜地成功——按下按鈕卻什麼都沒發生，比講清楚更難查。
   */
  async start(): Promise<DemoSimulationStatus> {
    throw new Error(
      '中心端的示範模擬器已移除。模擬器是外部單位，只有一份，'
      + '請在開發機執行 simulator/（cd simulator && npm start，http://127.0.0.1:4300）。',
    );
  }

  async pause(): Promise<DemoSimulationStatus> {
    this.stopSqlTick();
    this.startedAt = null;
    this.simStartMs = null;
    this.paused = true;
    this.resetTransportState();
    this.clearTransportStateFile();
    this.logger.log('Demo simulation paused');
    return this.getStatus();
  }

  private startSqlTick() {
    this.stopSqlTick();
    void this.tickSql();
    this.sqlTimer = setInterval(() => void this.tickSql(), 30_000);
  }

  private stopSqlTick() {
    if (this.sqlTimer) {
      clearInterval(this.sqlTimer);
      this.sqlTimer = null;
    }
  }

  private async tickSql() {
    try {
      // 運能折線改由 MQTT / 查詢 offset 相對時間呈現；勿遞減 offset（會使 KPI JOIN 失敗）
      await this.dataSource.query(`
        UPDATE vehicle_monitor_demo
        SET demo_speed = LEAST(
              24,
              GREATEST(8, COALESCE(demo_speed, 14) + (floor(random() * 3) - 1)::int)
            )
        WHERE vehicle_code NOT LIKE 'PMS%'
      `);
      await this.dataSource.query(`
        UPDATE operation_orders
        SET delay_minutes = GREATEST(0, COALESCE(delay_minutes, 0) + (floor(random() * 3) - 1)::int)
        WHERE order_id LIKE 'DEMO-ML-%'
          AND status IN ('PROCESSING', 'PENDING')
      `);
      await this.syncVehicleTrackSql();
      this.datasourceInvalidation.emit(
        [
          DS_TAGS.CAPACITY_TREND,
          DS_TAGS.SHIFT_CENTER,
          DS_TAGS.VEHICLE_MONITOR,
          DS_TAGS.SLOT_STATUS,
          DS_TAGS.MAINTENANCE_SLOTS,
          DS_TAGS.VEHICLE_DISTRIBUTION,
        ],
        'demo_sql_tick',
      );
    } catch (err) {
      this.logger.warn('Demo SQL tick failed', err);
    }
  }

  /** 依 v0.0.5 軌道路徑同步 SQL 示範列（segment / route_progress / 電量） */
  private syncVehicleTrackSql(force = false): Promise<void> {
    if (!force) {
      const now = Date.now();
      if (now - this.lastSyncVehicleTrackWallMs < DemoSimulationService.SYNC_TRACK_MIN_WALL_MS) {
        return Promise.resolve();
      }
      this.lastSyncVehicleTrackWallMs = now;
    } else {
      this.lastSyncVehicleTrackWallMs = Date.now();
    }
    if (this.syncVehicleTrackSqlPromise) {
      return this.syncVehicleTrackSqlPromise;
    }
    this.syncVehicleTrackSqlPromise = this.runSyncVehicleTrackSql().finally(() => {
      this.syncVehicleTrackSqlPromise = null;
    });
    return this.syncVehicleTrackSqlPromise;
  }

  private async runSyncVehicleTrackSql() {
    this.rehydrateTransportFromFileIfOrphaned();
    const motionSimStartMs = this.getMotionSimStartMs();
    const maintenanceSnapshots: MaintenanceOrderLifecycleSnapshot[] = [];
    let slotMotion: MaintenanceSlotMotionContext | null = null;

    if (motionSimStartMs == null) {
      try {
        await this.syncMaintenanceDistributionSlots(maintenanceSnapshots, null);
        this.datasourceInvalidation.emitMaintenanceSlots();
      } catch (err) {
        this.logger.warn(`syncMaintenanceDistributionSlots failed: ${(err as Error)?.message ?? err}`);
      }
      return;
    }

    try {
      const motionModulePath = this.resolveTrackMotionModule();
      if (!motionModulePath) return;

      const motionModule = this.loadMotionModule(motionModulePath) as {
        VEHICLE_POOL: string[];
        getActiveFleet: () => Array<{ id: string; offsetMin: number }>;
        tickFleetBatteryState: (elapsedMs: number, simStartMs: number) => unknown;
        getVehicleBattery: (id: string) => number | null;
        getVehicleFleetStatus: (id: string) => 'on_field' | 'charging' | 'standby';
        getVehicleMotion: (
          id: string,
          elapsedMs: number,
          simStartMs: number,
          options?: { managed?: boolean },
        ) => Record<string, unknown> | null;
        getScheduledSlotPendingInfo?: (
          id: string,
          elapsedMs: number,
          simStartMs: number,
        ) => { tripCode?: string } | null;
        getVehiclePreDepartureMotion?: (
          id: string,
          elapsedMs: number,
          simStartMs: number,
        ) => Record<string, unknown> | null;
        getVehicleYardMotion?: (id: string) => Record<string, unknown> | null;
        getVehiclePublishMotion?: (
          id: string,
          elapsedMs: number,
          simStartMs: number,
          options?: { managed?: boolean },
        ) => Record<string, unknown> | null;
      };
      const {
        VEHICLE_POOL,
        getActiveFleet,
        tickFleetBatteryState,
        getVehicleBattery,
        getVehicleFleetStatus,
        getVehicleMotion,
        getVehiclePreDepartureMotion,
        getScheduledSlotPendingInfo,
        getVehicleYardMotion,
        getVehiclePublishMotion,
      } = motionModule;

      const elapsed = this.resolveMotionElapsedMs();
      tickFleetBatteryState(elapsed, motionSimStartMs);
      slotMotion = {
        VEHICLE_POOL,
        elapsed,
        motionSimStartMs,
        getVehicleFleetStatus,
        getVehiclePublishMotion,
        getVehicleYardMotion,
      };

      const maintCatalog = this.resolveMaintenanceTaskCatalog();
      const mainlineSnapshots: MainlineOrderLifecycleSnapshot[] = [];

      for (const vehicleId of VEHICLE_POOL) {
        const battery = getVehicleBattery(vehicleId);
        if (battery == null) continue;

        await this.dataSource.query(
          `
          INSERT INTO vehicle_monitor_demo (
            vehicle_code, demo_load, overall_health, alert_message, card_border_color,
            status_computing, status_sensing, status_communication, status_chassis,
            badge_label, badge_outline
          )
          VALUES ($1, $2::numeric, 'OK', '', '#00c897', 'OK', 'OK', 'OK', 'OK', NULL, '0')
          ON CONFLICT (vehicle_code) DO UPDATE SET
            demo_load = EXCLUDED.demo_load,
            overall_health = 'OK',
            alert_message = '',
            card_border_color = '#00c897',
            status_computing = 'OK',
            status_sensing = 'OK',
            status_communication = 'OK',
            status_chassis = 'OK',
            badge_outline = '0'
          `,
          [vehicleId, battery],
        );

        const rawMotion =
          getVehiclePublishMotion?.(vehicleId, elapsed, motionSimStartMs, { managed: true }) ??
          getVehicleMotion(vehicleId, elapsed, motionSimStartMs, { managed: true }) ??
          getVehiclePreDepartureMotion?.(vehicleId, elapsed, motionSimStartMs) ??
          getVehicleYardMotion?.(vehicleId) ??
          null;
        const motion = rawMotion as {
          active?: boolean;
          track?: string;
          progress?: number;
          tripCode?: string;
          fleet_task?: string;
          leg?: string;
          dwelling?: boolean;
          yard_slot_id?: string | null;
          cycleIndex?: number;
          legDepartMs?: number;
          station?: string;
        } | null;
        if (!motion?.track) continue;

        const shiftTripCode = isShiftTripCode(motion.tripCode) ? motion.tripCode.trim() : null;

        if (isMainlineFleetMotion(motion) && shiftTripCode) {
          const progressPct = Math.round((motion.progress ?? 0) * 100);
          const segment = motion.track.replace(/→.*/, '');
          const departMs = motion.legDepartMs ?? Date.now();
          const orderId = deriveDemoOrderId(shiftTripCode, departMs);
          const phase =
            motion.fleet_task === 'shift_run' || motion.active === true
              ? 'processing'
              : 'pending';

          mainlineSnapshots.push({
            vehicleCode: vehicleId,
            orderId,
            tripCode: shiftTripCode,
            routeId: mainlineRouteId(shiftTripCode),
            phase,
          });

          await this.dataSource.query(
            `
            UPDATE vehicle_monitor_demo
            SET segment_label = $2,
                demo_speed = LEAST(24, GREATEST(8, $3::numeric)),
                badge_label = $4
            WHERE vehicle_code = $1
            `,
            [vehicleId, segment, 10 + progressPct / 10, shiftTripCode],
          );
          continue;
        }

        const maintMeta = maintCatalog.resolveMaintenanceTaskMeta(motion);
        if (maintMeta) {
          if (!isMainlineFleetMotion(motion)) {
            const tripCode = maintCatalog.maintenanceTripCode(motion, maintMeta);
            const yardRoute = yardRouteFromSlot(motion.yard_slot_id);
            const yardSlotId =
              typeof motion.yard_slot_id === 'string' ? motion.yard_slot_id.trim().toUpperCase() : '';
            maintenanceSnapshots.push({
              vehicleCode: vehicleId,
              orderId: maintCatalog.maintenanceDemoOrderId(vehicleId, yardSlotId),
              tripCode,
              phase: 'processing',
              maintTypeLabel: String(maintMeta.maint_type_label ?? '整備'),
              maintTypeBg: String(maintMeta.maint_type_bg ?? 'transparent'),
              maintTypeColor: String(maintMeta.maint_type_color ?? '#FD9A00'),
              iconBgColor: String(maintMeta.icon_bg_color ?? '#51A2FF'),
              progressMarkerIcon: String(maintMeta.progress_marker_icon ?? 'Zap'),
              yardSlotId: motion.yard_slot_id ?? null,
              maintStation: typeof motion.station === 'string' ? motion.station : null,
              segmentIndex: yardRoute.segmentIndex,
              routeProgress: yardRoute.routeProgress,
            });
          }
          const yardLabel = trackOrFacilityFromMotion(motion);
          if (yardLabel) {
            await this.dataSource.query(
              `
              UPDATE vehicle_monitor_demo
              SET segment_label = $2,
                  demo_speed = 0,
                  badge_label = $3
              WHERE vehicle_code = $1
              `,
              [vehicleId, yardLabel, maintMeta?.maint_type_label ?? null],
            );
          } else {
            await this.dataSource.query(
              `
              UPDATE vehicle_monitor_demo
              SET demo_speed = 0,
                  badge_label = $2
              WHERE vehicle_code = $1
              `,
              [vehicleId, maintMeta?.maint_type_label ?? null],
            );
          }
        }
      }

      for (const slot of getActiveFleet()) {
        const offsetMs = slot.offsetMin * 60 * 1000;
        if (elapsed >= offsetMs) continue;
        const preMotion = getScheduledSlotPendingInfo?.(slot.id, elapsed, motionSimStartMs)
          ?? getVehiclePreDepartureMotion?.(slot.id, elapsed, motionSimStartMs);
        const preTrip = isShiftTripCode(preMotion?.tripCode) ? preMotion!.tripCode!.trim() : null;
        if (!preTrip) continue;
        const departMs = motionSimStartMs + offsetMs;
        const orderId = deriveDemoOrderId(preTrip, departMs);
        mainlineSnapshots.push({
          vehicleCode: slot.id,
          orderId,
          tripCode: preTrip,
          routeId: mainlineRouteId(preTrip),
          phase: 'pending',
        });
      }

      try {
        const ended = await this.orderService.reconcileMainlineOrderLifecycle(mainlineSnapshots);
        if (ended > 0) {
          this.logger.debug(`reconcile mainline orders: ended ${ended} stale slot(s)`);
        }
      } catch (err) {
        this.logger.warn(
          `reconcile mainline orders failed: ${(err as Error)?.message ?? err}`,
        );
      }

      try {
        const maintEnded = await this.orderService.reconcileMaintenanceOrderLifecycle(
          maintenanceSnapshots,
        );
        if (maintEnded > 0) {
          this.logger.debug(`reconcile maintenance orders: ended ${maintEnded} stale task(s)`);
        }
      } catch (err) {
        this.logger.warn(
          `reconcile maintenance orders failed: ${(err as Error)?.message ?? err}`,
        );
      }

      await this.syncMaintenanceDistributionSlots(maintenanceSnapshots, slotMotion);
      this.datasourceInvalidation.emitMaintenanceSlots();

    } catch (err) {
      this.logger.warn(`syncVehicleTrackSql failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /** 整備分佈：依模擬 yard_slot_id 與整備訂單同步 slot_statuses */
  private async syncMaintenanceDistributionSlots(
    maintenanceSnapshots: ReadonlyArray<MaintenanceOrderLifecycleSnapshot>,
    motion: MaintenanceSlotMotionContext | null,
  ): Promise<void> {
    const assignmentByVehicle = new Map<string, { facilityId: string; charging: boolean }>();

    const ingest = (vehicleId: string, facilityId: string, charging: boolean) => {
      const id = String(vehicleId ?? '').trim().toUpperCase();
      const facility = String(facilityId ?? '').trim().toUpperCase();
      if (!id || !facility) return;
      if (!FACILITY_TO_MAINT_SLOT[facility]) return;
      assignmentByVehicle.set(id, { facilityId: facility, charging });
    };

    if (motion) {
      for (const vehicleId of motion.VEHICLE_POOL) {
        const pub =
          motion.getVehiclePublishMotion?.(
            vehicleId,
            motion.elapsed,
            motion.motionSimStartMs,
            { managed: true },
          ) ?? motion.getVehicleYardMotion?.(vehicleId);
        const yardSlotId = pub?.yard_slot_id;
        const facilityId =
          typeof yardSlotId === 'string' ? yardSlotId.trim().toUpperCase() : '';
        if (!facilityId) continue;
        ingest(vehicleId, facilityId, motion.getVehicleFleetStatus(vehicleId) === 'charging');
      }
    }

    for (const snap of maintenanceSnapshots) {
      const facilityId =
        typeof snap.yardSlotId === 'string' ? snap.yardSlotId.trim().toUpperCase() : '';
      if (!facilityId) continue;
      const charging = String(snap.maintTypeLabel ?? '').includes('充電');
      ingest(snap.vehicleCode, facilityId, charging);
    }

    const orderRows = (await this.dataSource.query(`
      SELECT
        o.vehicle_code,
        NULLIF(TRIM(o.payload->>'yard_slot_id'), '') AS yard_slot_id,
        o.maint_type_label
      FROM operation_orders o
      WHERE o.line_kind = 'MAINTENANCE'
        AND o.status IN ('PENDING', 'PROCESSING')
        AND NULLIF(TRIM(o.payload->>'yard_slot_id'), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM operation_orders ml
          WHERE ml.vehicle_code = o.vehicle_code
            AND ml.line_kind = 'MAINLINE'
            AND ml.status = 'PROCESSING'
            AND COALESCE(
              (SELECT demo_speed FROM vehicle_monitor_demo m WHERE m.vehicle_code = o.vehicle_code),
              0
            ) >= 1
        )
    `)) as Array<{ vehicle_code: string; yard_slot_id: string; maint_type_label: string | null }>;

    for (const row of orderRows) {
      const vehicleId = String(row.vehicle_code ?? '').trim().toUpperCase();
      if (assignmentByVehicle.has(vehicleId)) continue;
      ingest(
        vehicleId,
        String(row.yard_slot_id ?? '').trim().toUpperCase(),
        String(row.maint_type_label ?? '').includes('充電'),
      );
    }

    const now = Date.now();
    await this.dataSource.query(
      `
      UPDATE slot_statuses
      SET status = 'AVAILABLE',
          vehicle_code = NULL,
          last_updated = $1,
          raw_payload = '{}'::jsonb
      WHERE slot_id LIKE 'MAINT-%'
      `,
      [now],
    );

    for (const [vehicleId, { facilityId, charging }] of assignmentByVehicle) {
      const slotId = FACILITY_TO_MAINT_SLOT[facilityId];
      if (!slotId) continue;
      const status = charging && facilityId.startsWith('E') ? 'CHARGING' : 'OCCUPIED';
      await this.dataSource.query(
        `
        UPDATE slot_statuses
        SET status = $2,
            vehicle_code = $3,
            last_updated = $1,
            raw_payload = '{}'::jsonb
        WHERE slot_id = $4
        `,
        [now, status, vehicleId, slotId],
      );
    }
  }

  private loadMotionModule(modulePath: string): Record<string, unknown> {
    if (this.cachedMotionModulePath !== modulePath || !this.cachedMotionModule) {
      this.cachedMotionModulePath = modulePath;
      this.cachedMotionModule = requireCjs(modulePath) as Record<string, unknown>;
    }
    return this.cachedMotionModule;
  }

  private invalidateMotionModuleCache(): void {
    if (this.cachedMotionModulePath) {
      try {
        delete require.cache[this.cachedMotionModulePath];
      } catch {
        /* ignore */
      }
    }
    this.cachedMotionModulePath = null;
    this.cachedMotionModule = null;
  }

  private resolveMaintenanceTaskCatalog(): {
    resolveMaintenanceTaskMeta: (motion: Record<string, unknown>) => Record<string, unknown> | null;
    maintenanceTripCode: (motion: Record<string, unknown>, meta: Record<string, unknown>) => string;
    maintenanceDemoOrderId: (vehicleCode: string, yardSlotId: string) => string;
  } {
    const candidates = [
      path.join(process.cwd(), 'scripts', 'maintenance-task-catalog.js'),
      path.join(process.cwd(), 'backend', 'scripts', 'maintenance-task-catalog.js'),
      path.join(__dirname, '..', '..', 'scripts', 'maintenance-task-catalog.js'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return requireCjs(p);
    }
    throw new Error('maintenance-task-catalog.js not found');
  }

  private resolveTrackMotionModule(): string | null {
    const candidates = [
      path.join(process.cwd(), 'scripts', 't3-v0-0-5-track-motion.js'),
      path.join(process.cwd(), 'backend', 'scripts', 't3-v0-0-5-track-motion.js'),
      path.join(__dirname, '..', '..', 'scripts', 't3-v0-0-5-track-motion.js'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private resetFleetBatteryState() {
    const motionSimStartMs = this.getMotionSimStartMs();
    if (motionSimStartMs == null) return;
    try {
      const motionModulePath = this.resolveTrackMotionModule();
      if (!motionModulePath) return;
      const motionModule = requireCjs(motionModulePath) as {
        resetFleetBatteryState: (simStartMs: number) => void;
      };
      motionModule.resetFleetBatteryState(motionSimStartMs);
    } catch (err) {
      this.logger.warn('resetFleetBatteryState failed', err);
    }
  }

  private async ensureMqttBroker(): Promise<void> {
    const mqttUrl = process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883';
    const normalized = mqttUrl.replace(/^mqtts?:\/\//, 'http://');
    let host = '127.0.0.1';
    let port = 1883;
    try {
      const parsed = new URL(normalized);
      host = parsed.hostname || host;
      port = parsed.port ? Number(parsed.port) : port;
    } catch {
      /* use defaults */
    }

    await new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host, port }, () => {
        sock.destroy();
        resolve();
      });
      sock.setTimeout(4000, () => {
        sock.destroy();
        reject(
          new Error(
            `MQTT broker 連線逾時 (${host}:${port})，請先執行 npm run dev 啟動 Docker`,
          ),
        );
      });
      sock.on('error', () => {
        sock.destroy();
        reject(
          new Error(
            `MQTT broker 無法連線 (${host}:${port})，請先執行 npm run dev 啟動 Docker`,
          ),
        );
      });
    });
  }

  /**
   * 已停用：中心端不再啟動任何模擬器程序，也就沒有「外部的那一支」要找。
   *
   * 留著回 null 而不是整個拿掉，是因為呼叫端用它判斷「有沒有人代替車輛在發話」，
   * 答案現在恆為「沒有」。
   */
  private async findExternalSimulatorPid(): Promise<number | null> {
    return null;
  }
}
