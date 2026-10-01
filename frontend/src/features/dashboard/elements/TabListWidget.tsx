/**
 * TabListWidget
 * 可切換 Tab 的動態清單／子畫布表格元件：
 * - 支援多個 Tab 分頁，每個 Tab 擁有獨立 SQL 查詢或資料來源。
 * - 每個 Tab 可定義多個欄位格（Columns）。
 * - 每個欄位格擁有獨立的單元格子畫布範本（children: ChildWidget[]）。
 * - 依據資料庫查詢筆數，每一列（Row）自動注入變數並重複渲染各欄位單元格。
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabListWidget, TabListColumn, ChildWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useIsEditMode } from '../utils/widgetEditPreview';
import { VariableProvider } from '../VariableContext';
import { WidgetRenderer } from './WidgetRenderer';
import { Edit3 } from 'lucide-react';

const TAB_LIST_FONT_WIDGET_TYPES = new Set(['text', 'status-badge', 'alert-banner', 'clock', 'route-progress']);

function isTabListFontWidget(child: ChildWidget): boolean {
  return TAB_LIST_FONT_WIDGET_TYPES.has(child.type);
}

/** 將內容字級寫入表格本身，以及所有 Tab、所有欄位的文字／徽章元件 */
export function applyTabListContentFontSize(
  widget: TabListWidget,
  fontSize: number,
): Pick<TabListWidget, 'fontSize' | 'tabs'> {
  return {
    fontSize,
    tabs: (widget.tabs ?? []).map(t => ({
      ...t,
      columns: t.columns.map(c => ({
        ...c,
        fontSize,
        children: (c.children ?? []).map(ch =>
          isTabListFontWidget(ch) ? ({ ...ch, fontSize } as ChildWidget) : ch,
        ),
      })),
    })),
  };
}


// ─── 單一單元格渲染器 ─────────────────────────────────────────────────────────

function TabListCell({
  column,
  row,
  rowHeight,
  fontSize,
  textColor,
  tabAlign,
  globalAlign,
}: {
  column: TabListColumn;
  row: Record<string, unknown>;
  rowHeight: number;
  fontSize: number;
  textColor?: string;
  tabAlign?: 'left' | 'center' | 'right';
  globalAlign?: 'left' | 'center' | 'right';
}) {
  const children = column.children ?? [];
  const colW = column.width > 0 ? column.width : '100%';
  const align = column.align ?? tabAlign ?? globalAlign ?? 'left';
  // 內容字級以表格為準，避免各欄元件自己的 fontSize 把統一調整拆散
  const cellFs = fontSize;
  const cellColor = column.textColor ?? textColor ?? '#cbd5e1';

  const fieldKey = column.fieldKey || (
    column.name?.includes('班次') ? 'trip_code' :
    column.name?.includes('方向') ? 'direction_label' :
    column.name?.includes('載具') ? 'vehicle_code' :
    column.name?.includes('進度') ? 'route_stations' :
    column.name?.includes('狀態') ? 'status_label' :
    column.name?.includes('時間') || column.name?.includes('發車') ? 'depart_time' :
    column.name?.includes('類型') || column.name?.includes('項目') ? 'maint_type_label' :
    column.name?.includes('操作') || column.name?.includes('詳情') ? 'shift_key' : ''
  );

  const cellVariables = {
    ...row,
    ...(fieldKey ? {
      value: row[fieldKey],
      field: row[fieldKey],
      cell_value: row[fieldKey],
      [fieldKey]: row[fieldKey],
    } : {}),
  };

  return (
    <td
      style={{
        padding: '2px 8px',
        height: rowHeight,
        width: colW,
        maxWidth: colW,
        boxSizing: 'border-box',
        verticalAlign: 'middle',
        textAlign: align,
        overflow: 'hidden',
      }}
    >
      <VariableProvider variables={cellVariables as Record<string, string | number | boolean | null | undefined>}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: rowHeight - 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
            overflow: 'visible',
          }}
        >
          {children.length === 0 ? (
            <span style={{ fontSize: cellFs, color: cellColor, fontWeight: 500, textAlign: align, width: '100%' }}>
              {fieldKey && row[fieldKey] !== undefined ? String(row[fieldKey]) : '—'}
            </span>
          ) : (
            children.map((child: ChildWidget) => {
              let effectiveChild: ChildWidget = child;
              if (child.type === 'text') {
                effectiveChild = {
                  ...child,
                  fontSize: cellFs,
                  color: child.color || cellColor,
                  textAlign: align,
                };
              } else if (isTabListFontWidget(child)) {
                effectiveChild = { ...child, fontSize: cellFs } as ChildWidget;
              }
              return (
                <div
                  key={child.id}
                  style={{
                    position: 'relative',
                    width: child.type === 'route-progress' ? '100%' : (child.width ?? '100%'),
                    maxWidth: '100%',
                    height: child.height ?? '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
                    margin: align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0 auto 0 0',
                  }}
                >
                  <WidgetRenderer widget={effectiveChild} />
                </div>
              );
            })
          )}
        </div>
      </VariableProvider>
    </td>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

