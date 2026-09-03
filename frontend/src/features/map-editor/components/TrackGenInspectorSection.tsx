import type { MapBasemapObject } from '../types/basemap'
import { getTrackGenFileName, getTrackGenSummary } from '../utils/trackGenFacility'

/**
 * 軌道生成元件的屬性。
 *
 * 這裡只有名稱與一份摘要——「軌道怎麼畫」的三個參數在按下生成時的對話框裡，改了
 * 就能立刻看到整份版面的預覽，比在屬性欄裡拉滑桿再回頭看畫面直觀得多。
 *
 * 舊版在這裡放了橫向放大、軌道寬度倍率、彎道半徑、每塊目標長度、渡線與側線開關。
 * 那些都是「脊線 + 橫向偏移」那套模型的旋鈕，模型換成路網圖之後全部沒有意義了，
 * 一併移除，免得畫面上留著一堆調了沒反應的東西。
 */

type Props = {
  basemap: MapBasemapObject
  readOnly: boolean
  onRename: (customName: string) => void
}

export function TrackGenInspectorSection({ basemap, readOnly, onRename }: Props) {
  const summary = getTrackGenSummary(basemap.parameters)
  const fileName = getTrackGenFileName(basemap.parameters)

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-zinc-400">名稱</span>
        <input
          type="text"
          value={basemap.customName}
          readOnly={readOnly}
          onChange={(e) => onRename(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
        />
      </label>

      <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] leading-snug text-zinc-400">
        {summary ? (
          <div className="flex flex-col gap-0.5">
            <span>
              路網{' '}
              <b className="font-mono tabular-nums text-zinc-200">{summary.totalM} m</b>
              {' · '}
              <b className="font-mono tabular-nums text-zinc-200">{summary.lanes}</b> 條車道
            </span>
            <span>
              圖上 <b className="font-mono tabular-nums text-zinc-200">{summary.nodes}</b> 個節點
              {' · '}
              <b className="font-mono tabular-nums text-zinc-200">{summary.edges}</b> 條邊
              {' · '}
              <b className="font-mono tabular-nums text-zinc-200">{summary.components}</b> 個連通塊
            </span>
            <p className="mt-1 text-[10.5px] text-zinc-500">
              每一段軌道的參照場域範圍在生成時就填好了，座標直接沿用 .xodr——那就是場域的
              實際地圖，車端回報的位置與這裡是同一個座標系。
            </p>
          </div>
        ) : (
          <span>{fileName ? `已載入 ${fileName}，尚未生成軌道` : '尚未載入 .xodr'}</span>
        )}
      </div>

      <p className="text-[10.5px] leading-snug text-zinc-500">
        軌道寬度與「一塊代表幾公尺」在按下「軌道生成」後的對話框裡調，那裡看得到整份
        版面的預覽。整體大小由這個元件的框決定，拖曳邊角即可縮放。
      </p>
    </div>
  )
}
