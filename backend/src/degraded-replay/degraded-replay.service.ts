import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DegradedOperationEvent } from '../database/entities/degraded-operation-event.entity';
import { DegradedOperationExecution } from '../database/entities/degraded-operation-execution.entity';
import {
  DegradedReplayMap,
  DegradedReplaySession,
} from '../database/entities/degraded-replay.entities';
import { OperatingClockService } from '../operating-day/operating-clock.service';
import {
  MAX_FRAMES_PER_EXECUTION,
  REPLAY_STALE_AFTER_MS,
} from './degraded-replay.recorder';

/** 一次最多回傳幾筆回放資料（分段載入） */
export const MAX_FRAMES_PER_REQUEST = 4_000;
/** 一次查詢最長的營運時間範圍 */
export const MAX_WINDOW_MS = 30 * 60_000;
const HISTORY_PAGE_MAX = 50;

/** 這幾種事件會改變（或確立）本次的等級與速限 */
const PARAMETER_ACTIONS = [
  'immediate_submitted',
  'schedule_submitted',
  'schedule_due',
  'parameters_adjusted',
  'schedule_cancelled',
  'degraded_restored',
];

type FrameRow = {
  seq: string;
  stream: string;
  kind: string;
  vehicle_code: string | null;
  topic: string | null;
  received_at: string;
  operating_at: string;
  vehicle_ts: string | null;
  payload: Record<string, unknown>;
};

/**
 * 歷史降級紀錄與回放查詢。只讀：不碰營運時鐘、不寫訂單、不送 MQTT、不下發任何指令。
 */
@Injectable()
export class DegradedReplayService {
  constructor(
    @InjectRepository(DegradedOperationExecution)
    private readonly executions: Repository<DegradedOperationExecution>,
    @InjectRepository(DegradedOperationEvent)
    private readonly events: Repository<DegradedOperationEvent>,
    @InjectRepository(DegradedReplaySession)
    private readonly sessions: Repository<DegradedReplaySession>,
    @InjectRepository(DegradedReplayMap)
    private readonly maps: Repository<DegradedReplayMap>,
    private readonly dataSource: DataSource,
    private readonly clock: OperatingClockService,
  ) {}

