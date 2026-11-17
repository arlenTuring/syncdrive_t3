import { SiteColorInput } from '../../../components/SiteColorInput';
import { SiteSelect } from '../../../components/SiteSelect';
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
import type { MapBasemapObject } from '../types/basemap'
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
import { CrossTrackInspectorSection } from './CrossTrackInspectorSection'
import { TrackPartInspectorSection } from './TrackPartInspectorSection'
import { GeofenceInspectorSection } from './GeofenceInspectorSection'
import { FacilityInspectorSection } from './FacilityInspectorSection'
import { FacilityDockingPointInspectorSection } from './FacilityDockingPointInspectorSection'
import { Button, Checkbox } from '../../../components/ui';
import { FacilityLayerSection } from './FacilityLayerSection'
import { FacilityRefFieldPositionSection } from './FacilityRefFieldPositionSection'
import { FacilityRefFieldBoundsSection } from './FacilityRefFieldBoundsSection'
import { ZoneEntranceInspectorSection } from './ZoneEntranceInspectorSection'
import {
  ParentZoneInspectorSection,
  ZonePartitionInspectorSection,
} from './ZonePartitionInspectorSection'
import {
  usesRefFieldBounds,
  usesRefFieldPoint,
} from '../utils/facilityRefFieldBinding'
import {
  isFacilityAreaBlock,
  isZoneEntrance,
  isZonePartition,
  canBelongToParentZone,
  type ZoneEntranceLink,
} from '../utils/zonePartition'

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
    <div className="space-y-2 rounded-md border border-border-quaternary bg-black-30 p-2.5">
      <p className="text-caption-2 text-text-quaternary">{t('mapEditor.inspector.labelStyle.title')}</p>
      <label className="flex cursor-pointer items-center gap-2 text-body-xs text-text-secondary">
        <Checkbox checked={labelStyle.visible !== false} disabled={readOnly} onCheckedChange={(checked) => patchLabelStyle({
              visible: checked ? true : false,
            })
          } onFocus={onFieldFocus} onBlur={onFieldBlur} />
        {t('mapEditor.inspector.labelStyle.showName')}
      </label>
      {showLabelDragHint && labelStyle.visible !== false ? (
        <p className="text-caption-2 text-text-disabled">
          {t('mapEditor.inspector.labelStyle.dragHint')}
        </p>
      ) : null}
      <div>
        <label
          htmlFor="label-font-size"
          className="mb-1 block text-caption-2 text-text-quaternary"
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
            className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
          />
          <Button hierarchy="subordinate" variant="outlined" className="shrink-0" disabled={readOnly || labelStyle.visible === false} onPress={() => patchLabelStyle({ fontSizePx: undefined })} title={t('mapEditor.inspector.labelStyle.autoTitle', {
              px: DEFAULT_AUTO_LABEL_FONT_PX,
            })}>{t('common.auto')}</Button>
        </div>
        <p className="mt-1 text-caption-2 text-text-disabled">
          {t('mapEditor.inspector.labelStyle.fontHint', {
            px: EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX,
          })}
        </p>
      </div>
      <div>
        <label
          htmlFor="label-color"
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.inspector.labelStyle.textColor')}
        </label>
        <div className="flex items-center gap-2">
          <SiteColorInput
            id="label-color"
            disabled={readOnly || labelStyle.visible === false}
            value={labelStyle.color ?? '#e4e4e7'}
            onChange={(e) => patchLabelStyle({ color: e.target.value })}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-8 w-10 cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-50"
           />
          <Button hierarchy="subordinate" variant="outlined" disabled={readOnly || labelStyle.visible === false} onPress={() => patchLabelStyle({ color: '' })}>{t('mapEditor.inspector.labelStyle.defaultColor')}</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-body-xs text-text-secondary">
          <Checkbox checked={labelStyle.fontWeight === 'bold'} disabled={readOnly || labelStyle.visible === false} onCheckedChange={(checked) => patchLabelStyle({
                fontWeight: checked ? 'bold' : 'normal',
              })
            } />
          {t('common.bold')}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-body-xs text-text-secondary">
          <Checkbox checked={labelStyle.fontStyle === 'italic'} disabled={readOnly || labelStyle.visible === false} onCheckedChange={(checked) => patchLabelStyle({
                fontStyle: checked ? 'italic' : 'normal',
              })
            } />
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
        className="truncate rounded border border-border-quaternary bg-surface-primary px-2 py-1"
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
        className ?? 'border-border-quaternary bg-zinc-950/45'
      }`}
    >
      <h3 className="text-caption-2 uppercase text-text-quaternary">
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
  /** 編輯圖台區域像素尺寸（僅影響 Area 內顯示，不影響場域範圍） */
  onChangeAreaSizePx?: (wPx: number, hPx: number) => void
  geofenceSelectedLabelId?: string | null
  onSelectGeofenceLabel?: (facilityId: string, labelId: string | null) => void
  /** 所屬 Area 管制範圍（公尺） */
  domainMaxM?: { w: number; h: number }
  /** 所屬 Area 版面（用於 px↔場域換算提示） */
  areaLayout?: MapAreaLayout
  /** 全圖 Area（停靠點站名唯一性、節點 ID 產生） */
  mapAreas?: MapAreaObject[]
  /** 底圖（判定高精 Area 連結） */
  mapBasemaps?: MapBasemapObject[]
  /** 所屬 Area（場域座標自動閘門） */
  parentArea?: MapAreaObject | null
  onApplyDockingPoint?: (facility: FacilityObject) => void
  onApplyWaypoint?: (facility: FacilityObject) => void
  /** 分區入口：一次提交完整連結表（會同步綁定分區場域範圍） */
  onCommitZoneEntranceLinks?: (links: ZoneEntranceLink[]) => void
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
  mapBasemaps,
  parentArea = null,
  onApplyDockingPoint,
  onApplyWaypoint,
  onCommitZoneEntranceLinks,
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
      className="flex h-full min-h-0 w-72 flex-col border-l border-border-quaternary bg-surface-primary"
    >
      <div className="border-b border-border-quaternary px-3 py-2 text-body-xs-bold uppercase text-text-quaternary">
        {t('mapEditor.inspector.properties')}
        {readOnly && (
          <span className="ml-2 rounded bg-surface-secondary px-1.5 py-0.5 text-caption-2 font-normal normal-case text-text-tertiary">
            {t('common.view')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-body-s text-text-primary">
        <InspectorSection title={t('mapEditor.inspector.identityNaming')}>
          <div>
            <label className="mb-1 block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.standardLayerName')}
            </label>
            <p className="break-all rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-cyan-300/90">
              {layerName}
            </p>
          </div>
          <div>
            <label htmlFor="facility-id" className="mb-1 block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.facilityId')}
            </label>
            <input
              id="facility-id"
              value={facility.id}
              readOnly={readOnly}
              onChange={(e) => onChangeId(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
              placeholder="001"
            />
          </div>
          <div>
            <label htmlFor="facility-custom" className="mb-1 block text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.customDisplayName')}
            </label>
            <input
              id="facility-custom"
              value={facility.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
              placeholder={t('common.optional')}
            />
          </div>
          {onPatchParameters &&
          isFacilityAreaBlock(facility) ? (
            <div>
              <label htmlFor="facility-purpose" className="mb-1 block text-caption-2 text-text-quaternary">
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
                className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
                placeholder={t('mapEditor.inspector.purposePlaceholder')}
              />
              <p className="mt-1 text-caption-2 text-text-disabled">
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
            <p className="mb-1.5 text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.areaCoordsHint')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5">
                <div className="text-caption-2 text-text-quaternary">{t('mapEditor.inspector.positionX')}</div>
                <div className="font-mono text-body-xs text-text-primary">
                  {areaXp.toFixed(2)}
                </div>
              </div>
              <div className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5">
                <div className="text-caption-2 text-text-quaternary">{t('mapEditor.inspector.positionY')}</div>
                <div className="font-mono text-body-xs text-text-primary">
                  {areaYp.toFixed(2)}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-caption-2 text-text-disabled">
              {t('mapEditor.inspector.areaDragHint')}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-caption-2 text-text-quaternary">{t('mapEditor.inspector.pixelSizeInArea')}</p>
            {readOnly || !onChangeAreaSizePx ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5">
                  <div className="text-caption-2 text-text-quaternary">{t('mapEditor.inspector.pixelWidth')}</div>
                  <div className="font-mono text-body-xs text-text-primary">
                    {pixelW !== null ? pixelW.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5">
                  <div className="text-caption-2 text-text-quaternary">{t('mapEditor.inspector.pixelHeight')}</div>
                  <div className="font-mono text-body-xs text-text-primary">
                    {pixelH !== null ? pixelH.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
            ) : pixelW !== null && pixelH !== null ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="facility-size-px-w"
                    className="w-16 shrink-0 text-caption-2 text-text-quaternary"
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
                    className="min-w-0 flex-1 rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <span className="shrink-0 text-caption-2 text-text-quaternary">px</span>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="facility-size-px-h"
                    className="w-16 shrink-0 text-caption-2 text-text-quaternary"
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
                    className="min-w-0 flex-1 rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-text-primary outline-none focus:border-border-theme focus:ring-1 focus:ring-cyan-500/50"
                  />
                  <span className="shrink-0 text-caption-2 text-text-quaternary">px</span>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-1.5 text-caption-2 text-text-quaternary">
                {t('mapEditor.inspector.noPixelSize')}
              </p>
            )}
            <p className="mt-1.5 text-caption-2 text-text-disabled">
              {t('mapEditor.inspector.pixelSizeHint')}
            </p>
          </div>
        </InspectorSection>

        {onPatchParameters &&
        facility.type !== 'Slot' &&
        !isZonePartition(facility) ? (
          <FacilityLayerSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
          />
        ) : null}

        {usesRefFieldBounds(facility.type) &&
        !isZonePartition(facility) &&
        !isZoneEntrance(facility) ? (
          <FacilityRefFieldBoundsSection
            facility={facility}
            area={parentArea}
            basemaps={mapBasemaps}
            readOnly={readOnly || !onPatchParameters}
            onPatchParameters={onPatchParameters ?? (() => {})}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}

        {usesRefFieldPoint(facility.type) ? (
          <FacilityRefFieldPositionSection
            facility={facility}
            area={parentArea}
            basemaps={mapBasemaps}
            readOnly={readOnly || !onPatchParameters}
            onPatchParameters={onPatchParameters ?? (() => {})}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}

        {onPatchParameters && facility.type !== 'RoadLine' && (
          <InspectorSection
            title={t('mapEditor.inspector.mqtt.title')}
            className="border-amber-900/35 bg-amber-950/12"
          >
            <p className="text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.mqtt.hintBefore')}{' '}
              <strong>{t('mapEditor.inspector.mqtt.hintNameId')}</strong>
              {t('mapEditor.inspector.mqtt.hintAfter')}
            </p>
            <label className="mb-1 block text-caption-2 uppercase text-text-quaternary">
              {t('mapEditor.inspector.mqtt.componentName')}
            </label>
            <div className="mb-2 rounded border border-border-quaternary bg-black-30 px-2 py-1.5 font-mono text-body-xs text-text-primary">
              {facility.name}
            </div>
            <label
              htmlFor="mqtt-instance"
              className="mb-1 block text-caption-2 uppercase text-text-quaternary"
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
              className="mb-2 w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-status-warning outline-none focus:border-amber-500/80 read-only:opacity-80"
              placeholder={mqttTailDefault}
            />
            <div className="rounded border border-border-quaternary bg-surface-sub-background px-2 py-1.5 font-mono text-caption-2 text-text-tertiary">
              <div>
                <span className="text-text-quaternary">{t('mapEditor.inspector.mqtt.entityIdLabel')}</span>
                <span className="text-cyan-300/90">{resolvedEntityId}</span>
              </div>
              <div className="mt-0.5">
                <span className="text-text-quaternary">{t('mapEditor.inspector.mqtt.topicLabel')}</span>
                <span className="text-status-warning">{resolvedTopic}</span>
              </div>
            </div>
            {legacyEntityId.length > 0 && (
              <div className="mt-2 rounded border border-amber-800/40 bg-amber-950/40 px-2 py-1.5 text-caption-2 text-amber-100/90">
                <p className="mb-1">
                  {t('mapEditor.inspector.mqtt.legacyNote')}
                </p>
                {!readOnly && (
                  <Button hierarchy="subordinate" variant="outlined" onPress={() => onPatchParameters({ mqttEntityId: undefined })}>{t('mapEditor.inspector.mqtt.clearLegacy')}</Button>
                )}
              </div>
            )}
          </InspectorSection>
        )}

        {facility.type === 'Slot' && sf && occEn && eqEn ? (
          readOnly ? (
            <InspectorSection title={t('mapEditor.inspector.slot.title')}>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-body-xs-bold text-emerald-200/90">
                  {t('mapEditor.inspector.slot.occupancySettings')}
                </div>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.viewOnlyHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_OCCUPANCY.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-default items-center gap-2 text-body-xs text-text-tertiary"
                    >
                      <Checkbox checked={occEn[k]} disabled />
                      {k === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-body-xs-bold text-emerald-200/90">
                  {t('mapEditor.inspector.slot.equipmentSettings')}
                </div>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.viewOnlyHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_EQUIPMENT_STATES.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-default items-center gap-2 text-body-xs text-text-tertiary"
                    >
                      <Checkbox checked={eqEn[k]} disabled />
                      {k}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border-quaternary bg-surface-sub-background px-2 py-2 text-body-xs text-text-secondary">
                <div className="mb-2 font-medium text-text-tertiary">
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
                <div className="mb-2 text-body-xs-bold text-emerald-200/90">
                  {t('mapEditor.inspector.slot.occupancySettings')}
                </div>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.occupancyEnableHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_OCCUPANCY.map((k) => {
                    const enabled = occEn[k]
                    return (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center gap-2 text-body-xs text-text-primary"
                      >
                        <Checkbox checked={enabled} onCheckedChange={(checked) => {
                            const next = { ...sf.slotOccupancyEnabled }
                            if (checked) delete next[k]
                            else next[k] = false
                            onPatchSlot({
                              slotOccupancyEnabled:
                                Object.keys(next).length > 0 ? next : undefined,
                            })
                          }} />
                        {k === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-body-xs-bold text-emerald-200/90">
                  {t('mapEditor.inspector.slot.equipmentSettings')}
                </div>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.equipmentEnableHint')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {SLOT_EQUIPMENT_STATES.map((k) => {
                    const enabled = eqEn[k]
                    return (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center gap-2 text-body-xs text-text-primary"
                      >
                        <Checkbox checked={enabled} onCheckedChange={(checked) => {
                            const next = { ...sf.slotEquipmentEnabled }
                            if (checked) delete next[k]
                            else next[k] = false
                            onPatchSlot({
                              slotEquipmentEnabled:
                                Object.keys(next).length > 0 ? next : undefined,
                            })
                          }} />
                        {k}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-body-xs text-text-quaternary">
                  {t('mapEditor.inspector.slot.mapDefaultSaved')}
                </label>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.mapDefaultHint')}
                </p>
                <div className="flex flex-col gap-2">
                  <SiteSelect
                    value={sf.slotOccupancy}
                    onChange={(e) =>
                      onPatchSlot({
                        slotOccupancy: e.target.value as SlotOccupancy,
                      })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    size="md" className="w-full"
                  >
                    {SLOT_OCCUPANCY.map((s) => (
                      <option key={s} value={s}>
                        {s === 'Vacant' ? t('mapEditor.inspector.slot.vacantOption') : t('mapEditor.inspector.slot.occupiedOption')}
                      </option>
                    ))}
                  </SiteSelect>
                  <SiteSelect
                    value={sf.slotEquipmentState}
                    onChange={(e) =>
                      onPatchSlot({
                        slotEquipmentState: e.target.value as SlotEquipmentState,
                      })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    size="md" className="w-full"
                  >
                    {SLOT_EQUIPMENT_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </SiteSelect>
                </div>
              </div>
              <div className="rounded-md border border-cyan-900/40 bg-cyan-950/20 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-body-xs-bold text-cyan-200/90">
                    {t('mapEditor.inspector.slot.previewTest')}
                  </span>
                  {slotPreview && (
                    <span className="text-caption-2 text-status-warning">{t('mapEditor.inspector.slot.previewing')}</span>
                  )}
                </div>
                <p className="mb-2 text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.slot.previewHint')}
                </p>
                <div className="flex flex-col gap-2">
                  <SiteSelect
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
                    size="md" className="w-full"
                  >
                    {SLOT_OCCUPANCY.map((s) => (
                      <option key={s} value={s}>
                        {s === 'Vacant' ? t('mapEditor.inspector.slot.vacantShort') : t('mapEditor.inspector.slot.occupiedShort')}
                      </option>
                    ))}
                  </SiteSelect>
                  <SiteSelect
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
                    size="md" className="w-full"
                  >
                    {SLOT_EQUIPMENT_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </SiteSelect>
                  <div className="flex flex-wrap gap-2">
                    <Button hierarchy="subordinate" variant="outlined" onPress={() => onSlotPreviewChange(null)}>{t('mapEditor.inspector.slot.clearPreview')}</Button>
                    {slotPreview && (
                      <Button hierarchy="subordinate" variant="outlined" onPress={() => {
                          onPatchSlot({
                            slotOccupancy: slotPreview.occupancy,
                            slotEquipmentState: slotPreview.equipment,
                          })
                          onSlotPreviewChange(null)
                        }}>{t('mapEditor.inspector.slot.applyPreviewAsDefault')}</Button>
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
            <p className="text-caption-2 text-text-quaternary">
              {t('mapEditor.inspector.psd.hint')}
            </p>
            <label className="mb-1 block text-caption-2 text-text-quaternary">
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
              className="mb-1 block text-caption-2 uppercase text-text-quaternary"
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
              className="mb-2 w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-sky-500/80 read-only:opacity-80"
            />
            <label
              htmlFor="psd-sql-field"
              className="mb-1 block text-caption-2 uppercase text-text-quaternary"
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
              className="mb-2 w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-sky-500/80 read-only:opacity-80"
            />
            <pre className="overflow-x-auto rounded border border-border-quaternary bg-surface-sub-background p-2 font-mono text-caption-2 text-text-tertiary">
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
        {isFacilityAreaBlock(facility) && onPatchParameters ? (
          <FacilityInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {isFacilityAreaBlock(facility) && onPatchParameters ? (
          <FacilityDockingPointInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {isZoneEntrance(facility) && onCommitZoneEntranceLinks ? (
          <ZoneEntranceInspectorSection
            facility={facility}
            areaFacilities={parentArea?.facilities ?? []}
            readOnly={readOnly}
            onCommitLinks={onCommitZoneEntranceLinks}
            onPatchParameters={readOnly ? undefined : onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {isZonePartition(facility) ? (
          <ZonePartitionInspectorSection
            facility={facility}
            areaFacilities={parentArea?.facilities ?? []}
            readOnly={readOnly}
          />
        ) : null}
        {onPatchParameters &&
        canBelongToParentZone(facility) ? (
          <ParentZoneInspectorSection
            facility={facility}
            areaFacilities={parentArea?.facilities ?? []}
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
        {(facility.name === 'RailCross' || facility.name === 'RailSwitch') &&
        onPatchParameters ? (
          <TrackPartInspectorSection
            facility={facility}
            readOnly={readOnly}
            onPatchParameters={onPatchParameters}
            onFieldFocus={onFieldFocus}
            onFieldBlur={onFieldBlur}
          />
        ) : null}
        {facility.name === 'RailCross' && onPatchParameters ? (
          <CrossTrackInspectorSection
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
        facility.type !== 'Waypoint' ? (
          <InspectorSection title={t('mapEditor.inspector.displayState', { type: facility.type })}>
            <SiteSelect
              id="facility-state"
              value={facility.currentState}
              disabled={readOnly}
              onChange={(e) =>
                onChangeNonSlotState(e.target.value as NonSlotFacilityState)
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              size="md" className="w-full"
            >
              {nonSlotStates!.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SiteSelect>
            {facility.type === 'PSD' && (
              <p className="text-caption-2 text-text-disabled">
                {t('mapEditor.inspector.psd.alarmHint')}
              </p>
            )}
          </InspectorSection>
        ) : null}

        {!readOnly && (
          <div className="pt-1">
            <Button hierarchy="danger" variant="outlined" className="w-full" leadingIcon={<Trash2 />} onPress={onDelete}>{t('mapEditor.inspector.deleteObject')}</Button>
          </div>
        )}

        <p className="rounded-md border border-border-quaternary bg-black-30 px-2.5 py-2 text-caption-2 text-text-quaternary">
          {readOnly
            ? t('mapEditor.inspector.footerViewOnly')
            : t('mapEditor.inspector.footerEditHints')}
        </p>
      </div>
    </aside>
  )
}
