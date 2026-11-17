import { SiteColorInput } from '../../../components/SiteColorInput';
import { SiteSelect } from '../../../components/SiteSelect';
import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import { Checkbox } from '../../../components/ui';

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const
type StrokeStyle = (typeof STROKE_STYLES)[number]

function resolveStrokeStyle(raw: unknown): StrokeStyle {
  if (raw === 'dashed' || raw === 'dotted' || raw === 'solid') return raw
  return 'solid'
}

export function FrameInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const params = facility.parameters ?? {}
  const strokeWidthPx =
    typeof params.strokeWidthPx === 'number' ? Math.max(0, params.strokeWidthPx) : 0
  const strokeColor =
    typeof params.strokeColor === 'string' ? params.strokeColor.trim() : 'transparent'
  const strokeStyle = resolveStrokeStyle(params.strokeStyle)

  const enabled = strokeWidthPx > 0 && strokeColor !== 'transparent'

  return (
    <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
      <h3 className="text-caption-2 uppercase text-text-quaternary">
        {t('mapEditor.inspector.frame.title')}
      </h3>

      <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
        <Checkbox disabled={readOnly} checked={enabled} onCheckedChange={(checked) => {
            if (readOnly) return
            const v = checked
            if (!v) {
              onPatchParameters({
                strokeWidthPx: undefined,
                strokeColor: undefined,
                strokeStyle: undefined,
              })
              return
            }

            onPatchParameters({
              strokeWidthPx: strokeWidthPx > 0 ? strokeWidthPx : 2,
              strokeColor: strokeColor !== 'transparent' ? strokeColor : '#22d3ee',
              strokeStyle: strokeStyle,
            })
          }} onFocus={onFieldFocus} onBlur={onFieldBlur} />
        {t('mapEditor.inspector.frame.showFrame')}
      </label>

      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.frame.strokeWidth')}
              <NumberInput
                min={0}
                max={20}
                step={1}
                readOnly={readOnly}
                value={strokeWidthPx}
                onChange={(n) => onPatchParameters({ strokeWidthPx: Math.round(n) })}
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="mt-1 w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme"
              />
            </label>

            <label className="block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.frame.strokeColor')}
              <SiteColorInput
                disabled={readOnly}
                value={
                  strokeColor && strokeColor !== 'transparent' ? strokeColor : '#22d3ee'
                }
                onChange={(e) => onPatchParameters({ strokeColor: e.target.value })}
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="mt-1 h-9 w-full cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-60"
               />
            </label>
          </div>

          <label className="block text-caption-2 text-text-quaternary">
            {t('mapEditor.inspector.frame.dashStyle')}
            <SiteSelect
              disabled={readOnly}
              value={strokeStyle}
              onChange={(e) =>
                onPatchParameters({
                  strokeStyle: e.target.value as StrokeStyle,
                })
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              size="sm" className="mt-1 w-full"
            >
              {STROKE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(`mapEditor.inspector.stroke.${s}`)}
                </option>
              ))}
            </SiteSelect>
          </label>
        </>
      )}
    </section>
  )
}
