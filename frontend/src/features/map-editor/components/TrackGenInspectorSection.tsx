import { useMemo } from 'react'
import type { MapBasemapObject } from '../types/basemap'
import {
  DEFAULT_TRACKGEN_SETTINGS,
  getTrackGenFileName,
  getTrackGenResult,
  getTrackGenSettings,
  TRACKGEN_SETTINGS_KEY,
  uniformCornerRadiusM,
  type TrackGenSettings,
} from '../utils/trackGenFacility'

/**
 * 軌道生成元件的屬性。
 *
 * 這裡只調「整體怎麼畫」，不調個別區塊——區塊的里程與橫向偏移由 .xodr 的幾何
 * 決定，手動改那些數字就失去自動生成的意義了。
 */

type Props = {
  basemap: MapBasemapObject
  readOnly: boolean
  onRename: (customName: string) => void
  onPatchParameters: (patch: Record<string, unknown>) => void
}

type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled?: boolean
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, suffix, disabled, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-[11px] text-zinc-400">
        {label}
        <b className="font-mono text-[12px] font-medium tabular-nums text-zinc-100">
          {value}
          {suffix ? ` ${suffix}` : ''}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-500 disabled:opacity-40"
      />
    </label>
  )
}

export function TrackGenInspectorSection({
  basemap,
  readOnly,
  onRename,
  onPatchParameters,
}: Props) {
  const settings = getTrackGenSettings(basemap.parameters)
  const result = getTrackGenResult(basemap.parameters)
  const fileName = getTrackGenFileName(basemap.parameters)

  const stats = useMemo(() => {
    if (!result) return null
    const res = result.blocks.map((b) => b.residualM)
    const sorted = [...res].sort((a, b) => a - b)
    return {
      blocks: result.blocks.length,
      crossovers: result.lanes.filter((l) => l.role === 'crossover').length,
      sidings: result.lanes.filter((l) => l.role === 'siding').length,
      straights: result.spine.filter((s) => s.kind === 'straight').length,
      arcs: result.spine.filter((s) => s.kind === 'arc').length,
      medianRes: sorted.length ? sorted[sorted.length >> 1]! : 0,
      overRes: res.filter((r) => r > 0.3).length,
    }
  }, [result])

  const patch = (next: Partial<TrackGenSettings>) => {
    onPatchParameters({ [TRACKGEN_SETTINGS_KEY]: { ...settings, ...next } })
  }

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

      <div className="rounded-md border border-zinc-700/70 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-400">
        {result ? (
          <div className="flex flex-col gap-0.5">
            <span>
              路網 <b className="font-mono tabular-nums text-zinc-200">{result.totalM.toFixed(0)} m</b>
              脊線 <b className="font-mono tabular-nums text-zinc-200">{stats?.straights} 直 · {stats?.arcs} 彎</b>
            </span>
            <span>
              軌道 <b className="font-mono tabular-nums text-zinc-200">{(stats?.blocks ?? 0) * 2}</b> 塊
               渡線 <b className="font-mono tabular-nums text-zinc-200">{stats?.crossovers}</b>
               側線 <b className="font-mono tabular-nums text-zinc-200">{stats?.sidings}</b>
            </span>
            <span>
              殘差中位數 
              <b className="font-mono tabular-nums text-zinc-200">{stats?.medianRes.toFixed(3)} m</b>
              {stats && stats.overRes > 0 ? (
                <span className="text-amber-400"> {stats.overRes} 塊超過 0.3 m</span>
              ) : (
                <span className="text-emerald-400"> 全部在 0.3 m 內</span>
              )}
            </span>
          </div>
        ) : (
          <span>{fileName ? `已載入 ${fileName}，尚未生成軌道` : '尚未載入 .xodr'}</span>
        )}
      </div>

      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        <legend className="mb-1 text-[11px] font-medium tracking-wide text-zinc-300">整體比例</legend>
        <p className="-mt-1 text-[10.5px] leading-snug text-zinc-500">
          整體大小由元件框決定，拖曳邊角即可縮放。
        </p>
        <Slider
          label="橫向放大"
          value={settings.lateralScale}
          min={2}
          max={30}
          step={1}
          suffix="×"
          onChange={(v) => patch({ lateralScale: v })}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Slider
              label="彎道半徑"
              value={settings.cornerRadiusM}
              min={10}
              max={220}
              step={1}
              suffix="m"
              onChange={(v) => patch({ cornerRadiusM: v })}
            />
          </div>
          <button
            type="button"
            disabled={!result}
            onClick={() => {
              const r = result ? uniformCornerRadiusM(result.spine) : null
              if (r) patch({ cornerRadiusM: r })
            }}
            title="讓彎道畫出的弧長等於實際長度×沿線縮放"
            className="shrink-0 rounded-md border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-cyan-500/70 hover:text-cyan-200 disabled:opacity-40"
          >
            等比
          </button>
        </div>
      </fieldset>

      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        <legend className="mb-1 text-[11px] font-medium tracking-wide text-zinc-300">區塊</legend>
        <Slider
          label="每塊目標長度"
          value={settings.blockLengthM}
          min={20}
          max={150}
          step={5}
          suffix="m"
          onChange={(v) => patch({ blockLengthM: v })}
        />
        <p className="-mt-1 text-[10.5px] leading-snug text-zinc-500">
          改長度需要重新生成才會套用；比例與顯示則即時生效。
        </p>
        <Slider
          label="區塊字級"
          value={settings.labelSizePx}
          min={0}
          max={16}
          step={1}
          suffix={settings.labelSizePx === 0 ? '（隱藏）' : 'px'}
          onChange={(v) => patch({ labelSizePx: v })}
        />
      </fieldset>

      <fieldset disabled={readOnly} className="flex flex-col gap-2">
        <legend className="mb-1 text-[11px] font-medium tracking-wide text-zinc-300">顯示</legend>
        <label className="flex items-center gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            checked={settings.showCrossovers}
            onChange={(e) => patch({ showCrossovers: e.target.checked })}
            className="accent-cyan-500"
          />
          渡線
        </label>
        <label className="flex items-center gap-2 text-[12px] text-zinc-300">
          <input
            type="checkbox"
            checked={settings.showSidings}
            onChange={(e) => patch({ showSidings: e.target.checked })}
            className="accent-cyan-500"
          />
          側線
        </label>
      </fieldset>

      {!readOnly ? (
        <button
          type="button"
          onClick={() => onPatchParameters({ [TRACKGEN_SETTINGS_KEY]: { ...DEFAULT_TRACKGEN_SETTINGS } })}
          className="self-start rounded-md border border-zinc-600 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-cyan-500/70 hover:text-cyan-200"
        >
          回到預設值
        </button>
      ) : null}
    </div>
  )
}