export function TabListWidgetView({
  widget,
  onEnterEditColumn,
}: {
  widget: TabListWidget;
  onEnterEditColumn?: (tabId: string, columnId: string) => void;
}) {
  const { t } = useTranslation();
  const isEditMode = useIsEditMode();
  const tabs = widget.tabs ?? [];
  const defaultTabId = widget.activeTabId ?? widget.defaultTab ?? tabs[0]?.id ?? 'tab-mainline';
  const [currentTabId, setCurrentTabId] = useState<string>(defaultTabId);

  useEffect(() => {
    if (widget.activeTabId && widget.activeTabId !== currentTabId) {
      setCurrentTabId(widget.activeTabId);
    }
  }, [widget.activeTabId]);

  // 取得當前選中的 Tab
  const activeTab = useMemo(() => {
    return tabs.find(t => t.id === currentTabId) ?? tabs[0] ?? null;
  }, [tabs, currentTabId]);

  const effectiveTabId = activeTab?.id ?? defaultTabId;

  // 資料綁定
  const ds = activeTab?.dataSourceId ?? widget.dataSourceId ?? 'default-internal';
  const sql = activeTab?.sqlQuery ?? (
    effectiveTabId.includes('maint') ? widget.maintenanceSqlQuery : widget.mainlineSqlQuery
  );

  const queryState = useWidgetData({
    dataSourceId: ds,
    sqlQuery: sql,
    refreshMode: 'event',
    refreshInterval: activeTab?.refreshInterval,
  });

  // 目前班表標題輔助查詢
  const scheduleState = useWidgetData({
    dataSourceId: ds,
    sqlQuery: widget.currentScheduleSqlQuery,
    refreshMode: 'event',
  });

  const currentScheduleName = useMemo(() => {
    const row = scheduleState.data[0];
    if (!row) return '';
    return String(row.schedule_name ?? row.name ?? '');
  }, [scheduleState.data]);

  // 列資料只來自 SQL；編輯模式也不放示範列——沒資料就讓人看到沒資料
  const rows = useMemo(
    () => (queryState.data ?? []) as Record<string, unknown>[],
    [queryState.data],
  );

  const fs = widget.fontSize ?? 13;
  const bodyTextColor = widget.textColor ?? '#cbd5e1';
  const headerFs = widget.headerFontSize ?? 12;
  const headerTextColor = widget.headerTextColor ?? '#94a3b8';
  const tabFs = widget.tabFontSize ?? 14;
  const tabActiveColor = widget.tabActiveColor ?? '#3b82f6';
  const tabInactiveColor = widget.tabInactiveColor ?? '#64748b';
  const globalAlign = widget.align ?? 'left';
  const rowH = widget.rowHeight ?? 48;
  const headerH = widget.headerHeight ?? 38;
  const columns = activeTab?.columns ?? [];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: widget.backgroundColor ?? 'transparent',
        borderRadius: widget.borderRadius ?? 8,
        borderWidth: widget.borderWidth ?? 0,
        borderColor: widget.borderColor ?? 'transparent',
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          padding: '0 12px',
          backgroundColor: 'rgba(255,255,255,0.02)',
          minHeight: 44,
        }}
      >
        {/* 左側 Tab 切換 */}
        <div style={{ display: 'flex', gap: 6 }}>
          {tabs.map((tab) => {
            const isActive = tab.id === effectiveTabId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCurrentTabId(tab.id)}
                style={{
                  padding: '8px 18px',
                  fontSize: tabFs,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? tabActiveColor : tabInactiveColor,
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? `2.5px solid ${tabActiveColor}` : '2.5px solid transparent',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                  outline: 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 右側：目前班表 / 輔助資訊 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
          <span style={{ fontSize: fs - 1, color: '#64748b', whiteSpace: 'nowrap' }}>
            {widget.currentScheduleLabel ?? t('dashboard.tabListChrome.currentSchedule')}
          </span>
          {currentScheduleName ? (
            <span
              style={{
                fontSize: fs - 1,
                color: '#cbd5e1',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 4,
                padding: '2px 8px',
                border: '1px solid rgba(255,255,255,0.12)',
                whiteSpace: 'nowrap',
              }}
            >
              {currentScheduleName}
            </span>
          ) : (
            <span
              style={{
                fontSize: fs - 1,
                color: '#cbd5e1',
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: 4,
                padding: '2px 8px',
                border: '1px solid rgba(255,255,255,0.1)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('dashboard.tabListChrome.scheduleFallback')}
            </span>
          )}
        </div>
      </div>

      {/* ── 表格區塊 ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {queryState.loading && rows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#64748b',
              fontSize: fs,
            }}
          >
            {t('common.loading')}
          </div>
        ) : rows.length === 0 && !isEditMode ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#64748b',
              fontSize: fs,
            }}
          >
            {t('dashboard.tabListChrome.noData')}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
            }}
          >
            {/* 表頭 */}
            <thead>
              <tr
                style={{
                  height: headerH,
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: widget.headerBgColor ?? 'transparent',
                }}
              >
                {columns.map((col) => {
                  const effectiveAlign = col.align ?? activeTab?.align ?? globalAlign;
                  return (
                    <th
                      key={col.id}
                      style={{
                        padding: '4px 8px',
                        textAlign: effectiveAlign,
                        fontSize: headerFs,
                        color: headerTextColor,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        width: col.width > 0 ? col.width : 'auto',
                        userSelect: 'none',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: effectiveAlign === 'center' ? 'center' : effectiveAlign === 'right' ? 'flex-end' : 'flex-start',
                          gap: 4,
                          width: '100%',
                        }}
                      >
                        <span>{col.name}</span>
                        {isEditMode && onEnterEditColumn && (
                          <button
                            type="button"
                            title={t('dashboard.tabListChrome.editColumnTitle', {
                              name: col.name || t('dashboard.tabListChrome.thisColumn'),
                            })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEnterEditColumn(effectiveTabId, col.id);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '2px 4px',
                              borderRadius: 3,
                              border: 'none',
                              background: 'rgba(59,130,246,0.15)',
                              color: '#60a5fa',
                              cursor: 'pointer',
                              fontSize: 10,
                            }}
                          >
                            <Edit3 size={10} />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {/* 表身 (資料重複列) */}
            <tbody>
              {isEditMode && rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, columns.length)} style={{ padding: 12, textAlign: 'center', color: '#64748b', fontSize: fs }}>
                    {t('dashboard.tabListChrome.noData')}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr
                  key={String(row.shift_key ?? row.id ?? `row-${i}`)}
                  style={{
                    height: rowH,
                    backgroundColor: i % 2 === 1 ? (widget.stripeBgColor ?? 'rgba(255,255,255,0.02)') : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  {columns.map((col) => (
                    <TabListCell
                      key={col.id}
                      column={col}
                      row={row}
                      rowHeight={rowH}
                      fontSize={fs}
                      textColor={bodyTextColor}
                      tabAlign={activeTab?.align}
                      globalAlign={globalAlign}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
