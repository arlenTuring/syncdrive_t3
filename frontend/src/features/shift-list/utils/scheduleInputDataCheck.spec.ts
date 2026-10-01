import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyShiftScheduleCreateDraft } from '../types/create';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import { checkScheduleInputData } from './scheduleInputDataCheck';
import type { GenerateShiftScheduleInput } from './schedule-engine/generate';

/** 名稱、代號都只是測試資料 */
function edge(from: string, to: string, seconds: number | null) {
  return { id: `${from}>${to}`, fromNodeId: from, toNodeId: to, avgTravelTimeSeconds: seconds, minTravelTimeSeconds: seconds, distanceMeters: null };
}

function topology(overrides: Partial<PointTopology> = {}): PointTopology {
  return {
    ...emptyPointTopology(),
    nodes: [
      { id: 'n-a', kind: 'docking', label: 'A', stationId: 'st-a', x: 0, y: 0, color: '#111' },
      { id: 'n-b', kind: 'docking', label: 'B', stationId: 'st-b', x: 0, y: 0, color: '#111' },
      { id: 'gate', kind: 'waypoint', label: 'Gate', x: 0, y: 0, color: '#111' },
      { id: 'c1', kind: 'facility', label: 'C1', x: 0, y: 0, color: '#222' },
    ],
    edges: [edge('n-a', 'n-b', 60), edge('n-b', 'gate', 20), edge('gate', 'c1', 20), edge('c1', 'gate', 20), edge('gate', 'n-a', 20)],
    ...overrides,
  } as PointTopology;
}

function input(patch: { mapId?: string; topology?: PointTopology | null; stations?: string[]; tasks?: unknown[]; body?: Record<string, unknown> } = {}): GenerateShiftScheduleInput {
  const draft = emptyShiftScheduleCreateDraft();
  draft.routeGroups = {
    ...draft.routeGroups,
    mapId: patch.mapId ?? 'map-x',
    selectedRoutes: [{
      routeId: 'r1', routeName: 'A>B', groupId: 'g', groupName: 'g',
      stationIds: patch.stations ?? ['st-a', 'st-b'],
      stationDwells: [], stationDwellsConfirmed: true, stationLegTravels: [],
      avgTravelTimeSeconds: 60, minTravelTimeSeconds: 50, executionOrder: 1,
    }] as never,
  };
  return {
    draft,
    templateBody: {
      editorVersion: 1, scheduleRowCount: 1, attributes: [], intervals: [],
      tasks: patch.tasks ?? [{ id: 'c', rowIndex: 1, taskType: 'charging', startMinute: 60, durationMinutes: 60, label: '充電' }],
    },
    maintenanceTaskBody: patch.body ?? { charging: { stepEnabled: true, equipmentRows: [{ id: 'r', mapCode: 'C1' }] } },
    pointTopology: patch.topology === undefined ? topology() : patch.topology,
  } as GenerateShiftScheduleInput;
}

const messages = (issues: ReturnType<typeof checkScheduleInputData>) => issues.map((issue) => issue.message).join('\n');

describe('生成前的必要資料檢查（白皮書 MAP-01～03）', () => {
  it('資料齊全：沒有問題', () => {
    assert.deepEqual(checkScheduleInputData(input()), []);
  });

  it('沒選地圖：擋下，不自動改用其他地圖', () => {
    const issues = checkScheduleInputData(input({ mapId: '' }));
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.code, 'SCHEDULE_DATA_INCOMPLETE');
    assert.match(issues[0]!.message, /尚未在路線群組選擇地圖/);
  });

  it('地圖沒有路網拓樸：擋下', () => {
    assert.match(messages(checkScheduleInputData(input({ topology: null }))), /沒有路網拓樸/);
    assert.match(messages(checkScheduleInputData(input({ topology: topology({ edges: [] }) }))), /沒有任何路段/);
  });

  it('選圖當下先看地圖本身：路段端點不在路網上就擋，歸在地圖（scope=map），還沒選路線也照樣檢查', () => {
    const topo = topology();
    topo.edges.push(edge('n-a', 'ghost', 30));
    const issues = checkScheduleInputData(input({ topology: topo }));
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.detail?.scope, 'map');
    assert.match(issues[0]!.message, /n-a → ghost/);
    const noRoutes = input({ topology: topo });
    noRoutes.draft.routeGroups.selectedRoutes = [];
    assert.equal(checkScheduleInputData(noRoutes)[0]!.detail?.scope, 'map', '地圖本身的問題先報，不被「還沒選路線」蓋掉');
  });

  it('地圖本身沒問題、還沒選路線：只報本次選取（scope=selection）', () => {
    const noRoutes = input();
    noRoutes.draft.routeGroups.selectedRoutes = [];
    const issues = checkScheduleInputData(noRoutes);
    assert.deepEqual(issues.map((issue) => issue.detail?.scope), ['selection']);
  });

  it('路線上的站在路網找不到：指出第幾站', () => {
    assert.match(messages(checkScheduleInputData(input({ stations: ['st-a', 'st-x'] }))), /第 2 站「st-x」/);
  });

  it('模板用到的整備沒設定設施、或設施不在地圖上：擋下', () => {
    assert.match(messages(checkScheduleInputData(input({ body: {} }))), /沒有設定這一類的設施/);
    assert.match(
      messages(checkScheduleInputData(input({ body: { charging: { stepEnabled: true, equipmentRows: [{ id: 'r', mapCode: 'C9' }] } } }))),
      /「C9」在這張地圖的路網上找不到/,
    );
  });

  it('本次必要的進出場路段沒有行駛時間：指出哪一段，不當 0 秒', () => {
    const topo = topology({ edges: [edge('n-a', 'n-b', 60), edge('n-b', 'gate', 20), edge('gate', 'c1', null), edge('c1', 'gate', 20), edge('gate', 'n-a', 20)] });
    const text = messages(checkScheduleInputData(input({ topology: topo })));
    assert.match(text, /進場/);
    assert.match(text, /「Gate」→「C1」/);
  });

  it('模板沒用到的整備類型不檢查', () => {
    const tasks = [{ id: 'p', rowIndex: 1, taskType: 'passenger', startMinute: 0, durationMinutes: 60, label: '正線' }];
    assert.deepEqual(checkScheduleInputData(input({ tasks, body: {} })), []);
  });
});
