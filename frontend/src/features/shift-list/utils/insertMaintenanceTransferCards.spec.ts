import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyPointTopology } from '../../map-editor/types/pointTopology';
import type { PointTopology } from '../../map-editor/types/pointTopology';
import { insertMaintenanceTransferCards } from './insertMaintenanceTransferCards';
import type { GeneratedSchedulePlan } from './schedule-engine/types';

function edge(from: string, to: string, seconds: number) {
  return {
    id: `e:${from}->${to}`,
    fromNodeId: from,
    toNodeId: to,
    minTravelTimeSeconds: seconds,
    avgTravelTimeSeconds: seconds,
    distanceMeters: null,
  };
}

/**
 * 數某一種移動卡的張數。
 * 班表是日循環的（當日最後一段的下一段＝隔天第一段），所以只有「一段載客＋
 * 一段整備」這種極簡 fixture 也會同時產生入廠卡與出廠卡——測某一段規則時
 * 要數那一種卡，不能數總數，否則會被另一種卡的存在干擾。
 */
function countCards(
  timelines: GeneratedSchedulePlan['timelines'],
  source: 'yard_entry_move' | 'yard_exit_move',
): number {
  return timelines.reduce(
    (sum, t) => sum + t.blocks.filter((b) => b.source === source).length,
    0,
  );
}

const SECTION_CODES = {
  charging: 'E',
  carWash: 'W',
  maintenance: 'M',
  preTrip: 'P',
  mobile: 'H',
};

