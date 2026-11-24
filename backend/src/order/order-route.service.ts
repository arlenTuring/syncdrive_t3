import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationRoute } from '../database/entities/operation-route.entity';
import { OperationRouteStation } from '../database/entities/operation-route-station.entity';
import { OperationRouteStationAction } from '../database/entities/operation-route-station-action.entity';
import {
  OrderActionState,
} from '../database/entities/order-action-state.entity';
import { RouteActionStatus } from '../database/entities/operation-route-station-action.entity';

export type TaskGroupItem = {
  task_id: string;
  task_name: string;
  task_params?: { node_id?: string; junction_id?: string; station_id?: string };
  status: string;
  actual_start_time?: number | null;
  actual_end_time?: number | null;
  note?: string;
};

@Injectable()
export class OrderRouteService {
  constructor(
    @InjectRepository(OperationRoute)
    private readonly routeRepo: Repository<OperationRoute>,
    @InjectRepository(OperationRouteStation)
    private readonly stationRepo: Repository<OperationRouteStation>,
    @InjectRepository(OperationRouteStationAction)
    private readonly actionTemplateRepo: Repository<OperationRouteStationAction>,
    @InjectRepository(OrderActionState)
    private readonly actionStateRepo: Repository<OrderActionState>,
  ) {}

  async getRouteStations(routeId: string): Promise<OperationRouteStation[]> {
    return this.stationRepo.find({
      where: { routeId },
      order: { sequenceOrder: 'ASC' },
    });
  }

  /** 訂單成立時，依 route 模板建立 action 實例 */
  async materializeActionStates(orderId: string, routeId: string): Promise<void> {
    const templates = await this.actionTemplateRepo.find({
      where: { routeId },
      order: { sequenceOrder: 'ASC' },
    });
    const stations = await this.getRouteStations(routeId);
    const stationByRow = new Map(stations.map((s) => [s.id, s]));

    const rows: OrderActionState[] = templates.map((tpl) => {
      const station = stationByRow.get(tpl.stationRowId);
      // 以唯一的 action_template_id 組出動作狀態 PK：同一路線可有多個同類動作
      // （如 T3 與 S2W 各一次 PLATFORM_DOCKING），用 (actionType, sequence) 會碰撞。
      const actionId = `${orderId}_${tpl.id}`;
      return this.actionStateRepo.create({
        id: actionId,
        orderId,
        stationId: station?.stationId ?? 'UNKNOWN',
        actionType: tpl.actionType,
        actionStatus: RouteActionStatus.PENDING,
        triggerOffsetM: tpl.triggerOffsetM,
        nodeId: tpl.nodeId ?? undefined,
      });
    });

    if (rows.length > 0) {
      // 冪等具現化：先清掉同訂單殘留的動作狀態（order_action_states 與 operation_orders
      // 之間無 FK 級聯，班次訂單 id 會重用，殘留列會造成 PK 衝突），再寫入全新 PENDING 列。
      await this.actionStateRepo.delete({ orderId });
      await this.actionStateRepo.save(rows);
    }
  }

  /**
   * 車端 operation/update 的 task_group（營運任務狀態協議 §五）寫進 order_action_states。
   *
   * 有路線模板的舊訂單在建單時已具現化動作列，這裡對上後更新。調度引擎下的單沒有路線模板、沒有預建的列：
   * 車端回報的動作直接新增一列（id＝task_id），不然運行紀錄的動作欄永遠是空的（2026-11-23 TNB1329）。
   * 對列：task_id → 同站同動作 → 同節點同動作；只有回報沒帶站也沒帶節點時才退回「同動作」，
   * 免得第二站的進站蓋掉第一站那一列。已完成的列不會被較舊的進行中／待辦狀態改回去；沒變就不寫。
   */
  async applyTaskGroupUpdate(orderId: string, taskGroup: TaskGroupItem[]): Promise<void> {
    if (!Array.isArray(taskGroup) || taskGroup.length === 0) return;

    const rows = await this.actionStateRepo.find({ where: { orderId } });
    const text = (v: unknown) => (v == null ? null : String(v).trim() || null);
    const epoch = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : undefined);
    const claimed = new Set<OrderActionState>();

