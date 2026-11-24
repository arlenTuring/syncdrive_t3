import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../access-control/AuthContext'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import { HelpTip } from '../../shift-list/components/HelpTip'
import {
  checkBackupDir, deleteBackup, fetchBackupStatus, saveBackupSettings, startBackup, stopBackup,
  type BackupLocation, type BackupRun, type BackupSettingsValue, type BackupStatus,
} from '../api/dataAdminApi'
import { systemConfirm } from '../../../lib/systemDialog'
import { Button, Checkbox, Switch, fieldClass, InputNumber } from '../../../components/ui';

const POLL_MS = 3_000
const OVERDUE_MS = 2 * 86_400_000

const date = (value?: number | string | null) => (value == null ? '—' : new Date(Number(value)).toLocaleString('zh-TW'))
const size = (bytes?: number | string | null) => {
  if (bytes == null) return '—'
  const value = Number(bytes)
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`
  return `${Math.ceil(value / 1e3)} KB`
}
const duration = (run: BackupRun) => {
  if (run.finished_at == null) return ''
  const seconds = Math.round((Number(run.finished_at) - Number(run.started_at)) / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}
const STATUS_LABEL: Record<BackupRun['status'], string> = { running: '備份中', success: '成功', failed: '失敗', stopped: '已停止' }

const sectionTitle = 'text-body-s-bold text-text-primary'
const card = 'space-y-3 rounded-lg border border-border-quaternary bg-surface-primary px-3 py-3 text-body-s'
const input = fieldClass({ size: 'sm' })

function LocationField({ label, value, disabled, onChange, onCheck, result }: {
  label: string; value: string; disabled: boolean; onChange: (value: string) => void; onCheck: () => void; result?: BackupLocation | string
}) {
  return (
    <div>
      <div className="mb-1 text-body-xs text-text-tertiary">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${input} min-w-[260px] flex-1 font-mono text-body-xs`} />
        <Button hierarchy="subordinate" variant="outlined" disabled={disabled} onPress={onCheck}>檢查位置</Button>
      </div>
      {typeof result === 'string' ? <p role="alert" className="mt-1 text-body-xs text-status-error-emphasis">{result}</p> : null}
      {result && typeof result !== 'string' ? (
        <p className="mt-1 text-body-xs text-text-tertiary">
          可寫入，剩餘 {size(result.freeBytes)}／共 {size(result.totalBytes)}
          {result.sameDiskAsSystem ? <span className="text-status-warning">。這裡與系統在同一顆磁碟，磁碟損壞時備份會一起遺失，建議改放 NAS 或獨立磁碟。</span> : null}
        </p>
      ) : null}
    </div>
  )
}

/**
 * 備份由後端寫到它看得到的位置，不是瀏覽器這台電腦。
 * 備份在背景跑，所以按下後靠輪詢更新進度，離開頁面也不會中斷。
 */