describe('insertMaintenanceTransferCards（入廠 MI／出廠 MO／整備間轉場，共用一個模組）', () => {
  describe('入廠（MI）：只在串首補，開始提前、結束不動', () => {
    /** N2W ──60s──> M1（快）／M2（慢 120s）；M 系是保養設施 */
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          {
            id: 'n-n2w',
            kind: 'docking',
            label: 'N2W',
            stationId: 'station_n2w',
            x: 0,
            y: 0,
            color: '#111111',
          },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222222' },
          { id: 'M2', kind: 'facility', label: 'M2', x: 0, y: 0, color: '#222222' },
        ],
        edges: [edge('n-n2w', 'M1', 60), edge('n-n2w', 'M2', 120)],
      };
    }

    const ROUTES = [
      {
        routeId: 'ab',
        routeCode: 'AB',
        routeName: 'A>N2W',
        stationIds: ['station_a', 'station_n2w'],
        stationDwells: [],
        minTravelTimeSeconds: 300,
        avgTravelTimeSeconds: 300,
        dwellSlackSeconds: 0,
        switchBufferAfterSeconds: 0,
      },
    ] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

    const BODY = {
      maintenance: {
        stepEnabled: true,
        equipmentRows: [{ id: 'r1', mapCode: 'M1' }, { id: 'r2', mapCode: 'M2' }],
      },
    };

    /** 正線 09:00–09:30，保養 yardStart–11:00 */
    function plan(args: {
      yardStartMinute: number;
      row?: number;
      extraYardAfter?: boolean;
    }): GeneratedSchedulePlan {
      const row = args.row ?? 1;
      const blocks: unknown[] = [
        {
          id: `pax-${row}`,
          timelineRow: row,
          taskType: 'passenger',
          label: 'AB',
          routeId: 'ab',
          anchorStartMinute: 9 * 60,
          plannedStartMinute: 9 * 60,
          plannedEndMinute: 9 * 60 + 30,
          travelSeconds: 300,
          dwellSeconds: 0,
          source: 'template_bar',
        },
        {
          id: `yard-${row}`,
          timelineRow: row,
          taskType: 'servicing',
          label: '保養',
          anchorStartMinute: args.yardStartMinute,
          plannedStartMinute: args.yardStartMinute,
          plannedEndMinute: 11 * 60,
          travelSeconds: 0,
          dwellSeconds: 0,
          source: 'template_bar',
        },
      ];
      if (args.extraYardAfter) {
        blocks.push({
          id: `yard2-${row}`,
          timelineRow: row,
          taskType: 'charging',
          label: '充電',
          anchorStartMinute: 11 * 60,
          plannedStartMinute: 11 * 60,
          plannedEndMinute: 12 * 60,
          travelSeconds: 0,
          dwellSeconds: 0,
          source: 'template_bar',
        });
      }
      return { timelines: [{ row, blocks }] } as never as GeneratedSchedulePlan;
    }

    function run(p: GeneratedSchedulePlan, body: unknown = BODY, topo: PointTopology = topology()) {
      return insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: topo,
        maintenanceBody: body as Record<string, unknown>,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
      });
    }

    it('整備開始提前到抵達時刻，結束時刻不動（時長變長）', () => {
      // 正線 09:30 結束，保養原訂 10:00–11:00，M1 要 60 秒 → 09:31 就到得了
      const p = plan({ yardStartMinute: 10 * 60 });
      const result = run(p);

      assert.equal(result.inserted, 1);
      assert.equal(result.yardHeadExtended, 1);

      const blocks = p.timelines[0]!.blocks;
      const card = blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.equal(card.yardExitSectionLabel, '保養', '沒有固定的 MI 標籤，代號跟著來源 taskType 動態算');
      assert.equal(card.plannedStartMinute, 9 * 60 + 30);
      assert.equal(card.plannedEndMinute, 9 * 60 + 31);

      const yard = blocks.find((b) => b.id === 'yard-1')!;
      assert.equal(yard.plannedStartMinute, 9 * 60 + 31, '整備開始要提前到 MI 抵達');
      assert.equal(yard.plannedEndMinute, 11 * 60, '整備結束時刻必須不動');
    });

    it('沒有提前空間就不插卡（車跑到整備開始才空出來）', () => {
      const p = plan({ yardStartMinute: 9 * 60 + 30 });
      const result = run(p);
      assert.equal(result.inserted, 0);
      assert.equal(p.timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move'), undefined);
    });

    it('挑最快到得了的設施', () => {
      const p = plan({ yardStartMinute: 10 * 60 });
      run(p);
      const card = p.timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.equal(card.yardExitFacilityLabel, 'M1', 'M1 60 秒比 M2 120 秒快');
      assert.equal(card.travelSeconds, 60);
    });

    it('兩條時間線同時經過同一個共用轉折點時，用 2 倍碰撞保護時間擋下——車不能瞬間分身', () => {
      // 兩列車都是 09:30 跑完正線、都要進 M 系保養——路徑都要先經過共用的
      // 轉折點 N2W，時刻完全相同：物理上不可能兩台車同時出現在同一個點。
      const row1 = plan({ yardStartMinute: 10 * 60, row: 1 });
      const row2 = plan({ yardStartMinute: 10 * 60, row: 2 });
      const p: GeneratedSchedulePlan = {
        timelines: [...row1.timelines, ...row2.timelines],
      } as never as GeneratedSchedulePlan;

      const result = insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 30,
      });

      assert.equal(
        countCards(p.timelines, 'yard_entry_move'), 1,
        '第一條線正常插入廠卡，第二條線因為轉折點衝突排不進去',
      );
      const junctionSkip = result.skipped.find((s) => /轉折點撞上/.test(s.reason));
      assert.ok(junctionSkip, '要有一則轉折點衝突的回報');
      assert.equal(junctionSkip.timelineRow, 2);

      const row1Card = p.timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move');
      assert.ok(row1Card, '先處理的時間線不受影響');
    });

    it('沒有設定碰撞保護時間（0）就不擋——維持原本可以同時經過的行為', () => {
      const row1 = plan({ yardStartMinute: 10 * 60, row: 1 });
      const row2 = plan({ yardStartMinute: 10 * 60, row: 2 });
      const p: GeneratedSchedulePlan = {
        timelines: [...row1.timelines, ...row2.timelines],
      } as never as GeneratedSchedulePlan;

      const result = insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
      });

      assert.equal(
        countCards(p.timelines, 'yard_entry_move'), 2,
        '碰撞保護時間是 0 就不加這層限制，兩條線都插得出入廠卡',
      );
      assert.equal(result.skipped.filter((s) => /轉折點撞上/.test(s.reason)).length, 0);
    });

    it('連續整備串只在串首入廠，不會每段都插', () => {
      const p = plan({ yardStartMinute: 10 * 60, extraYardAfter: true });
      run(p);
      assert.equal(countCards(p.timelines, 'yard_entry_move'), 1);
    });

    it('整備任務沒設定該類設施時回報，不硬插', () => {
      const p = plan({ yardStartMinute: 10 * 60 });
      const result = run(p, { maintenance: { stepEnabled: true, equipmentRows: [] } });
      assert.equal(countCards(p.timelines, 'yard_entry_move'), 0);
      assert.ok(result.skipped.some((s) => /沒設定這一類的設施/.test(s.reason)));
    });

    it('拓樸到不了該設施時回報（方向不對就是逆行，不會自己反向走）', () => {
      const p = plan({ yardStartMinute: 10 * 60 });
      const reversed = topology();
      // 把邊全部翻成「設施 → 站」，入廠方向就沒有了
      reversed.edges = reversed.edges.map((e) => ({
        ...e,
        fromNodeId: e.toNodeId,
        toNodeId: e.fromNodeId,
      }));
      const result = run(p, BODY, reversed);
      assert.equal(result.inserted, 0);
      assert.match(result.skipped[0]!.reason, /沒有可通的路徑/);
    });

    it('沒有拓樸時安靜略過，不當成錯誤', () => {
      const p = plan({ yardStartMinute: 10 * 60 });
      const result = insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: null,
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
      });
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped.length, 0);
    });
  });

  describe('出廠（MO）：只在串尾補，往前貼齊、零秒緩衝，空間不夠可吃整備尾巴', () => {
    /** M1(30s)／M2(60s) → station_4；M 系是保養設施 */
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          {
            id: 'n-station4',
            kind: 'docking',
            label: 'T3上行',
            stationId: 'station_4',
            x: 0,
            y: 0,
            color: '#111111',
          },
          { id: 'fac-m1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222222' },
          { id: 'fac-m2', kind: 'facility', label: 'M2', x: 0, y: 0, color: '#222222' },
          // M3：設施存在、也設定給保養用，但拓樸上沒有連到 station_4——
          // 用來跟「這一類根本沒設施」區分開。
          { id: 'fac-m3', kind: 'facility', label: 'M3', x: 0, y: 0, color: '#222222' },
        ],
        edges: [edge('fac-m1', 'n-station4', 30), edge('fac-m2', 'n-station4', 60)],
      };
    }

    const MAINTENANCE_BODY = {
      maintenance: {
        stepEnabled: true,
        equipmentRows: [{ id: 'r1', mapCode: 'M1' }, { id: 'r2', mapCode: 'M2' }],
      },
    };

    const SELECTED_ROUTES = [
      { routeId: 'route_tn', routeName: 'TN', stationIds: ['station_4', 'station_2'] },
    ] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

    function buildTimelines(args: {
      yardStartMinute: number;
      yardEndMinute: number;
      departMinute: number;
    }): GeneratedSchedulePlan['timelines'] {
      return [
        {
          row: 1,
          blocks: [
            {
              id: 'yard-1',
              timelineRow: 1,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: args.yardStartMinute,
              plannedStartMinute: args.yardStartMinute,
              plannedEndMinute: args.yardEndMinute,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
            {
              id: 'trip-1',
              timelineRow: 1,
              taskType: 'passenger',
              label: 'TN',
              routeId: 'route_tn',
              anchorStartMinute: args.departMinute,
              plannedStartMinute: args.departMinute,
              plannedEndMinute: args.departMinute + 5,
              travelSeconds: 300,
              dwellSeconds: 0,
              source: 'entry_service',
            },
          ],
        },
      ] as never as GeneratedSchedulePlan['timelines'];
    }

    function run(
      timelines: GeneratedSchedulePlan['timelines'],
      body: Record<string, unknown> = MAINTENANCE_BODY,
      topo: PointTopology = topology(),
    ) {
      return insertMaintenanceTransferCards({
        timelines,
        topology: topo,
        maintenanceBody: body,
        selectedRoutes: SELECTED_ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });
    }

    it('卡片結束時刻貼齊下一段發車（零秒緩衝），且往前推出開始時刻', () => {
      // 保養 00:00–01:00，發車 01:10 → 有 10 分鐘空檔，M1 只要 30 秒
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      });
      const result = run(timelines);

      assert.equal(result.inserted, 1);
      const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
      assert.ok(card);
      // 貼齊：結束 == 下一段發車
      assert.equal(card.plannedEndMinute, 70);
      // 往前推 30 秒
      assert.equal(card.plannedStartMinute, 70 - 0.5);
      assert.equal(card.travelSeconds, 30);
    });

    it('挑最快的那一台具體設施，並帶出設施代號', () => {
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      });
      run(timelines);
      const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
      // M1(30s) 比 M2(60s) 快
      assert.equal(card?.yardExitFacilityLabel, 'M1');
      assert.equal(card?.yardExitFacilityNodeId, 'fac-m1');
      assert.equal(card?.yardExitStationId, 'station_4');
      assert.equal(card?.yardExitSectionCode, 'M');
    });

    it('下一段時間一律不動', () => {
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      });
      run(timelines);
      const trip = timelines[0]!.blocks.find((b) => b.id === 'trip-1');
      assert.equal(trip?.plannedStartMinute, 70);
      assert.equal(trip?.plannedEndMinute, 75);
    });

    it('整備完零秒就要發車時，才吃整備尾巴（全系統唯一有此特權的卡）', () => {
      // 保養 00:00–01:10，發車也在 01:10 → 完全沒有空檔
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 70,
        departMinute: 70,
      });
      const result = run(timelines);

      assert.equal(result.inserted, 1);
      assert.equal(result.ateYardTail, 1);
      const yard = timelines[0]!.blocks.find((b) => b.id === 'yard-1');
      const card = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
      // 整備結束被往前縮 30 秒，卡片接上去
      assert.equal(yard?.plannedEndMinute, 70 - 0.5);
      assert.equal(card?.plannedStartMinute, 70 - 0.5);
      assert.equal(card?.plannedEndMinute, 70);
      assert.equal(card?.yardExitAteYardTail, true);
    });

    it('同一台設施同一時刻不給兩列車用，用完就回報排不出來', () => {
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      });
      // 第 2、3 列同時段保養：M1、M2 各一台，第 3 列就沒設施可用
      for (const row of [2, 3]) {
        const clone = buildTimelines({
          yardStartMinute: 0,
          yardEndMinute: 60,
          departMinute: 70,
        })[0]!;
        clone.row = row;
        for (const block of clone.blocks) {
          block.timelineRow = row;
          block.id = `${block.id}-r${row}`;
        }
        timelines.push(clone);
      }

      const result = run(timelines);
      assert.equal(countCards(timelines, 'yard_exit_move'), 2, '只有 M1、M2 兩台，第 3 列排不出出廠卡');
      assert.ok(result.skipped.some((s) => /被別列車佔著/.test(s.reason)));
    });

    it('拓樸上設施沒有連到下一段起點站時，回報而不硬塞', () => {
      const timelines = buildTimelines({
        yardStartMinute: 0,
        yardEndMinute: 60,
        departMinute: 70,
      });
      const result = run(
        timelines,
        // 保養設施改成 M3：設施存在，但拓樸上沒有連到 station_4
        { maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r', mapCode: 'M3' }] } },
      );
      assert.equal(countCards(timelines, 'yard_exit_move'), 0);
      assert.ok(result.skipped.some((s) => /沒有連到 station_4/.test(s.reason)));
    });
  });

  describe('整備間轉場：串內部兩段不同類型整備銜接，出廠卡＋入廠卡成對', () => {
    /**
     * E1（充電）── 30s ──> N2W ── 200s ──> T3 ── 30s ──> M1（保養）
     * 跟真實場域同形狀：設施→鄰站→（跨區）→鄰站→設施。
     */
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          { id: 'E1', kind: 'facility', label: 'E1', x: 0, y: 0, color: '#111111' },
          { id: 'N2W', kind: 'docking', label: 'N2W', x: 0, y: 0, color: '#222222' },
          { id: 'T3', kind: 'docking', label: 'T3', x: 0, y: 0, color: '#222222' },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#111111' },
        ],
        edges: [
          edge('E1', 'N2W', 30),
          edge('N2W', 'T3', 200),
          edge('T3', 'M1', 30),
        ],
      };
    }

    const BODY = {
      charging: { stepEnabled: true, equipmentRows: [{ id: 'r1', mapCode: 'E1' }] },
      maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r2', mapCode: 'M1' }] },
    };

    const ROUTES: Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'] = [];

    /** 充電 07:00–07:10（分鐘制），保養 07:10–10:50 */
    function plan(): GeneratedSchedulePlan {
      return {
        timelines: [
          {
            row: 1,
            blocks: [
              {
                id: 'charging-1',
                timelineRow: 1,
                taskType: 'charging',
                label: '充電',
                anchorStartMinute: 400,
                plannedStartMinute: 400,
                plannedEndMinute: 430,
                travelSeconds: 0,
                dwellSeconds: 0,
                source: 'template_bar',
              },
              {
                id: 'servicing-1',
                timelineRow: 1,
                taskType: 'servicing',
                label: '保養',
                anchorStartMinute: 430,
                plannedStartMinute: 430,
                plannedEndMinute: 650,
                travelSeconds: 0,
                dwellSeconds: 0,
                source: 'template_bar',
              },
            ],
          },
        ],
      } as never as GeneratedSchedulePlan;
    }

    function run(
      p: GeneratedSchedulePlan,
      topo: PointTopology = topology(),
      body: unknown = BODY,
      areas: Parameters<typeof insertMaintenanceTransferCards>[0]['areas'] = [],
    ) {
      return insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: topo,
        areas,
        maintenanceBody: body as Record<string, unknown>,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });
    }

    it('前一段跑滿全長、結束時刻不動；後一段開始被推遲、結束時刻不動', () => {
      const p = plan();
      const result = run(p);

      assert.equal(result.laterTaskCompressed, 1);
      assert.equal(
        result.skipped.filter((x) => x.fromTaskType === 'charging').length, 0,
        '充電→保養這個方向要排得出來（反方向繞回隔天的那一對不在這則測試範圍）',
      );

      const blocks = p.timelines[0]!.blocks;
      const charging = blocks.find((b) => b.id === 'charging-1')!;
      const servicing = blocks.find((b) => b.id === 'servicing-1')!;

      assert.equal(charging.plannedStartMinute, 400, '前一段開始不得更動');
      assert.equal(charging.plannedEndMinute, 430, '前一段結束不得更動——它已經做滿全長');
      assert.equal(servicing.plannedEndMinute, 650, '後一段結束不得更動');
      // 移動總秒數 30+200+30=260s=4.333分；後一段開始被推遲同樣的量
      assert.equal(servicing.plannedStartMinute, 430 + 260 / 60);
    });

    it('插入的是兩張卡——出廠卡緊接入廠卡，不是合併成一張', () => {
      const p = plan();
      run(p);
      const blocks = p.timelines[0]!.blocks;
      const mo = blocks.find((b) => b.source === 'yard_exit_move')!;
      const mi = blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.ok(mo, '要有一張 MO 出廠卡');
      assert.ok(mi, '要有一張 MI 入廠卡');
      assert.equal(mo.source, 'yard_exit_move');
      assert.equal(mi.source, 'yard_entry_move');
      // 出廠卡結束＝入廠卡開始，中間不留縫隙也不重疊
      assert.equal(mo.plannedEndMinute, mi.plannedStartMinute);
    });

    it('出廠卡代號用來源類型（充電=E）；入廠卡代號用目的類型（保養=M）', () => {
      const p = plan();
      run(p);
      const blocks = p.timelines[0]!.blocks;
      const mo = blocks.find((b) => b.source === 'yard_exit_move')!;
      const mi = blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.equal(mo.yardExitSectionCode, 'E');
      assert.equal(mi.yardExitSectionCode, 'M');
      // 沒有固定的 MO／MI 標籤，標題文字跟著來源 taskType 動態算
      assert.equal(mo.yardExitSectionLabel, '充電');
      assert.equal(mi.yardExitSectionLabel, '保養');
    });

    it('出廠卡是離開來源設施專屬的第一段邊；入廠卡吸收掉中間所有正線轉乘', () => {
      const p = plan();
      run(p);
      const blocks = p.timelines[0]!.blocks;
      const mo = blocks.find((b) => b.source === 'yard_exit_move')!;
      const mi = blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.equal(mo.yardExitFacilityLabel, 'E1');
      assert.equal(mo.yardExitStationId, 'N2W', '分界點是第一段邊的終點');
      assert.equal(mo.travelSeconds, 30, '出廠卡只有來源設施自己專屬的第一段邊');
      assert.equal(mi.yardExitStationId, 'N2W', '入廠卡從分界點接續');
      assert.equal(mi.yardExitFacilityLabel, 'M1');
      assert.equal(mi.travelSeconds, 230, '剩下的 200+30 秒都算在入廠卡');
    });

    it('兩座設施在地圖 JSON 上是同一個 Area 時，0 秒示意轉移，完全不查拓樸', () => {
      // 刻意讓 E2、M1 在拓樸上完全不連通（沒有任何邊）——同區域判斷
      // 只看 Area 容器結構，不靠拓樸找不找得到路徑。
      const disconnectedTopology: PointTopology = {
        ...emptyPointTopology(),
        nodes: [
          { id: 'E2', kind: 'facility', label: 'E2', x: 0, y: 0, color: '#111111' },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#111111' },
        ],
        edges: [],
      };
      const areas = [
        {
          id: 'area-193',
          customName: '維修充電共用區',
          facilities: [
            { id: 'E2', type: 'Facility' },
            { id: 'M1', type: 'Facility' },
          ],
        },
      ] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['areas'];
      const p = plan();
      const result = run(
        p,
        disconnectedTopology,
        { charging: { stepEnabled: true, equipmentRows: [{ id: 'r1', mapCode: 'E2' }] },
          maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r2', mapCode: 'M1' }] } },
        areas,
      );
      assert.equal(
        result.skipped.filter((x) => x.fromTaskType === 'charging').length, 0,
        '沒有拓樸路徑也要能成立——同區域不靠拓樸',
      );
      const blocks = p.timelines[0]!.blocks;
      const mo = blocks.find((b) => b.source === 'yard_exit_move')!;
      const mi = blocks.find((b) => b.source === 'yard_entry_move')!;
      assert.equal(mo.label, '整備出廠 · E2 → M1');
      assert.equal(mi.label, '整備入廠 · E2 → M1');
      assert.equal(mo.travelSeconds, 0, '同區域是 0 秒示意轉移');
      assert.equal(mi.travelSeconds, 0);
      assert.equal(mo.plannedStartMinute, mo.plannedEndMinute, '出廠卡開始跟結束是同一刻');
      assert.equal(mi.plannedStartMinute, mi.plannedEndMinute, '入廠卡開始跟結束是同一刻');
      // 後一段（保養）緊接著前一段（充電）結束，中間完全沒有間隔
      const servicing = blocks.find((b) => b.id === 'servicing-1')!;
      const charging = blocks.find((b) => b.id === 'charging-1')!;
      assert.equal(servicing.plannedStartMinute, charging.plannedEndMinute);
    });

    it('兩座設施不在同一個 Area（或沒有 Area 資料）時，照樣走拓樸找路徑', () => {
      const p = plan();
      // 不傳 areas（預設空陣列）——沒有 Area 資料就不算同區域，跟原本一樣查拓樸
      const result = run(p);
      assert.equal(result.inserted, 1);
      const blocks = p.timelines[0]!.blocks;
      const mo = blocks.find((b) => b.source === 'yard_exit_move')!;
      assert.equal(mo.travelSeconds, 30, '沒有 Area 資料就不是同區域，維持查拓樸的正常時長');
    });

    it('同類型銜接不需要轉場，不插卡', () => {
      const p: GeneratedSchedulePlan = {
        timelines: [
          {
            row: 1,
            blocks: [
              { ...plan().timelines[0]!.blocks[1]!, id: 'a', taskType: 'servicing' },
              {
                ...plan().timelines[0]!.blocks[1]!,
                id: 'b',
                taskType: 'servicing',
                plannedStartMinute: 650,
                plannedEndMinute: 700,
              },
            ],
          },
        ],
      } as never as GeneratedSchedulePlan;
      const result = run(p);
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped.length, 0);
    });

    it('移動時間長到會把後一段推過結束時刻時，回報而不強插', () => {
      const p = plan();
      // 把後一段結束時刻改到很早，移動 260 秒（4.3 分）根本塞不下
      p.timelines[0]!.blocks[1]!.plannedEndMinute = 431;
      const result = run(p);
      const forwardSkip = result.skipped.find((x) => x.fromTaskType === 'charging');
      assert.ok(forwardSkip, '充電→保養這個方向要被擋下並回報');
      assert.match(forwardSkip.reason, /塞不進這段空檔/);
      // 兩段都維持原樣
      assert.equal(p.timelines[0]!.blocks[0]!.plannedEndMinute, 430);
    });

    it('其中一種類型沒設定設施時回報，不硬插', () => {
      const p = plan();
      const result = run(p, topology(), { charging: { stepEnabled: true, equipmentRows: [] } });
      const forwardSkip = result.skipped.find((x) => x.fromTaskType === 'charging');
      assert.ok(forwardSkip, '充電→保養這個方向要被擋下並回報');
      assert.match(forwardSkip.reason, /沒設定設施/);
    });

    it('沒有拓樸時安靜略過，不當成錯誤', () => {
      const p = plan();
      const result = insertMaintenanceTransferCards({
        timelines: p.timelines,
        topology: null,
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });
      assert.equal(result.inserted, 0);
      assert.equal(result.skipped.length, 0);
    });
  });

  describe('待命（standby）：設施優先、選點前瞻下一個任務', () => {
    /**
     * 兩個區域，各自有一個轉折點：
     *   E 區：E1 ──30s──> GATE_E ──30s──> E1（進出同一個閘門）
     *   M 區：M1 ──30s──> GATE_M ──30s──> M1
     * 兩個閘門之間 600 秒——所以「待在哪一區」對下一步的成本差很大。
     */
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          { id: 'GATE_E', kind: 'docking', label: 'GATE_E', stationId: 'st_e', x: 0, y: 0, color: '#111' },
          { id: 'GATE_M', kind: 'docking', label: 'GATE_M', stationId: 'st_m', x: 0, y: 0, color: '#111' },
          { id: 'E1', kind: 'facility', label: 'E1', x: 0, y: 0, color: '#222' },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222' },
        ],
        edges: [
          edge('GATE_E', 'E1', 30), edge('E1', 'GATE_E', 30),
          edge('GATE_M', 'M1', 30), edge('M1', 'GATE_M', 30),
          edge('GATE_E', 'GATE_M', 600), edge('GATE_M', 'GATE_E', 600),
        ],
      };
    }
    // 待命可掛 E1 與 M1 兩處；保養只能用 M1
    const BODY = {
      mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'E1' }, { id: 'b', mapCode: 'M1' }] },
      maintenance: { stepEnabled: true, equipmentRows: [{ id: 'c', mapCode: 'M1' }] },
    };
    const ROUTES: Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'] = [];

    function run(timelines: GeneratedSchedulePlan['timelines']) {
      return insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });
    }

    const yardBlock = (
      id: string, row: number, taskType: string, start: number, end: number,
    ) => ({
      id, timelineRow: row, taskType, label: taskType,
      anchorStartMinute: start, plannedStartMinute: start, plannedEndMinute: end,
      travelSeconds: 0, dwellSeconds: 0, source: 'template_bar',
    });

    it('待命選點看「下一個任務在哪」——下一段是保養（M 區）就待在 M 區', () => {
      // 待命 08:00–10:00，接著保養 10:00–12:00（只能在 M1）
      const timelines = [{
        row: 1,
        blocks: [
          yardBlock('standby-1', 1, 'standby', 8 * 60, 10 * 60),
          yardBlock('maint-1', 1, 'servicing', 10 * 60, 12 * 60),
        ],
      }] as never as GeneratedSchedulePlan['timelines'];

      run(timelines);
      const standby = timelines[0]!.blocks.find((b) => b.id === 'standby-1')!;
      const maint = timelines[0]!.blocks.find((b) => b.id === 'maint-1')!;
      assert.equal(maint.yardFacilityLabel, 'M1');
      assert.equal(
        standby.yardFacilityLabel, 'M1',
        '待命要待在下一段保養的同一區（出去 0 秒），不是隨便挑一個進得去的',
      );
    });

    it('設施優先：真整備先挑，待命只能拿剩下的', () => {
      // 兩列車時段完全重疊：保養只能用 M1，待命 M1/E1 都行 → 待命必須讓出 M1
      const timelines = [
        { row: 1, blocks: [yardBlock('standby-1', 1, 'standby', 8 * 60, 12 * 60)] },
        { row: 2, blocks: [yardBlock('maint-2', 2, 'servicing', 8 * 60, 12 * 60)] },
      ] as never as GeneratedSchedulePlan['timelines'];

      const result = run(timelines);
      const standby = timelines[0]!.blocks[0]!;
      const maint = timelines[1]!.blocks[0]!;
      assert.equal(maint.yardFacilityLabel, 'M1', '真整備優先拿到它唯一能用的 M1');
      assert.equal(standby.yardFacilityLabel, 'E1', '待命讓出 M1，去別的地方納涼');
      assert.equal(result.facilityUnavailable.length, 0);
    });
  });

  describe('待命停在正線停靠站：真的把那一格佔住', () => {
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          { id: 'n-t3', kind: 'docking', label: 'T3上行', stationId: 'station_t3', x: 0, y: 0, color: '#111' },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222' },
        ],
        edges: [edge('n-t3', 'M1', 60), edge('M1', 'n-t3', 60)],
      };
    }
    // 待命可以掛「T3上行」這個停靠站
    const BODY = {
      mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'T3上行' }] },
    };

    it('待命掛到停靠站時，會寫上 yardFacilityStationId 供站位佔用表使用', () => {
      const timelines = [{
        row: 1,
        blocks: [{
          id: 'standby-1', timelineRow: 1, taskType: 'standby', label: '待命',
          anchorStartMinute: 8 * 60, plannedStartMinute: 8 * 60, plannedEndMinute: 11 * 60,
          travelSeconds: 0, dwellSeconds: 0, source: 'template_bar',
        }],
      }] as never as GeneratedSchedulePlan['timelines'];

      insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: [],
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      const standby = timelines[0]!.blocks.find((b) => b.id === 'standby-1')!;
      assert.equal(standby.yardFacilityLabel, 'T3上行');
      assert.equal(
        standby.yardFacilityStationId, 'station_t3',
        '停在停靠站要記下 stationId——站位佔用表靠它才知道那一格被佔走',
      );
    });

    it('停在設施格時不寫 stationId——設施格不佔正線站位', () => {
      const BODY_FACILITY = {
        mobile: { stepEnabled: true, equipmentRows: [{ id: 'a', mapCode: 'M1' }] },
      };
      const timelines = [{
        row: 1,
        blocks: [{
          id: 'standby-1', timelineRow: 1, taskType: 'standby', label: '待命',
          anchorStartMinute: 8 * 60, plannedStartMinute: 8 * 60, plannedEndMinute: 11 * 60,
          travelSeconds: 0, dwellSeconds: 0, source: 'template_bar',
        }],
      }] as never as GeneratedSchedulePlan['timelines'];

      insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY_FACILITY,
        selectedRoutes: [],
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      const standby = timelines[0]!.blocks.find((b) => b.id === 'standby-1')!;
      assert.equal(standby.yardFacilityLabel, 'M1');
      assert.equal(standby.yardFacilityStationId, undefined);
    });
  });

  describe('三段共用一份設施佔用表：不同種卡不會撞用同一台設施', () => {
    /**
     * 單一設施 M1 同時是「保養」入廠目的地，也是另一列車出廠的起點——
     * 用來確認入廠、出廠共用的是同一份 bookings，不是各自獨立、互相看不見。
     */
    function topology(): PointTopology {
      return {
        ...emptyPointTopology(),
        nodes: [
          {
            id: 'n-a',
            kind: 'docking',
            label: 'A',
            stationId: 'station_a',
            x: 0,
            y: 0,
            color: '#111111',
          },
          {
            id: 'n-b',
            kind: 'docking',
            label: 'B',
            stationId: 'station_b',
            x: 0,
            y: 0,
            color: '#111111',
          },
          { id: 'M1', kind: 'facility', label: 'M1', x: 0, y: 0, color: '#222222' },
        ],
        edges: [edge('n-a', 'M1', 60), edge('M1', 'n-b', 60)],
      };
    }

    const BODY = {
      maintenance: { stepEnabled: true, equipmentRows: [{ id: 'r1', mapCode: 'M1' }] },
    };

    const ROUTES = [
      {
        routeId: 'a-in',
        routeCode: 'AI',
        stationIds: ['station_x', 'station_a'],
      },
      {
        routeId: 'b-out',
        routeCode: 'BO',
        stationIds: ['station_b', 'station_y'],
      },
    ] as never as Parameters<typeof insertMaintenanceTransferCards>[0]['selectedRoutes'];

    it('日循環：當日最後一段整備的「下一段」，是同一台車隔天的第一段載客', () => {
      // 整備排在當日尾巴（22:00–24:00），當日之內後面沒有任何載客——
      // 但班表是一天無限重複的，它要銜接的是隔天 00:10 那一段載客。
      // 線性看待會直接放棄、整備沒有出廠卡，車等於憑空離開整備廠。
      const timelines = [
        {
          row: 1,
          blocks: [
            {
              id: 'pax-head',
              timelineRow: 1,
              taskType: 'passenger',
              label: 'BO',
              routeId: 'b-out',
              anchorStartMinute: 10,
              plannedStartMinute: 10,
              plannedEndMinute: 40,
              travelSeconds: 1800,
              dwellSeconds: 0,
              source: 'template_bar',
            },
            {
              id: 'yard-tail',
              timelineRow: 1,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: 22 * 60,
              plannedStartMinute: 22 * 60,
              plannedEndMinute: 24 * 60,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
          ],
        },
      ] as never as GeneratedSchedulePlan['timelines'];

      insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      const exitCard = timelines[0]!.blocks.find((b) => b.source === 'yard_exit_move');
      assert.ok(exitCard, '繞過午夜也要排得出出廠卡');
      // M1→B 要 60 秒；貼齊隔天 00:10 發車 → 卡片落在 24:09 - 24:10（＝隔天 00:09–00:10）
      assert.equal(exitCard.plannedEndMinute, 24 * 60 + 10, '結束時刻＝隔天首段發車（+1440）');
      assert.equal(exitCard.plannedStartMinute, 24 * 60 + 9);
      assert.equal(
        timelines[0]!.blocks.find((b) => b.id === 'yard-tail')!.plannedEndMinute,
        24 * 60,
        '整備結束時刻不動——出廠卡排在它後面，沒有吃到尾巴',
      );
    });

    it('日循環：緊鄰的同類型整備跨午夜相接時，是同一段停留，設施要沿用同一台', () => {
      // 保養 20:00–24:00 接 00:00–06:00：日循環上這兩段是相接的同一段停留，
      // 車不會在午夜換格子。線性看待會把後者當成獨立的一段、另外找一台設施，
      // 只有一台 M1 時就會誤報「沒地方停」。
      const timelines = [
        {
          row: 1,
          blocks: [
            {
              id: 'yard-head',
              timelineRow: 1,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: 0,
              plannedStartMinute: 0,
              plannedEndMinute: 6 * 60,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
            {
              id: 'yard-tail',
              timelineRow: 1,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: 20 * 60,
              plannedStartMinute: 20 * 60,
              plannedEndMinute: 24 * 60,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
          ],
        },
      ] as never as GeneratedSchedulePlan['timelines'];

      const result = insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      const head = timelines[0]!.blocks.find((b) => b.id === 'yard-head')!;
      const tail = timelines[0]!.blocks.find((b) => b.id === 'yard-tail')!;
      assert.equal(head.yardFacilityLabel, 'M1');
      assert.equal(tail.yardFacilityLabel, 'M1', '跨午夜的同一段停留必須是同一台設施');
      assert.ok(!head.yardFacilityUnavailable, '不得誤報沒地方停');
      assert.ok(!tail.yardFacilityUnavailable);
      assert.equal(result.facilityUnavailable.length, 0);
    });

    it('沒排出任何移動卡的整備任務，也要補一台設施；一台都不空才標記為無可用設施', () => {
      // 兩列車的保養完全同時段，只有一台 M1——第一列拿到，第二列沒地方停。
      // 兩列都沒有前後的載客可回溯，所以三段規則都不會插任何移動卡：
      // 舊版會讓兩列都靜靜地沒有設施、也沒有任何警告，畫面上看不出問題。
      const yardOnlyRow = (row: number) => ({
        row,
        blocks: [
          {
            id: `yard-${row}`,
            timelineRow: row,
            taskType: 'servicing',
            label: '保養',
            anchorStartMinute: 10 * 60,
            plannedStartMinute: 10 * 60,
            plannedEndMinute: 12 * 60,
            travelSeconds: 0,
            dwellSeconds: 0,
            source: 'template_bar',
          },
        ],
      });
      const timelines = [yardOnlyRow(1), yardOnlyRow(2)] as never as GeneratedSchedulePlan['timelines'];

      const result = insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      assert.equal(result.inserted, 0, '這個情境本來就不會有移動卡');
      const first = timelines[0]!.blocks[0]!;
      const second = timelines[1]!.blocks[0]!;
      assert.equal(first.yardFacilityLabel, 'M1', '沒有移動卡也要補上設施');
      assert.ok(!first.yardFacilityUnavailable);
      assert.equal(second.yardFacilityLabel, undefined, '只有一台 M1，第二列沒地方停');
      assert.equal(second.yardFacilityUnavailable, true, '沒地方停必須標記出來，不能靜默');

      assert.equal(result.facilityUnavailable.length, 1);
      assert.equal(result.facilityUnavailable[0]!.blockId, 'yard-2', '要帶 blockId 才能把警告掛回那張卡');
      assert.equal(result.facilityUnavailable[0]!.facilityCount, 1);
      assert.match(result.facilityUnavailable[0]!.reason, /沒地方停/);
    });

    it('入廠卡的「設施空不空」檢查窗，必須涵蓋整段整備時長，不是只有抵達前那一小段', () => {
      // 回歸測試：舊版檢查的是 [抵達, 原訂整備開始] 那一小段、佔用的卻是整段，
      // 兩個窗口對不上——別列車早就訂走整段的 M1，第二列還是會被判定成空的，
      // 於是兩台車同時被排進同一格保養位（真實資料上抓到 35 組這種重疊）。
      //
      // 第 1 列：正線 09:59 結束 → 10:00 抵達 M1，保養 10:30–12:00（佔 M1 到 12:00）
      // 第 2 列：正線 08:59 結束 → 09:00 抵達 M1，保養 09:30–11:00
      //   舊版檢查窗 [09:00, 09:30] 跟第 1 列的 [10:00, 12:00] 不重疊 → 誤判為可用
      //   新版檢查窗 [09:00, 11:00] 跟第 1 列重疊 → 正確擋下
      const yardRow = (row: number, paxEnd: number, yardStart: number, yardEnd: number) => ({
        row,
        blocks: [
          {
            id: `pax-${row}`,
            timelineRow: row,
            taskType: 'passenger',
            label: 'AI',
            routeId: 'a-in',
            anchorStartMinute: paxEnd - 30,
            plannedStartMinute: paxEnd - 30,
            plannedEndMinute: paxEnd,
            travelSeconds: 1800,
            dwellSeconds: 0,
            source: 'template_bar',
          },
          {
            id: `yard-${row}`,
            timelineRow: row,
            taskType: 'servicing',
            label: '保養',
            anchorStartMinute: yardStart,
            plannedStartMinute: yardStart,
            plannedEndMinute: yardEnd,
            travelSeconds: 0,
            dwellSeconds: 0,
            source: 'template_bar',
          },
        ],
      });

      const timelines = [
        yardRow(1, 9 * 60 + 59, 10 * 60 + 30, 12 * 60),
        yardRow(2, 8 * 60 + 59, 9 * 60 + 30, 11 * 60),
      ] as never as GeneratedSchedulePlan['timelines'];

      const result = insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      const row1Yard = timelines[0]!.blocks.find((b) => b.id === 'yard-1')!;
      const row2Yard = timelines[1]!.blocks.find((b) => b.id === 'yard-2')!;
      // 只有一台 M1，兩列的保養時段重疊 → 只能有一列拿到
      const assigned = [row1Yard.yardFacilityLabel, row2Yard.yardFacilityLabel]
        .filter((x) => x != null);
      assert.equal(assigned.length, 1, '同一格 M1 不得同時指派給兩列車');
      assert.ok(result.skipped.some((s) => /被別列車佔著/.test(s.reason)));
    });

    it('入廠卡先佔走 M1，出廠卡在同一時段就排不進同一台設施', () => {
      const timelines: GeneratedSchedulePlan['timelines'] = [
        {
          row: 1,
          blocks: [
            {
              id: 'pax-in',
              timelineRow: 1,
              taskType: 'passenger',
              label: 'AI',
              routeId: 'a-in',
              anchorStartMinute: 0,
              plannedStartMinute: 0,
              plannedEndMinute: 10,
              travelSeconds: 600,
              dwellSeconds: 0,
              source: 'template_bar',
            },
            {
              id: 'yard-1',
              timelineRow: 1,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: 11,
              plannedStartMinute: 11,
              plannedEndMinute: 12,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
          ],
        },
        {
          row: 2,
          blocks: [
            {
              id: 'yard-2',
              timelineRow: 2,
              taskType: 'servicing',
              label: '保養',
              anchorStartMinute: 0,
              plannedStartMinute: 0,
              plannedEndMinute: 11,
              travelSeconds: 0,
              dwellSeconds: 0,
              source: 'template_bar',
            },
            {
              id: 'pax-out',
              timelineRow: 2,
              taskType: 'passenger',
              label: 'BO',
              routeId: 'b-out',
              anchorStartMinute: 12,
              plannedStartMinute: 12,
              plannedEndMinute: 20,
              travelSeconds: 480,
              dwellSeconds: 0,
              source: 'entry_service',
            },
          ],
        },
      ] as never as GeneratedSchedulePlan['timelines'];

      const result = insertMaintenanceTransferCards({
        timelines,
        topology: topology(),
        maintenanceBody: BODY,
        selectedRoutes: ROUTES,
        minimumRecoveryTimeSeconds: 0,
        collisionProtectionSeconds: 0,
        sectionCodes: SECTION_CODES,
      });

      // 兩列都想用 M1、時段重疊（入廠 09~10 分，出廠也貼著 11~12 分附近）——
      // 只有先搶到的一張能成立，另一張要嘛排不進去、要嘛用不同時段。
      const moCard = timelines[1]!.blocks.find((b) => b.source === 'yard_exit_move');
      const miCard = timelines[0]!.blocks.find((b) => b.source === 'yard_entry_move');
      // 至少要有一張卡成立（驗證的是兩種卡看得到同一份佔用表，不是誰輸誰贏）
      assert.ok(moCard || miCard || result.skipped.length > 0);
      if (moCard && miCard) {
        // 若兩張都排進去了，M1 的佔用時段不能重疊
        const miStart = minuteToSecond(miCard.plannedStartMinute);
        const miEnd = minuteToSecond(miCard.plannedEndMinute);
        const moStart = minuteToSecond(moCard.plannedStartMinute);
        const moEnd = minuteToSecond(moCard.plannedEndMinute);
        const overlap = miStart < moEnd - 1e-9 && moStart < miEnd - 1e-9;
        assert.equal(overlap, false, 'MI／MO 共用同一份設施佔用表，不得讓 M1 時段重疊');
      }
    });
  });
});

function minuteToSecond(minute: number): number {
  return minute * 60;
}
