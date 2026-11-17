import { SiteColorInput } from '../../../components/SiteColorInput';
import { SiteSelect } from '../../../components/SiteSelect';
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { Button, Checkbox } from '../../../components/ui';

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
  const { t } = useTranslation()
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
        <h3 className="text-caption-2 uppercase text-violet-400/90">
          {t('mapEditor.inspector.geofence.borderStyle')}
        </h3>
        <p className="text-caption-2 text-text-quaternary">
          {t('mapEditor.inspector.geofence.vertexHint', {
            count: params.verticesMeters.length,
          })}
        </p>
        <div>
          <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.lineStyle')}</label>
          <SiteSelect
            disabled={readOnly}
            value={params.strokeStyle}
            onChange={(e) =>
              onPatchParameters({
                strokeStyle: e.target.value as GeofenceStrokeStyle,
              })
            }
            size="md" className="w-full"
          >
            <option value="solid">{t('mapEditor.inspector.stroke.solid')}</option>
            <option value="dashed">{t('mapEditor.inspector.stroke.dashed')}</option>
            <option value="dotted">{t('mapEditor.inspector.stroke.dotted')}</option>
          </SiteSelect>
        </div>
        <div>
          <label className="mb-1 block text-caption-2 text-text-quaternary">
            {t('mapEditor.inspector.geofence.strokeWidth')}
          </label>
          <NumberInput
            min={1}
            max={24}
            disabled={readOnly}
            value={params.strokeWidthPx}
            onChange={(n) => onPatchParameters({ strokeWidthPx: n })}
            className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme disabled:opacity-70"
          />
        </div>
        <div>
          <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.strokeColor')}</label>
          <SiteColorInput
            disabled={readOnly}
            value={params.strokeColor}
            onChange={(e) => onPatchParameters({ strokeColor: e.target.value })}
            className="h-8 w-full cursor-pointer rounded border border-border-tertiary disabled:opacity-50"
           />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
          <Checkbox disabled={readOnly} checked={params.fillEnabled} onCheckedChange={(checked) => onPatchParameters({ fillEnabled: checked })
            } />
          {t('mapEditor.inspector.geofence.fillInside')}
        </label>
        {params.fillEnabled && (
          <>
            <div>
              <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.fillColor')}</label>
              <SiteColorInput
                disabled={readOnly}
                value={params.fillBaseColor}
                onChange={(e) =>
                  onPatchParameters({
                    fillColor: e.target.value,
                    fillOpacity: params.fillOpacity,
                  })
                }
                className="h-8 w-full cursor-pointer rounded border border-border-tertiary disabled:opacity-50"
               />
            </div>
            <div>
              <label
                htmlFor="geofence-fill-opacity"
                className="mb-1 flex items-center justify-between text-caption-2 text-text-quaternary"
              >
                <span>{t('mapEditor.inspector.geofence.opacity')}</span>
                <span className="font-mono text-text-theme">
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
                className="h-2 w-full cursor-pointer accent-link-theme-filled disabled:opacity-40"
              />
              <div className="mt-1 flex justify-between text-caption-2 text-text-disabled">
                <span>{t('mapEditor.inspector.fullyTransparent')}</span>
                <span>{t('mapEditor.inspector.opaque')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-caption-2 text-text-quaternary">
              <span
                className="size-6 shrink-0 rounded border border-border-tertiary"
                style={{ backgroundColor: params.resolvedFillColor }}
                aria-hidden
              />
              <span className="font-mono">{params.resolvedFillColor}</span>
            </div>
          </>
        )}
      </section>

      <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            {t('mapEditor.inspector.geofence.textChildren')}
          </h3>
          {!readOnly && (
            <Button hierarchy="subordinate" variant="outlined" leadingIcon={<Plus />} onPress={() => {
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
                    text: t('mapEditor.inspector.geofence.defaultTitle'),
                    x: cx,
                    y: cy,
                    rotationDeg: 0,
                    fontSizePx: 16,
                    fontWeight: 'normal',
                  },
                ])
                onSelectLabel(id)
              }}>{t('mapEditor.inspector.geofence.addText')}</Button>
          )}
        </div>
        {labels.length === 0 ? (
          <p className="text-caption-2 text-text-disabled">
            {t('mapEditor.inspector.geofence.noText')}
          </p>
        ) : (
          <ul className="space-y-1">
            {labels.map((lb) => (
              <li key={lb.id}>
                <button
                  type="button"
                  onClick={() => onSelectLabel(lb.id)}
                  className={`w-full rounded border px-2 py-1 text-left text-body-xs ${
                    selectedLabelId === lb.id
                      ? 'border-border-theme-light bg-surface-theme text-text-theme-light'
                      : 'border-border-quaternary bg-surface-primary text-text-tertiary hover:border-border-tertiary'
                  }`}
                >
                  {lb.text || t('mapEditor.inspector.geofence.emptyText')}
                  {!isLabelInsideGeofence(gf, lb) && (
                    <span className="ml-1 text-status-error-emphasis">{t('mapEditor.inspector.geofence.outOfBounds')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedLabel && (
          <div className="mt-2 space-y-2 border-t border-border-quaternary pt-2">
            <div>
              <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.textContent')}</label>
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
                className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.fontPx')}</label>
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
                  className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-1.5 text-body-xs text-text-secondary">
                  <Checkbox disabled={readOnly} checked={selectedLabel.fontWeight === 'bold'} onCheckedChange={(checked) => patchLabels(
                        labels.map((l) =>
                          l.id === selectedLabel.id
                            ? {
                                ...l,
                                fontWeight: checked ? 'bold' : 'normal',
                              }
                            : l,
                        ),
                      )
                    } />
                  {t('common.bold')}
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-caption-2 text-text-quaternary">{t('mapEditor.inspector.geofence.rotationDeg')}</label>
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
                className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
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
              <Button hierarchy="danger" variant="text" leadingIcon={<Trash2 />} onPress={() => {
                  patchLabels(labels.filter((l) => l.id !== selectedLabel.id))
                  onSelectLabel(null)
                }}>{t('mapEditor.inspector.geofence.deleteText')}</Button>
            )}
          </div>
        )}
      </section>
    </>
  )
}
