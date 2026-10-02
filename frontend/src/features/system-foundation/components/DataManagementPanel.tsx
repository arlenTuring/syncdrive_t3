import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Play, RefreshCw, Square } from 'lucide-react'
import { useDemoAccount } from '../../schedule-management/utils/demoAccountPreference'
import {
  cancelDataAdminSql,
  executeDataAdminSql,
  fetchDataAdminMetadata,
  fetchDataAdminSample,
  type DataAdminMetadata,
  type DataAdminResult,
} from '../api/dataAdminApi'
import { CLEAR_ALL_ORDERS_SQL } from '../dataAdminTemplates'

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
    metadata?.tables.forEach((table) => {
      groups.set(table.schema, [...(groups.get(table.schema) ?? []), table])
    })
    return [...groups.entries()]
  }, [metadata])

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
        {groupedTables.map(([schema, tables]) => (
          <div key={schema} className="mb-3">
            <div className="mb-1 text-xs font-semibold text-sky-300">{schema}</div>
            {tables.map((table) => (
              <button key={table.name} type="button" onClick={() => void openTable(schema, table.name)} className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${selected?.schema === schema && selected.table === table.name ? 'bg-sky-950 text-sky-200' : 'text-zinc-400 hover:bg-zinc-900'}`}>
                {table.name} <span className="text-zinc-600">~{table.estimated_rows}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-h-0 flex-col gap-3 p-3">
        <div className="grid shrink-0 grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">環境：{metadata?.environment.type ?? '—'}</div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">資料庫：{metadata?.environment.database ?? '—'}</div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-2">Schema：{selected?.schema ?? metadata?.environment.schema ?? '—'}</div>
        </div>
        <div className="shrink-0 rounded border border-zinc-800 bg-black">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2">
            <button type="button" onClick={() => setMode('read')} className={`rounded px-2 py-1 text-xs ${mode === 'read' ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>SELECT／唯讀</button>
            <button type="button" onClick={() => setMode('write')} className={`rounded px-2 py-1 text-xs ${mode === 'write' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>INSERT／UPDATE／DELETE</button>
            <button type="button" onClick={() => { setSql(CLEAR_ALL_ORDERS_SQL); setMode('write'); setResult(null); setError('') }} className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300">清除所有訂單 SQL 範本（只填入）</button>
            <div className="flex-1" />
            {loading ? (
              <button type="button" onClick={() => void cancel()} className="flex items-center gap-1 rounded bg-rose-700 px-3 py-1 text-xs text-white"><Square size={12} />取消</button>
            ) : (
              <button type="button" onClick={() => void execute()} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs text-white"><Play size={12} />執行</button>
            )}
          </div>
          <textarea aria-label="SQL 編輯器" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} className="h-32 w-full resize-y bg-black p-3 font-mono text-xs text-emerald-200 outline-none" />
        </div>
        {error && <div role="alert" className="shrink-0 rounded border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">{error}</div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-zinc-800 bg-black">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2 py-2 text-xs">
            <button type="button" onClick={() => setResultView('table')} className={resultView === 'table' ? 'text-sky-300' : 'text-zinc-500'}>表格</button>
            <button type="button" onClick={() => setResultView('json')} className={resultView === 'json' ? 'text-sky-300' : 'text-zinc-500'}>JSON</button>
            <span className="ml-auto text-zinc-500">{result ? `${result.rowCount} 列${result.truncated ? '（已達上限）' : ''}` : '尚未執行'}</span>
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