export function BackupSettings() {
  const auth = useAuth()
  const [account] = useDemoAccount()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [draft, setDraft] = useState<BackupSettingsValue | null>(null)
  const [locations, setLocations] = useState<{ manualDir?: BackupLocation | string; autoDir?: BackupLocation | string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const running = status?.runs.find((run) => run.status === 'running')
  const adopt = useCallback((next: BackupStatus) => {
    setStatus(next)
    setDraft({ manualDir: next.settings.manualDir, autoDir: next.settings.autoDir, autoEnabled: next.settings.autoEnabled, autoTime: next.settings.autoTime, keepCount: next.settings.keepCount, includeFiles: next.settings.includeFiles })
  }, [])
  const report = (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))

  useEffect(() => {
    fetchBackupStatus(account).then(adopt).catch(report)
  }, [account, adopt])

  // 只更新紀錄，不動使用者正在編輯的欄位
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { fetchBackupStatus(account).then(setStatus).catch(report) }, POLL_MS)
    return () => clearInterval(timer)
  }, [account, running])

  const dirty = !!status && !!draft && (Object.keys(draft) as Array<keyof BackupSettingsValue>).some((key) => draft[key] !== status.settings[key])
  const update = (patch: Partial<BackupSettingsValue>) => setDraft((current) => (current ? { ...current, ...patch } : current))

  async function act(work: () => Promise<void>) {
    setBusy(true); setError('')
    try { await work() } catch (caught) { report(caught) } finally { setBusy(false) }
  }

  const save = () => {
    if (!draft || !auth.require('system.data-admin.policy')) return
    return act(async () => adopt(await saveBackupSettings(account, draft)))
  }

  async function checkLocation(key: 'manualDir' | 'autoDir') {
    if (!draft || !auth.require('system.data-admin.policy')) return
    try {
      const result = await checkBackupDir(account, draft[key])
      setLocations((current) => ({ ...current, [key]: result }))
    } catch (caught) {
      setLocations((current) => ({ ...current, [key]: caught instanceof Error ? caught.message : String(caught) }))
    }
  }

  // 位置改了還沒存時先存，否則按下去會備份到舊位置
  const backupNow = () => {
    if (!draft || !auth.require('system.data-admin.policy')) return
    return act(async () => {
      if (dirty) adopt(await saveBackupSettings(account, draft))
      await startBackup(account)
      setStatus(await fetchBackupStatus(account))
    })
  }

  const stop = (run: BackupRun) => {
    if (!auth.require('system.data-admin.policy')) return
    return act(async () => {
      await stopBackup(account, run.id)
      setStatus(await fetchBackupStatus(account))
    })
  }

  const remove = async (run: BackupRun) => {
    if (!auth.require('system.data-admin.cleanup')) return
    if (!(await systemConfirm(`刪除 ${run.name}？檔案會永久移除，無法復原。`, { tone: 'danger' }))) return
    return act(async () => {
      await deleteBackup(account, run.id)
      setStatus(await fetchBackupStatus(account))
    })
  }

  if (!status || !draft) return error ? <p role="alert" className="text-body-xs text-status-error-emphasis">{error}</p> : <p className="text-body-xs text-text-quaternary">載入中…</p>

  const lastSuccess = status.runs.find((run) => run.status === 'success')
  const lastAuto = status.runs.find((run) => run.trigger === 'auto' && run.status === 'success')
  const overdue = status.settings.autoEnabled && (!lastAuto || Date.now() - Number(lastAuto.started_at) > OVERDUE_MS) && status.runs.some((run) => run.trigger === 'auto')

  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="text-body-xs text-status-error-emphasis">{error}</p> : null}
      {!status.tools.available ? <p role="alert" className="text-body-xs text-status-error-emphasis">後端找不到 PostgreSQL 備份工具，目前無法備份：{status.tools.error}</p> : null}
      {overdue ? <p role="alert" className="text-body-xs text-status-warning">自動備份已開啟，但超過兩天沒有成功的自動備份，請查看下方紀錄。</p> : null}

      <section className="space-y-2">
        <h3 className={sectionTitle}>目前狀態</h3>
        <div className={`${card} grid gap-2 sm:grid-cols-3`}>
          <div><div className="text-body-xs text-text-quaternary">最近成功備份</div><div className="text-text-primary">{date(lastSuccess?.started_at)}</div></div>
          <div><div className="text-body-xs text-text-quaternary">下次自動備份</div><div className="text-text-primary">{status.settings.autoEnabled ? date(status.settings.nextRunAt) : '未開啟'}</div></div>
          <div><div className="text-body-xs text-text-quaternary">資料庫大小</div><div className="text-text-primary">{size(status.databaseBytes)}</div></div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={sectionTitle}>立即備份</h3>
        <div className={card}>
          <LocationField label="手動備份儲存位置（後端主機上的路徑）" value={draft.manualDir} disabled={busy} onChange={(manualDir) => update({ manualDir })} onCheck={() => void checkLocation('manualDir')} result={locations.manualDir} />
          <div className="flex items-center gap-3">
            <Button variant="outlined" disabled={busy || !!running || !status.tools.available} onPress={() => void backupNow()}>立即備份</Button>
            {running ? <span className="text-text-theme">備份中，可離開此頁</span> : <span className="text-body-xs text-text-quaternary">系統可照常運作；資料庫備份不需停機。</span>}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={sectionTitle}>自動備份</h3>
        <div className={card}>
          <label className="flex items-center gap-2 text-text-secondary">
            <Switch checked={draft.autoEnabled} aria-label="開啟自動備份" onCheckedChange={(autoEnabled) => update({ autoEnabled })} />
            開啟自動備份
          </label>
          {draft.autoEnabled ? (
            <>
              <LocationField label="自動備份儲存位置（後端主機上的路徑）" value={draft.autoDir} disabled={busy} onChange={(autoDir) => update({ autoDir })} onCheck={() => void checkLocation('autoDir')} result={locations.autoDir} />
              <div className="flex flex-wrap items-center gap-5 text-text-tertiary">
                <label>每天<input aria-label="自動備份時間" type="time" value={draft.autoTime} onChange={(e) => update({ autoTime: e.target.value })} className={`${input} mx-1.5`} />執行</label>
                <span className="inline-flex items-center gap-1.5">
                  <label>保留最近<InputNumber ariaLabel="自動備份保留天數" min={1} max={365} value={draft.keepCount} onChange={(next) => update({ keepCount: next ?? 1 })} fluid={false} className="mx-1.5 inline-block w-24 align-middle" />天</label>
                  <HelpTip label="保留天數說明" widthClass="w-72">
                    每天備份一份全部資料。設 {draft.keepCount} 天就能退回最近 {draft.keepCount} 天任一天當時的狀態。超過時，新備份成功後才刪最舊的一份，備份失敗不會刪。手動備份不算在內，也不會自動刪除。
                  </HelpTip>
                </span>
              </div>
              <p className="text-body-xs text-text-quaternary">備份失敗時會寫入事件管理。</p>
            </>
          ) : <p className="text-body-xs text-text-quaternary">目前不會自動備份，只有按「立即備份」或部署時才有備份。</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={sectionTitle}>備份內容</h3>
        <div className={card}>
          <Checkbox label="包含圖資、媒體與金鑰檔" labelClassName="text-body-s text-text-secondary" checked={draft.includeFiles} onCheckedChange={(includeFiles) => update({ includeFiles })} />
          <p className="text-body-xs text-text-quaternary">資料庫一律備份。圖資不在資料庫內，取消勾選後只靠這份備份無法完整還原。監控錄影不進備份。備份含帳號與金鑰資料，請管好存放位置的權限。</p>
        </div>
      </section>

      <div className="flex justify-end">
        <Button disabled={busy || !dirty} onPress={() => void save()}>儲存設定</Button>
      </div>

      <section className="space-y-2">
        <h3 className={sectionTitle}>備份紀錄</h3>
        <div className="overflow-auto rounded-lg border border-border-quaternary bg-surface-primary px-3 py-2 text-body-xs">
          <table className="t3-table w-full text-left text-text-secondary">
            <thead className="text-text-quaternary"><tr><th className="py-1 font-normal">開始時間</th><th className="font-normal">方式</th><th className="font-normal">狀態</th><th className="font-normal">大小</th><th className="font-normal">位置</th><th /></tr></thead>
            <tbody>
              {status.runs.map((run) => (
                <tr key={run.id} className="border-t border-border-quaternary align-top">
                  <td className="py-1.5 whitespace-nowrap pr-3">{date(run.started_at)}</td>
                  <td className="whitespace-nowrap pr-3">{run.trigger === 'auto' ? '自動' : '手動'}</td>
                  <td className="pr-3">
                    <span className={run.status === 'success' ? 'text-status-success' : run.status === 'failed' ? 'text-status-error-emphasis' : 'text-text-secondary'}>{STATUS_LABEL[run.status]}</span>
                    {run.status === 'success' ? ` ${run.verified ? '已驗證可讀取' : ''} ${duration(run)}` : ''}
                    {run.files_exist === false ? <div className="text-status-warning">檔案已不在此位置</div> : null}
                    {run.error ? <div className="text-text-quaternary">{run.error}</div> : null}
                  </td>
                  <td className="whitespace-nowrap pr-3">{size(run.database_bytes == null ? null : Number(run.database_bytes) + Number(run.files_bytes ?? 0))}</td>
                  <td className="break-all pr-3 font-mono">{run.dir}/{run.name}</td>
                  <td className="whitespace-nowrap">
                    {run.status === 'running'
                      ? <Button hierarchy="danger" variant="text" disabled={busy} onPress={() => void stop(run)}>停止</Button>
                      : <Button hierarchy="danger" variant="text" disabled={busy} onPress={() => void remove(run)}>刪除</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {status.runs.length === 0 ? <div className="py-3 text-text-quaternary">尚無備份紀錄</div> : null}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={sectionTitle}>還原</h3>
        <div className={`${card} text-text-tertiary`}>
          還原會覆蓋現有資料且必須停機，所以不在頁面上提供按鈕，請由維運人員依 deploy/README.md 的「從系統備份還原」操作。
        </div>
      </section>
    </div>
  )
}
