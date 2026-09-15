import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { auditMapData, describeMapDataIssues } from '../utils/auditMapData'
import { parseMapFileJson } from '../utils/mapFileJson'
import { backfillTrackGenSpansInAreas } from '../utils/trackGenSpanBackfill'
import { repairTrackRefFieldBoundsInAreas } from '../utils/trackRefFieldBoundsRepair'
import { auditFieldMapping, describeFieldMappingAudit } from './auditFieldMapping'

/**
 * 發布出去的圖，車會不會被畫錯。
 *
 * <h3>為什麼是讀檔不是讀畫面</h3>
 * 這一類問題（缺橫向比例尺、兩塊共用同一份中心線、停靠點座標沒跟著重算）在畫面上都
 * 看不出來——座標照樣是數字、車照樣畫得出來，只是畫在錯的地方。要等有人截圖才發現，
 * 一次只抓得到一個。
 *
 * 往返誤差不必看畫面也不必知道正確答案：沿中心線取樣，走完定位那條路再換回現場，
 * 回不到原地就是壞了。所以直接讀 backend/data/published-maps 裡那幾份，跑一次就知道。
 *
 * <h3>驗的是程式實際會用到的那一份</h3>
 * 圖台載入時會先跑幾道修復（補里程對應、照中心線重算場域範圍），檔案裡缺的東西
 * 在畫面上已經被補起來了。這裡照同一條路跑一遍再驗——驗原始檔會報出使用者根本
 * 遇不到的問題，驗修復後的才是「車真的會被畫在哪裡」。
 *
 * 代價是檔案本身的陳舊不會被這支擋下來。那是發布流程的事：重新載入、存檔、發布
 * 一次，檔案就跟程式一致了。
 *
 * <h3>沒有圖就跳過</h3>
 * published-maps 在 .gitignore 裡，CI 上不會有。有才驗，沒有就跳過——這支的用途是
 * 「改完圖之後自己先跑一次」，不是擋 CI。
 */

const MAPS_DIR = join(__dirname, '../../../../../backend/data/published-maps')

function loadPublishedMaps(): Array<{ name: string; doc: unknown }> {
  if (!existsSync(MAPS_DIR)) return []
  return readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json') && f !== 'active-map.json')
    .map((f) => ({
      name: f,
      doc: JSON.parse(readFileSync(join(MAPS_DIR, f), 'utf-8')),
    }))
}

const maps = loadPublishedMaps()

describe.skipIf(maps.length === 0)('發布出去的圖：車畫得準不準', () => {
  for (const { name, doc } of maps) {
    const raw = doc as { mapDocument?: unknown; creationMode?: string }
    const inner = (raw.mapDocument ?? doc) as { creationMode?: string }
    // 只驗生成出來的圖：手繪圖的圖面與場域本來就不連續
    if (inner.creationMode !== 'trackGen') continue

    describe(name, () => {
      const loaded = parseMapFileJson(inner).areas
      const areas = repairTrackRefFieldBoundsInAreas(
        backfillTrackGenSpansInAreas(loaded).areas,
      ).areas
      const audit = auditFieldMapping(areas)

      it('往返誤差中位數要是 0', () => {
        if (audit.medianWorstM > 0.5) console.warn(describeFieldMappingAudit(audit))
        expect(audit.medianWorstM).toBeLessThanOrEqual(0.5)
      })

      it('一般軌道的往返誤差不超過 1 公尺', () => {
        const bad = audit.blocks.filter(
          (b) => !b.junction && b.worstM > 1,
        )
        if (bad.length > 0) console.warn(describeFieldMappingAudit(audit))
        expect(bad.map((b) => `${b.code} ${b.worstM}m`)).toEqual([])
      })

      it('一般軌道上的點不該被判給別塊', () => {
        const bad = audit.blocks.filter(
          (b) => !b.junction && b.wrongBlock > 0,
        )
        expect(bad.map((b) => `${b.code} ${b.wrongBlock}/${b.samples}`)).toEqual([])
      })

      /*
       * D18 當初就是這樣溜過去的：它有中心線、畫在圖上、也在路網清單裡，只是身上
       * 沒有里程對應，定位索引開頭那句 if (!spans.length) continue 直接把它跳過。
       * 症狀報出來是「往返誤差 18 公尺」，看起來像座標算錯，追到底才發現是這一塊
       * 從來沒進過索引。誤差是症狀，覆蓋率才是原因。
       */
      it('每一塊都要有里程對應，否則根本不會進定位索引', () => {
        const none = audit.blocks.filter((b) => b.spanCoverage <= 0)
        expect(none.map((b) => b.code)).toEqual([])
      })

      /*
       * 路口那幾塊的中心線會延伸進 junction 的連接道，而連接道是另一組 road，
       * 目前的 spans 沒有涵蓋，所以只約束一般軌道。
       */
      it('一般軌道的里程對應要蓋滿整條中心線', () => {
        const partial = audit.blocks.filter(
          (b) => !b.junction && b.spanCoverage < 0.999,
        )
        expect(
          partial.map((b) => `${b.code} ${(b.spanCoverage * 100).toFixed(0)}%`),
        ).toEqual([])
      })

      it('每一塊都量得出比例尺', () => {
        const missing = audit.blocks.filter((b) => b.alongPxPerM == null)
        expect(missing.map((b) => b.code)).toEqual([])
      })

      const issues = auditMapData(areas)
      const of = (kind: 'docking' | 'zone' | 'slot') =>
        issues.filter((i) => i.kind === kind).map((i) => `${i.target}：${i.detail}`)

      it('停靠點的座標要跟它畫的位置對得上', () => {
        if (issues.length > 0) console.warn(describeMapDataIssues(issues))
        expect(of('docking')).toEqual([])
      })

      it('分區的綁定與範圍要完整', () => {
        expect(of('zone')).toEqual([])
      })

      it('格位要在自己的分區裡、長邊對得上、不重疊', () => {
        expect(of('slot')).toEqual([])
      })
    })
  }
})
