import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationOrder } from '../database/entities/operation-order.entity';
import { MapService } from '../map/map.service';
import {
  operationShiftCreationModeLabel,
  readScheduleGeneratedAt,
} from '../operation-shift/operation-shift-list.util';
import { DispatchEngineService } from './dispatch-engine.service';
import type { PlannedDispatch } from './dispatch.plan';
import {
  assessSimulationReadiness,
  contentDigest,
  readShiftMapReference,
} from './dispatch.simulation-plan';
import {
  SIMULATION_RUN_PAYLOAD_KEYS,
  summarizeSimulationRun,
} from './dispatch.simulation-run';

/**
 * 模擬器「依班表 ID 載入」用的執行計畫。
 *
 * 預覽、同步、啟動都讀這一支，拿到的是同一份內容：任務清單由
 * {@link DispatchEngineService.planForShift} 產生——跟正式調度同一套展開、指派與補齊，
 * 只是來源換成指定的班表。這裡另外補上班表資訊、引用地圖、能否模擬與版本摘要。
 *
 * 純讀取：不下訂單、不發布草稿、不改 usage_status、不改班表時間。
 */
@Injectable()
export class SimulationPlanService {
  constructor(
    private readonly engine: DispatchEngineService,
    private readonly mapService: MapService,
    @InjectRepository(OperationOrder)
    private readonly orderRepository: Repository<OperationOrder>,
  ) {}

  /**
   * 一次模擬執行的實際進度（只讀）：依訂單 payload.plan_run_id 查，分類規則見
   * dispatch.simulation-run.ts。計畫數取自訂單上的 plan_run_total，不接受呼叫端指定。
   */
  async runStatus(runId: string) {
    const rows = await this.orderRepository
      .createQueryBuilder('o')
      .where(`o.payload->>'${SIMULATION_RUN_PAYLOAD_KEYS.runId}' = :runId`, { runId })
      .orderBy('o.planned_start', 'ASC')
      .getMany();
    return summarizeSimulationRun(
      runId,
      rows.map((o) => ({
        orderId: o.id,
        tripCode: o.tripCode,
        vehicleCode: o.vehicleCode,
        status: o.status,
        payload: (o.payload ?? null) as Record<string, unknown> | null,
      })),
    );
  }

