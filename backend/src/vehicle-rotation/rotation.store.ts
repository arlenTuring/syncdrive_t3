import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ShuntOrder } from './rotation.model';
import type { HistoryEntry, OrderState, ShuntLeg } from './rotation.recovery';

export type ItemStatus = 'pending' | 'confirmed' | 'skipped' | 'done' | 'aborted';
export type RecoveryState = 'none' | 'running' | 'done' | 'incomplete';

export type ItemRow = {
  id: string;
  operating_day: string;
  effective_day: string;
  outgoing: string;
  incoming: string;
  status: ItemStatus;
  recovery_state: RecoveryState;
  shunt_order: ShuntOrder;
  shunts: ShuntLeg[];
  cancelled_order_ids: string[];
  fault: string | null;
  history: HistoryEntry[];
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  finished_at: string | null;
};

export type RuntimePatch = {
  shunts?: ShuntLeg[];
  status?: ItemStatus;
  recoveryState?: RecoveryState;
  fault?: string | null;
  cancelledOrderIds?: string[];
  history?: HistoryEntry[];
  finishedAt?: number;
};

/** 一張還沒結案的單（收回發錯車的單用） */
export type ActiveOrder = { orderId: string; planOrderId: string | null; vehicle: string; status: string; plannedStart: number };

type OrderRow = {
  order_id: string;
  plan_order_id: string | null;
  vehicle_code: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  started: string | null;
  ended: string | null;
  cancel_at: string | null;
  closed_reason: string | null;
  created_at: string | null;
  px?: string | null;
  py?: string | null;
};

const num = (value: string | null | undefined): number | null => (value == null || value === '' ? null : Number(value));

/**
 * 輪替監看讀寫資料庫的地方。訂單一律用訂單編號對應：正式派遣的單編號就是計畫編號，
 * 計畫重播的單把計畫編號放在 payload.plan_order_id。不用班次代號猜（代號每天重複）。
 */
