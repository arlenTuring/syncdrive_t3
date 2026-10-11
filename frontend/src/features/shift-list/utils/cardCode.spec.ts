import { describe, expect, it } from 'vitest'
import {
  buildShiftScheduleDraftFromStored,
  emptyShiftScheduleCreateDraft,
  isCreateShiftScheduleStepComplete,
  serializeShiftScheduleBody,
} from '../types/create'
import { resolveGeneratedBlockTripCode } from './maintenanceSectionCode'
import { findCardCodeConfigIssues, parseTransitionCardCodes } from './cardCode'
import { checkPlanCardCodes } from './cardCodeCheck'
import type { GeneratedSchedulePlan } from './schedule-engine/types'

/* 後端 backend/src/operation-shift/card-code.spec.ts 用同樣的例子：兩邊代號一定要一樣 */
const sectionCodes = { charging: 'E', carWash: 'W', maintenance: 'M', preTrip: 'P', mobile: 'S' }
const transitionCodes = { entry: 'IN', exit: 'OU', hold: 'H' }

type B = Parameters<typeof resolveGeneratedBlockTripCode>[0] & { id: string; label?: string }
const block = (over: Partial<B>): B => ({ id: 'b', taskType: 'charging', source: 'template_bar', timelineRow: 2, plannedStartMinute: 18 * 60 + 30, ...over })

describe('card display codes', () => {
  it('row 2 charging (E) at 10:30 shows E021030; row 10 entry (IN) at 21:35 shows IN102135', () => {
    expect(resolveGeneratedBlockTripCode(block({ plannedStartMinute: 10 * 60 + 30.75 }), 0, sectionCodes, transitionCodes)).toBe('E021030')
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'dispatch', source: 'yard_entry_move', timelineRow: 10, plannedStartMinute: 21 * 60 + 35 }), 0, sectionCodes, transitionCodes)).toBe('IN102135')
  })

  it('entry, exit and hold/stay use their own codes + HHMM, same as the backend orders', () => {
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'dispatch', source: 'yard_exit_move', plannedStartMinute: 600 }), 0, sectionCodes, transitionCodes)).toBe('OU021000')
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'dispatch', source: 'yard_entry_move', plannedStartMinute: 700 }), 0, sectionCodes, transitionCodes)).toBe('IN021140')
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'idle', source: 'hold', plannedStartMinute: 705 }), 0, sectionCodes, transitionCodes)).toBe('H021145')
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'idle', source: 'transition', plannedStartMinute: 800 }), 0, sectionCodes, transitionCodes)).toBe('H021320')
    // 待命用整備代號，不另設
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'standby' }), 0, sectionCodes, transitionCodes)).toBe('S021830')
  })

  it('passenger codes are unchanged', () => {
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'passenger', routeCode: 'TN' }), 0, sectionCodes, transitionCodes)).toBe('TN1830')
  })

  it('old shifts (no transition codes) keep the old codes', () => {
    expect(resolveGeneratedBlockTripCode(block({}), 0, sectionCodes)).toBe('EB1830')
  })

  it('a missing code shows ---- instead of inventing one', () => {
    expect(resolveGeneratedBlockTripCode(block({ taskType: 'idle', source: 'hold' }), 0, sectionCodes, { ...transitionCodes, hold: '' })).toBe('----')
  })
})