  async build(shiftId: string, options: { reference?: number } = {}) {
    const reference = options.reference ?? Date.now();
    const plan = await this.engine.planForShift(shiftId, reference);
    const { row, body } = plan;

    const generated = readScheduleGeneratedAt(body);
    const creationMode =
      body.creationMode === 'manual' ? 'manual' : 'parametric';
    const savedAtMs = Number(row.updatedAt);

    // 地圖只看班表自己的引用；找不到就是找不到，不換成目前啟用的那一份
    const mapRef = readShiftMapReference(body);
    let mapEntry: ReturnType<MapService['getPublishedMapLibrary']> | null =
      null;
    let mapLookupError: string | null = null;
    if (mapRef.mapId) {
      try {
        mapEntry = this.mapService.getPublishedMapLibrary(mapRef.mapId);
      } catch (error) {
        mapLookupError = error instanceof Error ? error.message : String(error);
      }
    }
    const mapDocument = mapEntry?.mapDocument ?? null;

    const readiness = assessSimulationReadiness({
      hasSchedulePlan: this.engineHasPlan(body),
      publishBlockReason: this.publishBlockReason(body),
      mapId: mapRef.mapId,
      mapDocument,
      mapLookupError,
      selectedRouteIds: mapRef.selectedRouteIds,
      planned: plan.planned,
      skipped: plan.skipped,
      resolveFacility: (facilityId) =>
        !!mapRef.mapId &&
        !!this.mapService.getFacilityCenter(mapRef.mapId, facilityId),
      generatedAt: generated.at,
      mapUpdatedAt: mapEntry?.updatedAt ?? null,
    });

    const timelineRows = new Set(
      plan.tripsInSchedule.map((trip) => trip.timeline_row),
    );
    const byKind = countBy(plan.planned, (item) => item.kind);
    const byTaskType = countBy(
      plan.planned,
      (item) => item.taskType || item.kind,
    );
    const scheduleTaskTypes = countBy(
      plan.tripsInSchedule,
      (trip) => trip.task_type,
    );

    // 載入身分：班表內容、地圖內容、展開後的計畫各自摘要，任何一個變了就是不同版本
    const shiftDigest = contentDigest({
      id: row.id,
      updatedAt: row.updatedAt,
      plan: asRecord(body.scheduleOutput)?.plan ?? null,
    });
    const mapDigest = mapDocument ? contentDigest(mapDocument) : null;
    const planDigest = contentDigest(plan.planned.map(planIdentityOf));

    return {
      shift: {
        shift_id: row.id,
        name: row.name,
        version:
          typeof body.version === 'string' && body.version.trim()
            ? body.version.trim()
            : null,
        creation_mode: creationMode,
        creation_mode_label: operationShiftCreationModeLabel(creationMode),
        publish_status: row.publishStatus,
        usage_status: row.usageStatus,
        time_template_name:
          readString(body, 'timeTemplateName') ??
          readString(
            asRecord(asRecord(body.scheduleOutput)?.timeTemplateRef) ?? {},
            'templateName',
          ),
        generated_at: generated.at,
        generated_at_source: generated.source,
        generated_at_label:
          creationMode === 'manual' ? '建立排班結構時間' : '生成時間',
        saved_at: Number.isFinite(savedAtMs)
          ? new Date(savedAtMs).toISOString()
          : null,
      },
      map: {
        map_id: mapRef.mapId,
        display_name: mapEntry?.displayName ?? null,
        library_version: mapEntry?.version ?? null,
        library_updated_at: mapEntry?.updatedAt ?? null,
        found: !!mapDocument,
        selected_route_ids: mapRef.selectedRouteIds,
        missing_route_ids: readiness.missingRoutes,
        /** 班表沒有記錄製作當時的地圖版本，只能對照目前發布的內容 */
        historical_version_recorded: false,
      },
      counts: {
        timelines: timelineRows.size,
        schedule_trips: plan.tripsInSchedule.length,
        schedule_task_types: scheduleTaskTypes,
        planned: plan.planned.length,
        planned_by_kind: byKind,
        planned_by_task_type: byTaskType,
        skipped: plan.skipped.length,
      },
      simulatable: readiness.simulatable,
      blocking_reasons: readiness.blockingReasons,
      warnings: readiness.warnings,
      unresolved: {
        stations: readiness.unresolvedStations,
        facilities: readiness.unresolvedFacilities,
      },
      skipped: plan.skipped,
      identity: {
        shift_digest: shiftDigest,
        map_digest: mapDigest,
        plan_digest: planDigest,
        /** 三者合一：模擬器以此判斷「載入的」與「要啟動的」是不是同一份 */
        load_digest: contentDigest({ shiftDigest, mapDigest, planDigest }),
        reference_day: new Date(reference).toISOString(),
      },
      planned: plan.planned,
      mapDocument,
    };
  }

  private engineHasPlan(body: Record<string, unknown>): boolean {
    const output = asRecord(body.scheduleOutput);
    return !!asRecord(output?.plan);
  }

  private publishBlockReason(body: Record<string, unknown>): string | null {
    return this.engine.shiftPublishBlockReason(body);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function countBy<T>(
  items: T[],
  key: (item: T) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item) || 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** 計畫身分只看會影響執行的欄位（時刻用當日相對秒，換日不算換版） */
function planIdentityOf(item: PlannedDispatch) {
  const dayStart = new Date(item.departAt);
  dayStart.setHours(0, 0, 0, 0);
  const base = dayStart.getTime();
  return {
    tripCode: item.tripCode,
    kind: item.kind,
    taskType: item.taskType,
    vehicleCode: item.vehicleCode,
    timelineRow: item.timelineRow,
    routeCode: item.routeCode,
    depart: (item.departAt - base) / 1000,
    arrive: (item.arriveAt - base) / 1000,
    origin: item.origin?.id ?? null,
    destination: item.destination?.id ?? null,
    stations: item.stations.map((station) => [
      station.stationId,
      station.dwellSeconds,
    ]),
    maintenance: item.maintenance?.yardSlotId ?? null,
  };
}
