import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALONG_CELLS,
  CELL_HYSTERESIS,
  QUANTISE_ALONG_POSITION,
  QUANTISE_LATERAL_POSITION,
  quantiseAlong,
  quantiseLateral,
  trackAlongIsReversed,
  TRACK_HALF_WIDTH_M,
} from './quantisedTrackCell'

describe('沿線分四格', () => {
  it('0–25% 是第 0 格，75–100% 是第 3 格', () => {
    assert.equal(quantiseAlong(0), 0)
    assert.equal(quantiseAlong(0.24), 0)
    assert.equal(quantiseAlong(0.25), 1)
    assert.equal(quantiseAlong(0.74), 2)
    assert.equal(quantiseAlong(0.75), 3)
    assert.equal(quantiseAlong(1), ALONG_CELLS - 1)
  })

  it('超出範圍的箝制在頭尾', () => {
    assert.equal(quantiseAlong(-5), 0)
    assert.equal(quantiseAlong(9), ALONG_CELLS - 1)
  })

  /*
   * 沒有遲滯的話，車停在邊界附近時座標一抖就會在兩格之間來回跳。
   */
  it('還沒離開上一格夠遠就不換格', () => {
    // 0.51 已經進入第 2 格，但只超過邊界 0.01，不到遲滯值
    assert.equal(quantiseAlong(0.51, 1), 1)
    // 超過遲滯值才換
    assert.equal(quantiseAlong(0.5 + CELL_HYSTERESIS + 0.001, 1), 2)
  })

  it('往回走一樣要越過遲滯才退格', () => {
    assert.equal(quantiseAlong(0.49, 2), 2)
    assert.equal(quantiseAlong(0.5 - CELL_HYSTERESIS - 0.001, 2), 1)
  })
})

describe('橫向分級', () => {
  const H = TRACK_HALF_WIDTH_M

  it('偏移在半寬的 15% 以內算在中間', () => {
    assert.equal(quantiseLateral(0), 0)
    assert.equal(quantiseLateral(H * 0.15), 0)
    assert.equal(quantiseLateral(-H * 0.15), 0)
  })

  it('15% 到 100% 貼在那一邊的邊緣', () => {
    assert.equal(quantiseLateral(H * 0.16), 1)
    assert.equal(quantiseLateral(H * 0.25), 1)
    assert.equal(quantiseLateral(H), 1)
    assert.equal(quantiseLateral(-H * 0.5), -1)
  })

  it('超過半寬就是整台在軌道外面', () => {
    assert.equal(quantiseLateral(H * 1.01), 2)
    assert.equal(quantiseLateral(-H * 3), -2)
  })
})

describe('位置不再格化', () => {
  /*
   * 格化把不到 30 公分的偏差放大成「整台壓在軌道邊緣」，沿線又每 25% 才動一次——
   * 車畫在哪裡就不能拿來判斷定位對不對。預設關掉，讀數（四格進度、偏移百分比）保留。
   */
  it('預設兩個開關都是關的', () => {
    assert.equal(QUANTISE_ALONG_POSITION, false)
    assert.equal(QUANTISE_LATERAL_POSITION, false)
  })
})

describe('折線順序與行車方向', () => {
  const east: Array<[number, number]> = [[0, 0], [100, 0]]

  it('同向：不用倒過來', () => {
    assert.equal(trackAlongIsReversed({ trackGenSpans: [{ road: 'r', lane: -1, s0: 0, s1: 100, h: 0, f0: 0, f1: 1 }] }, east), false)
  })

  it('折線往東、車道往西：要倒過來，進度條才會照行車方向走', () => {
    assert.equal(trackAlongIsReversed({ trackGenSpans: [{ road: 'r', lane: 1, s0: 0, s1: 100, h: Math.PI, f0: 0, f1: 1 }] }, east), true)
  })

  it('夾角剛好小於 90 度算同向', () => {
    const h = (80 * Math.PI) / 180
    assert.equal(trackAlongIsReversed({ trackGenSpans: [{ road: 'r', lane: -1, s0: 0, s1: 100, h, f0: 0, f1: 1 }] }, east), false)
  })

  it('沒有 h 的舊資料當成同向', () => {
    assert.equal(trackAlongIsReversed({ trackGenSpans: [{ road: 'r', lane: -1, s0: 0, s1: 100, f0: 0, f1: 1 }] }, east), false)
    assert.equal(trackAlongIsReversed(undefined, east), false)
  })
})
