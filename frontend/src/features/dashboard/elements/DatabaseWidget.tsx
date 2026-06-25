import type { DatabaseWidget } from '../types';
import { Database } from 'lucide-react';
import { useWidgetData } from './useWidgetData';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  MOCK_DATABASE_PREVIEW,
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

export function DatabaseWidgetView({ widget }: { widget: DatabaseWidget }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const { data, loading, error } = useWidgetData({
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    dataUrl: widget.dataUrl,
  });
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, data.length > 0);
  const rows: Record<string, unknown>[] = (isEditPreview ? MOCK_DATABASE_PREVIEW : data).slice(0, widget.maxRows);
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'database' })}
    >
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                  background: 'transparent', borderRadius: 4, overflow: 'hidden',
                  fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <Database size={11} color="#a78bfa" />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{widget.title}</span>
        {loading && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 'auto' }}>載入中…</span>}
        {error && <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 'auto' }} title={error}>錯誤</span>}
        {data.length > 0 && !loading && (
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
            {data.length} 筆
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!widget.dataUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.1)', gap: 4 }}>
            <Database size={28} strokeWidth={1} />
            <span style={{ fontSize: 10 }}>請在屬性面板設定資料來源 URL</span>
          </div>
        )}

        {widget.displayMode === 'table' && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c} style={{ padding: '3px 6px', textAlign: 'left', position: 'sticky', top: 0,
                                       background: 'rgba(167,139,250,0.12)', color: '#a78bfa',
                                       borderBottom: '1px solid rgba(167,139,250,0.2)', whiteSpace: 'nowrap' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  {cols.map(c => (
                    <td key={c} style={{ padding: '2px 6px', color: 'rgba(255,255,255,0.55)',
                                         borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap',
                                         maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {widget.displayMode === 'json' && rows.length > 0 && (
          <pre style={{ margin: 0, padding: '6px 8px', fontSize: 9, color: '#86efac',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(rows, null, 2)}
          </pre>
        )}
      </div>
    </div>
    </WidgetEditPreviewOutline>
  );
}