    for (const task of taskGroup) {
      const taskId = text(task.task_id);
      const actionType = text(task.task_name);
      const status = this.normalizeActionStatus(task.status);
      if (!taskId || !status) continue;
      const stationId = text(task.task_params?.station_id);
      const nodeId = text(task.task_params?.node_id);
      const free = (r: OrderActionState) => !claimed.has(r) && r.actionType === actionType;

      let row = rows.find((r) => r.id === taskId)
        ?? (actionType && stationId ? rows.find((r) => free(r) && r.stationId === stationId) : undefined)
        ?? (actionType && nodeId ? rows.find((r) => free(r) && r.nodeId === nodeId) : undefined)
        ?? (actionType && !stationId && !nodeId ? rows.find(free) : undefined);
      let created = false;
      if (!row) {
        if (!actionType) continue;
        created = true;
        row = this.actionStateRepo.create({
          id: taskId,
          orderId,
          stationId: stationId ?? nodeId ?? 'UNKNOWN',
          actionType,
          actionStatus: RouteActionStatus.PENDING,
          triggerOffsetM: 0,
          nodeId: nodeId ?? undefined,
        });
        rows.push(row);
      }
      claimed.add(row);

      const finished = row.actionStatus === RouteActionStatus.COMPLETED || row.actionStatus === RouteActionStatus.FAILED;
      if (finished && status !== RouteActionStatus.COMPLETED && status !== RouteActionStatus.FAILED) continue;

      const next = {
        actionStatus: status,
        actualStartTime: epoch(task.actual_start_time) ?? row.actualStartTime,
        actualEndTime: epoch(task.actual_end_time) ?? row.actualEndTime,
        note: task.note != null ? String(task.note) : row.note,
        nodeId: nodeId ?? row.nodeId,
      };
      const changed = (Object.keys(next) as Array<keyof typeof next>).some((k) => String(next[k] ?? '') !== String(row[k] ?? ''));
      if (!changed && !created) continue;
      Object.assign(row, next);
      await this.actionStateRepo.save(row);
    }
  }

  async computeRouteProgress(orderId: string, routeId: string | null): Promise<number> {
    if (!routeId) return 0;
    const stations = await this.getRouteStations(routeId);
    if (stations.length === 0) return 0;

    const actions = await this.actionStateRepo.find({ where: { orderId } });
    const lastIndex = stations.length - 1;
    let maxRemain = 0;
    for (let i = 0; i < stations.length; i += 1) {
      const station = stations[i];
      const anchor =
        lastIndex <= 0 ? 100 : Math.round((i / lastIndex) * 100);
      const stationActions = actions.filter((a) => a.stationId === station.stationId);
      const allDone = stationActions.length > 0
        && stationActions.every((a) => a.actionStatus === RouteActionStatus.COMPLETED);
      if (allDone) {
        maxRemain = Math.max(maxRemain, anchor);
      } else {
        const inProgress = stationActions.some(
          (a) => a.actionStatus === RouteActionStatus.IN_PROGRESS,
        );
        if (inProgress) {
          const prevAnchor =
            i <= 0 ? 0 : Math.round(((i - 1) / lastIndex) * 100);
          maxRemain = Math.max(maxRemain, Math.round((prevAnchor + anchor) / 2));
        }
      }
    }
    return Math.min(100, maxRemain);
  }

  normalizeActionStatus(raw: unknown): RouteActionStatus | null {
    const v = String(raw ?? '').trim().toUpperCase();
    if (Object.values(RouteActionStatus).includes(v as RouteActionStatus)) {
      return v as RouteActionStatus;
    }
    return null;
  }

  /**
   * 下一站：依各站 STATION_DEPARTURE 完成狀態。
   * 中間站（如 T3）出站前 → 下一站為該站；出站完成後 → 下一站為終點站。
   */
  async computeNextStation(orderId: string, routeId: string | null | undefined): Promise<string | null> {
    if (!routeId) return null;
    const stations = await this.getRouteStations(routeId);
    if (stations.length === 0) return null;
    if (stations.length === 1) return stations[0].stationId;

    const actions = await this.actionStateRepo.find({ where: { orderId } });
    const depCompleted = (stationId: string) =>
      actions.some(
        (a) => a.stationId === stationId
          && a.actionType === 'STATION_DEPARTURE'
          && a.actionStatus === RouteActionStatus.COMPLETED,
      );

    for (let i = 1; i < stations.length; i += 1) {
      if (!depCompleted(stations[i].stationId)) {
        return stations[i].stationId;
      }
    }
    return stations[stations.length - 1].stationId;
  }
}