  /** 歷史降級列表：依開始時間新到舊（沒開始的預約依預約時間），分頁 */
  async listHistory(input: { page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    const pageSize = Math.min(
      HISTORY_PAGE_MAX,
      Math.max(1, Math.floor(Number(input.pageSize)) || 20),
    );
    const query = this.executions
      .createQueryBuilder('execution')
      .orderBy(
        'COALESCE(execution.started_at_operating, execution.scheduled_for_operating, execution.created_at)',
        'DESC',
      )
      .addOrderBy('execution.execution_id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [rows, total] = await query.getManyAndCount();
    const sessions = rows.length
      ? await this.sessions.find({
          where: { executionId: In(rows.map((row) => row.id)) },
        })
      : [];
    const byId = new Map(
      sessions.map((session) => [session.executionId, session]),
    );
    return {
      items: rows.map((row) => ({
        ...this.executionSummary(row),
        replay: this.replayAvailability(row, byId.get(row.id) ?? null),
      })),
      total,
      page,
      page_size: pageSize,
    };
  }

  /** 單筆詳情：本次內容與參數變更紀錄（操作、指令下發、生效時間分開） */
  async detail(executionId: string) {
    const execution = await this.requireExecution(executionId);
    const events = await this.events.find({
      where: { executionId, action: In(PARAMETER_ACTIONS) },
      order: { realAt: 'ASC', id: 'ASC' },
      take: 500,
    });
    const session = await this.sessions.findOne({ where: { executionId } });
    return {
      ...this.executionSummary(execution),
      parameter_changes: parameterChanges(execution, events),
      replay: this.replayAvailability(execution, session),
    };
  }

  /** 回放 metadata：時段、地圖版本、保存範圍與缺段 */
  async replayMeta(executionId: string) {
    const execution = await this.requireExecution(executionId);
    const session = await this.sessions.findOne({ where: { executionId } });
    const availability = this.replayAvailability(execution, session);
    const startedAt = numberOrNull(execution.startedAtOperating);
    const endedAt = numberOrNull(execution.endedAtOperating);
    const live = isRecording(execution.executionStatus);
    return {
      execution_id: executionId,
      availability,
      window:
        startedAt == null
          ? null
          : {
              from_operating: startedAt,
              to_operating: endedAt ?? (live ? this.clock.now() : startedAt),
              ongoing: live,
            },
      map: session?.mapHash
        ? {
            map_id: session.mapId,
            map_hash: session.mapHash,
            version: session.mapVersion,
            display_name: session.mapDisplayName,
          }
        : null,
      // 當時的車輛模型快照；null＝這筆紀錄沒有保存（功能上線前），前端要標示
      vehicle_model: session?.vehicleModel ?? null,
      coverage: session
        ? {
            status: session.status,
            initial_captured: session.initialCaptured,
            frame_count: Number(session.frameCount),
            dropped_count: Number(session.droppedCount),
            gaps: session.gaps ?? [],
            last_error: session.lastError,
            clock_run: session.clockRun,
            frame_limit: MAX_FRAMES_PER_EXECUTION,
          }
        : null,
      stale_after_ms: REPLAY_STALE_AFTER_MS,
      max_frames_per_request: MAX_FRAMES_PER_REQUEST,
    };
  }

  /** 當時那一份地圖（依開始時保存的內容雜湊；之後地圖被改也不影響） */
  async replayMap(executionId: string) {
    const session = await this.sessions.findOne({ where: { executionId } });
    if (!session?.mapHash)
      throw new NotFoundException('這筆降級沒有保存當時的地圖');
    const map = await this.maps.findOne({
      where: { mapHash: session.mapHash },
    });
    if (!map) throw new NotFoundException('當時的地圖快照已不存在');
    return {
      map_id: map.mapId,
      map_hash: map.mapHash,
      version: map.mapVersion,
      document: map.document,
    };
  }

  /**
   * 指定時刻的重建起點：每個串流（每台車、每個設施 topic、每張訂單）在 T 之前最後一筆。
   * 初始狀態的營運時間是開始時刻，所以自然成為最早的那一筆；T 之後的資料一筆都不給。
   */
  async snapshot(executionId: string, atRaw: unknown) {
    const { execution, from, to } = await this.requireReplayWindow(executionId);
    const at = this.parseTime(atRaw, 'at');
    if (at < from || at > to)
      throw new BadRequestException('時刻超出這次降級的回放時段');
    const rows = await this.dataSource.query<FrameRow[]>(
      `SELECT DISTINCT ON (stream, vehicle_code, topic)
              seq, stream, kind, vehicle_code, topic, received_at, operating_at, vehicle_ts, payload
         FROM degraded_replay_frames
        WHERE execution_id = $1 AND operating_at <= $2
        ORDER BY stream, vehicle_code, topic, operating_at DESC, seq DESC`,
      [execution.id, at],
    );
    // 收到時刻的參考點：T 之前最後收到的任何一筆（判斷哪台車已經過期用）
    const [reference] = await this.dataSource.query<
      Array<{ received_at: string; operating_at: string; seq: string }>
    >(
      `SELECT received_at, operating_at, seq FROM degraded_replay_frames
        WHERE execution_id = $1 AND operating_at <= $2
        ORDER BY operating_at DESC, seq DESC LIMIT 1`,
      [execution.id, at],
    );
    return {
      execution_id: execution.id,
      at,
      frames: rows.map(frameResponse),
      reference: reference
        ? {
            received_at: Number(reference.received_at),
            operating_at: Number(reference.operating_at),
            seq: Number(reference.seq),
          }
        : null,
    };
  }

  /**
   * 一段時間內的資料（營運時間、同時刻依 seq），有界：最多 limit 筆、最長 MAX_WINDOW_MS。
   * 沒拿完時回傳 next，前端從那裡接著要。
   */
  async frames(
    executionId: string,
    input: {
      from?: unknown;
      to?: unknown;
      after_seq?: unknown;
      limit?: unknown;
    },
  ) {
    const {
      execution,
      from: windowFrom,
      to: windowTo,
    } = await this.requireReplayWindow(executionId);
    const from = this.parseTime(input.from, 'from');
    const to = this.parseTime(input.to, 'to');
    if (to < from) throw new BadRequestException('to 不能早於 from');
    if (to - from > MAX_WINDOW_MS)
      throw new BadRequestException(
        `一次最多查 ${MAX_WINDOW_MS / 60_000} 分鐘的回放資料`,
      );
    const clampedFrom = Math.max(from, windowFrom);
    const clampedTo = Math.min(to, windowTo);
    const afterSeq =
      input.after_seq === undefined || input.after_seq === ''
        ? 0
        : this.parseTime(input.after_seq, 'after_seq');
    const limit = Math.min(
      MAX_FRAMES_PER_REQUEST,
      Math.max(1, Math.floor(Number(input.limit)) || MAX_FRAMES_PER_REQUEST),
    );
    if (clampedTo < clampedFrom)
      return {
        execution_id: execution.id,
        from,
        to,
        frames: [],
        covered_to: to,
        next: null,
      };
    // (operating_at, seq) 嚴格大於起點：前端拿到的 snapshot 已含 from 當下（含）的資料
    const rows = await this.dataSource.query<FrameRow[]>(
      `SELECT seq, stream, kind, vehicle_code, topic, received_at, operating_at, vehicle_ts, payload
         FROM degraded_replay_frames
        WHERE execution_id = $1 AND kind = 'live'
          AND (operating_at, seq) > ($2::bigint, $3::bigint)
          AND operating_at <= $4
        ORDER BY operating_at, seq
        LIMIT $5`,
      [execution.id, clampedFrom, afterSeq, clampedTo, limit + 1],
    );
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      execution_id: execution.id,
      from,
      to,
      frames: page.map(frameResponse),
      // 這次回應保證完整到哪個時刻；沒截斷就是整段
      covered_to: truncated && last ? Number(last.operating_at) : to,
      next:
        truncated && last
          ? { from: Number(last.operating_at), after_seq: Number(last.seq) }
          : null,
    };
  }

  private async requireExecution(executionId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(executionId))
      throw new BadRequestException('降級執行 ID 格式不正確');
    const execution = await this.executions.findOne({
      where: { id: executionId },
    });
    if (!execution)
      throw new NotFoundException(`降級執行 '${executionId}' 不存在`);
    return execution;
  }

