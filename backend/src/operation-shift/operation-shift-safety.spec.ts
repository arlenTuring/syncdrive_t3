import { OperationShiftService } from './operation-shift.service';
import {
  buildPlanFingerprint,
  resolveOperationShiftPublishCheckState,
} from './operation-shift-list.util';
import {
  buildSafetySettingsFingerprint,
  runStoredShiftSafetyCheck,
} from './safety/schedule-safety';
import {
  OperationShift,
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';

/**
 * 發布／部署前的獨立安全重驗。名稱與時刻都只是測試資料。
 *
 * 路線 A → B：行駛 120 秒，B 停 30 秒。兩條時間線的班次時刻由 fixture 決定：
 * 錯開就安全；同一刻從 A 發車就是站位碰撞。
 */
const ROUTES = [
  {
    routeId: 'route-ab',
    routeName: 'A>B',
    stationIds: ['station-a', 'station-b'],
    stationDwells: [
      {
        stationId: 'station-a',
        stationName: 'A',
        dwellSeconds: 0,
        dwellRequired: false,
      },
      {
        stationId: 'station-b',
        stationName: 'B',
        dwellSeconds: 30,
        dwellRequired: true,
        dwellMode: 'seconds',
      },
    ],
    avgTravelTimeSeconds: 120,
    minTravelTimeSeconds: 120,
    dwellSlackSeconds: 0,
    switchBufferAfterSeconds: 0,
  },
];

function trip(row: number, startMinute: number) {
  return {
    id: `trip-${row}`,
    timelineRow: row,
    taskType: 'passenger',
    source: 'template_bar',
    routeId: 'route-ab',
    anchorStartMinute: startMinute,
    plannedStartMinute: startMinute,
    plannedEndMinute: startMinute + 2.5,
    travelSeconds: 120,
    dwellSeconds: 30,
  };
}

function fixture(options: { secondTripMinute: number; storedSafe?: boolean }) {
  const plan = {
    timelines: [
      { row: 1, blocks: [trip(1, 600)] },
      { row: 2, blocks: [trip(2, options.secondTripMinute)] },
    ],
  };
  const body: Record<string, unknown> = {
    selectedRoutes: ROUTES,
    collisionProtectionSeconds: 30,
    maintenanceSectionCodeBySection: {},
    scheduleOutput: { plan },
  };
  // 前端存的「通過」紀錄（後端不能只相信它）
  (body.scheduleOutput as Record<string, unknown>).publishCheck = {
    checkedAt: '2026-01-01T00:00:00Z',
    planFingerprint: buildPlanFingerprint(plan),
    settingsFingerprint: buildSafetySettingsFingerprint({
      selectedRoutes: ROUTES,
      collisionProtectionSeconds: 30,
      sectionCodes: {},
    }),
    publishSafe: options.storedSafe ?? true,
    publishBlockingCount: options.storedSafe === false ? 1 : 0,
  };
  const row = {
    id: 'shift',
    body,
    usageStatus: OperationShiftUsageStatus.IDLE,
    publishStatus: OperationShiftPublishStatus.DRAFT,
  } as unknown as OperationShift;
  const query = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  const repo = {
    findOne: jest.fn().mockResolvedValue(row),
    save: jest.fn().mockImplementation((r: unknown) => r),
    createQueryBuilder: jest.fn().mockReturnValue(query),
  };
  const mapService = { getPublishedMapLibrary: jest.fn() };
  return {
    body,
    plan,
    row,
    repo,
    service: new OperationShiftService(repo as never, mapService as never),
  };
}

describe('發布／部署前的獨立安全重驗', () => {
  for (const method of ['publishShift', 'deployShift'] as const) {
    it(`${method}：前端標示通過、實際有站位碰撞，要拒絕，而且不改動任何班表`, async () => {
      const f = fixture({ secondTripMinute: 600, storedSafe: true });
      await expect(f.service[method]('shift')).rejects.toThrow(
        '禁止發布或部署',
      );
      expect(f.repo.save).not.toHaveBeenCalled();
      expect(f.repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it(`${method}：實際安全就放行（不管存的紀錄）`, async () => {
      const f = fixture({ secondTripMinute: 630, storedSafe: false });
      await f.service[method]('shift');
      expect(f.repo.save).toHaveBeenCalled();
    });

    it(`${method}：缺路線停靠設定或碰撞保護時間，要拒絕並說缺什麼`, async () => {
      const f = fixture({ secondTripMinute: 630 });
      delete f.body.collisionProtectionSeconds;
      await expect(f.service[method]('shift')).rejects.toThrow('碰撞保護時間');
      const g = fixture({ secondTripMinute: 630 });
      g.body.selectedRoutes = [];
      await expect(g.service[method]('shift')).rejects.toThrow('路線停靠設定');
      expect(f.repo.save).not.toHaveBeenCalled();
      expect(g.repo.save).not.toHaveBeenCalled();
    });
  }

  it('有移動卡卻拿不到地圖路網：不能當作沒問題', () => {
    const f = fixture({ secondTripMinute: 630 });
    f.plan.timelines[0].blocks.push({
      ...trip(1, 700),
      id: 'move-1',
      taskType: 'dispatch',
      source: 'yard_exit_move',
      routeId: '',
    });
    const result = runStoredShiftSafetyCheck(f.body, null);
    expect(result.publishSafe).toBe(false);
    expect(result.missing.join('')).toContain('地圖路網');
  });

  it('移動卡經過沒有行駛時間的路段：不能當 0 秒，要擋下並指出哪一段', () => {
    const f = fixture({ secondTripMinute: 630 });
    f.plan.timelines[0].blocks.push({
      ...trip(1, 700),
      id: 'move-1',
      taskType: 'dispatch',
      source: 'yard_entry_move',
      routeId: '',
      yardMoveViaLabels: ['A', 'Gate', 'Pit'],
    } as ReturnType<typeof trip>);
    const topology = {
      nodes: [
        { id: 'a', label: 'A', kind: 'docking', stationId: 'station-a' },
        { id: 'gate', label: 'Gate', kind: 'waypoint' },
        { id: 'pit', label: 'Pit', kind: 'facility' },
      ],
      edges: [
        {
          id: 'e1',
          fromNodeId: 'a',
          toNodeId: 'gate',
          avgTravelTimeSeconds: 20,
          minTravelTimeSeconds: 20,
        },
        {
          id: 'e2',
          fromNodeId: 'gate',
          toNodeId: 'pit',
          avgTravelTimeSeconds: null,
          minTravelTimeSeconds: null,
        },
      ],
    };
    const result = runStoredShiftSafetyCheck(f.body, topology);
    expect(result.publishSafe).toBe(false);
    const missing = result.blockingIssues.find(
      (issue) => issue.code === 'MISSING_TRAVEL_TIME',
    );
    expect(missing?.message).toContain('「Gate」→「Pit」');
  });
});

describe('清單上的檢查狀態', () => {
  it('舊紀錄（沒記設定指紋）不能沿用', () => {
    const f = fixture({ secondTripMinute: 630 });
    const check = (
      f.body.scheduleOutput as Record<string, Record<string, unknown>>
    ).publishCheck;
    expect(resolveOperationShiftPublishCheckState(f.body)).toBe('ready');
    delete check.settingsFingerprint;
    expect(resolveOperationShiftPublishCheckState(f.body)).toBe('unchecked');
  });

  it('設定改了（停靠秒數、碰撞保護）舊結論失效', () => {
    const f = fixture({ secondTripMinute: 630 });
    f.body.collisionProtectionSeconds = 60;
    expect(resolveOperationShiftPublishCheckState(f.body)).toBe('unchecked');
    const g = fixture({ secondTripMinute: 630 });
    g.body.selectedRoutes = [
      {
        ...ROUTES[0],
        stationDwells: [
          ROUTES[0].stationDwells[0],
          { ...ROUTES[0].stationDwells[1], dwellSeconds: 40 },
        ],
      },
    ];
    expect(resolveOperationShiftPublishCheckState(g.body)).toBe('unchecked');
  });

  it('班表改了舊結論失效；紀錄自相矛盾（通過卻有問題數）不算通過', () => {
    const f = fixture({ secondTripMinute: 630 });
    f.plan.timelines[1].blocks[0].plannedStartMinute = 631;
    expect(resolveOperationShiftPublishCheckState(f.body)).toBe('unchecked');
    const g = fixture({ secondTripMinute: 630 });
    (
      g.body.scheduleOutput as Record<string, Record<string, unknown>>
    ).publishCheck.publishBlockingCount = 1;
    expect(resolveOperationShiftPublishCheckState(g.body)).toBe('blocked');
  });
});

describe('對外班表讀哪一份', () => {
  it('部署後新舊兩份「最新已發布」同一個更新時間：回部署中的那一份', async () => {
    const f = fixture({ secondTripMinute: 630 });
    const row = (id: string, usage: OperationShiftUsageStatus) =>
      ({
        id,
        name: id,
        body: f.body,
        publishStatus: OperationShiftPublishStatus.PUBLISHED,
        usageStatus: usage,
        updatedAt: '1790446966554',
      }) as unknown as OperationShift;
    const repo = {
      // 資料庫對同分的排序不保證：刻意把舊的排前面
      find: jest
        .fn()
        .mockResolvedValue([
          row('old', OperationShiftUsageStatus.IDLE),
          row('deployed', OperationShiftUsageStatus.IN_USE),
        ]),
    };
    const service = new OperationShiftService(
      repo as never,
      { getPublishedMapLibrary: jest.fn() } as never,
    );
    const result = await service.getTimetableTrips({});
    expect(result.meta.shift_id).toBe('deployed');
  });
});
