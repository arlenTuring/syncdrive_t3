import { SiteColorInput } from '../../../components/SiteColorInput';
import { useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { MapAreaPatch } from '../utils/areaCoords'
import { resolveAreaFillStyle } from '../utils/areaLayoutStyle'
import { Button, Checkbox } from '../../../components/ui';

type Props = {
  area: MapAreaObject
  readOnly: boolean
  onChangeId: (id: string) => void
  onChangeCustomName: (customName: string) => void
  onPatchArea: (patch: MapAreaPatch) => void
  onDelete: () => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function InspectorNumberInput({
  value,
  readOnly,
  onCommit,
  onFieldFocus,
  onFieldBlur,
  className,
  commitOnChange = true,
}: {
  value: number
  readOnly: boolean
  onCommit: (n: number) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
  className?: string
  /** false 時僅 blur 才提交，避免輸入中途反覆 clamp */
  commitOnChange?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      type="text"
      inputMode="decimal"
      readOnly={readOnly}
      value={draft ?? String(value)}
      onFocus={() => {
        setDraft(String(value))
        onFieldFocus()
      }}
      onBlur={() => {
        const n = Number.parseFloat(draft ?? String(value))
        if (Number.isFinite(n)) onCommit(n)
        setDraft(null)
        onFieldBlur()
      }}
      onChange={(e) => {
        if (readOnly) return
        const raw = e.target.value
        setDraft(raw)
        if (!commitOnChange) return
        const n = Number.parseFloat(raw)
        if (Number.isFinite(n)) onCommit(n)
      }}
      className={className}
    />
  )
}

export function AreaInspectorSection({
  area,
  readOnly,
  onChangeId,
  onChangeCustomName,
  onPatchArea,
  onDelete,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { layout } = area
  const areaFill = resolveAreaFillStyle(layout)
  const fillEnabled = areaFill.backgroundColor !== 'transparent'
  const fillPickerHex =
    layout.fillColor &&
    layout.fillColor !== 'transparent' &&
    /^#[0-9a-f]{6}$/i.test(layout.fillColor)
      ? layout.fillColor
      : '#1e293b'

  return (
    <aside
      data-inspector
      className="flex h-full min-h-0 w-72 flex-col border-l border-border-quaternary bg-surface-primary"
    >
      <div className="border-b border-border-quaternary px-3 py-2 text-body-xs-bold uppercase text-text-quaternary">
        Area 屬性
        {readOnly && (
          <span className="ml-2 rounded bg-surface-secondary px-1.5 py-0.5 text-caption-2 font-normal normal-case text-text-tertiary">
            檢視
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-body-s text-text-primary">
        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            識別
          </h3>
          <div>
            <label htmlFor="area-id" className="mb-1 block text-caption-2 text-text-quaternary">
              Area ID
            </label>
            <input
              id="area-id"
              value={area.id}
              readOnly={readOnly}
              onChange={(e) => onChangeId(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme read-only:cursor-default read-only:opacity-90"
            />
          </div>
          <div>
            <label htmlFor="area-name" className="mb-1 block text-caption-2 text-text-quaternary">
              顯示名稱
            </label>
            <input
              id="area-name"
              value={area.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-text-primary outline-none focus:border-border-theme read-only:cursor-default read-only:opacity-90"
            />
          </div>
        </section>

        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            畫布布局（px）
          </h3>
          <p className="text-caption-2 text-text-disabled">
            選取 Area 後：拖曳頂部／左側刻度帶可移動 Area；邊界約 10px 內可縮放。中央區域用於放置與拖曳元件。
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['xPx', '橫向位置 (px)', layout.xPx],
                ['yPx', '縱向位置 (px)', layout.yPx],
                ['wPx', '橫向尺寸 (px)', layout.wPx],
                ['hPx', '縱向尺寸 (px)', layout.hPx],
              ] as const
            ).map(([key, label, val]) => (
              <label key={key} className="block text-caption-2 text-text-quaternary">
                {label}
                <InspectorNumberInput
                  value={val}
                  readOnly={readOnly}
                  onCommit={(n) => {
                    onPatchArea({
                      layout: { ...layout, [key]: n },
                    })
                  }}
                  onFieldFocus={onFieldFocus}
                  onFieldBlur={onFieldBlur}
                  className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-90"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            區域底色
          </h3>
          <p className="text-caption-2 text-text-disabled">
            預設透明。勾選後可指定填色；未指定時 Area 不遮擋下層內容。
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
            <Checkbox disabled={readOnly} checked={fillEnabled} onCheckedChange={(checked) => {
                if (readOnly) return
                if (!checked) {
                  onPatchArea({
                    layout: { ...layout, fillColor: undefined },
                  })
                  return
                }
                onPatchArea({
                  layout: {
                    ...layout,
                    fillColor:
                      layout.fillColor &&
                      layout.fillColor !== 'transparent'
                        ? layout.fillColor
                        : '#1e293b',
                  },
                })
              }} onFocus={onFieldFocus} onBlur={onFieldBlur} />
            顯示底色
          </label>
          {fillEnabled && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-caption-2 text-text-quaternary">
                填色
                <SiteColorInput
                  disabled={readOnly}
                  value={fillPickerHex}
                  onChange={(e) => {
                    onPatchArea({
                      layout: { ...layout, fillColor: e.target.value },
                    })
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="mt-1 h-9 w-full cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-60"
                 />
              </label>
              <label className="block text-caption-2 text-text-quaternary">
                色碼 / rgba
                <input
                  readOnly={readOnly}
                  value={layout.fillColor ?? 'transparent'}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    onPatchArea({
                      layout: {
                        ...layout,
                        fillColor: v && v !== 'transparent' ? v : undefined,
                      },
                    })
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  placeholder="transparent"
                  className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-caption-2 text-text-primary outline-none focus:border-border-theme read-only:opacity-90"
                />
              </label>
            </div>
          )}
        </section>

        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            外框線條
          </h3>
          <p className="text-caption-2 text-text-disabled">
            預設為透明（不顯示）。設定粗細與顏色後才會在畫布上繪製 Area 外框；選取時仍會顯示青色選取框。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-caption-2 text-text-quaternary">
              線條粗細 (px)
              <InspectorNumberInput
                value={layout.borderPx ?? 0}
                readOnly={readOnly}
                onCommit={(n) => {
                  onPatchArea({
                    layout: { ...layout, borderPx: Math.max(0, n) },
                  })
                }}
                onFieldFocus={onFieldFocus}
                onFieldBlur={onFieldBlur}
                className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-90"
              />
            </label>
            <label className="block text-caption-2 text-text-quaternary">
              線條顏色
              <div className="mt-1 flex items-center gap-2">
                <SiteColorInput
                  disabled={readOnly || (layout.borderPx ?? 0) <= 0}
                  value={
                    layout.borderColor &&
                    layout.borderColor !== 'transparent' &&
                    /^#[0-9a-f]{6}$/i.test(layout.borderColor)
                      ? layout.borderColor
                      : '#475569'
                  }
                  onChange={(e) => {
                    onPatchArea({
                      layout: {
                        ...layout,
                        borderColor: e.target.value,
                        borderPx: Math.max(1, layout.borderPx ?? 0),
                      },
                    })
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="h-8 w-10 cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-40"
                 />
                <input
                  readOnly={readOnly}
                  value={layout.borderColor ?? 'transparent'}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    onPatchArea({
                      layout: {
                        ...layout,
                        borderColor: v || 'transparent',
                      },
                    })
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  placeholder="transparent"
                  className="min-w-0 flex-1 rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-caption-2 text-text-primary outline-none focus:border-border-theme read-only:opacity-90"
                />
              </div>
            </label>
          </div>
          {!readOnly && (
            <Button hierarchy="subordinate" variant="outlined" className="w-full" onPress={() => {
                onPatchArea({
                  layout: {
                    ...layout,
                    fillColor: undefined,
                    borderPx: 0,
                    borderColor: 'transparent',
                  },
                })
              }} onFocus={onFieldFocus} onBlur={onFieldBlur}>重設外框為透明</Button>
          )}
        </section>

        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            顯示選項
          </h3>
          <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
            <Checkbox checked={area.showRuler} disabled={readOnly} onCheckedChange={(checked) => onPatchArea({ showRuler: checked })} onFocus={onFieldFocus} onBlur={onFieldBlur} />
            在畫布顯示刻度／座標尺
          </label>
          <p className="text-caption-2 text-text-quaternary">
            刻度／座標數字畫在 Area（正式顯示範圍）外側，不遮擋軌道與設施。工具列可循環：關閉 → 刻度 → 座標。
          </p>
        </section>

        {!readOnly && (
          <Button hierarchy="danger" variant="outlined" className="w-full" onPress={onDelete}>刪除此 Area</Button>
        )}
      </div>
    </aside>
  )
}
