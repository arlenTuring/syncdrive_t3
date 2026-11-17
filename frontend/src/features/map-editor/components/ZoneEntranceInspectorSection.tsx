import { SiteSelect } from '../../../components/SiteSelect';
import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import {
  availableZonePartitionsForEntrance,
  createZoneEntranceLinkFromPartition,
  listWaypointsInArea,
  readZoneEntranceLinks,
  readZoneEntranceWaypointId,
  ZONE_ENTRANCE_WAYPOINT_ID_KEY,
  type ZoneEntranceLink,
} from '../utils/zonePartition'
import { resolveWaypointDisplayName, getWaypointCode } from '../utils/waypointFacility'
import { Button } from '../../../components/ui';

type Props = {
  facility: FacilityObject
  /** 同 Area 內設施（用來列出可連結分區） */
  areaFacilities: readonly FacilityObject[]
  readOnly: boolean
  onCommitLinks: (links: ZoneEntranceLink[]) => void
  /** 綁定途經點用；唯讀時不給 */
  onPatchParameters?: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function zoneDisplayLabel(z: FacilityObject): string {
  const custom = typeof z.customName === 'string' ? z.customName.trim() : ''
  return custom || z.id
}

export function ZoneEntranceInspectorSection({
  facility,
  areaFacilities,
  readOnly,
  onCommitLinks,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const links = readZoneEntranceLinks(facility.parameters)
  const available = availableZonePartitionsForEntrance(areaFacilities)
  const waypoints = listWaypointsInArea(areaFacilities)
  const boundWaypointId = readZoneEntranceWaypointId(facility.parameters)
  const boundWaypoint = boundWaypointId
    ? areaFacilities.find((f) => f.id === boundWaypointId)
    : undefined

  const updateLink = (id: string, patch: Partial<ZoneEntranceLink>) => {
    onCommitLinks(links.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const removeLink = (id: string) => {
    onCommitLinks(links.filter((l) => l.id !== id))
  }

  /**
   * 把<strong>這一條</strong>連結改接到場上某個分區。
   *
   * 名稱與場域範圍不動——那是使用者填的現場資料，只有「對應到哪個圖元」壞掉了。
   */
  const rebindLink = (linkId: string, zoneId: string) => {
    if (!available.some((z) => z.id === zoneId)) return
    if (links.some((l) => l.zoneFacilityId === zoneId)) return
    onCommitLinks(
      links.map((l) => (l.id === linkId ? { ...l, zoneFacilityId: zoneId } : l)),
    )
  }

  const linkZone = (zoneId: string) => {
    const zone = areaFacilities.find((f) => f.id === zoneId)
    if (!zone) return
    // 雙重保險：已連結過的不分區再次加入
    if (links.some((l) => l.zoneFacilityId === zoneId)) return
    if (!available.some((z) => z.id === zoneId)) return
    onCommitLinks([...links, createZoneEntranceLinkFromPartition(zone)])
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-border-quaternary bg-zinc-950/45 p-3">
      <h3 className="text-caption-2 uppercase text-text-quaternary">
        {t('mapEditor.inspector.zoneEntrance.title')}
      </h3>
      <p className="text-caption-2 text-text-disabled">
        {t('mapEditor.inspector.zoneEntrance.hint')}
      </p>

      {/*
        進出場途經點。
        車要從哪裡進出這個場區，由人指定，不用幾何去猜——入口點常常畫在分區外面
        （它是從正線轉進來的路口），猜不準。
      */}
      <div className="space-y-1.5 rounded-md border border-border-quaternary bg-black-30 p-2">
        <span className="text-caption-2 text-text-tertiary">
          {t('mapEditor.inspector.zoneEntrance.waypointLabel')}
        </span>
        {readOnly || !onPatchParameters ? (
          <p className="text-caption-2 text-text-quaternary">
            {boundWaypoint
              ? resolveWaypointDisplayName(boundWaypoint)
              : t('mapEditor.inspector.zoneEntrance.waypointNone')}
          </p>
        ) : waypoints.length === 0 ? (
          <p className="text-caption-2 text-status-warning">
            {t('mapEditor.inspector.zoneEntrance.waypointEmpty')}
          </p>
        ) : (
          <SiteSelect
            value={boundWaypointId}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            onChange={(e) =>
              onPatchParameters({
                [ZONE_ENTRANCE_WAYPOINT_ID_KEY]: e.target.value.trim() || undefined,
              })
            }
            size="sm" className="w-full"
          >
            <option value="">{t('mapEditor.inspector.zoneEntrance.waypointNone')}</option>
            {waypoints.map((w) => {
              const code = getWaypointCode(w)
              const name = resolveWaypointDisplayName(w)
              return (
                <option key={w.id} value={w.id}>
                  {code && code !== name ? `${name}（${code}）` : name}
                </option>
              )
            })}
          </SiteSelect>
        )}
        {boundWaypointId && !boundWaypoint ? (
          <p className="text-caption-2 text-status-warning">
            {t('mapEditor.inspector.zoneEntrance.waypointMissing', { id: boundWaypointId })}
          </p>
        ) : null}
        <p className="text-caption-2 text-text-disabled">
          {t('mapEditor.inspector.zoneEntrance.waypointHint')}
        </p>
      </div>

      {links.length === 0 ? (
        <p className="text-body-xs text-text-quaternary">
          {t('mapEditor.inspector.zoneEntrance.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {links.map((link, index) => {
            const bound = link.zoneFacilityId
              ? areaFacilities.find((f) => f.id === link.zoneFacilityId)
              : undefined
            return (
              <li
                key={link.id}
                className="space-y-2 rounded-md border border-border-quaternary bg-surface-sub-background p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-caption-2 text-text-tertiary">
                    {t('mapEditor.inspector.zoneEntrance.linkLabel', {
                      index: index + 1,
                    })}
                  </span>
                  {!readOnly ? (
                    <Button hierarchy="danger" variant="text" onPress={() => removeLink(link.id)}>{t('common.delete')}</Button>
                  ) : null}
                </div>
                <p className="text-caption-2 text-text-quaternary">
                  {bound
                    ? t('mapEditor.inspector.zoneEntrance.boundLabel', {
                        label: zoneDisplayLabel(bound),
                        id: bound.id,
                      })
                    : link.zoneFacilityId
                      ? t('mapEditor.inspector.zoneEntrance.boundMissing', {
                          id: link.zoneFacilityId,
                        })
                      : t('mapEditor.inspector.zoneEntrance.unbound')}
                </p>
                {/*
                  這一條還沒接上、或接的圖元不在了：就地改接。
                  底下那個「連結場上分區」是<strong>新增</strong>一條連結，修不了
                  已經存在的這一條——只會多出一條同名的，舊的那條照樣壞著。
                */}
                {!readOnly && !bound ? (
                  available.length === 0 ? (
                    <p className="text-caption-2 text-status-warning">
                      {t('mapEditor.inspector.zoneEntrance.noAvailable')}
                    </p>
                  ) : (
                    <label className="block text-caption-2 text-status-warning">
                      {t('mapEditor.inspector.zoneEntrance.rebind')}
                      <SiteSelect
                        value=""
                        onChange={(e) => {
                          const zoneId = e.target.value.trim()
                          e.target.value = ''
                          if (!zoneId) return
                          rebindLink(link.id, zoneId)
                        }}
                        onFocus={onFieldFocus}
                        onBlur={onFieldBlur}
                        size="sm" className="mt-0.5 w-full"
                      >
                        <option value="">
                          {t('mapEditor.inspector.zoneEntrance.pickZone')}
                        </option>
                        {available.map((z) => (
                          <option key={z.id} value={z.id}>
                            {zoneDisplayLabel(z)}（{z.id}）
                          </option>
                        ))}
                      </SiteSelect>
                      <span className="mt-0.5 block text-caption-2 text-text-disabled">
                        {t('mapEditor.inspector.zoneEntrance.rebindHint')}
                      </span>
                    </label>
                  )
                ) : null}
                <label className="block text-caption-2 text-text-quaternary">
                  {t('mapEditor.inspector.zoneEntrance.zoneName')}
                  <input
                    readOnly={readOnly}
                    value={link.name}
                    onChange={(e) =>
                      updateLink(link.id, { name: e.target.value })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="mt-0.5 w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      [
                        'xMinM',
                        t('mapEditor.inspector.zoneEntrance.fieldXMin'),
                      ],
                      [
                        'xMaxM',
                        t('mapEditor.inspector.zoneEntrance.fieldXMax'),
                      ],
                      [
                        'yMinM',
                        t('mapEditor.inspector.zoneEntrance.fieldYMin'),
                      ],
                      [
                        'yMaxM',
                        t('mapEditor.inspector.zoneEntrance.fieldYMax'),
                      ],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-caption-2 text-text-quaternary">
                      {label}
                      <NumberInput
                        readOnly={readOnly}
                        value={link[key]}
                        step={0.1}
                        onChange={(v) => updateLink(link.id, { [key]: v })}
                        onFocus={onFieldFocus}
                        onBlur={onFieldBlur}
                        className="mt-0.5 w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
                      />
                    </label>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly ? (
        <div>
          <label className="mb-1 block text-caption-2 text-text-quaternary">
            {t('mapEditor.inspector.zoneEntrance.linkExisting')}
          </label>
          {available.length === 0 ? (
            <p className="text-body-xs text-text-quaternary">
              {t('mapEditor.inspector.zoneEntrance.noAvailable')}
            </p>
          ) : (
            <SiteSelect
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value.trim()
                e.target.value = ''
                if (!id) return
                linkZone(id)
              }}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              size="sm" className="w-full"
            >
              <option value="">
                {t('mapEditor.inspector.zoneEntrance.pickZone')}
              </option>
              {available.map((z) => (
                <option key={z.id} value={z.id}>
                  {zoneDisplayLabel(z)}（{z.id}）
                </option>
              ))}
            </SiteSelect>
          )}
        </div>
      ) : null}
    </section>
  )
}
