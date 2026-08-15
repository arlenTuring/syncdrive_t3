import React, { useMemo, useState } from 'react';
import type { WidgetType } from './types';
import {
  Type, Image, TrendingUp, Database, Gauge, LayoutGrid, Route,
  LayoutTemplate, CopyPlus,
  Square, Tag, Hash, AlignJustify, Clock, BarChart2, Map, Activity,
  CircleOff, AlertTriangle, Bus, List,
} from 'lucide-react';
import type { CanvasKind } from './types';

/** 用途篩選（容器 + 元件共用） */
export type PaletteFilter = 'all' | 'container' | 'layout' | 'chart' | 'kpi' | 'ops';

type WidgetCategory = Exclude<PaletteFilter, 'all' | 'container'>;

interface PaletteItem {
  type: WidgetType;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  category: WidgetCategory;
}

interface ContainerItem {
  id: string;
  canvasType: 'canvas' | 'canvas-group' | 'canvas-map-platform';
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const FILTERS: { id: PaletteFilter; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '所有容器與元件' },
  { id: 'container', label: '容器', hint: '畫布、群組、圖台' },
  { id: 'layout', label: '版面裝飾', hint: '標題、色塊、時鐘、空狀態' },
  { id: 'chart', label: '資料圖表', hint: '折線、長條、表格、儀表' },
  { id: 'kpi', label: '指標狀態', hint: 'KPI、進度、徽章' },
  { id: 'ops', label: '車輛營運', hint: '路線、格位、遙測卡' },
];

const WIDGET_SECTIONS: { category: WidgetCategory; title: string }[] = [
  { category: 'layout', title: '版面裝飾' },
  { category: 'chart', title: '資料圖表' },
  { category: 'kpi', title: '指標狀態' },
  { category: 'ops', title: '車輛營運' },
];

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'text', label: '純文字', icon: <Type size={18} />, color: '#f59e0b', description: '文字標籤、標題', category: 'layout' },
  { type: 'image', label: '圖片', icon: <Image size={18} />, color: '#10b981', description: '外部圖片 URL', category: 'layout' },
  { type: 'color-block', label: '色塊', icon: <Square size={18} />, color: '#64748b', description: '純色背景色塊（底層）', category: 'layout' },
  { type: 'clock', label: '時鐘', icon: <Clock size={18} />, color: '#a3e635', description: '即時系統時鐘', category: 'layout' },
  { type: 'empty-state', label: '空狀態', icon: <CircleOff size={18} />, color: '#94a3b8', description: '查詢 0 筆時佔位', category: 'layout' },
  { type: 'alert-banner', label: '資料警示', icon: <AlertTriangle size={18} />, color: '#f97316', description: '資料觸發才顯示（編輯時可見）', category: 'layout' },
  { type: 'line-chart', label: '折線圖', icon: <TrendingUp size={18} />, color: '#06b6d4', description: 'API 資料折線圖', category: 'chart' },
  { type: 'segment-bar', label: '分段比例條', icon: <BarChart2 size={18} />, color: '#22c55e', description: '依比例分段顯示', category: 'kpi' },
  { type: 'bar-chart', label: '長條圖', icon: <BarChart2 size={18} />, color: '#f97316', description: 'API 資料長條圖', category: 'chart' },
  { type: 'database', label: '資料庫', icon: <Database size={18} />, color: '#a78bfa', description: 'API 資料表格', category: 'chart' },
  { type: 'gauge', label: '儀表板', icon: <Gauge size={18} />, color: '#ec4899', description: '圓弧形數據量表', category: 'chart' },
  { type: 'stat-card', label: 'KPI 卡', icon: <Hash size={18} />, color: '#e879f9', description: '大數字指標卡', category: 'kpi' },
  { type: 'progress-bar', label: '進度條', icon: <AlignJustify size={18} />, color: '#38bdf8', description: '水平/垂直線性進度', category: 'kpi' },
  { type: 'status-badge', label: '狀態徽章', icon: <Tag size={18} />, color: '#22c55e', description: '動態彩色狀態標籤', category: 'kpi' },
  { type: 'route-progress', label: '路線進度', icon: <Route size={18} />, color: '#3b82f6', description: '線性路線進度／詳情卡', category: 'ops' },
  { type: 'slot-grid', label: '格位陣列', icon: <LayoutGrid size={18} />, color: '#f43f5e', description: '場域格位狀態監控', category: 'ops' },
  { type: 'unit-telemetry-card', label: '遙測卡', icon: <Activity size={18} />, color: '#a78bfa', description: '雙儀表 + 四子系統狀態燈', category: 'ops' },
  { type: 'vehicle-container', label: '載具樣板', icon: <Bus size={18} />, color: '#f59e0b', description: '圖台載具外觀與行為樣板（執行期套用至所有即時車輛）', category: 'ops' },
  { type: 'tab-list', label: 'Tab 清單表格', icon: <List size={18} />, color: '#3b82f6', description: '可切 Tab 與自訂欄位子畫布的動態表格', category: 'ops' },
];

