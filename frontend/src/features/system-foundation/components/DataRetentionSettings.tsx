import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../access-control/AuthContext'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import { videoApi, type StoragePolicy } from '../../video/api'
import {
  fetchCleanupCategories, fetchRetentionOverview, previewRetentionPolicy, saveRetentionPolicy,
  type CleanupCategory, type RetentionPolicy,
} from '../api/dataAdminApi'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const date = (value?: number | string | null) => (value == null ? '—' : new Date(Number(value)).toLocaleString('zh-TW'))

type Draft = { enabled: boolean; retentionValue: number; retentionUnit: 'hour' | 'day'; intervalMinutes: number }

const GROUPS: Array<{ title: string; categories: string[] }> = [
  { title: '行車資料', categories: ['vehicle_history', 'degraded_replay', 'telemetry'] },
  { title: '事件與指令', categories: ['security_events', 'bulk_logs'] },
]

function Row({ title, note, children }: { title: string; note: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-[13px]">
      <div className="min-w-[220px] flex-1">
        <div className="font-medium text-zinc-200">{title}</div>
        <div className="mt-0.5 text-[12px] text-zinc-500">{note}</div>
      </div>
      {children}
    </div>
  )
}

const numberInput = 'w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200'
const saveButton = 'rounded border border-sky-700 px-3 py-1 text-sky-300 disabled:opacity-50'

/**
 * 各種資料保存天數集中在這裡。資料庫類別寫 data_retention_policies（後端排程依此清理），
 * 影像寫影像儲存政策。啟用或縮短會造成不可還原的刪除，所以每一列各自儲存、先預覽再確認。
 */
export function DataRetentionSettings() {
  const auth = useAuth()
  const [account] = useDemoAccount()
  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [categories, setCategories] = useState<CleanupCategory[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [video, setVideo] = useState<StoragePolicy | null>(null)
  const [videoDays, setVideoDays] = useState(0)
  const [videoError, setVideoError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [overview, nextCategories] = await Promise.all([fetchRetentionOverview(account), fetchCleanupCategories(account)])
      setPolicies(overview.policies)
      setCategories(nextCategories)
      setDrafts(Object.fromEntries(overview.policies.map((p) => [p.category, {
        enabled: p.enabled, retentionValue: Number(p.retention_value), retentionUnit: p.retention_unit, intervalMinutes: Number(p.interval_minutes),
      }])))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
    try {
      const status = await videoApi.storageStatus()
      setVideo(status.policy)
      setVideoDays(status.policy.retentionDays)
      setVideoError('')
    } catch (caught) {
      setVideoError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [account])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function savePolicy(policy: RetentionPolicy) {
    if (!auth.require('system.data-admin.policy')) return
    const draft = drafts[policy.category]
    if (!draft) return
    setBusy(true); setError('')
    try {
      let confirmationPlanId: string | undefined
      const unitMs = (unit: string) => (unit === 'day' ? DAY_MS : HOUR_MS)
      const oldMs = Number(policy.retention_value) * unitMs(policy.retention_unit)
      const newMs = draft.retentionValue * unitMs(draft.retentionUnit)
      if ((draft.enabled && !policy.enabled) || (draft.enabled && newMs < oldMs)) {
        const impact = await previewRetentionPolicy(account, policy.category, draft)
        if (!window.confirm(`政策將影響約 ${impact.preview.records} 筆資料。${impact.preview.impact}\n\n啟用或縮短保留期限後，排程會進行不可還原的刪除。是否儲存？`)) return
        confirmationPlanId = impact.planId
      }
      await saveRetentionPolicy(account, policy.category, { ...draft, confirmationPlanId })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function saveVideo() {
    if (!video || !auth.require('events.video.recording-manage')) return
    if (videoDays < video.retentionDays && !window.confirm(`影像保存將由 ${video.retentionDays} 天縮短為 ${videoDays} 天，超過天數的錄影會被不可還原地刪除。是否儲存？`)) return
    setBusy(true); setError('')
    try {
      await videoApi.updateStoragePolicy({ expectedVersion: video.version, retentionDays: videoDays })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const policyRow = (category: string) => {
    const policy = policies.find((p) => p.category === category)
    const draft = drafts[category]
    if (!policy || !draft) return null
    const info = categories.find((c) => c.key === category)
    const update = (patch: Partial<Draft>) => setDrafts({ ...drafts, [category]: { ...draft, ...patch } })
    return (
      <Row
        key={category}
        title={info?.label ?? category}
        note={`${info?.impact ?? ''}最近成功 ${date(policy.last_success_at)}`}
      >
        <label className="text-zinc-300">
          <input type="checkbox" className="mr-1" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          自動清理
        </label>
        {draft.enabled ? (
          <label className="text-zinc-400">
            保存
            <input
              aria-label={`${info?.label ?? category}保存數量`}
              type="number"
              min={1}
              value={draft.retentionValue}
              onChange={(e) => update({ retentionValue: Number(e.target.value) })}
              className={`${numberInput} mx-1.5`}
            />
            {draft.retentionUnit === 'day' ? '天' : '小時'}
          </label>
        ) : (
          <span className="text-zinc-500">永久保存</span>
        )}
        <button type="button" disabled={busy} onClick={() => void savePolicy(policy)} className={saveButton}>儲存</button>
      </Row>
    )
  }

  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="text-[12px] text-red-300">{error}</p> : null}
      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <h3 className="text-[13px] font-semibold text-zinc-200">{group.title}</h3>
          {group.categories.map(policyRow)}
        </section>
      ))}
      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-zinc-200">影像</h3>
        <Row title="監控錄影" note={videoError ? `無法取得影像設定：${videoError}` : '超過天數的錄影由影像儲存排程刪除；容量上限與儲存位置在影像管理設定。'}>
          <label className="text-zinc-400">
            保存
            <input
              aria-label="監控錄影保存天數"
              type="number"
              min={1}
              max={3650}
              disabled={!video}
              value={videoDays}
              onChange={(e) => setVideoDays(Number(e.target.value))}
              className={`${numberInput} mx-1.5`}
            />
            天
          </label>
          <button type="button" disabled={busy || !video} onClick={() => void saveVideo()} className={saveButton}>儲存</button>
        </Row>
      </section>
      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-zinc-200">稽核日誌</h3>
        <Row title="操作、權限異動、登入日誌" note="目前沒有自動清理，全部保留。" />
      </section>
    </div>
  )
}
