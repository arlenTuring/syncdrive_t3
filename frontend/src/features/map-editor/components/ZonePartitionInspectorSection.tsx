import { SiteSelect } from '../../../components/SiteSelect';
import { Boxes, Link2, LogIn, SquareDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import { getRefFieldBounds } from '../utils/facilityRefFieldBounds'
import {
  isZoneEntrance,
  listZonePartitionsInArea,
  PARENT_ZONE_ID_KEY,
  readParentZoneId,
  readZoneEntranceLinks,
  readZoneLocalField,
  readZonePartitionBinding,
  ZONE_LOCAL_FIELD_KEY,
  canBelongToParentZone,
} from '../utils/zonePartition'

type PartitionProps = {
  facility: FacilityObject
  areaFacilities: readonly FacilityObject[]
  readOnly: boolean
}

function formatBound(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 1 : 2
  return n.toFixed(digits)
}

function facilityAlias(f: FacilityObject | undefined): string | null {
  if (!f) return null
  const custom = typeof f.customName === 'string' ? f.customName.trim() : ''
  return custom || null
}

export function ZonePartitionInspectorSection({
  facility,
  areaFacilities,
  readOnly: _readOnly,
}: PartitionProps) {
  const { t } = useTranslation()
  const binding = readZonePartitionBinding(facility.parameters)
  const bounds = getRefFieldBounds(facility.parameters)
  const childCount = areaFacilities.filter(
    (f) =>
      canBelongToParentZone(f) && readParentZoneId(f.parameters) === facility.id,
  ).length
  const hasBounds =
    bounds.xMinM !== null &&
    bounds.xMaxM !== null &&
    bounds.yMinM !== null &&
    bounds.yMaxM !== null
  const bound = Boolean(binding?.entranceId)

  const entrance = binding
    ? areaFacilities.find(
        (f) => f.id === binding.entranceId && isZoneEntrance(f),
      )
    : undefined
  const entranceAlias =
    facilityAlias(entrance) ??
    (binding?.entranceId ? binding.entranceId : null)

  const link = binding
    ? readZoneEntranceLinks(entrance?.parameters).find(
        (l) => l.id === binding.linkId,
      )
    : undefined
  const linkAlias =
    (link?.name && link.name.trim()) ||
    facilityAlias(facility) ||
    binding?.linkId ||
    null

  return (
    <section className="space-y-3 rounded-xl border border-status-success-light bg-gradient-to-b from-emerald-950/35 to-zinc-950/50 p-3 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)]">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-status-success-light bg-status-success-light text-status-success">
            <SquareDashed className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-body-xs-bold text-status-success">
              {t('mapEditor.inspector.zonePartition.title')}
            </h3>
            <p className="mt-0.5 text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.zonePartition.hintShort')}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-caption-2 font-medium ${
            bound
              ? 'border border-status-success-light bg-status-success-light text-status-success'
              : 'border border-zinc-600/60 bg-surface-primary text-text-quaternary'
          }`}
        >
          {bound
            ? t('mapEditor.inspector.zonePartition.synced')
            : t('mapEditor.inspector.zonePartition.unbound')}
        </span>
      </header>

      <div className="rounded-lg border border-border-quaternary bg-zinc-950/70 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-caption-2 text-text-tertiary">
            {t('mapEditor.inspector.zonePartition.fieldBounds')}
          </span>
          <span className="text-caption-2 text-text-disabled">m</span>
        </div>
        {hasBounds ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5 rounded-md border border-border-theme-light bg-surface-theme px-2 py-2">
              <div className="text-caption-2 uppercase text-text-theme">
                {t('mapEditor.inspector.zonePartition.axisX')}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption-2 text-text-theme">
                  {t('mapEditor.inspector.zonePartition.min')}
                </span>
                <span className="font-mono text-body-xs text-text-theme-light">
                  {formatBound(bounds.xMinM)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption-2 text-text-theme">
                  {t('mapEditor.inspector.zonePartition.max')}
                </span>
                <span className="font-mono text-body-xs text-text-theme-light">
                  {formatBound(bounds.xMaxM)}
                </span>
              </div>
            </div>
            <div className="space-y-1.5 rounded-md border border-status-warning-light bg-status-warning-light px-2 py-2">
              <div className="text-caption-2 uppercase text-status-warning">
                {t('mapEditor.inspector.zonePartition.axisY')}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption-2 text-status-warning">
                  {t('mapEditor.inspector.zonePartition.min')}
                </span>
                <span className="font-mono text-body-xs text-status-warning">
                  {formatBound(bounds.yMinM)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption-2 text-status-warning">
                  {t('mapEditor.inspector.zonePartition.max')}
                </span>
                <span className="font-mono text-body-xs text-status-warning">
                  {formatBound(bounds.yMaxM)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-body-xs text-text-quaternary">
            {t('mapEditor.inspector.zonePartition.fieldBoundsEmpty')}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 rounded-md border border-border-quaternary bg-black-30 px-2 py-1.5">
          <LogIn className="size-3 shrink-0 text-text-quaternary" aria-hidden />
          <span className="w-14 shrink-0 text-caption-2 text-text-quaternary">
            {t('mapEditor.inspector.zonePartition.entrance')}
          </span>
          <span
            className="min-w-0 truncate text-body-xs text-text-primary"
            title={binding?.entranceId}
          >
            {entranceAlias ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border-quaternary bg-black-30 px-2 py-1.5">
          <Link2 className="size-3 shrink-0 text-text-quaternary" aria-hidden />
          <span className="w-14 shrink-0 text-caption-2 text-text-quaternary">
            {t('mapEditor.inspector.zonePartition.linkAlias')}
          </span>
          <span
            className="min-w-0 truncate text-body-xs-bold text-status-success"
            title={binding?.linkId}
          >
            {linkAlias ?? '—'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border-quaternary pt-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border-quaternary bg-surface-primary px-2.5 py-1 text-caption-2 text-text-secondary">
          <Boxes className="size-3 text-text-quaternary" aria-hidden />
          {t('mapEditor.inspector.zonePartition.childCount', {
            count: childCount,
          })}
        </span>
      </div>
    </section>
  )
}

type ParentZoneProps = {
  facility: FacilityObject
  areaFacilities: readonly FacilityObject[]
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

/** 僅「設施」(FacilityArea)：指定所屬分區 */
export function ParentZoneInspectorSection({
  facility,
  areaFacilities,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: ParentZoneProps) {
  const { t } = useTranslation()
  if (!canBelongToParentZone(facility)) return null
  const zones = listZonePartitionsInArea(areaFacilities)
  if (zones.length === 0) return null

  const parentId = readParentZoneId(facility.parameters) ?? ''
  const local = readZoneLocalField(facility.parameters)

  return (
    <section className="space-y-2.5 rounded-xl border border-border-quaternary bg-zinc-950/45 p-3">
      <header className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border-quaternary bg-surface-primary text-text-tertiary">
          <SquareDashed className="size-3" aria-hidden />
        </span>
        <div>
          <h3 className="text-body-xs-bold text-text-secondary">
            {t('mapEditor.inspector.parentZone.title')}
          </h3>
          <p className="text-caption-2 text-text-disabled">
            {t('mapEditor.inspector.parentZone.hint')}
          </p>
        </div>
      </header>
      <label className="block text-caption-2 text-text-quaternary">
        {t('mapEditor.inspector.parentZone.select')}
        <SiteSelect
          disabled={readOnly}
          value={parentId}
          onChange={(e) => {
            const v = e.target.value.trim()
            if (!v) {
              onPatchParameters({
                [PARENT_ZONE_ID_KEY]: undefined,
                [ZONE_LOCAL_FIELD_KEY]: undefined,
              })
              return
            }
            onPatchParameters({ [PARENT_ZONE_ID_KEY]: v })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          size="sm" className="mt-0.5 w-full"
        >
          <option value="">{t('mapEditor.inspector.parentZone.none')}</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {/* name 是字面量聯集、永遠非空，再 || z.id 這一段到不了，型別會被窄成 never */}
              {(z.customName || z.name).trim() || z.id}
            </option>
          ))}
        </SiteSelect>
      </label>
      {local ? (
        <p className="font-mono text-caption-2 text-text-quaternary">
          {t('mapEditor.inspector.parentZone.local', {
            u: local.u.toFixed(3),
            v: local.v.toFixed(3),
          })}
        </p>
      ) : null}
    </section>
  )
}
