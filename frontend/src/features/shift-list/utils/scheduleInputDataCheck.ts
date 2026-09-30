import type { PointTopology } from '../../map-editor/types/pointTopology';
import { parseStoredTemplateBody } from '../../time-templates/types/editor';
import { resolveSelectedRouteInstanceId } from '../types/create';
import { findTopologyPath, missingTravelTimeEdgesBetween, type TopologyEdgeRef } from './findTopologyPath';
import { extractFacilityMapCodes } from './maintenanceFirstTripOrigins';
import { FACILITY_SECTION_BY_TASK_TYPE, nodeMatchesMoveCardCodes } from './moveCardShared';
import type { GenerateShiftScheduleInput } from './schedule-engine/generate';
import type { FeasibilityIssue } from './schedule-engine/types';

/**
 * 生成前的必要資料檢查（白皮書 MAP-01～03）
 * =======================================
 *
 * 正式生成入口與重播工具在跑引擎之前先過這一關；缺任何一項就不生成，講清楚缺什麼、到哪裡補。
 * 不猜值、不當 0 秒、不改使用者資料。
 *
 * 分兩類：
 * - 整張地圖的必要結構（路網拓樸、路段）——缺了這張圖就不能用。
 * - 本次選取內容（選的路線、整備設施、模板用到的整備類型）——換個選法可能可以。
 *
 * 「本次必要行駛時間」只看這一次真的會用到的連線：模板用到的每一類整備，它的設施與正線路線的
 * 起訖站之間，進場與出場各至少要有一條每段都有行駛時間的路徑。地圖其他沒用到的路段缺時間，
 * 生成時另外以警告列出（見 generate.ts 的 MISSING_TRAVEL_TIME），不在這裡擋。
 */
