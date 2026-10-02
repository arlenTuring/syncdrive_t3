import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Play, RefreshCw, Square } from 'lucide-react'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import {
  cancelDataAdminSql,
  executeDataAdminSql,
  fetchDataAdminMetadata,
  fetchDataAdminSample,
  fetchOrderCleanupPreview,
  fetchLiveResetPreview,
  executeLiveReset,
  resumeLiveReset,
  type LiveResetPreview,
  type LiveResetResult,
  type OrderCleanupPreview,
  type DataAdminMetadata,
  type DataAdminResult,
} from '../api/dataAdminApi'
import { CLEAR_ALL_ORDERS_SQL } from '../dataAdminTemplates'

const TABLE_PURPOSE: Record<string, string> = {
  operation_orders: '已建立的營運訂單',
  order_events: '訂單事件與處理狀態',
  order_action_states: '訂單站點動作狀態',
  operation_shifts: '已保存班表',
  time_templates: '時間模板',
  operation_routes: '營運路線設定',
  telemetry_logs: '車輛遙測時序紀錄',
  maps: '地圖主檔',
  map_versions: '地圖版本',
  data_sources: '儀表板共用資料來源',
}

function displayValue(value: unknown): string {
  if (value == null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function DataManagementPanel() {
  const [account] = useDemoAccount()
  const [metadata, setMetadata] = useState<DataAdminMetadata | null>(null)
  const [selected, setSelected] = useState<{ schema: string; table: string } | null>(null)
  const [sql, setSql] = useState('SELECT * FROM operation_orders ORDER BY created_at DESC')
  const [mode, setMode] = useState<'read' | 'write'>('read')
  const [result, setResult] = useState<DataAdminResult | null>(null)
  const [resultView, setResultView] = useState<'table' | 'json'>('table')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeRequestId, setActiveRequestId] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [cleanupPreview, setCleanupPreview] = useState<OrderCleanupPreview | null>(null)
  const [liveResetPreview, setLiveResetPreview] = useState<LiveResetPreview | null>(null)
  const [liveResetResult, setLiveResetResult] = useState<LiveResetResult | null>(null)
  const [liveResetScope, setLiveResetScope] = useState('')

  const loadMetadata = useCallback(async () => {
    setError('')
    try {
      setMetadata(await fetchDataAdminMetadata(account))
    } catch (caught) {
      setMetadata(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [account])

  useEffect(() => {
    void loadMetadata()
  }, [loadMetadata])

  const groupedTables = useMemo(() => {
    const groups = new Map<string, DataAdminMetadata['tables']>()
    metadata?.tables.filter((table) => {
      const query = tableSearch.trim().toLowerCase()
      return !query || `${table.name} ${TABLE_PURPOSE[table.name] ?? ''}`.toLowerCase().includes(query)
    }).forEach((table) => {
      groups.set(table.schema, [...(groups.get(table.schema) ?? []), table])
    })
    return [...groups.entries()]
  }, [metadata, tableSearch])

  const selectedColumns = useMemo(
    () => metadata?.columns.filter((column) => column.schema === selected?.schema && column.table === selected.table) ?? [],
    [metadata, selected],
  )

  async function generateOrderCleanupSql() {
    setSql(CLEAR_ALL_ORDERS_SQL)
    setMode('write')
    setResult(null)
    setError('')
    try {
      setCleanupPreview(await fetchOrderCleanupPreview(account))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function previewLiveReset() {
    setError('')
    try {
      const preview = await fetchLiveResetPreview(account)
      setLiveResetPreview(preview)
      setLiveResetScope(preview.vehicleCodes.join(', '))
      setSql(preview.sql)
      setMode('write')
      setResult(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function resetScope(): string[] {
    return [...new Set(liveResetScope.split(',').map((code) => code.trim()).filter(Boolean))]
  }

  async function runLiveReset() {
    if (!window.confirm('將依預覽分步清除所選範圍的即時測試資料，並保持來源暫停。是否繼續？')) return
    setLoading(true)
    setError('')
    try {
      setLiveResetResult(await executeLiveReset(account, resetScope()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  async function resumeLiveInputs() {
    setError('')
    try {
      setLiveResetResult(await resumeLiveReset(account, resetScope()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function openTable(schema: string, table: string) {
    setSelected({ schema, table })
    setSql(`SELECT * FROM "${schema}"."${table}"`)
    setMode('read')
    setError('')
    try {
      setResult(await fetchDataAdminSample(account, schema, table))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function execute() {
    if (mode === 'write' && !window.confirm('即將執行資料寫入。失敗時會回滾整筆交易，是否繼續？')) return
    const requestId = crypto.randomUUID()
    setActiveRequestId(requestId)
    setLoading(true)
    setError('')
    try {
      setResult(await executeDataAdminSql(account, { sql, mode, requestId }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
      setActiveRequestId('')
    }
  }

  async function cancel() {
    if (!activeRequestId) return
    try {
      await cancelDataAdminSql(account, activeRequestId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  if (account.id !== 'supervisor') {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-amber-300">
        資料管理介面僅限主管帳號使用。
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] bg-zinc-950 text-zinc-200">
      <aside className="min-h-0 overflow-auto border-r border-zinc-800 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Database size={15} />資料庫結構</div>
          <button type="button" aria-label="重新整理資料庫結構" onClick={() => void loadMetadata()} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><RefreshCw size={14} /></button>
        </div>
        {metadata && (
          <select aria-label="資料庫環境" className="mb-3 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs" value="current" onChange={() => undefined}>
            <option value="current">{metadata.environment.database}@{metadata.environment.host}:{metadata.environment.port}</option>
          </select>
        )}
        <input aria-label="搜尋資料表" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="搜尋資料表或用途" className="mb-3 w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-xs outline-none focus:border-sky-500" />
        {groupedTables.map(([schema, tables]) => (
          <div key={schema} className="mb-3">
            <div className="mb-1 text-xs font-semibold text-sky-300">{schema}</div>
            {tables.map((table) => (
              <button key={table.name} type="button" onClick={() => void openTable(schema, table.name)} className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${selected?.schema === schema && selected.table === table.name ? 'bg-sky-950 text-sky-200' : 'text-zinc-400 hover:bg-zinc-900'}`}>
                <span>{table.name} <span className="text-zinc-600">~{table.estimated_rows}</span></span>
                <span className="block truncate text-[10px] text-zinc-600">{TABLE_PURPOSE[table.name] ?? '資料表'}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-h-0 flex-col gap-3 p-3">
        <div className="grid shrink-0 grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">環境：{metadata?.environment.host === '127.0.0.1' || metadata?.environment.host === 'localhost' ? '本機' : '遠端'}／{metadata?.environment.type ?? '—'}</div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">資料庫：{metadata?.environment.database ?? '—'}</div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">Schema：{selected?.schema ?? metadata?.environment.schema ?? '—'}</div>
        </div>
        {selected && (
          <div className="max-h-28 shrink-0 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-xs">
            <div className="mb-1 flex items-center"><strong>{selected.schema}.{selected.table}</strong><button type="button" onClick={() => setSql(`SELECT * FROM \"${selected.schema}\".\"${selected.table}\"`)} className="ml-auto text-sky-300">產生查詢 SQL</button></div>
            <div className="flex flex-wrap gap-1">{selectedColumns.map((column) => {
              const constraints = metadata?.constraints.filter((item) => item.schema === selected.schema && item.table === selected.table && item.column === column.name) ?? []
              const key = constraints.some((item) => item.type === 'PRIMARY KEY') ? ' PK' : constraints.some((item) => item.type === 'FOREIGN KEY') ? ' FK' : ''
              return <span key={column.name} className="rounded bg-black px-1.5 py-1 text-zinc-400">{column.name}: {column.type}{key}{column.nullable ? ' 可空' : ' 必填'}</span>
            })}</div>
          </div>
        )}
        <div className="shrink-0 rounded border border-zinc-800 bg-black">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2">
            <button type="button" onClick={() => setMode('read')} className={`rounded px-2 py-1 text-xs ${mode === 'read' ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>SELECT／唯讀</button>
            <button type="button" onClick={() => setMode('write')} className={`rounded px-2 py-1 text-xs ${mode === 'write' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>INSERT／UPDATE／DELETE</button>
            <button type="button" onClick={() => void generateOrderCleanupSql()} className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300">清除所有訂單 SQL 範本（只填入）</button>
            <div className="flex-1" />
            {loading ? (
              <button type="button" onClick={() => void cancel()} className="flex items-center gap-1 rounded bg-rose-700 px-3 py-1 text-xs text-white"><Square size={12} />取消</button>
            ) : (
              <button type="button" onClick={() => void execute()} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs text-white"><Play size={12} />執行</button>
            )}
          </div>
          <textarea aria-label="SQL 編輯器" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} className="h-32 w-full resize-y bg-black p-3 font-mono text-xs text-emerald-200 outline-none" />
        </div>
        {cleanupPreview && mode === 'write' && sql === CLEAR_ALL_ORDERS_SQL && (
          <div className="shrink-0 rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
            待清除：{cleanupPreview.statusCounts.map((item) => `${item.status} ${item.count}`).join('、') || '0 筆'}；關聯列：{Object.entries(cleanupPreview.relatedCounts).map(([name, count]) => `${name} ${count}`).join('、')}。保留班表、模板、路線、地圖、車輛、帳號與儀表板設定。
          </div>
        )}
        <div className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
          <div className="flex items-center gap-2"><strong>重置即時測試資料</strong><button type="button" onClick={() => void previewLiveReset()} className="rounded border border-sky-800 px-2 py-1 text-sky-300">產生預覽與 SQL</button>{liveResetPreview && <><button type="button" disabled={loading} onClick={() => void runLiveReset()} className="rounded border border-rose-800 px-2 py-1 text-rose-300">執行分步重置</button><button type="button" onClick={() => void resumeLiveInputs()} className="rounded border border-emerald-800 px-2 py-1 text-emerald-300">恢復接收</button></>}</div>
          {liveResetPreview && <div className="mt-2 space-y-1 text-zinc-400"><label className="block">車輛範圍<input value={liveResetScope} onChange={(event) => setLiveResetScope(event.target.value)} className="ml-2 w-2/3 rounded border border-zinc-700 bg-black px-2 py-1" /></label><div>非 SQL 操作：{liveResetPreview.actions.join(' → ')}</div><div>Redis：{liveResetPreview.redisKeys.length} 個明確 key；Broker Topic：{liveResetPreview.mqttTopics.length} 個（未確認 retained 時不清除）</div><div className="text-amber-300">{liveResetPreview.warnings.join('；')}</div><div>保留：{liveResetPreview.preserved.join('、')}</div></div>}
          {liveResetResult?.steps && <div className="mt-2 space-y-1">{liveResetResult.steps.map((step) => <div key={step.id} className={step.status === 'failed' ? 'text-rose-300' : step.status === 'skipped' ? 'text-amber-300' : 'text-emerald-300'}>{step.id}：{step.status} — {step.detail}</div>)}</div>}
          {liveResetResult?.resumed && <div className="mt-2 text-emerald-300">{liveResetResult.note}</div>}
        </div>
        {error && <div role="alert" className="shrink-0 rounded border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-zinc-800 bg-black">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2 py-2 text-xs">
            <button type="button" onClick={() => setResultView('table')} className={resultView === 'table' ? 'text-sky-300' : 'text-zinc-500'}>表格</button>
            <button type="button" onClick={() => setResultView('json')} className={resultView === 'json' ? 'text-sky-300' : 'text-zinc-500'}>JSON</button>
            <span className="ml-auto text-zinc-500">{result ? `${result.rowCount} 列／影響 ${result.affected ?? result.rowCount} 筆／${result.durationMs ?? 0} ms${result.truncated ? '（已達上限）' : ''}` : '尚未執行'}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {resultView === 'json' ? (
              <pre className="p-3 text-xs text-zinc-300">{JSON.stringify(result?.rows ?? [], null, 2)}</pre>
            ) : result?.columns.length ? (
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-zinc-900"><tr>{result.columns.map((column) => <th key={column} className="border-b border-r border-zinc-800 px-2 py-1.5 text-left font-medium text-zinc-300">{column}</th>)}</tr></thead>
                <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column} className="max-w-72 truncate border-b border-r border-zinc-900 px-2 py-1 text-zinc-400" title={displayValue(row[column])}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
              </table>
            ) : <div className="p-4 text-xs text-zinc-600">沒有結果資料</div>}
          </div>
        </div>
      </section>
    </div>
  )
}