describe('card code settings', () => {
  const base = {
    sectionCodes,
    sectionEnabled: { charging: true, carWash: false, maintenance: true, preTrip: true, mobile: true },
    maintenanceSkipped: false,
    routeCodes: ['TN', 'ST'],
  }

  it('trims and upper-cases but rejects digits, spaces and symbols', () => {
    expect(parseTransitionCardCodes({ entry: ' in ', exit: 'ou', hold: 'h' })).toEqual(transitionCodes)
    const messages = findCardCodeConfigIssues({ ...base, transitionCodes: { entry: 'I1', exit: 'O U', hold: 'H!' } }).map((i) => i.message)
    expect(messages).toEqual([
      '「入場」代號不能有數字（1～2 個大寫英文字母）',
      '「出場」代號不能有空格（1～2 個大寫英文字母）',
      '「暫停／停留」代號只能用英文字母（1～2 個大寫英文字母）',
    ])
  })

  it('requires entry/exit only when a maintenance task is used; hold always', () => {
    const empty = { entry: '', exit: '', hold: '' }
    expect(findCardCodeConfigIssues({ ...base, transitionCodes: empty }).map((i) => i.key)).toEqual(['entry', 'exit', 'hold'])
    expect(findCardCodeConfigIssues({ ...base, maintenanceSkipped: true, transitionCodes: empty }).map((i) => i.key)).toEqual(['hold'])
  })

  it('rejects one code used for two purposes and a code equal to a route code', () => {
    const messages = findCardCodeConfigIssues({ ...base, transitionCodes: { entry: 'E', exit: 'TN', hold: 'H' } }).map((i) => i.message)
    expect(messages).toContain('代號「E」同時用在 入場、充電，不同用途不能共用')
    expect(messages).toContain('「出場」代號「TN」與正線路線代號相同，班次代號會混淆')
  })
})

describe('expanded plan conflicts', () => {
  const plan = (blocks: B[]): GeneratedSchedulePlan => ({
    timelines: [...new Set(blocks.map((b) => b.timelineRow))].map((row) => ({ row, blocks: blocks.filter((b) => b.timelineRow === row) })),
  }) as unknown as GeneratedSchedulePlan
  const check = (blocks: B[]) => checkPlanCardCodes({
    plan: plan(blocks), transitionCodes, sectionCodes,
    sectionEnabled: { charging: true }, maintenanceSkipped: false, routeCodes: ['TN'],
  })

  it('same code + same minute on two vehicles is fine because the row differs', () => {
    expect(check([block({ id: 'a', timelineRow: 2 }), block({ id: 'b', timelineRow: 5, plannedStartMinute: 18 * 60 + 30.5 })]).lines).toEqual([])
  })

  it('same row + same minute + same code is listed with kind, row and time — nothing appended', () => {
    const result = check([block({ id: 'a', timelineRow: 2 }), block({ id: 'b', timelineRow: 2, plannedStartMinute: 18 * 60 + 30.5 })])
    expect(result.lines).toEqual(['代號重複 E021830：充電（第 2 列 18:30）／充電（第 2 列 18:30）'])
  })

  it('different minutes are fine; old shifts are not checked', () => {
    expect(check([block({ id: 'a' }), block({ id: 'b', timelineRow: 5, plannedStartMinute: 18 * 60 + 31 })]).lines).toEqual([])
    expect(checkPlanCardCodes({ plan: null, transitionCodes: null, sectionCodes, sectionEnabled: {}, maintenanceSkipped: false, routeCodes: [] }).lines).toEqual([])
  })
})

describe('stored in the shift body', () => {
  it('round-trips through the body; old bodies stay pending without inventing codes', () => {
    const draft = emptyShiftScheduleCreateDraft()
    draft.routeGroups.transitionCardCodes = { entry: 'in', exit: 'OU', hold: 'H' }
    const body = serializeShiftScheduleBody(draft)
    expect(body.transitionCardCodes).toEqual(transitionCodes)
    expect(buildShiftScheduleDraftFromStored('x', body).routeGroups.transitionCardCodes).toEqual(transitionCodes)
    const { transitionCardCodes: _drop, ...legacy } = body
    void _drop
    expect(buildShiftScheduleDraftFromStored('x', legacy).routeGroups.transitionCardCodes).toBeNull()
    expect('transitionCardCodes' in serializeShiftScheduleBody(buildShiftScheduleDraftFromStored('x', legacy))).toBe(false)
  })

  it('an invalid code keeps the route-group step incomplete', () => {
    const draft = emptyShiftScheduleCreateDraft()
    draft.maintenanceTask.skipped = true
    draft.routeGroups.transitionCardCodes = { entry: '', exit: '', hold: 'H1' }
    expect(isCreateShiftScheduleStepComplete(4, draft, true)).toBe(false)
  })
})
