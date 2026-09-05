import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

interface PaletteItemDef {
  type: WidgetType;
  i18nKey: string;
  icon: React.ReactNode;
  color: string;
  category: WidgetCategory;
}

interface ContainerItemDef {
  id: string;
  canvasType: 'canvas' | 'canvas-group' | 'canvas-map-platform' | 'canvas-tab-list';
  i18nKey: string;
  icon: React.ReactNode;
  color: string;
}

const FILTER_IDS: PaletteFilter[] = ['all', 'container', 'layout', 'chart', 'kpi', 'ops'];

const WIDGET_SECTIONS: { category: WidgetCategory }[] = [
  { category: 'layout' },
  { category: 'chart' },
  { category: 'kpi' },
  { category: 'ops' },
];

const PALETTE_ITEMS: PaletteItemDef[] = [
  { type: 'text', i18nKey: 'text', icon: <Type size={18} />, color: '#f59e0b', category: 'layout' },
  { type: 'image', i18nKey: 'image', icon: <Image size={18} />, color: '#10b981', category: 'layout' },
  { type: 'color-block', i18nKey: 'colorBlock', icon: <Square size={18} />, color: '#64748b', category: 'layout' },
  { type: 'clock', i18nKey: 'clock', icon: <Clock size={18} />, color: '#a3e635', category: 'layout' },
  { type: 'empty-state', i18nKey: 'emptyState', icon: <CircleOff size={18} />, color: '#94a3b8', category: 'layout' },
  { type: 'alert-banner', i18nKey: 'alertBanner', icon: <AlertTriangle size={18} />, color: '#f97316', category: 'layout' },
  { type: 'line-chart', i18nKey: 'lineChart', icon: <TrendingUp size={18} />, color: '#06b6d4', category: 'chart' },
  { type: 'segment-bar', i18nKey: 'segmentBar', icon: <BarChart2 size={18} />, color: '#22c55e', category: 'kpi' },
  { type: 'bar-chart', i18nKey: 'barChart', icon: <BarChart2 size={18} />, color: '#f97316', category: 'chart' },
  { type: 'database', i18nKey: 'database', icon: <Database size={18} />, color: '#a78bfa', category: 'chart' },
  { type: 'gauge', i18nKey: 'gauge', icon: <Gauge size={18} />, color: '#ec4899', category: 'chart' },
  { type: 'stat-card', i18nKey: 'statCard', icon: <Hash size={18} />, color: '#e879f9', category: 'kpi' },
  { type: 'progress-bar', i18nKey: 'progressBar', icon: <AlignJustify size={18} />, color: '#38bdf8', category: 'kpi' },
  { type: 'status-badge', i18nKey: 'statusBadge', icon: <Tag size={18} />, color: '#22c55e', category: 'kpi' },
  { type: 'route-progress', i18nKey: 'routeProgress', icon: <Route size={18} />, color: '#3b82f6', category: 'ops' },
  { type: 'slot-grid', i18nKey: 'slotGrid', icon: <LayoutGrid size={18} />, color: '#f43f5e', category: 'ops' },
  { type: 'unit-telemetry-card', i18nKey: 'unitTelemetry', icon: <Activity size={18} />, color: '#a78bfa', category: 'ops' },
  { type: 'vehicle-container', i18nKey: 'vehicleContainer', icon: <Bus size={18} />, color: '#f59e0b', category: 'ops' },
  { type: 'tab-list', i18nKey: 'tabList', icon: <List size={18} />, color: '#3b82f6', category: 'ops' },
];

const CONTAINER_ITEMS: ContainerItemDef[] = [
  { id: 'canvas', canvasType: 'canvas', i18nKey: 'canvas', icon: <LayoutTemplate size={18} />, color: '#8b5cf6' },
  { id: 'canvas-group', canvasType: 'canvas-group', i18nKey: 'canvasGroup', icon: <CopyPlus size={18} />, color: '#d946ef' },
  { id: 'canvas-tab-list', canvasType: 'canvas-tab-list', i18nKey: 'canvasTabList', icon: <List size={18} />, color: '#3b82f6' },
  { id: 'map-platform', canvasType: 'canvas-map-platform', i18nKey: 'mapPlatform', icon: <Map size={18} />, color: '#0ea5e9' },
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
  const { t } = useTranslation();
  const [filter, setFilter] = useState<PaletteFilter>('all');

  // Hooks 必須在每次 render 以相同順序執行，不可放在 isEditMode 條件 return 之後
  const showContainers = filter === 'all' || filter === 'container';
  const filteredWidgets = useMemo(() => {
    if (filter === 'all' || filter === 'container') return PALETTE_ITEMS;
    return PALETTE_ITEMS.filter(w => w.category === filter);
  }, [filter]);

  const widgetSections = useMemo(() => {
    if (filter !== 'all') {
      return [{
        title: t(`dashboard.palette.filters.${filter}`),
        items: filteredWidgets,
      }];
    }
    return WIDGET_SECTIONS
      .map(sec => ({
        title: t(`dashboard.palette.filters.${sec.category}`),
        items: PALETTE_ITEMS.filter(w => w.category === sec.category),
      }))
      .filter(sec => sec.items.length > 0);
  }, [filter, filteredWidgets, t]);

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
          {t('dashboard.palette.viewMode')}
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
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0, marginRight: 4 }}>
          {t('dashboard.palette.filter')}
        </span>
        {FILTER_IDS.map(id => (
          <FilterChip
            key={id}
            active={filter === id}
            label={t(`dashboard.palette.filters.${id}`)}
            hint={t(`dashboard.palette.filters.${id}Hint`)}
            onClick={() => setFilter(id)}
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
            <SectionLabel title={t('dashboard.palette.containers')} />
            {CONTAINER_ITEMS.map(item => {
              const label = t(`dashboard.palette.containerItems.${item.i18nKey}.label`);
              const description = t(`dashboard.palette.containerItems.${item.i18nKey}.description`);
              return (
                <DraggableTile
                  key={item.id}
                  label={label}
                  icon={item.icon}
                  color={item.color}
                  title={t('dashboard.palette.dragToPlane', { label, description })}
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
              );
            })}
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
              const label = t(`dashboard.palette.widgets.${item.i18nKey}.label`);
              const description = t(`dashboard.palette.widgets.${item.i18nKey}.description`);
              const tileTitle = mapOnlyBlocked
                ? t('dashboard.palette.vehicleMapOnly')
                : t('dashboard.palette.dragToCanvas', { label, description });
              return (
              <DraggableTile
                key={item.type}
                label={label}
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
