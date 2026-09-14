import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import {
  availableZonePartitionsForEntrance,
  createZoneEntranceLinkFromPartition,
  readZoneEntranceLinks,
  type ZoneEntranceLink,
} from '../utils/zonePartition'

type Props = {
  facility: FacilityObject
  /** 同 Area 內設施（用來列出可連結分區） */
  areaFacilities: readonly FacilityObject[]
  readOnly: boolean
  onCommitLinks: (links: ZoneEntranceLink[]) => void
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
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const links = readZoneEntranceLinks(facility.parameters)
  const available = availableZonePartitionsForEntrance(areaFacilities)

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
    <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {t('mapEditor.inspector.zoneEntrance.title')}
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-600">
        {t('mapEditor.inspector.zoneEntrance.hint')}
      </p>

      {links.length === 0 ? (
        <p className="text-[11px] text-zinc-500">
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
                className="space-y-2 rounded-md border border-zinc-700/80 bg-zinc-950/80 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-zinc-400">
                    {t('mapEditor.inspector.zoneEntrance.linkLabel', {
                      index: index + 1,
                    })}
                  </span>
                  {!readOnly ? (
                    <button
                      type="button"
                      className="text-[10px] text-rose-400 hover:text-rose-300"
                      onClick={() => removeLink(link.id)}
                    >
                      {t('common.delete')}
                    </button>
                  ) : null}
                </div>
                <p className="text-[10px] text-zinc-500">
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
                    <p className="text-[10px] text-amber-300/80">
                      {t('mapEditor.inspector.zoneEntrance.noAvailable')}
                    </p>
                  ) : (
                    <label className="block text-[10px] text-amber-300/80">
                      {t('mapEditor.inspector.zoneEntrance.rebind')}
                      <select
                        value=""
                        onChange={(e) => {
                          const zoneId = e.target.value.trim()
                          e.target.value = ''
                          if (!zoneId) return
                          rebindLink(link.id, zoneId)
                        }}
                        onFocus={onFieldFocus}
                        onBlur={onFieldBlur}
                        className="mt-0.5 w-full rounded border border-amber-700/70 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-500"
                      >
                        <option value="">
                          {t('mapEditor.inspector.zoneEntrance.pickZone')}
                        </option>
                        {available.map((z) => (
                          <option key={z.id} value={z.id}>
                            {zoneDisplayLabel(z)}（{z.id}）
                          </option>
                        ))}
                      </select>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-600">
                        {t('mapEditor.inspector.zoneEntrance.rebindHint')}
                      </span>
                    </label>
                  )
                ) : null}
                <label className="block text-[10px] text-zinc-500">
                  {t('mapEditor.inspector.zoneEntrance.zoneName')}
                  <input
                    readOnly={readOnly}
                    value={link.name}
                    onChange={(e) =>
                      updateLink(link.id, { name: e.target.value })
                    }
                    onFocus={onFieldFocus}
                    onBlur={onFieldBlur}
                    className="mt-0.5 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
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
                    <label key={key} className="block text-[10px] text-zinc-500">
                      {label}
                      <NumberInput
                        readOnly={readOnly}
                        value={link[key]}
                        step={0.1}
                        onChange={(v) => updateLink(link.id, { [key]: v })}
                        onFocus={onFieldFocus}
                        onBlur={onFieldBlur}
                        className="mt-0.5 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
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
          <label className="mb-1 block text-[10px] text-zinc-500">
            {t('mapEditor.inspector.zoneEntrance.linkExisting')}
          </label>
          {available.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              {t('mapEditor.inspector.zoneEntrance.noAvailable')}
            </p>
          ) : (
            <select
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value.trim()
                e.target.value = ''
                if (!id) return
                linkZone(id)
              }}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-cyan-500"
            >
              <option value="">
                {t('mapEditor.inspector.zoneEntrance.pickZone')}
              </option>
              {available.map((z) => (
                <option key={z.id} value={z.id}>
                  {zoneDisplayLabel(z)}（{z.id}）
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}
    </section>
  )
}