@Injectable()
export class RotationRuntimeStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 需要監看的項目：進行中的輪替，以及中止後補救還沒做完的 */
  async openItems(): Promise<ItemRow[]> {
    return this.dataSource.query(
      `SELECT * FROM vehicle_rotation_items
       WHERE status = 'confirmed' OR (status = 'aborted' AND recovery_state = 'running')
       ORDER BY created_at`,
    );
  }

  async item(id: string): Promise<ItemRow | null> {
    const [row] = await this.dataSource.query('SELECT * FROM vehicle_rotation_items WHERE id = $1', [id]);
    return row ?? null;
  }

  /** 依計畫編號（或實際訂單編號）找訂單；同一個編號有好幾張時新的在後面 */
  async ordersFor(ids: readonly string[]): Promise<OrderState[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const rows: OrderRow[] = await this.dataSource.query(
      `SELECT o.order_id, o.payload->>'plan_order_id' AS plan_order_id, o.vehicle_code, o.status, o.planned_start, o.planned_end,
              o.payload->>'op_started_at' AS started, o.payload->>'op_completed_at' AS ended,
              o.payload->>'cancel_requested_at' AS cancel_at, o.payload->>'closed_reason' AS closed_reason, o.created_at,
              m.telemetry_payload->'local_pose'->'position'->>'x' AS px,
              m.telemetry_payload->'local_pose'->'position'->>'y' AS py
       FROM operation_orders o
       LEFT JOIN vehicle_monitor_demo m ON m.vehicle_code = o.vehicle_code AND o.status = 'PROCESSING'
       WHERE o.order_id = ANY($1) OR o.payload->>'plan_order_id' = ANY($1)
       ORDER BY o.created_at ASC`,
      [unique],
    );
    return rows.map(toState);
  }

  /** 這幾台車還沒結案、也還沒被要求取消的單（某時刻以後開始的） */
  async activeOrders(vehicles: readonly string[], since: number): Promise<ActiveOrder[]> {
    const rows: OrderRow[] = await this.dataSource.query(
      `SELECT order_id, payload->>'plan_order_id' AS plan_order_id, vehicle_code, status, planned_start
       FROM operation_orders
       WHERE vehicle_code = ANY($1) AND status IN ('PENDING', 'PROCESSING')
         AND payload->>'cancel_requested_at' IS NULL AND planned_start >= $2`,
      [vehicles, since],
    );
    return rows.map((row) => ({
      orderId: row.order_id,
      planOrderId: row.plan_order_id,
      vehicle: row.vehicle_code,
      status: row.status,
      plannedStart: Number(row.planned_start ?? 0),
    }));
  }

  /** 這幾台車哪些手上有別張單正在執行（不算 exclude 裡的單） */
  async busyVehicles(vehicles: readonly string[], exclude: readonly string[]): Promise<Set<string>> {
    const rows: Array<{ vehicle_code: string }> = await this.dataSource.query(
      `SELECT DISTINCT vehicle_code FROM operation_orders
       WHERE vehicle_code = ANY($1) AND status = 'PROCESSING'
         AND NOT (order_id = ANY($2)) AND NOT (COALESCE(payload->>'plan_order_id', '') = ANY($2))`,
      [vehicles, exclude],
    );
    return new Set(rows.map((row) => row.vehicle_code));
  }

  /** 接替車手上要在調車前結束的場內單（待命、保養） */
  async yardOrdersBefore(vehicle: string, before: number, exclude: readonly string[], keepRow: number): Promise<string[]> {
    // 只收接替車原本那一列的單；它要接的那一列（keepRow）的任務是接班本身，不能收
    const rows: Array<{ order_id: string }> = await this.dataSource.query(
      `SELECT order_id FROM operation_orders
       WHERE vehicle_code = $1 AND status IN ('PENDING', 'PROCESSING') AND line_kind <> 'MAINLINE'
         AND planned_start <= $2 AND payload->>'cancel_requested_at' IS NULL
         AND NOT (order_id = ANY($3)) AND NOT (COALESCE(payload->>'plan_order_id', '') = ANY($3))
         AND COALESCE(payload->>'timeline_row', '') <> $4`,
      [vehicle, before, exclude, String(keepRow)],
    );
    return rows.map((row) => row.order_id);
  }

  async save(id: string, patch: RuntimePatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      sets.push(sql.replace('?', `$${params.length}`));
    };
    if (patch.shunts) add('shunts = ?::jsonb', JSON.stringify(patch.shunts));
    if (patch.status) add('status = ?', patch.status);
    if (patch.recoveryState) add('recovery_state = ?', patch.recoveryState);
    if (patch.fault !== undefined) add('fault = ?', patch.fault);
    if (patch.cancelledOrderIds) add('cancelled_order_ids = ?::jsonb', JSON.stringify(patch.cancelledOrderIds));
    if (patch.history?.length) add('history = history || ?::jsonb', JSON.stringify(patch.history));
    if (patch.finishedAt != null) add('finished_at = ?', patch.finishedAt);
    if (sets.length === 0) return;
    await this.dataSource.query(`UPDATE vehicle_rotation_items SET ${sets.join(', ')} WHERE id = $1`, params);
  }
}

function toState(row: OrderRow): OrderState {
  return {
    orderId: row.order_id,
    planOrderId: row.plan_order_id,
    vehicle: row.vehicle_code,
    status: row.status,
    plannedEnd: num(row.planned_end),
    startedAt: num(row.started),
    endedAt: num(row.ended),
    cancelRequestedAt: num(row.cancel_at),
    closedReason: row.closed_reason,
    createdAt: num(row.created_at) ?? 0,
    // 車的實際位置（5 公尺格）：位置有變就是還在前進。車端的段序／剩餘百分比不一定有更新，不能當進度
    progressKey: row.px == null || row.py == null ? null : `${Math.round(Number(row.px) / 5)}:${Math.round(Number(row.py) / 5)}`,
  };
}

/** 依編號整理：同一個計畫編號的單以最新一張為準，實際訂單編號也能查 */
export function indexStates(states: readonly OrderState[]): Map<string, OrderState> {
  const map = new Map<string, OrderState>();
  for (const state of states) {
    map.set(state.orderId, state);
    if (state.planOrderId) map.set(state.planOrderId, state);
  }
  return map;
}
