import {
  buildDailyReport,
  buildShuntOrder,
  orderSpan,
  rowPositionAt,
  ROTATION_RESOURCE_BUFFER_MS,
  DEFAULT_ROTATION_RULES,
  findSwapWindows,
  inTimeRange,
  nextRotationKm,
  noWindowReason,
  rotationQueue,
  shuntConflict,
  takeoverBlockers,
  takeoverCandidates,
  type FleetCar,
  type PlanTask,
} from './rotation.model'

const rules = { ...DEFAULT_ROTATION_RULES, takeoverRows: [10], windowStart: '00:00', windowEnd: '23:59' }
const MIN = 60_000
const HOUR = 3_600_000
const dayStart = 0
const now = 8 * HOUR

const car = (over: Partial<FleetCar>): FleetCar => ({
  code: 'PMS01',
  row: 1,
  onLine: true,
  currentKm: 10_000,
  lastRotationKm: 9_500,
  batteryPct: 80,
  restSince: null,
  hold: 'available',
  ...over,
})

const spare = (over: Partial<FleetCar>): FleetCar =>
  car({ code: 'PMS10', row: 10, onLine: false, restSince: now - 10 * HOUR, ...over })

const task = (over: Partial<PlanTask> & { trip_code: string; depart_at: number }): PlanTask => ({
  order_id: over.trip_code,
  vehicle_code: 'PMS01',
  timeline_row: 1,
  arrive_at: over.depart_at + MIN,
  kind: 'passenger',
  origin: 'NW',
  destination: 'T3',
  ...over,
})

describe('誰該下來：只看自己的里程', () => {
  it('下次可輪替里程＝上次輪替里程＋基數，不歸零', () => {
    expect(nextRotationKm(car({ lastRotationKm: 11_350 }), rules)).toBe(12_350)
  })

  it('比別台車多 1000 公里以上，但沒到自己的基數：不輪替', () => {
    const high = car({ code: 'PMS03', currentKm: 12_000, lastRotationKm: 11_500 })
    const low = spare({ currentKm: 9_000, lastRotationKm: 8_000 })
    expect(rotationQueue([high, low], rules)).toEqual([])
  })

  it('超過基數越多排越前面，沒有必須換的狀態', () => {
    const a = car({ code: 'A', currentKm: 10_600, lastRotationKm: 9_500 })
    const b = car({ code: 'B', currentKm: 13_000, lastRotationKm: 9_500 })
    expect(rotationQueue([a, b], rules).map((item) => item.code)).toEqual(['B', 'A'])
  })

  it('可接替時間線上的車是接別人工作的，里程再高也不排進隊伍', () => {
    const reserve = car({ code: 'PMS11', row: 10, currentKm: 13_000, lastRotationKm: 9_500 })
    expect(rotationQueue([reserve], rules)).toEqual([])
  })
})

describe('誰能上去', () => {
  it('保留、大保養、不在可接替的時間線都不能接替，並列出原因', () => {
    expect(takeoverBlockers(spare({ hold: 'overhaul' }), rules, dayStart)).toEqual(['大保養'])
    expect(takeoverBlockers(spare({ hold: 'reserved' }), rules, dayStart)).toEqual(['保留'])
    expect(takeoverBlockers(spare({ row: 5 }), rules, dayStart)).toEqual(['不在可接替的運用'])
    expect(takeoverBlockers(car({}), rules, dayStart)).toEqual(['線上服務中'])
  })

  it('可接替時間線上有載客班次（機動線）也能接替', () => {
    expect(takeoverBlockers(spare({ onLine: true }), rules, dayStart)).toEqual([])
  })

  it('電量與休息時間不是門檻', () => {
    expect(takeoverBlockers(spare({ batteryPct: 5, restSince: now }), rules, dayStart)).toEqual([])
  })

  it('當天剛換下的車不接替，隔天才可以', () => {
    const justOut = spare({ rotatedOutAt: now })
    expect(takeoverBlockers(justOut, rules, dayStart)).toEqual(['今天剛換下'])
    expect(takeoverBlockers(justOut, rules, now + 24 * HOUR)).toEqual([])
  })

  it('里程低的優先', () => {
    const list = takeoverCandidates({
      cars: [spare({ code: 'X', currentKm: 9_000 }), spare({ code: 'Y', currentKm: 8_000 })],
      rules,
      dayStart,
    })
    expect(list.map((item) => item.code)).toEqual(['Y', 'X'])
  })
})