  private async requireReplayWindow(executionId: string) {
    const execution = await this.requireExecution(executionId);
    const from = numberOrNull(execution.startedAtOperating);
    if (from == null)
      throw new BadRequestException('這筆降級沒有正式開始，沒有回放時段');
    const to =
      numberOrNull(execution.endedAtOperating) ??
      (isRecording(execution.executionStatus) ? this.clock.now() : from);
    return { execution, from, to };
  }

  private parseTime(value: unknown, name: string): number {
    const number = Number(value);
    if (value === undefined || value === '' || !Number.isFinite(number))
      throw new BadRequestException(`${name} 必須是數字（Epoch 毫秒）`);
    return Math.floor(number);
  }

  private executionSummary(execution: DegradedOperationExecution) {
    return {
      execution_id: execution.id,
      source_plan_id: execution.sourcePlanId,
      name: execution.planName,
      description: execution.planDescription,
      level: execution.level,
      speed_limit_kmh: execution.speedLimitKmh,
      execution_status: execution.executionStatus,
      control_status: execution.controlStatus,
      schedule_mode: execution.scheduleMode,
      scheduled_for_operating: numberOrNull(execution.scheduledForOperating),
      started_at_operating: numberOrNull(execution.startedAtOperating),
      started_at_real: numberOrNull(execution.startedAtReal),
      ended_at_operating: numberOrNull(execution.endedAtOperating),
      ended_at_real: numberOrNull(execution.endedAtReal),
      command_tracking: execution.commandTracking,
      operator_id: execution.operatorId,
      created_at: numberOrNull(execution.createdAt),
    };
  }

