import { useEffect, useState } from 'react'
import { HardDrive, History, Trash2 } from 'lucide-react'
import { useAuth } from '../../access-control/AuthContext'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import {
  executeCleanupPlan, fetchCleanupCategories, fetchCleanupJobs, fetchRetentionOverview,
  previewCleanup, stopCleanupJob,
  type CleanupCategory, type CleanupJob, type CleanupPreview, type RetentionOverview,
} from '../api/dataAdminApi'
import { Button, Dialog } from '../../../components/ui';

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

  async function load() {
    try {
      const [nextOverview, nextCategories, nextJobs] = await Promise.all([fetchRetentionOverview(account), fetchCleanupCategories(account), fetchCleanupJobs(account)])
      setOverview(nextOverview); setCategories(nextCategories); setJobs(nextJobs)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const hasActiveJobs = jobs.some((job) => ['queued', 'running'].includes(job.status))
  useEffect(() => {
    if (!hasActiveJobs) return
    const timer = window.setInterval(() => {
      void fetchCleanupJobs(account).then((nextJobs) => {
        setJobs(nextJobs)
        if (!nextJobs.some((job) => ['queued', 'running'].includes(job.status))) void load()
      }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
    }, 750)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs]) // eslint-disable-line react-hooks/exhaustive-deps

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
  return <div className="space-y-3 text-body-xs">
    <section className="rounded border border-border-quaternary bg-surface-primary p-3">
      <div className="mb-3 flex items-center gap-2 text-body-s-bold"><HardDrive size={16} />資料容量概況<Button hierarchy="danger" className="ml-auto" disabled={busy || hasActiveJobs} onPress={() => void createQuickPreview(categories.map((item) => item.key))} leadingIcon={<Trash2 />}>全部清除</Button><Button variant="text" onPress={() => void load()}>重新統計</Button></div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="資料庫總容量" value={bytes(overview?.database.totalBytes)} note={overview?.database.includes ?? '包含表、索引與大型欄位'} />
        <Metric label="後端檔案系統" value={overview?.backendFilesystem.available ? `${bytes(overview.backendFilesystem.freeBytes)} 可用／${bytes(overview.backendFilesystem.totalBytes)}` : '無法取得'} note={overview?.backendFilesystem.note ?? '不是瀏覽器磁碟'} />
        <Metric label="PostgreSQL 資料卷" value="無法取得" note={overview?.databaseVolume.note ?? '不以其他磁碟冒充'} />
      </div>
      <div className="mt-2 overflow-auto"><table className="t3-table w-full text-left"><thead className="text-text-quaternary"><tr><th>類別</th><th>容量</th><th>估算筆數</th><th className="text-right">操作</th></tr></thead><tbody>{overview?.categories.map((item) => {
        const job = jobs.find((candidate) => candidate.category === item.category && ['queued', 'running'].includes(candidate.status))
        const deleted = Number(job?.deleted_count ?? 0); const expected = Math.max(Number(job?.expected_count ?? 0), deleted)
        const progress = expected > 0 ? Math.min(100, Math.round(deleted / expected * 100)) : 0
        return <tr key={item.category} className="border-t border-border-quaternary"><td className="py-2"><div>{item.label}</div>{job && <div className="mt-1 w-64 max-w-full"><div className="h-1.5 overflow-hidden rounded bg-link-standard-hover"><div className="h-full bg-link-theme-filled transition-[width] duration-300" style={{ width: `${progress}%` }} /></div><div className="mt-1 text-caption-2 text-text-theme">{job.status === 'queued' ? '排隊中' : `清理中 ${progress}%`} · 已清除 {deleted.toLocaleString()}／預計 {expected.toLocaleString()} 筆</div></div>}</td><td>{bytes(item.totalBytes)}</td><td>{job ? `約 ${Math.max(expected - deleted, 0).toLocaleString()} 筆待清理` : `約 ${item.estimatedRows.toLocaleString()}`}</td><td className="text-right">{job ? <span className="text-text-theme">{progress}%</span> : <Button hierarchy="danger" variant="outlined" disabled={busy} onPress={() => void createQuickPreview([item.category])}>快速清除</Button>}</td></tr>
      })}</tbody></table></div>
      <div className="mt-2 text-text-quaternary">最後統計：{date(overview?.collectedAt)}。{overview?.countSemantics}</div>
    </section>

    <p className="text-text-quaternary">自動保存天數已移到「系統基礎設定 › 資料保存天數」。</p>

    <section className="rounded border border-border-quaternary bg-surface-primary p-3">
      <div className="mb-2 flex items-center gap-2 text-body-s-bold"><History size={16} />清理執行紀錄</div>
      <div className="overflow-auto"><table className="t3-table w-full text-left"><thead className="text-text-quaternary"><tr><th>工作 ID</th><th>類別</th><th>觸發</th><th>狀態</th><th>刪除筆數</th><th>開始／完成</th><th /></tr></thead><tbody>{jobs.map((job) => <tr key={job.id} className="border-t border-border-quaternary"><td className="py-2 font-mono">{job.id.slice(0, 8)}</td><td>{categories.find((c) => c.key === job.category)?.label ?? job.category}</td><td>{job.trigger === 'policy' ? '自動政策' : '手動'}</td><td>{job.status}{job.error ? `：${job.error}` : ''}</td><td>{job.deleted_count}</td><td>{date(job.started_at)}／{date(job.finished_at)}</td><td>{['queued','running'].includes(job.status) && <Button hierarchy="danger" variant="text" onPress={() => auth.require('system.data-admin.cleanup') && void stopCleanupJob(account, job.id).then(load)}>停止</Button>}</td></tr>)}</tbody></table>{jobs.length === 0 && <div className="py-3 text-text-quaternary">尚無清理紀錄</div>}</div>
    </section>
    {error && <div role="alert" className="rounded border border-border-danger-light bg-status-error-light p-2 text-status-error-emphasis">{error}</div>}
    {confirming && previews.length > 0 && (
      <Dialog
        role="alertdialog"
        size="lg"
        title={<span className="text-status-error-emphasis">確認不可還原的資料清除</span>}
        busy={busy}
        onClose={() => { setConfirming(false); setPreviews([]) }}
        footer={<>
          <Button hierarchy="subordinate" variant="tonal" onPress={() => { setConfirming(false); setPreviews([]) }}>取消</Button>
          <Button hierarchy="danger" disabled={busy} onPress={() => void runCleanup()}>確認清除</Button>
        </>}
      >
        <div className="space-y-3">
          <p>將清除下列區塊目前可安全清理的全部歷史資料：</p>
          {previews.map((preview) => <div key={preview.planId} className="rounded bg-surface-secondary p-2"><strong>{preview.preview.categoryLabel}</strong>：預計 {preview.preview.records.toLocaleString()} 筆<div className="mt-1 text-body-xs text-text-quaternary">保護／排除：{preview.preview.protected.join('、')}</div></div>)}
          <p className="text-status-warning">此操作無法還原。執行時仍會重新檢查權限、進行中資料與其他保護狀態。</p>
        </div>
      </Dialog>
    )}
  </div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded bg-surface-sub-background p-2"><div className="text-text-quaternary">{label}</div><div className="my-1 text-body-s-bold">{value}</div><div className="text-caption-2 text-text-disabled">{note}</div></div> }
