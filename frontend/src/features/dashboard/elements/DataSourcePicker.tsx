import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, Play, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import {
  fetchTables,
  fetchTableSchema,
  executeDatasourceQuery,
  getDataSourcesForBinding,
} from '../store/useDataSourceStore';
import { DataSourceIdSelect } from './DataSourceIdSelect';
import { useVariables, interpolateVariables } from '../VariableContext';
import { usePlaneSourceId } from '../context/PlaneDataSourceContext';

interface Props {
  dataSourceId: string;
  sqlQuery: string;
  onChangeDataSource: (id: string) => void;
  onChangeSqlQuery: (q: string) => void;
  /** 當預覽拿到欄位名稱時，通知父元件（供折線圖選欄位用） */
  onColumnsDetected?: (cols: string[]) => void;
}

const inputCls = `w-full bg-zinc-800/80 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

export function DataSourcePicker({ dataSourceId: boundSourceId, sqlQuery, onChangeDataSource, onChangeSqlQuery, onColumnsDetected }: Props) {
  const { t } = useTranslation();
  // 元件綁的是 boundSourceId；查資料表、欄位、預覽都用這張儀表板「資料設定」實際選的連線
  const dataSourceId = usePlaneSourceId(boundSourceId);
  const dataSources = getDataSourcesForBinding('sql');
  const variables = useVariables();

  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableSchema, setTableSchema] = useState<{ column_name: string; data_type: string }[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);

  // 預覽結果
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // ─── 載入資料表清單 ───────────────────────────────────────────
  const loadTables = useCallback(async (dsId: string) => {
    if (!dsId) return;
    setLoadingTables(true);
    try {
      const ts = await fetchTables(dsId);
      setTables(ts);
    } catch { setTables([]); }
    finally { setLoadingTables(false); }
  }, []);

  useEffect(() => { loadTables(dataSourceId); }, [dataSourceId, loadTables]);

  // ─── 選取資料表 → 載入欄位 → 產生 SELECT 範本 ────────────────
  async function handleSelectTable(table: string) {
    setSelectedTable(table);
    setShowTableMenu(false);
    const cols = await fetchTableSchema(dataSourceId, table);
    setTableSchema(cols);
    // 自動產生查詢範本
    onChangeSqlQuery(`SELECT ${cols.map(c => c.column_name).join(', ')}\nFROM ${table}\nORDER BY 1 DESC\nLIMIT 100`);
  }

  // ─── 執行預覽 ─────────────────────────────────────────────────
  async function handlePreview() {
    if (!dataSourceId || !sqlQuery.trim()) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setShowPreview(true);
    try {
      const resolvedSql = interpolateVariables(sqlQuery, variables);
      if (/\{[^{}]+\}/.test(resolvedSql)) {
        throw new Error(t('dashboard.dataSourcePicker.unresolvedVars'));
      }
      const rows = await executeDatasourceQuery(dataSourceId, resolvedSql);
      setPreviewRows(rows.slice(0, 10));
      const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
      setPreviewCols(cols);
      onColumnsDetected?.(cols);
    } catch (e: unknown) {
      setPreviewError((e as Error).message);
      setPreviewRows([]);
      setPreviewCols([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  const selectedDs = dataSources.find(d => d.id === dataSourceId);

  return (
    <div className="space-y-2.5">
      <DataSourceIdSelect
        kind="sql"
        value={boundSourceId}
        onChange={id => {
          onChangeDataSource(id);
          setTables([]);
          setSelectedTable('');
          setTableSchema([]);
        }}
      />

      {/* 資料表選擇（內建型才有） */}
      {selectedDs?.type === 'internal' && dataSourceId && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-zinc-500 text-xs flex items-center gap-1">
              <Table size={10} /> {t('dashboard.dataSourcePicker.selectTable')}
            </label>
            <button onClick={() => loadTables(dataSourceId)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <RefreshCw size={10} className={loadingTables ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 資料表下拉 */}
          <div className="relative">
            <button
              onClick={() => setShowTableMenu(v => !v)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/80 border border-zinc-700
                         rounded-md text-xs text-zinc-400 hover:border-zinc-600 transition-colors"
            >
              <span>{selectedTable || (loadingTables ? t('dashboard.dataSourcePicker.loading') : t('dashboard.dataSourcePicker.chooseTable'))}</span>
              <ChevronDown size={10} />
            </button>
            {showTableMenu && tables.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-0.5 bg-zinc-800 border border-zinc-700
                              rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto py-1">
                {tables.map(t => (
                  <button key={t} onClick={() => handleSelectTable(t)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors font-mono
                      ${selectedTable === t ? 'bg-cyan-600/20 text-cyan-300' : 'text-zinc-300 hover:bg-zinc-700'}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 欄位提示 */}
          {tableSchema.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tableSchema.slice(0, 8).map(col => (
                <button key={col.column_name}
                  onClick={() => {
                    const cursor = (document.getElementById('sql-query-textarea') as HTMLTextAreaElement)?.selectionStart ?? sqlQuery.length;
                    const next = sqlQuery.slice(0, cursor) + col.column_name + sqlQuery.slice(cursor);
                    onChangeSqlQuery(next);
                  }}
                  className="px-1.5 py-0.5 rounded text-xs bg-zinc-700 text-zinc-300 font-mono
                             hover:bg-cyan-700/40 hover:text-cyan-300 transition-colors"
                  title={col.data_type}
                >
                  {col.column_name}
                </button>
              ))}
              {tableSchema.length > 8 && (
                <span className="text-zinc-600 text-xs self-center">{t('dashboard.dataSourcePicker.moreColumns', { count: tableSchema.length - 8 })}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* SQL 輸入框 */}
      {dataSourceId && (
        <div>
          <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.dataSourcePicker.sqlLabel')}</label>
          <textarea
            id="sql-query-textarea"
            value={sqlQuery}
            onChange={e => onChangeSqlQuery(e.target.value)}
            rows={5}
            className={`${inputCls} resize-y font-mono leading-relaxed`}
            placeholder={'SELECT column1, column2\nFROM my_table\nWHERE ...\nORDER BY created_at DESC\nLIMIT 100'}
            spellCheck={false}
          />
          <p className="text-zinc-600 text-xs mt-0.5 leading-relaxed">
            {t('dashboard.dataSourcePicker.sqlHintBefore')}
            <code className="mx-0.5 text-cyan-600/90">{t('dashboard.dataSourcePicker.sqlHintCode')}</code>
            {t('dashboard.dataSourcePicker.sqlHintAfter')}
          </p>
        </div>
      )}

      {/* 預覽按鈕 */}
      {dataSourceId && sqlQuery.trim() && (
        <button
          onClick={handlePreview}
          disabled={previewLoading}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg
                     bg-cyan-700/25 border border-cyan-700/50 text-cyan-300 text-xs
                     hover:bg-cyan-700/40 disabled:opacity-50 transition-colors"
        >
          {previewLoading
            ? <><RefreshCw size={12} className="animate-spin" /> {t('dashboard.dataSourcePicker.querying')}</>
            : <><Play size={12} /> {t('dashboard.dataSourcePicker.preview')}</>
          }
        </button>
      )}

      {/* 預覽結果 */}
      {showPreview && (
        <div className="border border-zinc-700/60 rounded-lg overflow-hidden">
          {previewError
            ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 text-red-400 text-xs">
                <AlertCircle size={12} /> {previewError}
              </div>
            )
            : previewRows.length > 0
              ? (
                <div className="overflow-x-auto max-h-40">
                  <table className="w-full text-xs font-mono border-collapse">
                    <thead>
                      <tr>
                        {previewCols.map(c => (
                          <th key={c} className="px-2 py-1 text-left text-cyan-400 bg-cyan-900/20 border-b border-zinc-700/60 whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className={i % 2 ? 'bg-zinc-800/30' : ''}>
                          {previewCols.map(c => (
                            <td key={c} className="px-2 py-1 text-zinc-400 whitespace-nowrap max-w-[80px] overflow-hidden text-ellipsis border-b border-zinc-800/60">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
              : <div className="px-3 py-2 text-zinc-500 text-xs">{t('dashboard.dataSourcePicker.noData')}</div>
          }
        </div>
      )}
    </div>
  );
}
