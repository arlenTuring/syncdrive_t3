import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';
import { OrderService, type MainlineOrderLifecycleSnapshot } from '../order/order.service';
import { CommandService } from '../command/command.service';
import { CommandType } from '../database/entities/command-log.entity';
import { VTMS_VEHICLE_CODE_PATTERN } from '../common/vehicle-codes';

const requireCjs = createRequire(__filename);

const MAINLINE_LEG_MINUTES = 6;
const MAINT_TASK_MINUTES = 30;

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
    stA: isUp ? 'S2W' : 'N2W',
    stB: 'T3',
    stC: isUp ? 'N2W' : 'S2W',
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

function yardRouteFromSlot(slotId: string | null | undefined): { segmentIndex: number; routeProgress: number } {
  const slot = String(slotId ?? '').toUpperCase();
  if (slot.startsWith('P')) return { segmentIndex: 2, routeProgress: 85 };
  if (slot.startsWith('E')) return { segmentIndex: 1, routeProgress: 50 };
  if (slot.startsWith('W')) return { segmentIndex: 1, routeProgress: 40 };
  if (slot.startsWith('H') || slot.startsWith('M')) return { segmentIndex: 0, routeProgress: 20 };
  return { segmentIndex: 0, routeProgress: 15 };
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
  virtualElapsedMs: number;
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
  private cachedMotionModulePath: string | null = null;
  private cachedMotionModule: Record<string, unknown> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dashboardDemoSeed: DashboardDemoSeedService,
    private readonly orderService: OrderService,
    private readonly commandService: CommandService,
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
      this.speedMultiplier = Math.max(0.25, Math.min(15, patch.speedMultiplier));
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
    void this.syncVehicleTrackSql();
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
    void this.syncVehicleTrackSql();
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
      throw new Error(`無效的 vehicle_code：${vehicleCode}（須為 PMS-01～PMS-11）`);
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
      this.speedMultiplier = file.speedMultiplier;
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

  async start(): Promise<DemoSimulationStatus> {
    await this.ensureMqttBroker();
    try {
      await this.dataSource.query('TRUNCATE telemetry_logs');
      this.logger.log('Truncated telemetry_logs before demo start');
    } catch (err) {
      this.logger.warn('Failed to truncate telemetry_logs before demo start', err);
    }
    await this.dashboardDemoSeed.reseedAll();
    await this.killAllSimulators();

    const scriptPath = this.resolveSimulatorScript();
    if (!scriptPath) {
      throw new Error('找不到 vtms-shift-demo-simulator.js');
    }

    const port = process.env.PORT ?? '3000';
    const transportApi = `http://127.0.0.1:${port}/syncdrive-api/demo/simulation`;

    this.startedAt = new Date();
    this.simStartMs = this.startedAt.getTime();
    const motionSimStartMs = this.simStartMs;

    this.child = spawn(process.execPath, [scriptPath], {
      cwd: path.dirname(path.dirname(scriptPath)),
      env: {
        ...process.env,
        MANAGED: '1',
        MQTT_URL: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
        TRANSPORT_API: transportApi,
        SYNC_API: `http://127.0.0.1:${port}/syncdrive-api`,
        TRANSPORT_STATE_FILE: this.transportStatePath,
        SIM_START_MS: String(motionSimStartMs),
      },
      stdio: 'ignore',
      detached: false,
    });

    this.child.on('exit', (code, signal) => {
      this.logger.log(`VTMS shift simulator exited (code=${code}, signal=${signal})`);
      this.child = null;
      this.stopSqlTick();
      this.clearTransportStateFile();
    });

    this.child.on('error', (err) => {
      this.logger.error('VTMS shift simulator failed to start', err);
      this.child = null;
      this.stopSqlTick();
      this.clearTransportStateFile();
    });
    this.paused = false;
    this.resetTransportState();
    this.resetFleetBatteryState();
    this.lastAckWallMs = Date.now();
    this.emitTransportState(true);
    this.startSqlTick();
    await this.syncVehicleTrackSql();

    this.logger.log(`Demo simulation started (pid=${this.child.pid})`);
    return this.getStatus();
  }

  async pause(): Promise<DemoSimulationStatus> {
    await this.killAllSimulators();
    this.stopSqlTick();
    this.child = null;
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
      await this.dataSource.query(`
        UPDATE capacity_trend_demo_points
        SET offset_minutes = offset_minutes - 1
        WHERE demo_set_id = 'DEMO'
      `);
      await this.dataSource.query(`
        UPDATE vehicle_monitor_demo
        SET demo_speed = LEAST(
              24,
              GREATEST(8, COALESCE(demo_speed, 14) + (floor(random() * 3) - 1)::int)
            )
        WHERE vehicle_code NOT LIKE 'PMS-%'
      `);
      await this.dataSource.query(`
        UPDATE operation_orders
        SET delay_minutes = GREATEST(0, COALESCE(delay_minutes, 0) + (floor(random() * 3) - 1)::int)
        WHERE order_id LIKE 'DEMO-ML-%'
          AND status IN ('PROCESSING', 'PENDING')
      `);
      await this.syncVehicleTrackSql();
    } catch (err) {
      this.logger.warn('Demo SQL tick failed', err);
    }
  }

  /** 依 v0.0.5 軌道路徑同步 SQL 示範列（segment / route_progress / 電量） */
  private syncVehicleTrackSql(): Promise<void> {
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
    if (motionSimStartMs == null) return;
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
        getVehiclesInYardKind?: (kind: 'charge' | 'park' | 'maint') => string[];
      };
      const {
        VEHICLE_POOL,
        getActiveFleet,
        tickFleetBatteryState,
        getVehicleBattery,
        getVehicleFleetStatus,
        getVehicleMotion,
        getVehiclePreDepartureMotion,
        getVehicleYardMotion,
        getVehiclePublishMotion,
        getVehiclesInYardKind,
      } = motionModule;

      const elapsed = this.resolveMotionElapsedMs();
      tickFleetBatteryState(elapsed, motionSimStartMs);

      const chargingInYard = getVehiclesInYardKind?.('charge') ?? [];
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
          await this.dataSource.query(
            `
            UPDATE vehicle_monitor_demo
            SET segment_label = $2,
                demo_speed = 0,
                badge_label = $3
            WHERE vehicle_code = $1
            `,
            [vehicleId, motion.track, maintMeta?.maint_type_label ?? null],
          );
        }
      }

      for (const slot of getActiveFleet()) {
        const offsetMs = slot.offsetMin * 60 * 1000;
        if (elapsed >= offsetMs) continue;
        const preMotion = getVehiclePreDepartureMotion?.(slot.id, elapsed, motionSimStartMs) as {
          tripCode?: string;
        } | null;
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

      await this.dataSource.query(`
        UPDATE slot_statuses
        SET status = 'AVAILABLE', vehicle_code = NULL, last_updated = $1
        WHERE slot_id LIKE 'MAINT-CHG-%'
           OR slot_id LIKE 'MAINT-PRK-%'
           OR slot_id LIKE 'MAINT-DSP-%'
      `, [Date.now()]);

      const chargeSlots = ['MAINT-CHG-01', 'MAINT-CHG-02', 'MAINT-CHG-03', 'MAINT-CHG-04'];
      for (let i = 0; i < chargingInYard.length && i < chargeSlots.length; i += 1) {
        await this.dataSource.query(
          `
          UPDATE slot_statuses
          SET status = 'CHARGING',
              vehicle_code = $2,
              last_updated = $1
          WHERE slot_id = $3
          `,
          [Date.now(), chargingInYard[i], chargeSlots[i]],
        );
      }

      const parkedIds = getVehiclesInYardKind?.('park') ?? [];
      const parkSlotByPlatform: Record<string, string> = {
        P1: 'MAINT-PRK-01',
        P2: 'MAINT-PRK-02',
      };
      const parkSlotUsed = new Set<string>();
      for (const vehicleId of parkedIds) {
        const yardMotion = getVehicleYardMotion?.(vehicleId) as {
          yard_slot_id?: string | null;
        } | null;
        const platform = yardMotion?.yard_slot_id ?? null;
        if (!platform || (platform !== 'P1' && platform !== 'P2')) continue;
        const slotId = parkSlotByPlatform[platform];
        if (!slotId || parkSlotUsed.has(slotId)) continue;
        parkSlotUsed.add(slotId);
        await this.dataSource.query(
          `
          UPDATE slot_statuses
          SET status = 'OCCUPIED',
              vehicle_code = $2,
              last_updated = $1
          WHERE slot_id = $3
          `,
          [Date.now(), vehicleId, slotId],
        );
      }

      const maintStandbyIds = (getVehiclesInYardKind?.('maint') ?? []).filter(
        (id) => getVehicleFleetStatus(id) === 'standby',
      );
      const dspSlots = ['MAINT-DSP-01', 'MAINT-DSP-02', 'MAINT-DSP-03'];
      for (let i = 0; i < maintStandbyIds.length && i < dspSlots.length; i += 1) {
        await this.dataSource.query(
          `
          UPDATE slot_statuses
          SET status = 'OCCUPIED',
              vehicle_code = $2,
              last_updated = $1
          WHERE slot_id = $3
          `,
          [Date.now(), maintStandbyIds[i], dspSlots[i]],
        );
      }

    } catch (err) {
      this.logger.warn(`syncVehicleTrackSql failed: ${(err as Error)?.message ?? err}`);
    }
  }

  private loadMotionModule(modulePath: string): Record<string, unknown> {
    if (this.cachedMotionModulePath !== modulePath || !this.cachedMotionModule) {
      this.cachedMotionModulePath = modulePath;
      this.cachedMotionModule = requireCjs(modulePath) as Record<string, unknown>;
    }
    return this.cachedMotionModule;
  }

  private resolveMaintenanceTaskCatalog(): {
    resolveMaintenanceTaskMeta: (motion: Record<string, unknown>) => Record<string, unknown> | null;
    maintenanceTripCode: (motion: Record<string, unknown>, meta: Record<string, unknown>) => string;
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

  private resolveSimulatorScript(): string | null {
    const candidates = [
      path.join(process.cwd(), 'scripts', 'vtms-shift-demo-simulator.js'),
      path.join(process.cwd(), 'backend', 'scripts', 'vtms-shift-demo-simulator.js'),
      path.join(__dirname, '..', '..', 'scripts', 'vtms-shift-demo-simulator.js'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private async killAllSimulators(): Promise<void> {
    if (this.child && this.child.pid) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    await this.killExternalSimulator();
    await new Promise((r) => setTimeout(r, 300));
    const survivors = await this.listSimulatorPids();
    for (const pid of survivors) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  private killExternalSimulator(): Promise<void> {
    return new Promise((resolve) => {
      const killer = spawn('pkill', ['-f', 'vtms-shift-demo-simulator.js'], { stdio: 'ignore' });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
      setTimeout(() => resolve(), 800);
    });
  }

  private listSimulatorPids(): Promise<number[]> {
    return new Promise((resolve) => {
      const proc = spawn('pgrep', ['-f', 'vtms-shift-demo-simulator.js'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve([]);
      }, 1500);
      proc.stdout?.on('data', (chunk) => {
        out += String(chunk);
      });
      proc.on('exit', () => {
        clearTimeout(timer);
        const pids = out
          .trim()
          .split('\n')
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((pid) => Number.isFinite(pid));
        resolve(pids);
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve([]);
      });
    });
  }

  private async findExternalSimulatorPid(): Promise<number | null> {
    const managedPid = this.resolveManagedPid();
    const pids = await this.listSimulatorPids();
    const external = pids.filter((pid) => pid !== managedPid);
    return external[0] ?? null;
  }
}