const CONTAINER_ITEMS: ContainerItem[] = [
  { id: 'canvas', canvasType: 'canvas', label: '畫布元件', icon: <LayoutTemplate size={18} />, color: '#8b5cf6', description: '單一畫布區塊，可放子元件' },
  { id: 'canvas-group', canvasType: 'canvas-group', label: '畫布群組', icon: <CopyPlus size={18} />, color: '#d946ef', description: '資料重複／輪播範本' },
  { id: 'canvas-tab-list', canvasType: 'canvas-tab-list', label: 'Tab 清單表格', icon: <List size={18} />, color: '#3b82f6', description: '可切換 Tab 與自訂欄位子畫布的表格容器' },
  { id: 'map-platform', canvasType: 'canvas-map-platform', label: '圖台容器', icon: <Map size={18} />, color: '#0ea5e9', description: '嵌入 Map Editor 場域圖' },
];

interface Props {
  isEditMode?: boolean;
  hasActiveCanvas: boolean;
  hasActivePlane?: boolean;
  /** 目前選取的畫布種類（用於限制載具容器） */
  activeCanvasKind?: CanvasKind;
  activeCanvasIsGroup?: boolean;
  onAddCanvas?: (isGroup: boolean, x?: number, y?: number, canvasKind?: CanvasKind, initialWidgetType?: WidgetType) => void;
  onAddWidget?: (widgetType: WidgetType) => void;
}

function handleCanvasDragStart(
  e: React.DragEvent,
  canvasType: 'canvas' | 'canvas-group' | 'canvas-map-platform' | 'canvas-tab-list',
) {
  e.dataTransfer.setData('canvasType', canvasType);
  e.dataTransfer.setData('canvastype', canvasType);
  e.dataTransfer.effectAllowed = 'copy';
}

function FilterChip({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: '4px 10px',
        borderRadius: 999,
        border: active ? '1px solid rgba(34,211,238,0.55)' : '1px solid rgba(255,255,255,0.1)',
        background: active ? 'rgba(6,182,212,0.18)' : 'rgba(255,255,255,0.04)',
        color: active ? '#67e8f9' : 'rgba(255,255,255,0.55)',
        fontSize: 10,
        fontWeight: active ? 700 : 500,
        fontFamily: 'system-ui, sans-serif',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'rgba(255,255,255,0.45)',
        writingMode: 'vertical-rl',
        textOrientation: 'upright',
        letterSpacing: 1,
        fontWeight: 'bold',
        flexShrink: 0,
        alignSelf: 'center',
        padding: '2px 4px',
        lineHeight: 1.2,
      }}
    >
      {title}
    </div>
  );
}

function DraggableTile({
  label,
  icon,
  color,
  title,
  draggable,
  disabled,
  onDragStart,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  title: string;
  draggable: boolean;
  disabled: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick?: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        width: 72,
        height: 62,
        borderRadius: 8,
        border: `1px solid ${color}28`,
        background: `${color}0d`,
        color,
        cursor: disabled ? 'not-allowed' : 'grab',
        opacity: disabled ? 0.35 : 1,
        userSelect: 'none',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (disabled) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = `${color}20`;
        el.style.borderColor = `${color}60`;
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = `${color}0d`;
        el.style.borderColor = `${color}28`;
        el.style.transform = 'translateY(0)';
      }}
    >
      {icon}
      <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{label}</span>
    </div>
  );
}

