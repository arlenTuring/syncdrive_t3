import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bundleLaneOffsetFactors } from './trackGenGraphLayout'

describe('bundleLaneOffsetFactors', () => {
  it('keeps opposite single-lane roads in geographic base order', () => {
    // 對向兩條單線：舊公式 ((base+k-(total-1)/2)*sign 會把兩邊翻成同一側或交叉
    const north = bundleLaneOffsetFactors(/*base*/ 0, 1, 2, /*eastbound*/ -1)
    const south = bundleLaneOffsetFactors(/*base*/ 1, 1, 2, /*westbound*/ 1)
    assert.equal(north.length, 1)
    assert.equal(south.length, 1)
    assert.ok(north[0]! < south[0]!, 'north stays above south even with opposite laneSign')
  })

  it('orders multi-lane left-of-travel within one edge', () => {
    // 東向：laneId 大＝左側＝版面較上（係數較小）
    const east = bundleLaneOffsetFactors(0, 2, 2, -1)
    assert.ok(east[1]! < east[0]!)
    // 西向：laneId 大＝左側＝版面較下
    const west = bundleLaneOffsetFactors(0, 2, 2, 1)
    assert.ok(west[1]! > west[0]!)
  })
})
