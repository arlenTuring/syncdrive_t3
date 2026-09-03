import { Plus, Trash2 } from 'lucide-react'
import { NumberInput } from '../../../components/NumberInput'
import { TextAlignmentControls } from '../../../components/TextAlignmentControls'
import { TextLayoutControls } from '../../../components/TextLayoutControls'
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
} from '../../../lib/textAlignment'
import { resolveTextWrapMode } from '../../../lib/textLayout'
import type { FacilityObject, GeofenceFacility } from '../types/facility'
import {
  getGeofenceParams,
  isLabelInsideGeofence,
  newGeofenceLabelId,
  type GeofenceStrokeStyle,
  type GeofenceTextLabel,
} from '../utils/geofence'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  selectedLabelId: string | null
  onSelectLabel: (labelId: string | null) => void
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function GeofenceInspectorSection({
  facility,
  readOnly,
  selectedLabelId,
  onSelectLabel,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Geofence') return null
  const gf = facility as GeofenceFacility
  const params = getGeofenceParams(gf)
  const labels = params.labels

  const patchLabels = (next: GeofenceTextLabel[]) => {
    onPatchParameters({ labels: next.length > 0 ? next : undefined })
  }

  const selectedLabel = labels.find((l) => l.id === selectedLabelId) ?? null

  return (
    <>
      <section className="space-y-2.5 rounded-lg border border-violet-900/40 bg-violet-950/15 p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/90">
          電子圍籬 · 邊界樣式
        </h3>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          拖曳頂點調整形狀；點擊邊上「＋」可新增頂點。頂點數：{' '}
          {params.verticesMeters.length}
        </p>
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">線型</label>
          <select
            disabled={readOnly}
            value={params.strokeStyle}
            onChange={(e) =>
              onPatchParameters({
                strokeStyle: e.target.value as GeofenceStrokeStyle,
              })
            }
            className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-70"
          >
            <option value="solid">實線</option>
            <option value="dashed">虛線</option>
            <option value="dotted">點線</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">
            線條粗細（px）
          </label>
          <NumberInput
            min={1}
            max={24}
            disabled={readOnly}
            value={params.strokeWidthPx}
            onChange={(n) => onPatchParameters({ strokeWidthPx: n })}
            className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-70"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">線條顏色</label>
          <input
            type="color"
            disabled={readOnly}
            value={params.strokeColor}
            onChange={(e) => onPatchParameters({ strokeColor: e.target.value })}
            className="h-8 w-full cursor-pointer rounded border border-zinc-600 disabled:opacity-50"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={params.fillEnabled}
            onChange={(e) =>
              onPatchParameters({ fillEnabled: e.target.checked })
            }
            className="rounded border-zinc-600 accent-cyan-500"
          />
          填滿圍籬內部
        </label>
        {params.fillEnabled && (
          <>
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">填色</label>
              <input
                type="color"
                disabled={readOnly}
                value={params.fillBaseColor}
                onChange={(e) =>
                  onPatchParameters({
                    fillColor: e.target.value,
                    fillOpacity: params.fillOpacity,
                  })
                }
                className="h-8 w-full cursor-pointer rounded border border-zinc-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="geofence-fill-opacity"
                className="mb-1 flex items-center justify-between text-[10px] text-zinc-500"
              >
                <span>透明度</span>
                <span className="font-mono text-cyan-400/90">
                  {Math.round(params.fillOpacity * 100)}%
                </span>
              </label>
              <input
                id="geofence-fill-opacity"
                type="range"
                min={0}
                max={100}
                step={1}
                disabled={readOnly}
                value={Math.round(params.fillOpacity * 100)}
                onChange={(e) =>
                  onPatchParameters({
                    fillColor: params.fillBaseColor,
                    fillOpacity: Number(e.target.value) / 100,
                  })
                }
                className="h-2 w-full cursor-pointer accent-cyan-500 disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-[9px] text-zinc-600">
                <span>全透明</span>
                <span>不透明</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <span
                className="size-6 shrink-0 rounded border border-zinc-600"
                style={{ backgroundColor: params.resolvedFillColor }}
                aria-hidden
              />
              <span className="font-mono">{params.resolvedFillColor}</span>
            </div>
          </>
        )}
      </section>

      <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            文字子元件
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                const box = params.verticesMeters
                const cx =
                  box.reduce((s, v) => s + v.x, 0) / Math.max(1, box.length)
                const cy =
                  box.reduce((s, v) => s + v.y, 0) / Math.max(1, box.length)
                const id = newGeofenceLabelId()
                patchLabels([
                  ...labels,
                  {
                    id,
                    text: '標題',
                    x: cx,
                    y: cy,
                    rotationDeg: 0,
                    fontSizePx: 16,
                    fontWeight: 'normal',
                  },
                ])
                onSelectLabel(id)
              }}
              className="inline-flex items-center gap-1 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
            >
              <Plus className="size-3" /> 新增文字
            </button>
          )}
        </div>
        {labels.length === 0 ? (
          <p className="text-[10px] text-zinc-600">
            尚無文字；新增後可在圖台上拖曳與旋轉（超出圍籬會顯示紅框）。
          </p>
        ) : (
          <ul className="space-y-1">
            {labels.map((lb) => (
              <li key={lb.id}>
                <button
                  type="button"
                  onClick={() => onSelectLabel(lb.id)}
                  className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                    selectedLabelId === lb.id
                      ? 'border-cyan-500/60 bg-cyan-950/30 text-cyan-200'
                      : 'border-zinc-700/80 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {lb.text || '（空白）'}
                  {!isLabelInsideGeofence(gf, lb) && (
                    <span className="ml-1 text-red-400">· 超出</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedLabel && (
          <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">文字內容</label>
              <input
                readOnly={readOnly}
                value={selectedLabel.text}
                onChange={(e) =>
                  patchLabels(
                    labels.map((l) =>
                      l.id === selectedLabel.id
                        ? { ...l, text: e.target.value }
                        : l,
                    ),
                  )
                }
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] text-zinc-500">字級 px</label>
                <NumberInput
                  min={8}
                  max={72}
                  readOnly={readOnly}
                  value={selectedLabel.fontSizePx}
                  onChange={(n) =>
                    patchLabels(
                      labels.map((l) =>
                        l.id === selectedLabel.id ? { ...l, fontSizePx: n } : l,
                      ),
                    )
                  }
                  className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selectedLabel.fontWeight === 'bold'}
                    onChange={(e) =>
                      patchLabels(
                        labels.map((l) =>
                          l.id === selectedLabel.id
                            ? {
                                ...l,
                                fontWeight: e.target.checked ? 'bold' : 'normal',
                              }
                            : l,
                        ),
                      )
                    }
                    className="rounded border-zinc-600 accent-cyan-500"
                  />
                  粗體
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-zinc-500">旋轉（度）</label>
              <NumberInput
                readOnly={readOnly}
                value={selectedLabel.rotationDeg}
                onChange={(n) =>
                  patchLabels(
                    labels.map((l) =>
                      l.id === selectedLabel.id ? { ...l, rotationDeg: n } : l,
                    ),
                  )
                }
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
              />
            </div>
            <TextAlignmentControls
              horizontal={resolveTextHorizontalAlign(selectedLabel.textAlign)}
              vertical={resolveTextVerticalAlign(selectedLabel.verticalAlign)}
              onHorizontalChange={(textAlign) =>
                patchLabels(
                  labels.map((l) =>
                    l.id === selectedLabel.id ? { ...l, textAlign } : l,
                  ),
                )
              }
              onVerticalChange={(verticalAlign) =>
                patchLabels(
                  labels.map((l) =>
                    l.id === selectedLabel.id ? { ...l, verticalAlign } : l,
                  ),
                )
              }
              disabled={readOnly}
            />
            <TextLayoutControls
              textWrap={resolveTextWrapMode(selectedLabel.textWrap)}
              onTextWrapChange={(textWrap) =>
                patchLabels(
                  labels.map((l) =>
                    l.id === selectedLabel.id ? { ...l, textWrap } : l,
                  ),
                )
              }
              labelBoxWidthPx={selectedLabel.labelBoxWidthPx}
              labelBoxHeightPx={selectedLabel.labelBoxHeightPx}
              onLabelBoxWidthChange={(labelBoxWidthPx) =>
                patchLabels(
                  labels.map((l) =>
                    l.id === selectedLabel.id ? { ...l, labelBoxWidthPx } : l,
                  ),
                )
              }
              onLabelBoxHeightChange={(labelBoxHeightPx) =>
                patchLabels(
                  labels.map((l) =>
                    l.id === selectedLabel.id ? { ...l, labelBoxHeightPx } : l,
                  ),
                )
              }
              disabled={readOnly}
            />
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  patchLabels(labels.filter((l) => l.id !== selectedLabel.id))
                  onSelectLabel(null)
                }}
                className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300"
              >
                <Trash2 className="size-3" /> 刪除此文字
              </button>
            )}
          </div>
        )}
      </section>
    </>
  )
}
