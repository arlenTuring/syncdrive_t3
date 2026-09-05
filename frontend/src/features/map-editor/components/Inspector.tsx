import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { NumberInput } from '../../../components/NumberInput'
import { TextAlignmentControls } from '../../../components/TextAlignmentControls'
import { TextLayoutControls } from '../../../components/TextLayoutControls'
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
  textHorizontalToJustify,
  textVerticalToAlignItems,
} from '../../../lib/textAlignment'
import { resolveTextWrapMode } from '../../../lib/textLayout'
import { getFacilitySizeMeters } from '../constants/facilityDimensions'
import type { MapAreaLayout, MapAreaObject } from '../types/area'
import {
  resolveSlotEquipmentEnabled,
  resolveSlotOccupancyEnabled,
  SLOT_EQUIPMENT_STATES,
  SLOT_OCCUPANCY,
  STATES_BY_TYPE,
} from '../constants/states'
import { getMqttEntityId, getMqttTopicForFacility } from '../live/mqttEntityId'
import type {
  FacilityObject,
  NonSlotFacilityState,
  SlotEquipmentState,
  SlotFacility,
  SlotOccupancy,
} from '../types/facility'
import { buildStandardLayerName } from '../utils/layerNaming'
import {
  DEFAULT_AUTO_LABEL_FONT_PX,
  EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX,
  getFacilityLabelStyle,
  labelStyleToParameters,
  mergeFacilityLabelStyle,
  resolveLabelFontPx,
  resolveLabelPlacement,
} from '../utils/facilityLabelStyle'
import { facilityUsesDraggableMapLabel } from '../utils/facilityInspectorUi'
import {
  DEFAULT_PSD_OPEN_PERCENT_KEY,
  normalizeOpenPercentPercent,
  openPercentToPsdState,
  resolvePsdDisplay,
} from '../utils/psdOpenPercent'
import { TrackInspectorSection } from './TrackInspectorSection'
import { SignalInspectorSection } from './SignalInspectorSection'
import { DockingPointInspectorSection } from './DockingPointInspectorSection'
import { WaypointInspectorSection } from './WaypointInspectorSection'
import { RoadLineInspectorSection } from './RoadLineInspectorSection'
import { TrackCrossoverInspectorSection } from './TrackCrossoverInspectorSection'
import { GeofenceInspectorSection } from './GeofenceInspectorSection'
import { FacilityInspectorSection } from './FacilityInspectorSection'
import { FacilityDockingPointInspectorSection } from './FacilityDockingPointInspectorSection'
import { FacilityLayerSection } from './FacilityLayerSection'
import { FacilityRefFieldPositionSection } from './FacilityRefFieldPositionSection'
import { FacilityRefFieldBoundsSection } from './FacilityRefFieldBoundsSection'
import {
  usesRefFieldBounds,
  usesRefFieldPoint,
} from '../utils/facilityRefFieldBinding'

type FacilityLabelStyleSectionProps = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
}

function FacilityLabelStyleSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: FacilityLabelStyleSectionProps) {
  const { t } = useTranslation()
  const labelStyle = getFacilityLabelStyle(facility)
  const { w: sizeWm, h: sizeHm } = getFacilitySizeMeters(facility)
  const labelPreviewMinDim = Math.min(sizeWm, sizeHm) * 10
  const effectiveLabelPx = resolveLabelFontPx(
    labelPreviewMinDim,
    labelStyle,
    facility.type,
  )

  const patchLabelStyle = (patch: Partial<typeof labelStyle>) => {
    const next = mergeFacilityLabelStyle(labelStyle, patch)
    onPatchParameters(labelStyleToParameters(next) as Record<string, unknown>)
  }

  const showLabelDragHint = facilityUsesDraggableMapLabel(facility)

  return (
    <div className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-950/50 p-2.5">
      <p className="text-[10px] font-medium text-zinc-500">{t('mapEditor.inspector.labelStyle.title')}</p>
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={labelStyle.visible !== false}
          disabled={readOnly}
          onChange={(e) =>
            patchLabelStyle({
              visible: e.target.checked ? true : false,
            })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="rounded border-zinc-600 accent-cyan-500"
        />
        {t('mapEditor.inspector.labelStyle.showName')}
      </label>
      {showLabelDragHint && labelStyle.visible !== false ? (
        <p className="text-[10px] leading-relaxed text-zinc-600">
          {t('mapEditor.inspector.labelStyle.dragHint')}
        </p>
      ) : null}
      <div>
        <label
          htmlFor="label-font-size"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.inspector.labelStyle.fontSize')}
        </label>
        <div className="flex items-center gap-2">
          <NumberInput
            id="label-font-size"
            min={6}
            max={72}
            step={1}
            disabled={readOnly || labelStyle.visible === false}
            value={effectiveLabelPx}
            onChange={(n) => patchLabelStyle({ fontSizePx: n })}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={readOnly || labelStyle.visible === false}
            onClick={() => patchLabelStyle({ fontSizePx: undefined })}
            className="shrink-0 rounded border border-zinc-600 px-2 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            title={t('mapEditor.inspector.labelStyle.autoTitle', {
              px: DEFAULT_AUTO_LABEL_FONT_PX,
            })}
          >
            {t('common.auto')}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-600">
          {t('mapEditor.inspector.labelStyle.fontHint', {
            px: EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX,
          })}
        </p>
      </div>
      <div>
        <label
          htmlFor="label-color"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.inspector.labelStyle.textColor')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="label-color"
            type="color"
            disabled={readOnly || labelStyle.visible === false}
            value={labelStyle.color ?? '#e4e4e7'}
            onChange={(e) => patchLabelStyle({ color: e.target.value })}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-8 w-10 cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={readOnly || labelStyle.visible === false}
            onClick={() => patchLabelStyle({ color: '' })}
            className="rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
          >
            {t('mapEditor.inspector.labelStyle.defaultColor')}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={labelStyle.fontWeight === 'bold'}
            disabled={readOnly || labelStyle.visible === false}
            onChange={(e) =>
              patchLabelStyle({
                fontWeight: e.target.checked ? 'bold' : 'normal',
              })
            }
            className="rounded border-zinc-600 accent-cyan-500"
          />
          {t('common.bold')}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={labelStyle.fontStyle === 'italic'}
            disabled={readOnly || labelStyle.visible === false}
            onChange={(e) =>
              patchLabelStyle({
                fontStyle: e.target.checked ? 'italic' : 'normal',
              })
            }
            className="rounded border-zinc-600 accent-cyan-500"
          />
          {t('common.italic')}
        </label>
      </div>
      <TextAlignmentControls
        horizontal={resolveTextHorizontalAlign(labelStyle.textAlign)}
        vertical={resolveTextVerticalAlign(labelStyle.verticalAlign)}
        onHorizontalChange={(textAlign) => patchLabelStyle({ textAlign })}
        onVerticalChange={(verticalAlign) => patchLabelStyle({ verticalAlign })}
        disabled={readOnly || labelStyle.visible === false}
      />
      <TextLayoutControls
        textWrap={resolveTextWrapMode(labelStyle.textWrap)}
        onTextWrapChange={(textWrap) => patchLabelStyle({ textWrap })}
        labelBoxWidthPx={labelStyle.labelBoxWidthPx}
        labelBoxHeightPx={labelStyle.labelBoxHeightPx}
        onLabelBoxWidthChange={(labelBoxWidthPx) => patchLabelStyle({ labelBoxWidthPx })}
        onLabelBoxHeightChange={(labelBoxHeightPx) => patchLabelStyle({ labelBoxHeightPx })}
        labelPlacement={resolveLabelPlacement(facility, labelStyle)}
        onLabelPlacementChange={(labelPlacement) =>
          patchLabelStyle({
            labelPlacement,
            labelOffsetCustom: false,
            labelOffsetPx: undefined,
          })
        }
        showPlacement={showLabelDragHint}
        disabled={readOnly || labelStyle.visible === false}
      />
      <p
        className="truncate rounded border border-zinc-700/60 bg-zinc-900/80 px-2 py-1"
        style={{
          fontSize: Math.min(22, effectiveLabelPx),
          color: labelStyle.color ?? '#e4e4e7',
          fontWeight: labelStyle.fontWeight === 'bold' ? 'bold' : 400,
          fontStyle: labelStyle.fontStyle === 'italic' ? 'italic' : 'normal',
          visibility: labelStyle.visible === false ? 'hidden' : 'visible',
          minHeight: Math.min(22, effectiveLabelPx) * 1.6,
          display: 'flex',
          alignItems: textVerticalToAlignItems(
            resolveTextVerticalAlign(labelStyle.verticalAlign),
          ),
          justifyContent: textHorizontalToJustify(
            resolveTextHorizontalAlign(labelStyle.textAlign),
          ),
          textAlign: resolveTextHorizontalAlign(labelStyle.textAlign),
        }}
      >
        {facility.customName.trim() || facility.name || t('common.preview')}
      </p>
    </div>
  )
}

