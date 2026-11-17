import { useTranslation } from 'react-i18next'
import type { MapBasemapObject } from '../types/basemap'
import {
  BASEMAP_OPACITY_KEY,
  getBasemapFileName,
  getBasemapOpacity,
  getBasemapSourceType,
} from '../utils/basemapFacility'
import { Button } from '../../../components/ui';

type Props = {
  basemap: MapBasemapObject
  readOnly: boolean
  onChangeCustomName: (customName: string) => void
  onPatchParameters: (patch: Record<string, unknown>) => void
  onDelete: () => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function BasemapInspectorSection({
  basemap,
  readOnly,
  onChangeCustomName,
  onPatchParameters,
  onDelete,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const opacity = getBasemapOpacity(basemap.parameters)
  const opacityPct = Math.round(opacity * 100)
  const sourceType = getBasemapSourceType(basemap.parameters)
  const fileName = getBasemapFileName(basemap.parameters)

  return (
    <aside
      data-inspector
      className="flex h-full min-h-0 w-72 flex-col border-l border-border-quaternary bg-surface-primary"
    >
      <div className="border-b border-border-quaternary px-3 py-2 text-body-xs-bold uppercase text-text-quaternary">
        {t('mapEditor.inspector.basemap.title')}
        {readOnly && (
          <span className="ml-2 rounded bg-surface-secondary px-1.5 py-0.5 text-caption-2 font-normal normal-case text-text-tertiary">
            {t('common.view')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-body-s text-text-primary">
        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            {t('mapEditor.inspector.basemap.identity')}
          </h3>
          <div>
            <label htmlFor="basemap-id" className="mb-1 block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.basemap.id')}
            </label>
            <input
              id="basemap-id"
              value={basemap.id}
              readOnly
              className="w-full cursor-default rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary opacity-90 outline-none"
            />
          </div>
          <div>
            <label htmlFor="basemap-name" className="mb-1 block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.basemap.displayName')}
            </label>
            <input
              id="basemap-name"
              value={basemap.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-text-primary outline-none focus:border-border-theme read-only:cursor-default read-only:opacity-90"
            />
          </div>
          {fileName ? (
            <p className="text-caption-2 text-text-disabled">
              {t('mapEditor.inspector.basemap.file', { name: fileName })}
              {sourceType
                ? `（${sourceType === 'xodr' ? 'OpenDRIVE' : t('mapEditor.inspector.basemap.sourceImage')}）`
                : ''}
            </p>
          ) : null}
        </section>

        <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
          <h3 className="text-caption-2 uppercase text-text-quaternary">
            {t('mapEditor.inspector.basemap.display')}
          </h3>
          <div>
            <label
              htmlFor="basemap-opacity"
              className="mb-1 flex items-center justify-between text-caption-2 text-text-quaternary"
            >
              <span>{t('mapEditor.inspector.basemap.opacity')}</span>
              <span className="font-mono text-text-theme">{opacityPct}%</span>
            </label>
            <input
              id="basemap-opacity"
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={readOnly}
              value={opacityPct}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              onChange={(e) => {
                if (readOnly) return
                onPatchParameters({
                  [BASEMAP_OPACITY_KEY]: Number(e.target.value) / 100,
                })
              }}
              className="h-2 w-full cursor-pointer accent-link-theme-filled disabled:opacity-40"
            />
            <div className="mt-1 flex justify-between text-caption-2 text-text-disabled">
              <span>{t('mapEditor.inspector.fullyTransparent')}</span>
              <span>{t('mapEditor.inspector.opaque')}</span>
            </div>
            <p className="mt-2 text-caption-2 text-text-disabled">
              {t('mapEditor.inspector.basemap.opacityHint')}
            </p>
          </div>
        </section>

        {!readOnly ? (
          <Button hierarchy="danger" variant="outlined" onPress={onDelete}>{t('mapEditor.inspector.basemap.delete')}</Button>
        ) : null}
      </div>
    </aside>
  )
}