describe('時間範圍', () => {
  const at = (hour: number) => new Date(2026, 10, 3, hour, 30).getTime()

  it('可以跨午夜', () => {
    expect(inTimeRange(at(23), '23:00', '02:00')).toBe(true)
    expect(inTimeRange(at(1), '23:00', '02:00')).toBe(true)
    expect(inTimeRange(at(12), '23:00', '02:00')).toBe(false)
  })

  it('不跨午夜', () => {
    expect(inTimeRange(at(10), '09:00', '11:00')).toBe(true)
    expect(inTimeRange(at(12), '09:00', '11:00')).toBe(false)
  })
})

describe('換手窗口與調車單', () => {
  const plan: PlanTask[] = [
    task({ trip_code: 'P1', depart_at: 9 * HOUR, arrive_at: 9 * HOUR + 10 * MIN, destination: 'NW' }),
    task({ trip_code: 'IN', kind: 'movement', depart_at: 9 * HOUR + 10 * MIN, arrive_at: 9 * HOUR + 11 * MIN, origin: 'NW', destination: 'E1' }),
    task({ trip_code: 'E', kind: 'maintenance', depart_at: 9 * HOUR + 11 * MIN, arrive_at: 10 * HOUR, origin: 'E1', destination: 'E1', maintenance: { maintenance_task_type: 'charging' } }),
    task({ trip_code: 'OT', kind: 'movement', depart_at: 10 * HOUR, arrive_at: 10 * HOUR + MIN, origin: 'E1', destination: 'NW' }),
    task({ trip_code: 'P2', depart_at: 10 * HOUR + MIN, arrive_at: 10 * HOUR + 11 * MIN, origin: 'NW', destination: 'T3' }),
    // T3 停站 0 秒
    task({ trip_code: 'P3', depart_at: 10 * HOUR + 11 * MIN, arrive_at: 10 * HOUR + 20 * MIN, origin: 'T3', destination: 'NW' }),
    task({ trip_code: 'P4', vehicle_code: 'PMS02', timeline_row: 2, depart_at: 10 * HOUR + 5 * MIN }),
    task({ trip_code: 'S10', vehicle_code: 'PMS10', timeline_row: 10, kind: 'maintenance', depart_at: 0, arrive_at: 20 * HOUR, origin: 'M4', destination: 'M4' }),
  ]
  const find = (notBefore = now) =>
    findSwapWindows({ tasks: plan, row: 1, takeoverRow: 10, dayStart, notBefore })

  it('充電區是窗口，T3 停站 0 秒不是', () => {
    const windows = find()
    expect(windows.map((item) => [item.id, item.zone, item.location])).toEqual([['P2', '充電區', 'E1']])
  })

  describe('收班後停到換日（之後只剩 0 秒占位）：在進場那一刻換手', () => {
    const night = [
      ...plan,
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'charging' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1' }),
    ]
    const entryOf = (tasks: PlanTask[]) =>
      findSwapWindows({ tasks, row: 1, takeoverRow: 10, dayStart, notBefore: now }).find((item) => item.entry)

    it('接手車先進那一格，被換車照原本進場時刻從月台開去接手車的格位', () => {
      const window = entryOf(night)!
      expect(window).toMatchObject({ endOfDay: true, meetAt: 'D1', location: 'NW', outAt: 10 * HOUR + 20 * MIN, skippedService: [] })
      expect(window.cancelled.map((item) => item.trip_code)).toEqual(['IN2', 'S2', 'OT2'])
      // 接手車在被換車離開月台前出發，被換車原本進到那一格的時刻前到
      expect(window.takeoverDepartAt).toBeLessThanOrEqual(10 * HOUR + 20 * MIN)
      expect(window.takeoverDepartAt + window.moveInMs).toBeLessThanOrEqual(10 * HOUR + 21 * MIN)
      const order = buildShuntOrder({ tasks: night, outgoing: car({}), incoming: spare({}), window })
      const out = order.changes.find((change) => change.key === 'add-outgoing')!
      expect([out.route, out.at]).toEqual(['NW → M4', 10 * HOUR + 20 * MIN])
      expect(order.counts.passenger).toBe(0)
    })

    it('進場後當天還有真的移動（半夜換格）就不用這個窗口：接手車跟隔天開頭的位置對不上', () => {
      const moved = night.map((item) => (item.trip_code === 'OT2' ? { ...item, destination: 'D2', arrive_at: 23 * HOUR + MIN } : item))
      expect(entryOf(moved)).toBeUndefined()
    })

    it('接手車那一列之後當天還有移動，就不能在收班時換：輪替隔天才生效，那些單還是派給它', () => {
      const busy = [...night, task({ trip_code: 'R10', vehicle_code: 'PMS10', timeline_row: 10, kind: 'movement', depart_at: 22 * HOUR, arrive_at: 22 * HOUR + 5 * MIN, origin: 'M4', destination: 'NW' })]
      expect(findSwapWindows({ tasks: busy, row: 1, takeoverRow: 10, dayStart, notBefore: now }).some((item) => item.endOfDay)).toBe(false)
    })
  })

  it('白天被換車跟接手車停同一個入口不是窗口：兩邊互等', () => {
    const sameEntry = plan.map((item) =>
      item.trip_code === 'S10' ? { ...item, origin: 'E4', destination: 'E4' } : item,
    )
    expect(findSwapWindows({ tasks: sameEntry, row: 1, takeoverRow: 10, dayStart, notBefore: now })).toEqual([])
  })

  it('收班後被換車跟接手車停同一個入口也不是窗口：接手車出場被擋', () => {
    const night = [
      ...plan.map((item) => (item.trip_code === 'S10' ? { ...item, origin: 'D4', destination: 'D4' } : item)),
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR, arrive_at: 23 * HOUR + MIN, origin: 'D1', destination: 'NW' }),
    ]
    expect(findSwapWindows({ tasks: night, row: 1, takeoverRow: 10, dayStart, notBefore: now }).some((item) => item.endOfDay)).toBe(false)
  })

  it('接手車到位前做完的場內任務留給被換車', () => {
    const night = [
      ...plan,
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'WT2', kind: 'maintenance', depart_at: 23 * HOUR, arrive_at: 23 * HOUR + 5 * MIN, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR + 5 * MIN, arrive_at: 23 * HOUR + 9 * MIN, origin: 'D1', destination: 'NW' }),
    ]
    const [window] = findSwapWindows({ tasks: night, row: 1, takeoverRow: 10, dayStart, notBefore: now })
    expect(window.cancelled.map((item) => item.trip_code)).toEqual(['OT2'])
    expect(window.takeoverDepartAt + window.moveInMs).toBe(23 * HOUR + 9 * MIN)
  })

  it('收班後的窗口排最前面，當天班次都不受影響', () => {
    const night = [
      ...plan,
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR, arrive_at: 23 * HOUR + MIN, origin: 'D1', destination: 'NW' }),
    ]
    const windows = findSwapWindows({ tasks: night, row: 1, takeoverRow: 10, dayStart, notBefore: now })
    expect(windows[0]).toMatchObject({ id: 'OT2', endOfDay: true, meetAt: 'NW', skippedService: [] })
    const order = buildShuntOrder({ tasks: night, outgoing: car({}), incoming: spare({}), window: windows[0] })
    expect(order.counts).toMatchObject({ reassign: 0, passenger: 0, cancel: 1 })
  })

  it('一組輪替占用到換下的車回場結束（再加緩衝），不是只到接班', () => {
    const night = [
      ...plan,
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR, arrive_at: 23 * HOUR + MIN, origin: 'D1', destination: 'NW' }),
    ]
    const windows = findSwapWindows({ tasks: night, row: 1, takeoverRow: 10, dayStart, notBefore: now })
    const order = buildShuntOrder({ tasks: night, outgoing: car({}), incoming: spare({}), window: windows[0] })
    const out = order.changes.find((change) => change.key === 'add-outgoing')!
    const [from, to] = orderSpan(order)
    expect(from).toBe(windows[0].takeoverDepartAt)
    expect(to).toBe(Math.max(out.at + out.durationMs!, windows[0].next.arrive_at!) + ROTATION_RESOURCE_BUFFER_MS)
    expect(to).toBeGreaterThan(windows[0].next.arrive_at!)
  })

  it('計畫上還在移動中的車不當成已在終點', () => {
    const moving = [task({ trip_code: 'MV', kind: 'movement', depart_at: 10 * HOUR, arrive_at: 10 * HOUR + 10 * MIN, origin: 'D1', destination: 'NW' })]
    expect(rowPositionAt(moving, 1, 10 * HOUR + 5 * MIN)).toEqual({ location: null, moving: true, headingTo: 'NW' })
    expect(rowPositionAt(moving, 1, 10 * HOUR + 11 * MIN)).toEqual({ location: 'NW', moving: false, headingTo: null })
  })

  it('會略過行檢的窗口排最後並標出來', () => {
    const inspect = plan.map((item) =>
      item.trip_code === 'OT' ? { ...item, kind: 'maintenance' as const, depart_at: 10 * HOUR, arrive_at: 10 * HOUR + MIN, origin: 'E1', destination: 'E1', maintenance: { maintenance_task_type: 'inspection' } } : item,
    )
    const windows = findSwapWindows({ tasks: inspect, row: 1, takeoverRow: 10, dayStart, notBefore: now })
    expect(windows.at(-1)?.skippedService).toEqual(['行檢'])
  })

  it('已經過去的窗口不列出', () => {
    expect(find(11 * HOUR)).toEqual([])
  })

  it('接手車同時段有移動任務就不是窗口', () => {
    const busy = [...plan, task({ trip_code: 'B', vehicle_code: 'PMS10', timeline_row: 10, kind: 'movement', depart_at: 9 * HOUR + 40 * MIN, arrive_at: 10 * HOUR + 5 * MIN })]
    expect(findSwapWindows({ tasks: busy, row: 1, takeoverRow: 10, dayStart, notBefore: now })).toEqual([])
  })

  it('調車單只列受影響的任務，班次時刻不變', () => {
    const outgoing = car({})
    const incoming = spare({})
    const order = buildShuntOrder({ tasks: plan, outgoing, incoming, window: find()[0] })
    expect(order.changes.filter((item) => item.kind === 'cancel').map((item) => item.tripCode)).toEqual(['OT'])
    expect(order.changes.filter((item) => item.kind === 'add').map((item) => item.after)).toEqual(['PMS10', 'PMS01'])
    const reassigned = order.changes.filter((item) => item.kind === 'reassign')
    expect(reassigned.map((item) => [item.tripCode, item.after])).toEqual([['P2', 'PMS10'], ['P3', 'PMS10']])
    expect(reassigned[0].at).toBe(plan[4].depart_at)
    expect(order.changes.some((item) => item.tripCode === 'P4' || item.tripCode === 'P1')).toBe(false)
    expect(order.counts.unaffected).toBe(plan.length - 3)
  })

  describe('今日報告', () => {
    const due = car({ currentKm: 11_000, lastRotationKm: 9_500 })
    const night = [
      ...plan,
      task({ trip_code: 'IN2', kind: 'movement', depart_at: 10 * HOUR + 20 * MIN, arrive_at: 10 * HOUR + 21 * MIN, origin: 'NW', destination: 'D1' }),
      task({ trip_code: 'S2', kind: 'maintenance', depart_at: 10 * HOUR + 21 * MIN, arrive_at: 23 * HOUR, origin: 'D1', destination: 'D1', maintenance: { maintenance_task_type: 'standby' } }),
      task({ trip_code: 'OT2', kind: 'movement', depart_at: 23 * HOUR, arrive_at: 23 * HOUR + MIN, origin: 'D1', destination: 'NW' }),
    ]
    const report = (over: Partial<typeof rules> = {}, cars: FleetCar[] = [due, spare({})], tasks = night) =>
      buildDailyReport({ tasks, cars, rules: { ...rules, ...over }, now, dayStart, notBefore: 0 })

    it('到里程的車配上接替車，只用收班後的換手點', () => {
      const { orders, blocked } = report()
      expect(blocked).toEqual([])
      expect(orders).toHaveLength(1)
      expect(orders[0]).toMatchObject({ outgoing: 'PMS01', incoming: 'PMS10', window: { endOfDay: true } })
    })

    it('沒有收班後換手點就不換', () => {
      expect(report({}, [due, spare({})], plan).orders).toEqual([])
    })

    it('時段內找不到換手點就寫原因，不硬換', () => {
      const local = new Date(night.find((item) => item.trip_code === 'OT2')!.depart_at)
      const hour = (local.getHours() + 12) % 24
      const out = String(hour).padStart(2, '0')
      const { orders, blocked } = report({ windowStart: `${out}:00`, windowEnd: `${out}:30` })
      expect(orders).toEqual([])
      expect(blocked).toHaveLength(1)
      expect(blocked[0].reason).toMatch(new RegExp(`^收班進場 \\d\\d:\\d\\d（D1），${out}:00–${out}:30 內一直停在場內`))
    })

    it('沒有可接替車輛就寫原因', () => {
      expect(report({ takeoverRows: [] }).blocked).toEqual([{ code: 'PMS01', reason: '沒有可接替車輛' }])
    })

    it('時段內只有出場接載客：講清楚那是要改派當天班次的換手', () => {
      const hm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
      const exitAt = 23 * HOUR
      const withExit = [...night, task({ trip_code: 'P5', depart_at: exitAt + MIN, origin: 'NW', destination: 'T3' })]
      const reason = noWindowReason(withExit, 1, { ...rules, windowStart: hm(exitAt - 10 * MIN), windowEnd: hm(exitAt + 10 * MIN) })
      expect(reason).toContain(`下一次移動是 ${hm(exitAt)} D1 → NW 出場接載客`)
    })

    it('已確認的車不重排', () => {
      const first = report().orders[0]
      const again = buildDailyReport({ tasks: night, cars: [due, spare({})], rules, now, dayStart, notBefore: 0, keep: [{ order: first, status: 'confirmed' }] })
      expect(again.orders).toEqual([])
    })
  })

  describe('接替調車不跟班表上別的車搶路', () => {
    const T = (h: number, m: number, sec = 0) => (h * 60 + m) * MIN + sec * 1000
    const pax = (trip: string, row: number, from: string, to: string, dep: number, arr: number): PlanTask => ({
      order_id: `o-${trip}`, trip_code: trip, vehicle_code: null, timeline_row: row, depart_at: dep, arrive_at: arr,
      kind: 'passenger', origin: from, destination: to,
    })
    // 2026-11-27 23:47：PMS09 M3 → T3U → NWD，前面 23:54 有 TN2354（T3U → NWD，220 秒）、到 NWD 停到 23:58:30
    const plan: PlanTask[] = [
      pax('TN2354', 6, 'T3U', 'NWD', T(23, 54, 10), T(23, 57, 50)),
      { ...pax('IN062358', 6, 'NWD', 'E2', T(23, 58, 30), T(24, 7, 30)), kind: 'movement' },
    ]
    const hops = [
      { from: 'M3', to: 'T3U', ms: 60_000 },
      { from: 'T3U', to: 'NWD', ms: 200_000 },
    ]
    const check = (departAt: number) =>
      shuntConflict({ tasks: plan, ignoreRows: new Set([1, 10]), ignore: new Set(), hops, departAt, holdUntil: T(24, 0) })

    it('在載客車前面上正線、會被追上：衝突', () => {
      expect(check(T(23, 53))).toBe('TN2354')
    })
    it('跟在載客車後面隔一個班距、到站時月台已空：可以', () => {
      expect(check(T(23, 55, 15))).toBeNull()
    })
    it('到站時月台還有車停著：衝突', () => {
      const parked = [...plan, pax('NT0000X', 7, 'T3D', 'NWD', T(23, 50), T(23, 59, 50))]
      expect(
        shuntConflict({ tasks: parked, ignoreRows: new Set([1, 10]), ignore: new Set(), hops, departAt: T(23, 55, 15), holdUntil: T(24, 0) }),
      ).toBe('NT0000X')
    })
    it('同一場區的移動時間重疊：衝突', () => {
      const yard = [...plan, { ...pax('IN030010', 3, 'T3D', 'M1', T(23, 55, 30), T(23, 57)), kind: 'movement' as const }]
      expect(
        shuntConflict({ tasks: yard, ignoreRows: new Set([1, 10]), ignore: new Set(), hops, departAt: T(23, 55, 15), holdUntil: T(24, 0) }),
      ).toBe('IN030010')
    })
  })
})
