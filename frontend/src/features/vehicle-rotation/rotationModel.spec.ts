import { describe, expect, it } from 'vitest'
import {
  applySimulatedSwap,
  buildDailyReport,
  buildShuntOrder,
  DEFAULT_ROTATION_RULES,
  findSwapWindows,
  inTimeRange,
  isDue,
  monitorSteps,
  nextRotationKm,
  rotationQueue,
  takeoverBlockers,
  takeoverCandidates,
  type FleetCar,
  type PlanTask,
} from './rotationModel'

const rules = { ...DEFAULT_ROTATION_RULES, takeoverSlots: ['D1', 'M4'], windowStart: '00:00', windowEnd: '23:59' }
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
})

describe('誰能上去', () => {
  it('保留、大保養、不在格位都不能接替，並列出原因', () => {
    expect(takeoverBlockers(spare({ hold: 'overhaul' }), rules, 'M4', dayStart)).toEqual(['大保養'])
    expect(takeoverBlockers(spare({ hold: 'reserved' }), rules, 'Z9', dayStart)).toEqual(['保留', '不在可接替格位'])
    expect(takeoverBlockers(car({}), rules, 'M4', dayStart)).toEqual(['線上服務中'])
  })

  it('電量與休息時間不是門檻', () => {
    expect(takeoverBlockers(spare({ batteryPct: 5, restSince: now }), rules, 'M4', dayStart)).toEqual([])
  })

  it('當天剛換下的車不接替，隔天才可以', () => {
    const justOut = spare({ rotatedOutAt: now })
    expect(takeoverBlockers(justOut, rules, 'M4', dayStart)).toEqual(['今天剛換下'])
    expect(takeoverBlockers(justOut, rules, 'M4', now + 24 * HOUR)).toEqual([])
  })

  it('里程低的優先', () => {
    const tasks = [task({ trip_code: 'S', timeline_row: 10, kind: 'maintenance', depart_at: 0, origin: 'M4', destination: 'M4' })]
    const list = takeoverCandidates({
      tasks,
      cars: [spare({ code: 'X', currentKm: 9_000 }), spare({ code: 'Y', currentKm: 8_000 })],
      rules,
      now,
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
    task({ trip_code: 'S10', vehicle_code: 'PMS10', timeline_row: 10, kind: 'maintenance', depart_at: 0, arrive_at: 20 * HOUR, origin: 'D1', destination: 'D1' }),
  ]
  const find = (notBefore = now) =>
    findSwapWindows({ tasks: plan, row: 1, takeoverRow: 10, dayStart, notBefore })

  it('充電區是窗口，T3 停站 0 秒不是', () => {
    const windows = find()
    expect(windows.map((item) => [item.id, item.zone, item.location])).toEqual([['P2', '充電區', 'E1']])
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

  it('模擬換手後不會立刻互換回去', () => {
    const outgoing = car({ currentKm: 11_000, lastRotationKm: 9_500 })
    const incoming = spare({ currentKm: 8_000, lastRotationKm: 7_500 })
    expect(isDue(outgoing, rules)).toBe(true)
    const order = buildShuntOrder({ tasks: plan, outgoing, incoming, window: find()[0] })
    const after = applySimulatedSwap([outgoing, incoming], order, now)
    const [down, up] = after
    expect(up).toMatchObject({ row: 1, onLine: true, lastRotationKm: 8_000 })
    expect(isDue(up, rules)).toBe(false)
    expect(down).toMatchObject({ row: 10, onLine: false, lastRotationKm: 9_500 })
    expect(takeoverBlockers(down, rules, 'M4', dayStart)).toEqual(['今天剛換下'])
    expect(rotationQueue(after, rules)).toEqual([])
  })

  describe('今日報告', () => {
    const due = car({ currentKm: 11_000, lastRotationKm: 9_500 })
    const report = (over: Partial<typeof rules> = {}, cars: FleetCar[] = [due, spare({})]) =>
      buildDailyReport({ tasks: plan, cars, rules: { ...rules, ...over }, now, dayStart, notBefore: 0 })

    it('到里程的車配上接替車', () => {
      const { items, blocked } = report()
      expect(blocked).toEqual([])
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ status: 'pending', order: { outgoing: 'PMS01', incoming: 'PMS10' } })
    })

    it('時段內找不到換手點就寫原因，不硬換', () => {
      const { items, blocked } = report({ windowStart: '20:00', windowEnd: '21:00' })
      expect(items).toEqual([])
      expect(blocked).toEqual([{ code: 'PMS01', reason: '20:00–21:00 內找不到可換手的時間' }])
    })

    it('沒有可接替車輛就寫原因', () => {
      expect(report({ takeoverSlots: [] }).blocked).toEqual([{ code: 'PMS01', reason: '沒有可接替車輛' }])
    })

    it('會略過行檢的換手點不採用', () => {
      const inspect = plan.map((item) =>
        item.trip_code === 'OT' ? { ...item, kind: 'maintenance' as const, origin: 'E1', destination: 'E1', maintenance: { maintenance_task_type: 'inspection' } } : item,
      )
      const { items, blocked } = buildDailyReport({ tasks: inspect, cars: [due, spare({})], rules, now, dayStart, notBefore: 0 })
      expect(items).toEqual([])
      expect(blocked).toHaveLength(1)
    })

    it('重新產出時保留已確認的項目', () => {
      const first = report().items[0]
      const confirmed = { ...first, status: 'confirmed' as const, stepsDone: 2 }
      const again = buildDailyReport({ tasks: plan, cars: [due, spare({})], rules, now, dayStart, notBefore: 0, keep: [confirmed] })
      expect(again.items).toEqual([confirmed])
    })

    it('監看步驟依序：前往、抵達、承接、換下的車回格位', () => {
      const steps = monitorSteps(report().items[0].order)
      expect(steps.map((step) => step.key)).toEqual(['depart', 'arrive', 'takeover', 'return'])
      const times = steps.map((step) => step.at ?? 0)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
    })
  })
})
