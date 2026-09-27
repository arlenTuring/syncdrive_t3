import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  activateMapLibraryEntry,
  checkMapActivation,
  type MapActivationCheck,
} from '../api/mapLibraryApi'
import type { MapLibraryEntry } from '../utils/mapLibraryStorage'

type Props = {
  entry: MapLibraryEntry
  onClose: () => void
  /** 切換成功（已是主要地圖） */
  onActivated: (mapId: string) => void
}

/**
 * 設為主要地圖。
 *
 * 主要地圖是整個系統在讀的那一張（車輛定位、訂單站點、儀表板、模擬器），換掉它會影響
 * 正在跑的營運。所以不是按下去就換：先把最新內容存上後端、比對部署中的班表接不接得上
 * （規則見後端 map-activation.ts），把結果攤給使用者看，接不上就不給換。
 */
export function SetPrimaryMapDialog({ entry, onClose, onActivated }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const [check, setCheck] = useState<MapActivationCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void checkMapActivation(entry).then((result) => {
      if (cancelled) return
      if (result.ok) setCheck(result.check)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [entry])

  const confirm = async () => {
    setActivating(true)
    setError(null)
    try {
      const result = await activateMapLibraryEntry(entry)
      if (result.ok) {
        onActivated(result.mapId)
        return
      }
      // 檢查之後、按下之前部署班表可能換了：後端會再擋一次，帶回新的檢查結果
      if (result.check) setCheck(result.check)
      setError(result.error)
    } finally {
      setActivating(false)
    }
  }

  const loading = !check && !error
  const canConfirm = Boolean(check?.canActivate) && !activating

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !activating) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl border border-[rgba(212,212,212,0.15)] bg-[#18181B] p-5 text-[#F3F4F6] shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-medium leading-6">
          {t('mapLibrary.primary.title', { name: entry.displayName })}
        </h2>
        <p className="mt-2 text-sm leading-[20px] tracking-[0.5px] text-[#99A1AF]">
          {t('mapLibrary.primary.impact')}
        </p>

        {loading ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-[#99A1AF]">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('mapLibrary.primary.checking')}
          </p>
        ) : null}

        {check ? (
          <div className="mt-4 space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-[rgba(142,197,255,0.04)] px-4 py-3 text-sm">
              <dt className="text-[#99A1AF]">{t('mapLibrary.primary.current')}</dt>
              <dd>{check.currentActive.displayName ?? check.currentActive.mapId}</dd>
              <dt className="text-[#99A1AF]">{t('mapLibrary.primary.next')}</dt>
              <dd>
                {entry.displayName}
                <span className="ml-2 text-xs text-[#99A1AF]">
                  {t('mapLibrary.primary.counts', {
                    routes: check.routeCount,
                    stations: check.stationCount,
                  })}
                </span>
              </dd>
              <dt className="text-[#99A1AF]">{t('mapLibrary.primary.deployedShift')}</dt>
              <dd>{check.deployedShift?.shiftName ?? t('mapLibrary.primary.noDeployedShift')}</dd>
            </dl>

            {check.blockers.length > 0 ? (
              <ul className="space-y-1.5 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {check.blockers.map((issue, i) => (
                  <li key={`${issue.code}-${i}`} className="flex gap-2">
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
                    <span>{issue.message}</span>
                  </li>
                ))}
                <li className="pl-6 text-xs text-red-300/80">{t('mapLibrary.primary.blockedHint')}</li>
              </ul>
            ) : null}

            {check.warnings.length > 0 ? (
              <ul className="space-y-1.5 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                {check.warnings.map((issue, i) => (
                  <li key={`${issue.code}-${i}`} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {check.canActivate && check.blockers.length === 0 && check.warnings.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                {check.deployedShift
                  ? t('mapLibrary.primary.okWithShift')
                  : t('mapLibrary.primary.ok')}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2 text-sm text-red-300">
            {t('mapLibrary.primary.failed', { error })}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={activating}
            className="inline-flex h-[34px] items-center rounded-lg bg-[rgba(209,213,220,0.12)] px-3.5 text-sm font-medium tracking-[0.5px] text-[#D1D5DC] hover:bg-[rgba(209,213,220,0.18)] disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!canConfirm}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[#2B7FFF] px-3.5 text-sm font-medium tracking-[0.5px] text-white enabled:hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {activating && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('mapLibrary.primary.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
