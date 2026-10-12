import type { YardSlotFieldBox } from '../utils/yardFacilitySlots'
import { isYardParkableFacilityId } from '../utils/yardFacilitySlots'

export type YardClassState = {
  stillSinceMs: number | null
  yard: boolean
  slotId: string | null
}

export type YardDecision = {
  yard: boolean
  slotId: string | null
  reason: 'marker' | 'not-in-slot' | 'no-payload'
  state: YardClassState
}

export const EMPTY_YARD_STATE: YardClassState = { stillSinceMs: null, yard: false, slotId: null }

export function isYardMarkerTrusted(payload: Record<string, unknown> | undefined): boolean {
  return payload?.location_kind === 'FACILITY'
    && typeof payload.segment_label === 'string'
    && isYardParkableFacilityId(payload.segment_label)
}

export function classifyYardVehicle(input: {
  payload?: Record<string, unknown>
  xM: number
  yM: number
  boxes: YardSlotFieldBox[]
  nowMs: number
  previous?: YardClassState
}): YardDecision {
  const yard = isYardMarkerTrusted(input.payload)
  const slotId = yard ? String(input.payload!.segment_label).trim() : null
  return {
    yard,
    slotId,
    reason: yard ? 'marker' : input.payload ? 'not-in-slot' : 'no-payload',
    state: { stillSinceMs: null, yard, slotId },
  }
}
