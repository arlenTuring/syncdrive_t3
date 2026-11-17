import { SiteSelect } from '../../../components/SiteSelect';
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
import { DataRetentionPanel } from './DataRetentionPanel'
import { useAuth } from '../../access-control/AuthContext'
import { systemConfirm } from '../../../lib/systemDialog';
import { Button, IconButton, SegmentedControl } from '../../../components/ui';

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
  const auth = useAuth()
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function resetScope(): string[] {
    return [...new Set(liveResetScope.split(',').map((code) => code.trim()).filter(Boolean))]
  }

  async function runLiveReset() {
    if (!auth.require('system.data-admin.execute')) return
    if (!(await systemConfirm('將停用調度與即時寫入，並清除所選範圍的訂單、明細、遙測及快照；班表定義會保留。是否繼續？', { tone: 'danger' }))) return
    setLoading(true)
    setError('')
    setLiveResetResult(null)
    try {
      setLiveResetResult(await executeLiveReset(account, resetScope()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  async function resumeLiveInputs() {
    if (!auth.require('system.data-admin.execute')) return
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
    if (!auth.require('system.data-admin.execute')) return
    if (mode === 'write' && !(await systemConfirm('即將執行資料寫入。失敗時會回滾整筆交易，是否繼續？'))) return
    const requestId = crypto.randomUUID()
    setActiveRequestId(requestId)
    setLoading(true)
    setError('')
    setResult(null)
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
    if (!auth.require('system.data-admin.execute')) return
    if (!activeRequestId) return
    try {
      await cancelDataAdminSql(account, activeRequestId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  if (!auth.can('system.data-admin.view')) return <div className="flex h-full items-center justify-center p-8 text-body-s text-status-warning">權限不足</div>

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] bg-surface-sub-background text-text-primary">
      <aside className="min-h-0 overflow-auto border-r border-border-quaternary p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-body-s-bold"><Database size={15} />資料庫結構</div>
          <IconButton label="重新整理資料庫結構" size="small" hierarchy="subordinate" variant="standard" icon={<RefreshCw />} onPress={() => void loadMetadata()} />
        </div>
        {metadata && (
          <SiteSelect aria-label="資料庫環境" size="sm" className="mb-3 w-full" value="current" onChange={() => undefined}>
            <option value="current">{metadata.environment.database}@{metadata.environment.host}:{metadata.environment.port}</option>
          </SiteSelect>
        )}
        <input aria-label="搜尋資料表" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="搜尋資料表或用途" className="mb-3 w-full rounded border border-border-quaternary bg-surface-sub-background px-2 py-1.5 text-body-xs outline-none focus:border-border-theme" />
        {groupedTables.map(([schema, tables]) => (
          <div key={schema} className="mb-3">
            <div className="mb-1 text-body-xs-bold text-text-theme">{schema}</div>
            {tables.map((table) => (
              <button key={table.name} type="button" onClick={() => void openTable(schema, table.name)} className={`block w-full truncate rounded px-2 py-1 text-left text-body-xs ${selected?.schema === schema && selected.table === table.name ? 'bg-surface-theme text-text-theme' : 'text-text-tertiary hover:bg-link-standard'}`}>
                <span>{table.name} <span className="text-text-disabled">~{table.estimated_rows}</span></span>
                <span className="block truncate text-caption-2 text-text-disabled">{TABLE_PURPOSE[table.name] ?? '資料表'}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="min-h-0 space-y-3 overflow-auto p-3">
        <DataRetentionPanel />
        <details className="rounded border border-border-quaternary" open>
          <summary className="cursor-pointer bg-surface-primary px-3 py-2 text-body-s-bold">資料庫結構、查詢與即時資料重置（既有功能）</summary>
          <div className="flex min-h-[620px] flex-col gap-3 p-3">
        <div className="grid shrink-0 grid-cols-3 gap-2 text-body-xs">
          <div className="rounded border border-border-quaternary bg-surface-primary p-2">環境：{metadata?.environment.host === '127.0.0.1' || metadata?.environment.host === 'localhost' ? '本機' : '遠端'}／{metadata?.environment.type ?? '—'}</div>
          <div className="rounded border border-border-quaternary bg-surface-primary p-2">資料庫：{metadata?.environment.database ?? '—'}</div>
          <div className="rounded border border-border-quaternary bg-surface-primary p-2">Schema：{selected?.schema ?? metadata?.environment.schema ?? '—'}</div>
        </div>
        {selected && (
          <div className="max-h-28 shrink-0 overflow-auto rounded border border-border-quaternary bg-surface-primary p-2 text-body-xs">
            <div className="mb-1 flex items-center"><strong>{selected.schema}.{selected.table}</strong><Button variant="text" className="ml-auto" onPress={() => setSql(`SELECT * FROM \"${selected.schema}\".\"${selected.table}\"`)}>產生查詢 SQL</Button></div>
            <div className="flex flex-wrap gap-1">{selectedColumns.map((column) => {
              const constraints = metadata?.constraints.filter((item) => item.schema === selected.schema && item.table === selected.table && item.column === column.name) ?? []
              const key = constraints.some((item) => item.type === 'PRIMARY KEY') ? ' PK' : constraints.some((item) => item.type === 'FOREIGN KEY') ? ' FK' : ''
              return <span key={column.name} className="rounded bg-surface-sub-background px-1.5 py-1 text-text-tertiary">{column.name}: {column.type}{key}{column.nullable ? ' 可空' : ' 必填'}</span>
            })}</div>
          </div>
        )}
        <div className="shrink-0 rounded border border-border-quaternary bg-surface-sub-background">
          <div className="flex items-center gap-2 border-b border-border-quaternary px-2 py-2">
            <SegmentedControl label="SQL 模式" value={mode} onChange={setMode} options={[{ id: 'read' as const, label: 'SELECT／唯讀' }, { id: 'write' as const, label: 'INSERT／UPDATE／DELETE' }]} />
            <Button hierarchy="danger" variant="outlined" onPress={() => void generateOrderCleanupSql()}>清除所有訂單 SQL 範本（只填入）</Button>
            <div className="flex-1" />
            {loading ? (
              <Button hierarchy="danger" onPress={() => void cancel()} leadingIcon={<Square />}>取消</Button>
            ) : (
              <Button onPress={() => void execute()} leadingIcon={<Play />}>執行</Button>
            )}
          </div>
          <textarea aria-label="SQL 編輯器" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} className="h-32 w-full resize-y bg-surface-sub-background p-3 font-mono text-body-xs text-status-success outline-none" />
        </div>
        {cleanupPreview && mode === 'write' && sql === CLEAR_ALL_ORDERS_SQL && (
          <div className="shrink-0 rounded border border-status-warning-light bg-status-warning-light px-3 py-2 text-body-xs text-status-warning">
            待清除：{cleanupPreview.statusCounts.map((item) => `${item.status} ${item.count}`).join('、') || '0 筆'}；關聯列：{Object.entries(cleanupPreview.relatedCounts).map(([name, count]) => `${name} ${count}`).join('、')}。保留班表、模板、路線、地圖、車輛、帳號與儀表板設定。
          </div>
        )}
        <div className="shrink-0 rounded border border-border-quaternary bg-surface-primary px-3 py-2 text-body-xs">
          <div className="flex items-center gap-2"><strong>完整重置測試資料</strong><Button variant="outlined" onPress={() => void previewLiveReset()}>檢查作用範圍</Button>{liveResetPreview && <><Button hierarchy="danger" variant="outlined" disabled={loading} onPress={() => void runLiveReset()}>執行完整重置</Button><Button hierarchy="subordinate" variant="outlined" onPress={() => void resumeLiveInputs()}>只恢復 MQTT 接收</Button></>}</div>
          {liveResetPreview && <div className="mt-2 space-y-1 text-text-tertiary"><label className="block">車輛範圍<input value={liveResetScope} onChange={(event) => setLiveResetScope(event.target.value)} className="ml-2 w-2/3 rounded border border-border-quaternary bg-surface-sub-background px-2 py-1" /></label><div>完整重置步驟：{liveResetPreview.actions.join(' → ')}</div><div>Redis：{liveResetPreview.redisKeys.length} 個明確 key；Broker Topic：{liveResetPreview.mqttTopics.length} 個（未確認 retained 時不清除）</div><div className="text-status-warning">{liveResetPreview.warnings.join('；')}</div><div>保留：{liveResetPreview.preserved.join('、')}</div><details><summary className="cursor-pointer text-text-quaternary">查看單一交易 SQL</summary><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap bg-surface-sub-background p-2 text-caption-2 text-status-success">{liveResetPreview.sql}</pre></details></div>}
          {liveResetResult?.steps && <div className="mt-2 space-y-1"><div>{liveResetResult.operation}／{liveResetResult.status}／request ID：{liveResetResult.requestId}／資料庫：{liveResetResult.database?.committed ? '已提交' : liveResetResult.database?.rolledBack ? '已回滾' : '未提交'}／調度：{liveResetResult.dispatchPaused ? '已暫停' : '狀態未知'}</div>{liveResetResult.steps.map((step) => <div key={step.id} className={step.status === 'failed' ? 'text-status-error-emphasis' : step.status === 'skipped' || step.status === 'not_run' ? 'text-status-warning' : 'text-status-success'}>{step.id}：{step.status} — {step.detail}</div>)}</div>}
          {liveResetResult?.resumed && <div className="mt-2 text-status-success">{liveResetResult.note}</div>}
        </div>
        {error && <div role="alert" className="shrink-0 rounded border border-border-danger-light bg-status-error-light px-3 py-2 text-body-xs text-status-error-emphasis">{error}</div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border-quaternary bg-surface-sub-background">
          <div className="flex shrink-0 items-center gap-2 border-b border-border-quaternary px-2 py-2 text-body-xs">
            <SegmentedControl label="結果顯示" value={resultView} onChange={setResultView} options={[{ id: 'table' as const, label: '表格' }, { id: 'json' as const, label: 'JSON' }]} />
            <span className="ml-auto text-text-quaternary">{result ? `${result.operation ?? '執行 SQL'}／${result.requestId}／${result.rowCount} 列／影響 ${result.affected ?? result.rowCount} 筆／${result.durationMs ?? 0} ms${result.truncated ? '（已達上限）' : ''}` : '尚未執行'}</span>
          </div>
          {result?.warnings?.map((warning) => <div key={warning} className="border-b border-status-warning-light bg-status-warning-light px-3 py-2 text-body-xs text-status-warning">{warning}</div>)}
          <div className="min-h-0 flex-1 overflow-auto">
            {resultView === 'json' ? (
              <pre className="p-3 text-body-xs text-text-secondary">{JSON.stringify(result?.rows ?? [], null, 2)}</pre>
            ) : result?.columns.length ? (
              <table className="min-w-full border-collapse text-body-xs">
                <thead className="sticky top-0 bg-surface-primary"><tr>{result.columns.map((column) => <th key={column} className="border-b border-r border-border-quaternary px-2 py-1.5 text-left font-medium text-text-secondary">{column}</th>)}</tr></thead>
                <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column} className="max-w-72 truncate border-b border-r border-border-quaternary px-2 py-1 text-text-tertiary" title={displayValue(row[column])}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
              </table>
            ) : <div className="p-4 text-body-xs text-text-disabled">沒有結果資料</div>}
          </div>
        </div>
          </div>
        </details>
      </section>
    </div>
  )
}
