import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALONG_CELLS,
  CELL_HYSTERESIS,
  quantiseAlong,
  quantiseLateral,
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