  /**
   * 能不能回放：沒正式開始的沒有時段；舊紀錄（功能上線前）沒有保存；有保存但缺初始狀態
   * 或有缺段的標成不完整。
   */
  private replayAvailability(
    execution: DegradedOperationExecution,
    session: DegradedReplaySession | null,
  ): {
    state: 'not_started' | 'none' | 'partial' | 'complete' | 'recording';
    reason: string | null;
  } {
    if (!execution.startedAtOperating)
      return { state: 'not_started', reason: '沒有正式開始，沒有降級時段' };
    if (!session) return { state: 'none', reason: '這筆降級沒有保存回放資料' };
    if (isRecording(execution.executionStatus))
      return { state: 'recording', reason: '降級進行中，保存持續中' };
    const problems: string[] = [];
    if (!session.initialCaptured) problems.push('缺開始時的初始狀態');
    if (!session.mapHash) problems.push('缺當時地圖');
    if ((session.gaps ?? []).length > 0)
      problems.push(`有 ${session.gaps.length} 段資料缺段`);
    if (session.status !== 'complete') problems.push('保存沒有正常收尾');
    return problems.length
      ? { state: 'partial', reason: problems.join('、') }
      : { state: 'complete', reason: null };
  }
}

function isRecording(status: string) {
  return ['activating', 'active', 'restoring'].includes(status);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function frameResponse(row: FrameRow) {
  return {
    seq: Number(row.seq),
    stream: row.stream,
    kind: row.kind,
    vehicle_code: row.vehicle_code,
    topic: row.topic,
    received_at: Number(row.received_at),
    operating_at: Number(row.operating_at),
    vehicle_ts: numberOrNull(row.vehicle_ts),
    payload: row.payload,
  };
}

type ExecutionLike = { level?: unknown; speed_limit_kmh?: unknown };

/**
 * 事件 → 參數變更紀錄。每一筆分開保存三個時間：
 * 操作時間（real_at，按下去的時候）、生效時間（operating_at，管理狀態改變的營運時刻），
 * 指令下發（車端控制尚未接通時為 not_dispatched，沒有下發時刻）。
 */
export function parameterChanges(
  execution: DegradedOperationExecution,
  events: DegradedOperationEvent[],
) {
  const out: Array<{
    event_id: string;
    action: string;
    operator_id: string;
    operated_at_real: number;
    effective_at_operating: number | null;
    level: number | null;
    speed_limit_kmh: number | null;
    previous_level: number | null;
    previous_speed_limit_kmh: number | null;
    control: {
      result: string;
      dispatched_at_real: number | null;
      reason: string | null;
    };
  }> = [];
  const tracking = Array.isArray(execution.commandTracking)
    ? (execution.commandTracking as Array<{
        at?: number;
        result?: string;
        reason?: string;
      }>)
    : [];
  for (const event of events) {
    if (event.result !== 'success') continue;
    const after = (event.afterValue ?? {}) as ExecutionLike;
    const before = (event.beforeValue ?? {}) as ExecutionLike;
    const realAt = Number(event.realAt);
    // 同一次操作留下的控制紀錄：時間最接近、不早於操作的那一筆
    const control = tracking
      .filter((entry) => Number(entry.at) >= realAt - 1_000)
      .sort((a, b) => Number(a.at) - Number(b.at))[0];
    const dispatched =
      control?.result === 'applied' || control?.result === 'pending';
    out.push({
      event_id: event.id,
      action: event.action,
      operator_id: event.operatorId,
      operated_at_real: realAt,
      effective_at_operating:
        event.action === 'schedule_submitted' ||
        event.action === 'schedule_cancelled'
          ? null
          : numberOrNull(event.operatingAt),
      level: numberOrNull(after.level),
      speed_limit_kmh: numberOrNull(after.speed_limit_kmh),
      previous_level: numberOrNull(before.level),
      previous_speed_limit_kmh: numberOrNull(before.speed_limit_kmh),
      control: {
        result: control?.result ?? 'not_dispatched',
        dispatched_at_real: dispatched ? Number(control?.at) : null,
        reason: control?.reason ?? null,
      },
    });
  }
  return out;
}
