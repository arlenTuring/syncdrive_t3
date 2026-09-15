/**
 * @vitest-environment jsdom
 *
 * parseOpenDriveXodr 用瀏覽器的 DOMParser 解 XML，Node 沒有這個全域物件。
 * 圖台本來就跑在瀏覽器，不為了測試改用別的解析器——換一支解析器就不是在測
 * 正式環境跑的那段程式了。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOpenDriveXodr } from './parseXodr'

const MINI_XODR = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <road name="r1" length="20" id="1" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="20">
        <line />
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <center>
          <lane id="0" type="none" level="false" />
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0" a="3" b="0" c="0" d="0" />
            <userData code="mmslLaneId" value="99" />
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>`

describe('parseOpenDriveXodr', () => {
  it('parses a minimal straight road with one driving lane', () => {
    const plan = parseOpenDriveXodr(MINI_XODR, { sampleStepM: 2 })
    expect(plan.roadCount).toBe(1)
    expect(plan.lanes.length).toBe(1)
    expect(plan.lanes[0]?.laneType).toBe('driving')
    expect(plan.lanes[0]?.mmslLaneId).toBe('99')
    expect(plan.lanes[0]?.points.length).toBeGreaterThan(4)
    expect(plan.bounds.xmax - plan.bounds.xmin).toBeGreaterThan(15)
    expect(plan.bounds.ymax - plan.bounds.ymin).toBeGreaterThan(2)
  })

  it('parses T3.xodr when available on disk', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(here, '../../../../../../../T3.xodr'),
      '/Users/arlen/Desktop/T3.xodr',
    ]
    let xml: string | null = null
    for (const p of candidates) {
      try {
        xml = readFileSync(p, 'utf8')
        break
      } catch {
        /* try next */
      }
    }
    if (!xml) return
    const plan = parseOpenDriveXodr(xml, { sampleStepM: 1 })
    expect(plan.roadCount).toBe(22)
    expect(plan.lanes.length).toBeGreaterThan(20)
    const driving = plan.lanes.filter((l) => l.laneType === 'driving')
    expect(driving.length).toBe(30)
    expect(plan.bounds.xmin).toBeLessThan(-800)
    expect(plan.bounds.xmax).toBeGreaterThan(-50)
  })
})