function InspectorSection({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  /** 額外外層樣式（例如 MQTT 區塊） */
  className?: string
}) {
  return (
    <section
      className={`space-y-2.5 rounded-lg border p-3 ${
        className ?? 'border-zinc-800/70 bg-zinc-950/45'
      }`}
    >
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

type InspectorProps = {
  facility: FacilityObject
  /** 檢視模式：僅顯示，不可改動 */
  readOnly?: boolean
  onChangeId: (id: string) => void
  onChangeCustomName: (customName: string) => void
  onChangeNonSlotState: (state: NonSlotFacilityState) => void
  /** 編輯模式：整備格預覽（圖台即時預覽，null 表示顯示地圖預設） */
  slotPreview: { occupancy: SlotOccupancy; equipment: SlotEquipmentState } | null
  onSlotPreviewChange: (
    p: { occupancy: SlotOccupancy; equipment: SlotEquipmentState } | null,
  ) => void
  /** 更新整備格：啟用設置、地圖預設顯示狀態 */
  onPatchSlot: (
    patch: Partial<
      Pick<
        SlotFacility,
        | 'slotOccupancy'
        | 'slotEquipmentState'
        | 'slotOccupancyEnabled'
        | 'slotEquipmentEnabled'
      >
    >,
  ) => void
  /** 合併寫入 parameters（例如 MQTT 欄位） */
  onPatchParameters?: (patch: Record<string, unknown>) => void
  onDelete: () => void
  onFieldFocus: () => void
  onFieldBlur: () => void
  /** 編輯圖台區域像素尺寸（僅影響 Area 內顯示，不影響參照場域範圍） */
  onChangeAreaSizePx?: (wPx: number, hPx: number) => void
  geofenceSelectedLabelId?: string | null
  onSelectGeofenceLabel?: (facilityId: string, labelId: string | null) => void
  /** 所屬 Area 管制範圍（公尺） */
  domainMaxM?: { w: number; h: number }
  /** 所屬 Area 版面（用於 px↔場域換算提示） */
  areaLayout?: MapAreaLayout
  /** 全圖 Area（停靠點站名唯一性、節點 ID 產生） */
  mapAreas?: MapAreaObject[]
  onApplyDockingPoint?: (facility: FacilityObject) => void
  onApplyWaypoint?: (facility: FacilityObject) => void
}

export function Inspector({
  facility,
  readOnly = false,
  onChangeId,
  onChangeCustomName,
  onChangeNonSlotState,
  slotPreview,
  onSlotPreviewChange,
  onPatchSlot,
  onPatchParameters,
  onDelete,
  onFieldFocus,
  onFieldBlur,
  onChangeAreaSizePx,
  geofenceSelectedLabelId = null,
  onSelectGeofenceLabel,
  domainMaxM: _domainMaxM,
  areaLayout: _areaLayout,
  mapAreas = [],
  onApplyDockingPoint,
  onApplyWaypoint,
}: InspectorProps) {
  const { t } = useTranslation()
  void _domainMaxM
  void _areaLayout
  const nonSlotStates =
    facility.type === 'Slot' ? null : STATES_BY_TYPE[facility.type]
  const layerName = buildStandardLayerName(
    facility.type,
    facility.name,
    facility.id,
    facility.customName,
  )
  const { w: sizeWm, h: sizeHm } = getFacilitySizeMeters(facility)
  const areaXp = facility.areaPosition.x
  const areaYp = facility.areaPosition.y
  const pixelW =
    facility.areaSizePx && Number.isFinite(facility.areaSizePx.w)
      ? facility.areaSizePx.w
      : null
  const pixelH =
    facility.areaSizePx && Number.isFinite(facility.areaSizePx.h)
      ? facility.areaSizePx.h
      : null
  const layoutSizeM = { w: sizeWm, h: sizeHm }

  const mqttTailDefault = facility.id
  const mqttInstanceUi =
    typeof facility.parameters?.mqttInstanceId === 'string' &&
    facility.parameters.mqttInstanceId.trim().length > 0
      ? facility.parameters.mqttInstanceId.trim()
      : mqttTailDefault
  const resolvedEntityId = getMqttEntityId(facility)
  const resolvedTopic = getMqttTopicForFacility(facility)
  const legacyEntityId =
    typeof facility.parameters?.mqttEntityId === 'string'
      ? facility.parameters.mqttEntityId.trim()
      : ''

  const sf: SlotFacility | null =
    facility.type === 'Slot' ? (facility as SlotFacility) : null
  const occEn = sf ? resolveSlotOccupancyEnabled(sf) : null
  const eqEn = sf ? resolveSlotEquipmentEnabled(sf) : null

  return (
    <aside
      data-inspector
      className="flex h-full min-h-0 w-72 flex-col border-l border-zinc-700/80 bg-zinc-900"
    >
      <div className="border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {t('mapEditor.inspector.properties')}
        {readOnly && (
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal normal-case text-zinc-400">
            {t('common.view')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-sm text-zinc-200">
        <InspectorSection title={t('mapEditor.inspector.identityNaming')}>
          <div>
            <label className="mb-1 block text-[10px] text-zinc-500">
              {t('mapEditor.inspector.standardLayerName')}
            </label>
            <p className="break-all rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5 font-mono text-[11px] leading-snug text-cyan-300/90">
              {layerName}
            </p>
          </div>
          <div>
            <label htmlFor="facility-id" className="mb-1 block text-[10px] text-zinc-500">
              {t('mapEditor.inspector.facilityId')}
            </label>
            <input
              id="facility-id"
              value={facility.id}
              readOnly={readOnly}
              onChange={(e) => onChangeId(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
              placeholder="001"
            />
          </div>
          <div>
            <label htmlFor="facility-custom" className="mb-1 block text-[10px] text-zinc-500">
              {t('mapEditor.inspector.customDisplayName')}
            </label>
            <input
              id="facility-custom"
              value={facility.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
              placeholder={t('common.optional')}
            />
          </div>
          {onPatchParameters &&
          facility.type === 'Facility' ? (
            <div>
              <label htmlFor="facility-purpose" className="mb-1 block text-[10px] text-zinc-500">
                {t('mapEditor.inspector.purpose')}
              </label>
              <input
                id="facility-purpose"
                readOnly={readOnly}
                value={
                  typeof facility.parameters?.purpose === 'string'
                    ? facility.parameters.purpose
                    : ''
                }
                onChange={(e) =>
                  onPatchParameters({ purpose: e.target.value.trim() || undefined })
                }
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
                placeholder={t('mapEditor.inspector.purposePlaceholder')}
              />
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                {t('mapEditor.inspector.purposeHint')}
              </p>
            </div>
          ) : null}
          {facility.type === 'Geofence' && onPatchParameters && (
            <GeofenceInspectorSection
              facility={facility}
              readOnly={readOnly}
              selectedLabelId={geofenceSelectedLabelId}
              onSelectLabel={(labelId) =>
                onSelectGeofenceLabel?.(facility.id, labelId)
              }
              onPatchParameters={onPatchParameters}
              onFieldFocus={onFieldFocus}
              onFieldBlur={onFieldBlur}
            />
          )}
          {onPatchParameters &&
            facility.type !== 'Geofence' &&
            facility.type !== 'Waypoint' && (
            <FacilityLabelStyleSection
              facility={facility}
              readOnly={readOnly}
              onPatchParameters={onPatchParameters}
              onFieldFocus={onFieldFocus}
              onFieldBlur={onFieldBlur}
            />
          )}
        </InspectorSection>

        <InspectorSection title={t('mapEditor.inspector.positionSize')}>
          <div>
            <p className="mb-1.5 text-[10px] text-zinc-500">
              {t('mapEditor.inspector.areaCoordsHint')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                <div className="text-[10px] text-zinc-500">{t('mapEditor.inspector.positionX')}</div>
                <div className="font-mono text-[11px] text-zinc-200">
                  {areaXp.toFixed(2)}
                </div>
              </div>
              <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                <div className="text-[10px] text-zinc-500">{t('mapEditor.inspector.positionY')}</div>
                <div className="font-mono text-[11px] text-zinc-200">
                  {areaYp.toFixed(2)}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-600">
              {t('mapEditor.inspector.areaDragHint')}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] text-zinc-500">{t('mapEditor.inspector.pixelSizeInArea')}</p>
            {readOnly || !onChangeAreaSizePx ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-500">{t('mapEditor.inspector.pixelWidth')}</div>
                  <div className="font-mono text-[11px] text-zinc-200">
                    {pixelW !== null ? pixelW.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-500">{t('mapEditor.inspector.pixelHeight')}</div>
                  <div className="font-mono text-[11px] text-zinc-200">
                    {pixelH !== null ? pixelH.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
            ) : pixelW !== null && pixelH !== null ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="facility-size-px-w"
                    className="w-16 shrink-0 text-[10px] text-zinc-500"
                  >
                    {t('mapEditor.inspector.pixelWidth')}
                  </label>
                  <NumberInput
                    id="facility-size-px-w"
                    min={1}
                    step={0.1}
                    value={Number(pixelW.toFixed(2))}
                    onChange={(px) => {
                      if (px <= 0 || pixelH === null) return
                      onChangeAreaSizePx(px, pixelH)
                    }}
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <span className="shrink-0 text-[10px] text-zinc-500">px</span>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="facility-size-px-h"
                    className="w-16 shrink-0 text-[10px] text-zinc-500"
                  >
                    {t('mapEditor.inspector.pixelHeight')}
                  </label>
                  <NumberInput
                    id="facility-size-px-h"
                    min={1}
                    step={0.1}
                    value={Number(pixelH.toFixed(2))}
                    onChange={(px) => {
                      if (px <= 0 || pixelW === null) return
                      onChangeAreaSizePx(pixelW, px)
                    }}
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <span className="shrink-0 text-[10px] text-zinc-500">px</span>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5 text-[10px] text-zinc-500">
                {t('mapEditor.inspector.noPixelSize')}
              </p>
            )}
            <p className="mt-1.5 text-[10px] text-zinc-600">
              {t('mapEditor.inspector.pixelSizeHint')}
            </p>
          </div>
        </InspectorSection>

        {onPatchParameters && facility.type !== 'Slot' ? (
          <FacilityLayerSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
          />
        ) : null}

        {usesRefFieldBounds(facility.type) ? (
          <FacilityRefFieldBoundsSection
            facility={facility}
            readOnly={readOnly || !onPatchParameters}
            onPatchParameters={onPatchParameters ?? (() => {})}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}

        {usesRefFieldPoint(facility.type) ? (
          <FacilityRefFieldPositionSection
            facility={facility}
            readOnly={readOnly || !onPatchParameters}
            onPatchParameters={onPatchParameters ?? (() => {})}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}

        {onPatchParameters && facility.type !== 'RoadLine' && facility.type !== 'TrackCrossover' && (
          <InspectorSection
            title={t('mapEditor.inspector.mqtt.title')}
            className="border-amber-900/35 bg-amber-950/12"
          >
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {t('mapEditor.inspector.mqtt.hintBefore')}{' '}
              <strong>{t('mapEditor.inspector.mqtt.hintNameId')}</strong>
              {t('mapEditor.inspector.mqtt.hintAfter')}
            </p>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
              {t('mapEditor.inspector.mqtt.componentName')}
            </label>
            <div className="mb-2 rounded border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 font-mono text-[11px] text-zinc-200">
              {facility.name}
            </div>
            <label
              htmlFor="mqtt-instance"
              className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500"
            >
              {t('mapEditor.inspector.mqtt.tailId')}
            </label>
            <input
              id="mqtt-instance"
              value={mqttInstanceUi}
              readOnly={readOnly}
              onChange={(e) => {
                const v = e.target.value.trim()
                onPatchParameters({
                  mqttInstanceId:
                    v === '' || v === mqttTailDefault ? undefined : v,
                })
              }}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-amber-100 outline-none focus:border-amber-500/80 read-only:opacity-80"
              placeholder={mqttTailDefault}
            />
            <div className="rounded border border-zinc-700/80 bg-zinc-950/80 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-400">
              <div>
                <span className="text-zinc-500">{t('mapEditor.inspector.mqtt.entityIdLabel')}</span>
                <span className="text-cyan-300/90">{resolvedEntityId}</span>
              </div>
              <div className="mt-0.5">
                <span className="text-zinc-500">{t('mapEditor.inspector.mqtt.topicLabel')}</span>
                <span className="text-amber-200/80">{resolvedTopic}</span>
              </div>
            </div>
            {legacyEntityId.length > 0 && (
              <div className="mt-2 rounded border border-amber-800/40 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-100/90">
                <p className="mb-1">
                  {t('mapEditor.inspector.mqtt.legacyNote')}
                </p>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onPatchParameters({ mqttEntityId: undefined })}
                    className="rounded border border-amber-700/60 bg-amber-950/60 px-2 py-0.5 text-[10px] hover:bg-amber-900/50"
                  >
                    {t('mapEditor.inspector.mqtt.clearLegacy')}
                  </button>
                )}
              </div>
            )}
          </InspectorSection>
        )}

        {facility.type === 'Slot' && sf && occEn && eqEn ? (
          readOnly ? (
            <InspectorSection title={t('mapEditor.inspector.slot.title')}>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  {t('mapEditor.inspector.slot.occupancySettings')}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  {t('mapEditor.inspector.slot.viewOnlyHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_OCCUPANCY.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-default items-center gap-2 text-xs text-zinc-400"
                    >
                      <input
                        type="checkbox"
                        checked={occEn[k]}
                        disabled
                        className="rounded border-zinc-600 opacity-70"
                      />
                      {k === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  {t('mapEditor.inspector.slot.equipmentSettings')}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  {t('mapEditor.inspector.slot.viewOnlyHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_EQUIPMENT_STATES.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-default items-center gap-2 text-xs text-zinc-400"
                    >
                      <input
                        type="checkbox"
                        checked={eqEn[k]}
                        disabled
                        className="rounded border-zinc-600 opacity-70"
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-zinc-700 bg-zinc-950/80 px-2 py-2 text-xs text-zinc-300">
                <div className="mb-2 font-medium text-zinc-400">
                  {t('mapEditor.inspector.slot.mapDefaultSaved')}
                </div>
                <p>
                  {t('mapEditor.inspector.slot.space')}
                  {sf.slotOccupancy === 'Vacant'
                    ? t('mapEditor.inspector.slot.vacantFull')
                    : t('mapEditor.inspector.slot.occupiedFull')}
                </p>
                <p className="mt-1">{t('mapEditor.inspector.slot.equipmentState')}{sf.slotEquipmentState}</p>
              </div>
            </InspectorSection>
          ) : (
            <InspectorSection title={t('mapEditor.inspector.slot.title')}>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  {t('mapEditor.inspector.slot.occupancySettings')}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  {t('mapEditor.inspector.slot.occupancyEnableHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_OCCUPANCY.map((k) => {
                    const enabled = occEn[k]
                    return (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            const next = { ...sf.slotOccupancyEnabled }
                            if (e.target.checked) delete next[k]
                            else next[k] = false
                            onPatchSlot({
                              slotOccupancyEnabled:
                                Object.keys(next).length > 0 ? next : undefined,
                            })
                          }}
                          className="rounded border-zinc-600"
                        />
                        {k === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  {t('mapEditor.inspector.slot.equipmentSettings')}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  {t('mapEditor.inspector.slot.equipmentEnableHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_EQUIPMENT_STATES.map((k) => {
                    const enabled = eqEn[k]
                    return (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            const next = { ...sf.slotEquipmentEnabled }
                            if (e.target.checked) delete next[k]
                            else next[k] = false
                            onPatchSlot({
                              slotEquipmentEnabled:
                                Object.keys(next).length > 0 ? next : undefined,
                            })
                          }}
                          className="rounded border-zinc-600"
                        />
                        {k}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">
                  {t('mapEditor.inspector.slot.mapDefaultSaved')}
                </label>
                <p className="mb-2 text-[10px] text-zinc-500">
                  {t('mapEditor.inspector.slot.mapDefaultHint')}
                </p>
                <div className="flex flex-col gap-2">
                  <select
                    value={sf.slotOccupancy}
                    onChange={(e) =>
                      onPatchSlot({
                        slotOccupancy: e.target.value as SlotOccupancy,
                      })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                  >
                    {SLOT_OCCUPANCY.map((s) => (
                      <option key={s} value={s}>
                        {s === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sf.slotEquipmentState}
                    onChange={(e) =>
                      onPatchSlot({
                        slotEquipmentState: e.target.value as SlotEquipmentState,
                      })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
                  >
                    {SLOT_EQUIPMENT_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="rounded-md border border-cyan-900/40 bg-cyan-950/20 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-cyan-200/90">
                    {t('mapEditor.inspector.slot.previewTest')}
                  </span>
                  {slotPreview && (
                    <span className="text-[10px] text-amber-400">{t('mapEditor.inspector.slot.previewing')}</span>
                  )}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  {t('mapEditor.inspector.slot.previewHint')}
                </p>
                <div className="flex flex-col gap-2">
                  <select
                    value={
                      slotPreview?.occupancy ??
                      sf.slotOccupancy
                    }
                    onChange={(e) => {
                      const occupancy = e.target.value as SlotOccupancy
                      onSlotPreviewChange({
                        occupancy,
                        equipment:
                          slotPreview?.equipment ?? sf.slotEquipmentState,
                      })
                    }}
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                  >
                    {SLOT_OCCUPANCY.map((s) => (
                      <option key={s} value={s}>
                        {s === 'Vacant' ? t('mapEditor.inspector.slot.vacantShort') : t('mapEditor.inspector.slot.occupiedShort')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={
                      slotPreview?.equipment ??
                      sf.slotEquipmentState
                    }
                    onChange={(e) => {
                      const equipment = e.target.value as SlotEquipmentState
                      onSlotPreviewChange({
                        occupancy:
                          slotPreview?.occupancy ?? sf.slotOccupancy,
                        equipment,
                      })
                    }}
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-cyan-500"
                  >
                    {SLOT_EQUIPMENT_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onSlotPreviewChange(null)}
                      className="rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      {t('mapEditor.inspector.slot.clearPreview')}
                    </button>
                    {slotPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          onPatchSlot({
                            slotOccupancy: slotPreview.occupancy,
                            slotEquipmentState: slotPreview.equipment,
                          })
                          onSlotPreviewChange(null)
                        }}
                        className="rounded border border-cyan-700 bg-cyan-950/50 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-900/40"
                      >
                        {t('mapEditor.inspector.slot.applyPreviewAsDefault')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </InspectorSection>
          )
        ) : null}
        {facility.type === 'PSD' && onPatchParameters ? (
          <InspectorSection
            title={t('mapEditor.inspector.psd.title')}
            className="border-sky-900/35 bg-sky-950/12"
          >
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {t('mapEditor.inspector.psd.hint')}
            </p>
            <label className="mb-1 block text-[10px] text-zinc-500">
              {t('mapEditor.inspector.psd.mapDefaultOpen', {
                pct: resolvePsdDisplay(facility).openPercent.toFixed(0),
              })}
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={readOnly}
              value={resolvePsdDisplay(facility).openPercent}
              onChange={(e) => {
                const pct = normalizeOpenPercentPercent(Number(e.target.value))
                onPatchParameters({ openPercent: pct })
                onChangeNonSlotState(
                  openPercentToPsdState(
                    pct,
                    facility.currentState === 'Alarm',
                  ),
                )
              }}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mb-2 w-full accent-sky-500 disabled:opacity-60"
            />
            <label
              htmlFor="psd-mqtt-key"
              className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500"
            >
              {t('mapEditor.inspector.psd.mqttKey')}
            </label>
            <input
              id="psd-mqtt-key"
              readOnly={readOnly}
              value={
                typeof facility.parameters?.mqttOpenPercentKey === 'string'
                  ? facility.parameters.mqttOpenPercentKey
                  : DEFAULT_PSD_OPEN_PERCENT_KEY
              }
              onChange={(e) =>
                onPatchParameters({
                  mqttOpenPercentKey: e.target.value.trim() || undefined,
                })
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500/80 read-only:opacity-80"
            />
            <label
              htmlFor="psd-sql-field"
              className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500"
            >
              {t('mapEditor.inspector.psd.sqlField')}
            </label>
            <input
              id="psd-sql-field"
              readOnly={readOnly}
              value={
                typeof facility.parameters?.sqlOpenPercentField === 'string'
                  ? facility.parameters.sqlOpenPercentField
                  : ''
              }
              onChange={(e) =>
                onPatchParameters({
                  sqlOpenPercentField: e.target.value.trim() || undefined,
                })
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              placeholder="door_open_pct"
              className="mb-2 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500/80 read-only:opacity-80"
            />
            <pre className="overflow-x-auto rounded border border-zinc-700/80 bg-zinc-950/80 p-2 font-mono text-[9px] leading-relaxed text-zinc-400">
              {`{\n  "entityId": "${resolvedEntityId}",\n  "openPercent": 72,\n  "alarm": false\n}`}
            </pre>
          </InspectorSection>
        ) : null}
        {facility.type === 'Track' && onPatchParameters ? (
          <TrackInspectorSection
            facility={facility}
            sizeMeters={layoutSizeM}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'Facility' && onPatchParameters ? (
          <FacilityInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'Facility' && onPatchParameters ? (
          <FacilityDockingPointInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'Signal' && onPatchParameters ? (
          <SignalInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'DockingPoint' && onPatchParameters && onApplyDockingPoint ? (
          <DockingPointInspectorSection
            facility={facility}
            areas={mapAreas}
            readOnly={readOnly}
            onApplyDockingPoint={onApplyDockingPoint}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'Waypoint' && onApplyWaypoint ? (
          <WaypointInspectorSection
            facility={facility}
            areas={mapAreas}
            readOnly={readOnly}
            onApplyWaypoint={onApplyWaypoint}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'RoadLine' && onPatchParameters ? (
          <RoadLineInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.type === 'TrackCrossover' && onPatchParameters ? (
          <TrackCrossoverInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
            mapAreas={mapAreas}
          />
        ) : null}
        {facility.type !== 'Slot' &&
        facility.type !== 'Geofence' &&
        facility.type !== 'Track' &&
        facility.type !== 'Facility' &&
        facility.type !== 'Signal' &&
        facility.type !== 'RoadLine' &&
        facility.type !== 'TrackCrossover' &&
        facility.type !== 'Waypoint' ? (
          <InspectorSection title={t('mapEditor.inspector.displayState', { type: facility.type })}>
            <select
              id="facility-state"
              value={facility.currentState}
              disabled={readOnly}
              onChange={(e) =>
                onChangeNonSlotState(e.target.value as NonSlotFacilityState)
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {nonSlotStates!.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {facility.type === 'PSD' && (
              <p className="text-[10px] text-zinc-600">
                {t('mapEditor.inspector.psd.alarmHint')}
              </p>
            )}
          </InspectorSection>
        ) : null}

        {!readOnly && (
          <div className="pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-900/80 bg-red-950/50 py-2 text-sm font-medium text-red-300 transition hover:bg-red-950/80 focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              {t('mapEditor.inspector.deleteObject')}
            </button>
          </div>
        )}

        <p className="rounded-md border border-zinc-800/60 bg-zinc-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500">
          {readOnly
            ? t('mapEditor.inspector.footerViewOnly')
            : t('mapEditor.inspector.footerEditHints')}
        </p>
      </div>
    </aside>
  )
}