export function ComponentPalette({
  isEditMode = true,
  hasActiveCanvas: _hasActiveCanvas,
  hasActivePlane,
  activeCanvasKind,
  activeCanvasIsGroup,
  onAddCanvas,
  onAddWidget,
}: Props) {
  const [filter, setFilter] = useState<PaletteFilter>('all');

  // Hooks 必須在每次 render 以相同順序執行，不可放在 isEditMode 條件 return 之後
  const showContainers = filter === 'all' || filter === 'container';
  const filteredWidgets = useMemo(() => {
    if (filter === 'all' || filter === 'container') return PALETTE_ITEMS;
    return PALETTE_ITEMS.filter(w => w.category === filter);
  }, [filter]);

  const widgetSections = useMemo(() => {
    if (filter !== 'all') return [{ title: FILTERS.find(f => f.id === filter)?.label ?? '', items: filteredWidgets }];
    return WIDGET_SECTIONS
      .map(sec => ({ title: sec.title, items: PALETTE_ITEMS.filter(w => w.category === sec.category) }))
      .filter(sec => sec.items.length > 0);
  }, [filter, filteredWidgets]);

  if (!isEditMode) {
    return (
      <div
        style={{
          background: '#0f1623',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
          padding: '10px 16px',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'system-ui' }}>
          檢視模式 · 進入編輯模式後可拖曳新增畫布與元件
        </span>
      </div>
    );
  }

  function handleWidgetDragStart(e: React.DragEvent, type: WidgetType) {
    e.dataTransfer.setData('widgetType', type);
    e.dataTransfer.setData('widgettype', type);
    e.dataTransfer.effectAllowed = 'copy';
  }

  const containerDisabled = !hasActivePlane;

  return (
    <div
      style={{
        background: '#0f1623',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 用途篩選 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px 4px',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0, marginRight: 4 }}>篩選</span>
        {FILTERS.map(f => (
          <FilterChip
            key={f.id}
            active={filter === f.id}
            label={f.label}
            hint={f.hint}
            onClick={() => setFilter(f.id)}
          />
        ))}
      </div>

      {/* 元件列 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 16px 10px',
          minHeight: 76,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent',
        }}
      >
        {showContainers && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingRight: 16,
              borderRight: '1px solid rgba(255,255,255,0.1)',
              height: '100%',
            }}
          >
            <SectionLabel title="容器" />
            {CONTAINER_ITEMS.map(item => (
              <DraggableTile
                key={item.id}
                label={item.label}
                icon={item.icon}
                color={item.color}
                title={`${item.label}：${item.description}（點擊或拖曳至平面）`}
                draggable={!containerDisabled}
                disabled={containerDisabled}
                onDragStart={e => {
                  if (containerDisabled) { e.preventDefault(); return; }
                  handleCanvasDragStart(e, item.canvasType);
                }}
                onClick={() => {
                  if (containerDisabled) return;
                  if (item.canvasType === 'canvas-tab-list') {
                    onAddCanvas?.(false, undefined, undefined, 'standard', 'tab-list');
                  } else if (item.canvasType === 'canvas-map-platform') {
                    onAddCanvas?.(false, undefined, undefined, 'map-platform');
                  } else if (item.canvasType === 'canvas-group') {
                    onAddCanvas?.(true, undefined, undefined, 'standard');
                  } else {
                    onAddCanvas?.(false, undefined, undefined, 'standard');
                  }
                }}
              />
            ))}
          </div>
        )}

        {widgetSections.map((sec, idx) => (
          <div
            key={sec.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingRight: idx < widgetSections.length - 1 ? 16 : 0,
              borderRight: idx < widgetSections.length - 1 ? '1px solid rgba(255,255,255,0.1)' : undefined,
              height: '100%',
            }}
          >
            <SectionLabel title={sec.title} />
            {sec.items.map(item => {
              const mapOnlyBlocked = Boolean(
                item.type === 'vehicle-container'
                && (activeCanvasKind !== 'map-platform' || activeCanvasIsGroup),
              );
              const tileDisabled = !hasActivePlane || mapOnlyBlocked;
              const tileTitle = mapOnlyBlocked
                ? '載具樣板僅可放在圖台容器內'
                : `${item.label}：${item.description}（點擊或拖曳至畫布／平面）`;
              return (
              <DraggableTile
                key={item.type}
                label={item.label}
                icon={item.icon}
                color={item.color}
                title={tileTitle}
                draggable={!tileDisabled}
                disabled={tileDisabled}
                onDragStart={e => {
                  if (tileDisabled) { e.preventDefault(); return; }
                  handleWidgetDragStart(e, item.type);
                }}
                onClick={() => {
                  if (tileDisabled) return;
                  onAddWidget?.(item.type);
                }}
              />
            );})}
          </div>
        ))}
      </div>
    </div>
  );
}