export function checkScheduleInputData(input: GenerateShiftScheduleInput): FeasibilityIssue[] {
  const issues: FeasibilityIssue[] = [];
  const push = (message: string, detail: Record<string, unknown> = {}) =>
    issues.push({
      code: 'SCHEDULE_DATA_INCOMPLETE',
      severity: 'error',
      kind: 'actionable',
      message,
      detail,
    });

  const groups = input.draft.routeGroups;
  if (!groups.mapId?.trim()) {
    push('尚未在路線群組選擇地圖：請回路線群組選一張可用的地圖。系統不會自動改用其他地圖。', { scope: 'map' });
    return issues;
  }
  const topology: PointTopology | null | undefined = input.pointTopology;
  if (!topology || topology.nodes.length === 0) {
    push(`地圖「${groups.mapId}」沒有路網拓樸：請到地圖編輯補上路網拓樸後再生成。`, { scope: 'map', mapId: groups.mapId });
    return issues;
  }
  if (topology.edges.length === 0) {
    push(`地圖「${groups.mapId}」的路網拓樸沒有任何路段：請到地圖編輯連接路段並填行駛時間。`, { scope: 'map', mapId: groups.mapId });
    return issues;
  }

  const routes = groups.selectedRoutes ?? [];
  if (routes.length === 0) {
    push('路線群組沒有選任何路線：請回路線群組選擇路線。', { scope: 'selection' });
    return issues;
  }

  // 停靠點（docking）優先；路線上的途經點可能是別種節點（例如跨區轉接點），同樣以 stationId 對應
  const dockingByStation = new Map<string, string>();
  const anyNodeByStation = new Map<string, string>();
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (!stationId) continue;
    if (node.kind === 'docking' && !dockingByStation.has(stationId)) dockingByStation.set(stationId, node.id);
    if (!anyNodeByStation.has(stationId)) anyNodeByStation.set(stationId, node.id);
  }
  for (const route of routes) {
    const name = route.routeName || route.routeId;
    route.stationIds.forEach((stationId, index) => {
      if (anyNodeByStation.has(stationId.trim())) return;
      const stationName = route.stationDwells?.find((dwell) => dwell.stationId === stationId)?.stationName ?? stationId;
      push(
        `路線「${name}」的第 ${index + 1} 站「${stationName}」在這張地圖的路網上找不到對應停靠點：`
          + '請確認路線是這張地圖的路線，或到地圖編輯補上停靠點。',
        { scope: 'selection', routeInstanceId: resolveSelectedRouteInstanceId(route), stationId },
      );
    });
    const travel = route.avgTravelTimeSeconds ?? route.minTravelTimeSeconds;
    if (travel == null || !Number.isFinite(travel) || travel <= 0) {
      push(`路線「${name}」沒有行駛時間：請到路線設定補上。`, { scope: 'selection', routeInstanceId: resolveSelectedRouteInstanceId(route) });
    }
  }

  // 模板用到哪幾類整備
  const template = parseStoredTemplateBody(input.templateBody ?? {});
  const usedTaskTypes = new Set(template.tasks.map((task) => task.taskType).filter((type) => type !== 'passenger'));
  const routeStationNodes = [...new Set(routes.flatMap((route) => [route.stationIds[0], route.stationIds[route.stationIds.length - 1]]))]
    .map((stationId) => dockingByStation.get(stationId?.trim() ?? ''))
    .filter((nodeId): nodeId is string => Boolean(nodeId));

  for (const taskType of usedTaskTypes) {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as keyof typeof FACILITY_SECTION_BY_TASK_TYPE];
    if (!section) continue;
    const codes = extractFacilityMapCodes(input.maintenanceTaskBody ?? null, section);
    const label = SECTION_LABEL[section] ?? section;
    if (codes.length === 0) {
      push(`時間模板排了「${label}」，但整備任務沒有設定這一類的設施：請到整備任務補上。`, { scope: 'selection', taskType });
      continue;
    }
    const facilities = topology.nodes.filter(
      (node) => (node.kind === 'facility' || node.kind === 'docking') && nodeMatchesMoveCardCodes(node, codes),
    );
    const missingCodes = codes.filter((code) => !topology.nodes.some((node) => nodeMatchesMoveCardCodes(node, [code])));
    if (missingCodes.length > 0) {
      push(
        `整備任務「${label}」設定的設施${missingCodes.map((code) => `「${code}」`).join('、')}在這張地圖的路網上找不到：`
          + '請到地圖編輯補上，或在整備任務改選其他設施。',
        { scope: 'selection', taskType, missingCodes },
      );
    }
    if (facilities.length === 0 || routeStationNodes.length === 0) continue;
    // 進場（站 → 設施）與出場（設施 → 站）各至少要有一條完整有時間的路
    for (const direction of ['entry', 'exit'] as const) {
      const pairs = facilities.flatMap((facility) => routeStationNodes.map((station) =>
        direction === 'entry' ? [station, facility.id] as const : [facility.id, station] as const));
      if (pairs.some(([from, to]) => findTopologyPath(topology, from, to))) continue;
      const gaps: TopologyEdgeRef[] = [];
      for (const [from, to] of pairs) {
        for (const edge of missingTravelTimeEdgesBetween(topology, from, to) ?? []) {
          if (!gaps.some((item) => item.fromNodeId === edge.fromNodeId && item.toNodeId === edge.toNodeId)) gaps.push(edge);
        }
      }
      push(
        `「${label}」的設施${direction === 'entry' ? '從正線站進場' : '出場回到正線站'}沒有任何一條完整的路：`
          + (gaps.length > 0
            ? `路網上 ${gaps.map((edge) => `「${edge.fromLabel}」→「${edge.toLabel}」`).join('、')} 沒有行駛時間，請到地圖路網補上（缺值不當 0 秒）。`
              + '注意方向：兩個方向是各自的路段，「已設為雙向」只代表反方向那條存在，時間要各自填；'
              + '在地圖路網點那一條線，面板會顯示對向是否有時間。'
            : '路網上沒有連通的路段，請到地圖路網補上連線。'),
        { scope: 'selection', taskType, direction, missingTravelTimeEdges: gaps },
      );
    }
  }
  return issues;
}

const SECTION_LABEL: Record<string, string> = {
  charging: '充電',
  preTrip: '行檢',
  maintenance: '保養',
  carWash: '洗車',
  mobile: '待命',
};
