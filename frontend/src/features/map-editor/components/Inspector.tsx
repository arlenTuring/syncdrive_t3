import { Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
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
      <p className="text-[10px] font-medium text-zinc-500">名稱顯示樣式</p>
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
        顯示名稱
      </label>
      {showLabelDragHint && labelStyle.visible !== false ? (
        <p className="text-[10px] leading-relaxed text-zinc-600">
          請先按上方<strong className="font-medium text-zinc-400">「編輯」</strong>
          進入編輯模式。在圖台上將滑鼠移到名稱上（會出現淡青框與抓取游標），
          <strong className="font-medium text-zinc-400">拖曳名稱</strong>
          調整位置，選取後拖曳名稱右側圓點可
          <strong className="font-medium text-zinc-400">旋轉名稱</strong>
          （適用軌道、設施、號誌、智慧桿等）。
        </p>
      ) : null}
      <div>
        <label
          htmlFor="label-font-size"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          字體大小（px）
        </label>
        <div className="flex items-center gap-2">
          <input
            id="label-font-size"
            type="number"
            min={6}
            max={72}
            step={1}
            disabled={readOnly || labelStyle.visible === false}
            value={effectiveLabelPx}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              patchLabelStyle({ fontSizePx: n })
            }}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={readOnly || labelStyle.visible === false}
            onClick={() => patchLabelStyle({ fontSizePx: undefined })}
            className="shrink-0 rounded border border-zinc-600 px-2 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            title={`還原自動（約 ${DEFAULT_AUTO_LABEL_FONT_PX}px）`}
          >
            自動
          </button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-600">
          圖台座標字級；所有設施預設 {EXAMPLE_MAP_DEFAULT_LABEL_FONT_PX}px。
        </p>
      </div>
      <div>
        <label
          htmlFor="label-color"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          文字顏色
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
            預設色
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
          粗體
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
          斜體
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
        {facility.customName.trim() || facility.name || '預覽'}
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
        屬性
        {readOnly && (
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal normal-case text-zinc-400">
            檢視
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-sm text-zinc-200">
        <InspectorSection title="識別與命名">
          <div>
            <label className="mb-1 block text-[10px] text-zinc-500">
              標準圖層命名
            </label>
            <p className="break-all rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5 font-mono text-[11px] leading-snug text-cyan-300/90">
              {layerName}
            </p>
          </div>
          <div>
            <label htmlFor="facility-id" className="mb-1 block text-[10px] text-zinc-500">
              設施 ID
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
              自訂顯示名稱
            </label>
            <input
              id="facility-custom"
              value={facility.customName}
              readOnly={readOnly}
              onChange={(e) => onChangeCustomName(e.target.value)}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 read-only:cursor-default read-only:opacity-90"
              placeholder="選填"
            />
          </div>
          {onPatchParameters &&
          facility.type === 'Facility' ? (
            <div>
              <label htmlFor="facility-purpose" className="mb-1 block text-[10px] text-zinc-500">
                用途
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
                placeholder="例：充電格、停車格、維修格"
              />
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                選填；僅用於大型設施區塊分類說明（清單顯示）。紅綠燈／智慧桿／月台門請用元件庫「設備」類型，勿在此填寫代替。
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

        <InspectorSection title="位置與尺寸">
          <div>
            <p className="mb-1.5 text-[10px] text-zinc-500">
              區域座標（Area 內；原點左下，橫軸向右、縱軸向上，見規則 9）
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                <div className="text-[10px] text-zinc-500">橫向位置</div>
                <div className="font-mono text-[11px] text-zinc-200">
                  {areaXp.toFixed(2)}
                </div>
              </div>
              <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                <div className="text-[10px] text-zinc-500">縱向位置</div>
                <div className="font-mono text-[11px] text-zinc-200">
                  {areaYp.toFixed(2)}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-600">
              在圖台上拖曳調整位置；拉伸 Area 外框時區域座標不變。實際場域語意請用下方「參照場域範圍」。
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] text-zinc-500">像素尺寸（Area 內顯示）</p>
            {readOnly || !onChangeAreaSizePx ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-500">像素橫向尺寸</div>
                  <div className="font-mono text-[11px] text-zinc-200">
                    {pixelW !== null ? pixelW.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-700/90 bg-zinc-950/80 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-500">像素縱向尺寸</div>
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
                    像素橫向尺寸
                  </label>
                  <input
                    id="facility-size-px-w"
                    type="number"
                    min={1}
                    step={0.1}
                    value={pixelW.toFixed(2)}
                    onChange={(e) => {
                      const px = Number.parseFloat(e.target.value)
                      if (!Number.isFinite(px) || px <= 0 || pixelH === null) return
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
                    像素縱向尺寸
                  </label>
                  <input
                    id="facility-size-px-h"
                    type="number"
                    min={1}
                    step={0.1}
                    value={pixelH.toFixed(2)}
                    onChange={(e) => {
                      const px = Number.parseFloat(e.target.value)
                      if (!Number.isFinite(px) || px <= 0 || pixelW === null) return
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
                尚無像素尺寸；請在圖台上拖曳邊線調整大小，或載入含 areaSizePx 的地圖。
              </p>
            )}
            <p className="mt-1.5 text-[10px] text-zinc-600">
              圖台絕對畫素，與 Area 外框、場域尺寸無關；實際場域語意請用「參照場域範圍」。
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
            title="MQTT 對接"
            className="border-amber-900/35 bg-amber-950/12"
          >
            <p className="text-[10px] leading-relaxed text-zinc-500">
              對接路徑為 <strong>元件名稱／尾端 ID</strong>（名稱來自 palette，ID 在路徑最後）。
              Topic 為 <code className="text-cyan-600">syncdrive/名稱/ID</code>。
              payload 的 <code className="text-cyan-500">entityId</code> 須與下方一致。
            </p>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
              元件名稱（對接用）
            </label>
            <div className="mb-2 rounded border border-zinc-700/80 bg-zinc-950/50 px-2 py-1.5 font-mono text-[11px] text-zinc-200">
              {facility.name}
            </div>
            <label
              htmlFor="mqtt-instance"
              className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500"
            >
              尾端 ID（選填，預設為設施 ID）
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
                <span className="text-zinc-500">entityId（名稱/尾端ID）：</span>
                <span className="text-cyan-300/90">{resolvedEntityId}</span>
              </div>
              <div className="mt-0.5">
                <span className="text-zinc-500">Topic：</span>
                <span className="text-amber-200/80">{resolvedTopic}</span>
              </div>
            </div>
            {legacyEntityId.length > 0 && (
              <div className="mt-2 rounded border border-amber-800/40 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-100/90">
                <p className="mb-1">
                  已設定舊版 <code className="text-cyan-400">mqttEntityId</code>
                  ，會優先於「名稱／尾端 ID」。
                </p>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onPatchParameters({ mqttEntityId: undefined })}
                    className="rounded border border-amber-700/60 bg-amber-950/60 px-2 py-0.5 text-[10px] hover:bg-amber-900/50"
                  >
                    清除舊版，改用名稱／ID
                  </button>
                )}
              </div>
            )}
          </InspectorSection>
        )}

        {facility.type === 'Slot' && sf && occEn && eqEn ? (
          readOnly ? (
            <InspectorSection title="整備格">
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  空間狀態設定（啟用設置）
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  檢視模式僅供瀏覽；按「編輯」後可調整勾選。
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
                      {k === 'Vacant' ? 'Vacant（空閒）' : 'Occupied（已佔用）'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  設備狀態設定（啟用設置）
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  檢視模式僅供瀏覽；按「編輯」後可調整勾選。
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
                  地圖預設顯示（儲存值）
                </div>
                <p>
                  空間：
                  {sf.slotOccupancy === 'Vacant'
                    ? '空閒（Vacant）'
                    : '已佔用（Occupied）'}
                </p>
                <p className="mt-1">設備狀態：{sf.slotEquipmentState}</p>
              </div>
            </InspectorSection>
          ) : (
            <InspectorSection title="整備格">
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  空間狀態設定（啟用設置）
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  勾選要啟用的狀態；未勾表示不需要此狀態。預設全部啟用。與下方「地圖預設顯示」互不連動。
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
                        {k === 'Vacant' ? 'Vacant（空閒）' : 'Occupied（已佔用）'}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/15 p-2">
                <div className="mb-2 text-xs font-medium text-emerald-200/90">
                  設備狀態設定（啟用設置）
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  勾選要啟用的設備／作業狀態；未勾表示不需要。與下方「地圖預設顯示」互不連動。
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
                  地圖預設顯示（儲存值）
                </label>
                <p className="mb-2 text-[10px] text-zinc-500">
                  檢視模式與未預覽時，圖台依此組合顯示。
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
                        {s === 'Vacant' ? 'Vacant（空閒）' : 'Occupied（已佔用）'}
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
                    預覽測試（圖台）
                  </span>
                  {slotPreview && (
                    <span className="text-[10px] text-amber-400">預覽中</span>
                  )}
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                  一對一查看各組合的邊框／光影效果，不會自動寫入預設值。
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
                        {s === 'Vacant' ? '空閒' : '已佔用'}
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
                      清除預覽
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
                        將預覽設為地圖預設
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
            title="月台門開度"
            className="border-sky-900/35 bg-sky-950/12"
          >
            <p className="text-[10px] leading-relaxed text-zinc-500">
              圖台以<strong className="text-zinc-400">開度百分比</strong>線性控制門片（0 全關 → 100 全開）。
              MQTT／SQL 請提供 0–100（或 0–1）數值；亦支援離散狀態
              Open／Closed／Moving／Alarm。
            </p>
            <label className="mb-1 block text-[10px] text-zinc-500">
              地圖預設開度（{resolvePsdDisplay(facility).openPercent.toFixed(0)}%）
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
              MQTT 開度欄位名
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
              SQL 開度欄位（預留）
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
          <InspectorSection title={`顯示狀態（${facility.type}）`}>
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
                Alarm 時門片改紅色；Open／Closed 僅在無即時開度時作為預設。
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
              刪除此物件
            </button>
          </div>
        )}

        <p className="rounded-md border border-zinc-800/60 bg-zinc-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-zinc-500">
          {readOnly
            ? '檢視模式僅能瀏覽屬性；按「編輯」後可修改。'
            : '旋轉請用元件下方圓形工具列。未聚焦輸入欄時：⌘/Ctrl+C／V 複製貼上；Delete 刪除；⌘/Ctrl+Z 復原、⌘/Ctrl+Shift+Z 重做。'}
        </p>
      </div>
    </aside>
  )
}
