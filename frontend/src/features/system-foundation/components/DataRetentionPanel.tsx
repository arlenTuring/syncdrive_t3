import { useEffect, useState } from 'react'
import { HardDrive, History, ShieldAlert, Trash2 } from 'lucide-react'
import { useAuth } from '../../access-control/AuthContext'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import {
  executeCleanupPlan, fetchCleanupCategories, fetchCleanupJobs, fetchRetentionOverview,
  previewCleanup, previewRetentionPolicy, saveRetentionPolicy, stopCleanupJob,
  type CleanupCategory, type CleanupJob, type CleanupPreview, type RetentionOverview, type RetentionPolicy,
} from '../api/dataAdminApi'

const bytes = (value?: number | null) => value == null ? '無法取得' : new Intl.NumberFormat('zh-TW', { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(value / 1024 / 1024)
const date = (value?: number | string | null) => value == null ? '—' : new Date(Number(value)).toLocaleString('zh-TW')

export function DataRetentionPanel() {
  const auth = useAuth()
  const [account] = useDemoAccount()
  const [overview, setOverview] = useState<RetentionOverview | null>(null)
  const [categories, setCategories] = useState<CleanupCategory[]>([])
  const [jobs, setJobs] = useState<CleanupJob[]>([])
  const [previews, setPreviews] = useState<CleanupPreview[]>([])
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; retentionValue: number; retentionUnit: 'hour' | 'day'; intervalMinutes: number }>>({})

  async function load() {
    try {
      const [nextOverview, nextCategories, nextJobs] = await Promise.all([fetchRetentionOverview(account), fetchCleanupCategories(account), fetchCleanupJobs(account)])
      setOverview(nextOverview); setCategories(nextCategories); setJobs(nextJobs)
      setDrafts(Object.fromEntries(nextOverview.policies.map((p) => [p.category, { enabled: p.enabled, retentionValue: Number(p.retention_value), retentionUnit: p.retention_unit, intervalMinutes: Number(p.interval_minutes) }])))
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createQuickPreview(categoryKeys: string[]) {
    if (!auth.require('system.data-admin.cleanup')) return
    if (categoryKeys.length === 0) return
    setBusy(true); setError(''); setPreviews([])
    try {
      const cutoff = Date.now()
      const next = await Promise.all(categoryKeys.map((category) => previewCleanup(account, { category, to: cutoff })))
      setPreviews(next)
      setConfirming(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }
  async function runCleanup() {
    if (previews.length === 0 || !auth.require('system.data-admin.cleanup')) return
    setBusy(true); setError('')
    try { await Promise.all(previews.map((preview) => executeCleanupPlan(account, preview.planId))); setConfirming(false); setPreviews([]); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }
  async function updatePolicy(policy: RetentionPolicy) {
    if (!auth.require('system.data-admin.policy')) return
    const draft = drafts[policy.category]; if (!draft) return
    setBusy(true); setError('')
    try {
      let confirmationPlanId: string | undefined
      const oldMs = Number(policy.retention_value) * (policy.retention_unit === 'day' ? 86_400_000 : 3_600_000)
      const newMs = draft.retentionValue * (draft.retentionUnit === 'day' ? 86_400_000 : 3_600_000)
      if ((draft.enabled && !policy.enabled) || (draft.enabled && newMs < oldMs)) {
        const impact = await previewRetentionPolicy(account, policy.category, draft)
        if (!window.confirm(`政策將影響約 ${impact.preview.records} 筆資料。${impact.preview.impact}\n\n啟用或縮短保留期限後，排程會進行不可還原的刪除。是否儲存？`)) return
        confirmationPlanId = impact.planId
      }
      await saveRetentionPolicy(account, policy.category, { ...draft, confirmationPlanId }); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }

  return <div className="space-y-3 text-xs">
    <section className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><HardDrive size={16} />資料容量概況<button type="button" disabled={busy} onClick={() => void createQuickPreview(categories.map((item) => item.key))} className="ml-auto rounded bg-rose-700 px-3 py-1.5 text-white disabled:opacity-50"><Trash2 size={14} className="mr-1 inline" />全部清除</button><button type="button" onClick={() => void load()} className="text-sky-300">重新統計</button></div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="資料庫總容量" value={bytes(overview?.database.totalBytes)} note={overview?.database.includes ?? '包含表、索引與大型欄位'} />
        <Metric label="後端檔案系統" value={overview?.backendFilesystem.available ? `${bytes(overview.backendFilesystem.freeBytes)} 可用／${bytes(overview.backendFilesystem.totalBytes)}` : '無法取得'} note={overview?.backendFilesystem.note ?? '不是瀏覽器磁碟'} />
        <Metric label="PostgreSQL 資料卷" value="無法取得" note={overview?.databaseVolume.note ?? '不以其他磁碟冒充'} />
      </div>
      <div className="mt-2 overflow-auto"><table className="w-full text-left"><thead className="text-zinc-500"><tr><th>類別</th><th>容量</th><th>估算筆數</th><th className="text-right">操作</th></tr></thead><tbody>{overview?.categories.map((item) => <tr key={item.category} className="border-t border-zinc-800"><td className="py-2">{item.label}</td><td>{bytes(item.totalBytes)}</td><td>約 {item.estimatedRows.toLocaleString()}</td><td className="text-right"><button type="button" disabled={busy} onClick={() => void createQuickPreview([item.category])} className="rounded border border-rose-700 px-2 py-1 text-rose-300 disabled:opacity-50">快速清除</button></td></tr>)}</tbody></table></div>
      <div className="mt-2 text-zinc-500">最後統計：{date(overview?.collectedAt)}。{overview?.countSemantics}</div>
    </section>

    <section className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} />自動保留政策</div>
      <div className="space-y-2">{overview?.policies.map((policy) => { const draft = drafts[policy.category]; const info = categories.find((item) => item.key === policy.category); if (!draft) return null; return <div key={policy.category} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-2 rounded bg-black p-2">
        <div><strong>{info?.label ?? policy.category}</strong><div className="text-zinc-500">{policy.source === 'timescaledb_existing' ? policy.readOnlyReason : `最近成功 ${date(policy.last_success_at)}／下次 ${date(policy.next_run_at)}`}</div></div>
        <label><input type="checkbox" checked={draft.enabled} disabled={policy.source === 'timescaledb_existing'} onChange={(e) => setDrafts({ ...drafts, [policy.category]: { ...draft, enabled: e.target.checked } })} /> 啟用</label>
        <input aria-label={`${policy.category}保留數量`} type="number" min={1} value={draft.retentionValue} onChange={(e) => setDrafts({ ...drafts, [policy.category]: { ...draft, retentionValue: Number(e.target.value) } })} className="w-20 rounded border border-zinc-700 bg-zinc-900 p-1" />
        <select value={draft.retentionUnit} onChange={(e) => setDrafts({ ...drafts, [policy.category]: { ...draft, retentionUnit: e.target.value as 'hour' | 'day' } })} className="rounded border border-zinc-700 bg-zinc-900 p-1"><option value="hour">小時</option><option value="day">天</option></select>
        <label className="text-zinc-500">每 <input aria-label={`${policy.category}執行間隔`} type="number" min={15} value={draft.intervalMinutes} onChange={(e) => setDrafts({ ...drafts, [policy.category]: { ...draft, intervalMinutes: Number(e.target.value) } })} className="w-20 rounded border border-zinc-700 bg-zinc-900 p-1 text-zinc-200" /> 分鐘</label>
        <button type="button" disabled={busy || policy.source === 'timescaledb_existing'} onClick={() => void updatePolicy(policy)} className="rounded border border-sky-700 px-2 py-1 text-sky-300">儲存</button>
      </div>})}</div>
      <div className="mt-2 text-zinc-500">執行間隔目前由後端保存（預設每日）；新政策全部預設停用。既有 TimescaleDB 政策只顯示、不建立第二個排程。</div>
    </section>

    <section className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><History size={16} />清理執行紀錄</div>
      <div className="overflow-auto"><table className="w-full text-left"><thead className="text-zinc-500"><tr><th>工作 ID</th><th>類別</th><th>觸發</th><th>狀態</th><th>刪除筆數</th><th>開始／完成</th><th /></tr></thead><tbody>{jobs.map((job) => <tr key={job.id} className="border-t border-zinc-800"><td className="py-2 font-mono">{job.id.slice(0, 8)}</td><td>{categories.find((c) => c.key === job.category)?.label ?? job.category}</td><td>{job.trigger === 'policy' ? '自動政策' : '手動'}</td><td>{job.status}{job.error ? `：${job.error}` : ''}</td><td>{job.deleted_count}</td><td>{date(job.started_at)}／{date(job.finished_at)}</td><td>{['queued','running'].includes(job.status) && <button type="button" onClick={() => auth.require('system.data-admin.cleanup') && void stopCleanupJob(account, job.id).then(load)} className="text-amber-300">停止</button>}</td></tr>)}</tbody></table>{jobs.length === 0 && <div className="py-3 text-zinc-500">尚無清理紀錄</div>}</div>
    </section>
    {error && <div role="alert" className="rounded border border-rose-800 bg-rose-950/50 p-2 text-rose-200">{error}</div>}
    {confirming && previews.length > 0 && <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/70 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"><h3 className="text-lg font-semibold text-rose-300">確認不可還原的資料清除</h3><div className="mt-3 space-y-3 text-sm text-zinc-300"><p>將清除下列區塊目前可安全清理的全部歷史資料：</p>{previews.map((preview) => <div key={preview.planId} className="rounded bg-zinc-900 p-2"><strong>{preview.preview.categoryLabel}</strong>：預計 {preview.preview.records.toLocaleString()} 筆<div className="mt-1 text-xs text-zinc-500">保護／排除：{preview.preview.protected.join('、')}</div></div>)}<p className="text-amber-300">此操作無法還原。執行時仍會重新檢查權限、進行中資料與其他保護狀態。</p></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setConfirming(false); setPreviews([]) }} className="rounded px-3 py-2">取消</button><button type="button" disabled={busy} onClick={() => void runCleanup()} className="rounded bg-rose-700 px-3 py-2 text-white">確認清除</button></div></div></div>}
  </div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded bg-black p-2"><div className="text-zinc-500">{label}</div><div className="my-1 text-sm font-semibold">{value}</div><div className="text-[10px] text-zinc-600">{note}</div></div> }
