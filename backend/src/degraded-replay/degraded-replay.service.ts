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
import { MAX_SEQ, parseSeq } from '../vehicle-history/history-cursor';
import type { ReplayGap } from '../database/entities/degraded-replay.entities';

/** 由一般運行歷史讀的串流（order_route 是降級開始時的訂單站序快照） */
const HISTORY_STREAMS = ['telemetry', 'operation', 'health', 'facility', 'order_route'];
/** 起點快照往回找多久（降級開始前最後一筆狀態） */
const HISTORY_SNAPSHOT_LOOKBACK_MS = 6 * 60 * 60_000;
/** 這些缺段期間收到的資料營運時間不可信（時鐘未接上），讀一般歷史時排除 */
const UNTRUSTED_GAP_REASONS = new Set(['clock_unsynced', 'clock_run_changed']);

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
    const historyBacked = session?.framesSource === 'history';
    // 資料來自一般運行歷史：那段期間歷史寫入失敗、緩衝滿載的缺段也算在這次降級的缺段裡
    const historyGaps = historyBacked && session ? await this.historyGapsFor(session) : [];
    const historyFrameCount = historyBacked && session ? await this.historyFrameCount(session) : null;
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
            frame_count: historyFrameCount ?? Number(session.frameCount),
            dropped_count: Number(session.droppedCount) + historyGaps.reduce((sum, gap) => sum + (gap.count ?? 0), 0),
            gaps: [...(session.gaps ?? []), ...historyGaps].sort((a, b) => a.from_real - b.from_real),
            frames_source: session.framesSource ?? 'degraded',
            last_error: session.lastError,
            clock_run: session.clockRun,
            frame_limit: MAX_FRAMES_PER_EXECUTION,
          }
        : null,
      stale_after_ms: REPLAY_STALE_AFTER_MS,
      max_frames_per_request: MAX_FRAMES_PER_REQUEST,
    };
  }

  private async historyGapsFor(session: DegradedReplaySession): Promise<ReplayGap[]> {
    const to = session.endedReal ? Number(session.endedReal) : Date.now();
    const rows = await this.dataSource.query<Array<{ from_real: string; to_real: string; from_operating: string | null; to_operating: string | null; reason: string; count: number }>>(
      `SELECT from_real, to_real, from_operating, to_operating, reason, count FROM vehicle_history_gaps
        WHERE from_real <= $2 AND to_real >= $1 ORDER BY from_real`,
      [Number(session.startedReal), to],
    );
    return rows.map((row) => ({
      from_real: Number(row.from_real),
      to_real: Number(row.to_real),
      from_operating: numberOrNull(row.from_operating),
      to_operating: numberOrNull(row.to_operating),
      reason: row.reason as ReplayGap['reason'],
      count: row.count,
    }));
  }

  private async historyFrameCount(session: DegradedReplaySession): Promise<number> {
    const to = session.endedOperating ? Number(session.endedOperating) : this.clock.now();
    const [row] = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM vehicle_history_frames
        WHERE clock_run = $1 AND operating_at BETWEEN $2 AND $3 AND stream = ANY($4::text[])`,
      [session.clockRun, Number(session.startedOperating), to, HISTORY_STREAMS],
    );
    return Number(row?.count ?? 0);
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
  async snapshot(executionId: string, atRaw: unknown, seqRaw?: unknown) {
    const { execution, from, to, session } = await this.requireReplayWindow(executionId);
    const at = this.parseTime(atRaw, 'at');
    // 游標精確到同一時刻的第幾筆；沒給序號＝這一毫秒的資料全部套用
    const seq = parseSeq(seqRaw) ?? MAX_SEQ;
    if (at < from || at > to)
      throw new BadRequestException('時刻超出這次降級的回放時段');
    if (session?.framesSource === 'history')
      return this.historySnapshot(execution.id, session, at, seq);
    const rows = await this.dataSource.query<FrameRow[]>(
      `SELECT DISTINCT ON (stream, vehicle_code, topic)
              seq, stream, kind, vehicle_code, topic, received_at, operating_at, vehicle_ts, payload
         FROM degraded_replay_frames
        WHERE execution_id = $1 AND (operating_at, seq) <= ($2::bigint, $3::bigint)
        ORDER BY stream, vehicle_code, topic, operating_at DESC, seq DESC`,
      [execution.id, at, seq],
    );
    // 收到時刻的參考點：T 之前最後收到的任何一筆（判斷哪台車已經過期用）
    const [reference] = await this.dataSource.query<
      Array<{ received_at: string; operating_at: string; seq: string }>
    >(
      `SELECT received_at, operating_at, seq FROM degraded_replay_frames
        WHERE execution_id = $1 AND (operating_at, seq) <= ($2::bigint, $3::bigint)
        ORDER BY operating_at DESC, seq DESC LIMIT 1`,
      [execution.id, at, seq],
    );
    return {
      execution_id: execution.id,
      at,
      seq: seq === MAX_SEQ ? null : seq,
      frames: rows.map(frameResponse),
      reference: reference
        ? {
            t: Number(reference.operating_at),
            received_at: Number(reference.received_at),
            operating_at: Number(reference.operating_at),
            seq: String(reference.seq),
          }
        : null,
    };
  }

  /**
   * 前一筆／後一筆（逐幀跨出已載入範圍時用），限本次降級的回放時段。沒有就回 null。
   */
  async neighbor(executionId: string, input: { at?: unknown; seq?: unknown; dir?: unknown }) {
    const { execution, from, to, session } = await this.requireReplayWindow(executionId);
    const at = this.parseTime(input.at, 'at');
    const seq = parseSeq(input.seq) ?? MAX_SEQ;
    const dir = input.dir === 'prev' ? 'prev' : input.dir === 'next' ? 'next' : null;
    if (!dir) throw new BadRequestException('dir 必須是 prev 或 next');
    const compare = dir === 'prev' ? '<' : '>';
    const order = dir === 'prev' ? 'DESC' : 'ASC';
    if (session?.framesSource === 'history') {
      const filter = this.historyFilter(session, 4);
      const [row] = await this.dataSource.query<HistoryRow[]>(
        `SELECT seq, stream, vehicle_code, topic, order_id, received_at, operating_at, vehicle_ts, source, payload, derived
           FROM vehicle_history_frames
          WHERE clock_run = $1 AND (operating_at, seq) ${compare} ($2::bigint, $3::bigint)
            AND operating_at BETWEEN ${filter.boundsParams}
            ${filter.sql}
          ORDER BY operating_at ${order}, seq ${order} LIMIT 1`,
        [session.clockRun, at, seq, from, to, ...filter.params],
      );
      return { execution_id: execution.id, frame: row ? historyFrameResponse(row) : null };
    }
    const [row] = await this.dataSource.query<FrameRow[]>(
      `SELECT seq, stream, kind, vehicle_code, topic, received_at, operating_at, vehicle_ts, payload
         FROM degraded_replay_frames
        WHERE execution_id = $1 AND kind = 'live'
          AND (operating_at, seq) ${compare} ($2::bigint, $3::bigint)
          AND operating_at BETWEEN $4 AND $5
        ORDER BY operating_at ${order}, seq ${order} LIMIT 1`,
      [execution.id, at, seq, from, to],
    );
    return { execution_id: execution.id, frame: row ? frameResponse(row) : null };
  }

  /** 讀一般運行歷史的過濾條件：限定串流、排除即時系統拒收與時鐘不可信的期間 */
  private historyFilter(session: DegradedReplaySession, firstParam: number) {
    const params: unknown[] = [];
    const clauses: string[] = [`stream = ANY($${firstParam + 2}::text[])`, `(derived IS NULL OR NOT derived ? 'rejected')`];
    params.push(HISTORY_STREAMS);
    for (const gap of (session.gaps ?? []) as ReplayGap[]) {
      if (!UNTRUSTED_GAP_REASONS.has(gap.reason)) continue;
      const index = firstParam + 2 + params.length;
      params.push(gap.from_real, gap.to_real);
      clauses.push(`NOT (received_at BETWEEN $${index} AND $${index + 1})`);
    }
    return {
      boundsParams: `$${firstParam} AND $${firstParam + 1}`,
      sql: clauses.map((clause) => `AND ${clause}`).join(' '),
      params,
    };
  }

  /** 由一般運行歷史組出降級回放的起點：同一個營運時鐘輪次、營運時間不晚於游標的最後一筆 */
  private async historySnapshot(
    executionId: string,
    session: DegradedReplaySession,
    at: number,
    seq: string,
  ) {
    const since = Number(session.startedReal) - HISTORY_SNAPSHOT_LOOKBACK_MS;
    const keys = await this.dataSource.query<Array<{ stream_key: string }>>(
      `SELECT stream_key FROM vehicle_history_stream_keys
        WHERE stream = ANY($1::text[]) AND last_real >= $2`,
      [HISTORY_STREAMS, since],
    );
    const filter = this.historyFilter(session, 5);
    const rows = keys.length
      ? await this.dataSource.query<HistoryRow[]>(
          `SELECT f.* FROM unnest($1::text[]) AS k(stream_key)
             CROSS JOIN LATERAL (
               SELECT seq, stream, vehicle_code, topic, order_id, received_at, operating_at, vehicle_ts, source, payload, derived
                 FROM vehicle_history_frames
                WHERE stream_key = k.stream_key AND clock_run = $2
                  AND (operating_at, seq) <= ($3::bigint, $4::bigint)
                  AND received_at BETWEEN ${filter.boundsParams}
                  ${filter.sql}
                ORDER BY received_at DESC, seq DESC LIMIT 1
             ) f`,
          [keys.map((key) => key.stream_key), session.clockRun, at, seq, since, Date.now(), ...filter.params],
        )
      : [];
    const frames = rows.map(historyFrameResponse);
    const reference = frames
      .filter((frame) => frame.kind === 'live')
      .sort((a, b) => b.received_at - a.received_at)[0];
    return {
      execution_id: executionId,
      at,
      seq: seq === MAX_SEQ ? null : seq,
      frames,
      reference: reference
        ? { t: reference.operating_at, received_at: reference.received_at, operating_at: reference.operating_at, seq: reference.seq }
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
      session,
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
    const afterSeq = parseSeq(input.after_seq, 'after_seq') ?? '0';
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
    if (session?.framesSource === 'history') {
      const filter = this.historyFilter(session, 5);
      const historyRows = await this.dataSource.query<HistoryRow[]>(
        `SELECT seq, stream, vehicle_code, topic, order_id, received_at, operating_at, vehicle_ts, source, payload, derived
           FROM vehicle_history_frames
          WHERE clock_run = $1
            AND (operating_at, seq) > ($2::bigint, $3::bigint)
            AND operating_at <= $4
            AND operating_at BETWEEN ${filter.boundsParams}
            ${filter.sql}
          ORDER BY operating_at, seq
          LIMIT $${7 + filter.params.length}`,
        [session.clockRun, clampedFrom, afterSeq, clampedTo, windowFrom, windowTo, ...filter.params, limit + 1],
      );
      const truncatedHistory = historyRows.length > limit;
      const pageHistory = (truncatedHistory ? historyRows.slice(0, limit) : historyRows).map(historyFrameResponse);
      const lastHistory = pageHistory.at(-1);
      return {
        execution_id: execution.id,
        from,
        to,
        frames: pageHistory,
        covered_to: truncatedHistory && lastHistory ? lastHistory.operating_at : to,
        next: truncatedHistory && lastHistory ? { from: lastHistory.operating_at, after_seq: lastHistory.seq } : null,
      };
    }
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
          ? { from: Number(last.operating_at), after_seq: String(last.seq) }
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
    const session = await this.sessions.findOne({ where: { executionId } });
    return { execution, from, to, session };
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

type HistoryRow = {
  seq: string;
  stream: string;
  vehicle_code: string | null;
  topic: string | null;
  order_id: string | null;
  received_at: string;
  operating_at: string;
  vehicle_ts: string | null;
  source: string;
  payload: Record<string, unknown>;
  derived: Record<string, unknown> | null;
};

/** 一般運行歷史的一筆 → 降級回放的資料格式（時間軸是營運時間） */
function historyFrameResponse(row: HistoryRow) {
  const isOrder = row.stream === 'order_route';
  return {
    seq: String(row.seq),
    t: Number(row.operating_at),
    stream: isOrder ? 'order' : row.stream,
    kind: isOrder && row.payload?.kind === 'initial' ? 'initial' : 'live',
    vehicle_code: row.vehicle_code,
    topic: isOrder ? row.order_id : row.topic,
    received_at: Number(row.received_at),
    operating_at: Number(row.operating_at),
    vehicle_ts: numberOrNull(row.vehicle_ts),
    source: row.source,
    payload: row.payload,
    // 當時中心端的位置判定（與原始內容分開）；回放圖台據此判斷車是否停在格位
    derived: row.derived ?? null,
  };
}

function frameResponse(row: FrameRow) {
  return {
    seq: String(row.seq),
    t: Number(row.operating_at),
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
