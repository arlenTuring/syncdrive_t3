import { useMemo } from 'react';
import type { MaintenanceDistributionWidget as MaintenanceDistributionType } from '../types';
import { presetIconUrl } from '../constants/iconLibrary';
import { useWidgetData } from './useWidgetData';
import { WidgetEditPreviewOutline } from '../components/EditPreviewChrome';
import {
  useIsEditMode,
  resolveWidgetPreviewLabel,
  shouldShowEditPreview,
  widgetHasDataBinding,
} from '../utils/widgetEditPreview';

/**
 * 整備分佈
 * ========
 *
 * 類別、格位、哪一格有車全部來自後端 <code>/syncdrive-api/facility/maintenance-distribution</code>：
 * 類別＝部署中班表啟用的整備區塊（名稱照班表設定），格位＝整備任務各區塊用的設施格，
 * 有車＝車輛即時位置落在那一格、且車正在做的是這一類整備。元件不寫死任何代號。
 *
 * 使用中的格位是「突起」的：亮底、白字、上緣高光加下方陰影；空格是凹下去的暗格。
 */

type SlotView = { code: string; occupied: boolean; vehicleCode: string | null };
type CategoryView = { key: string; label: string; occupiedCount: number; slots: SlotView[] };
type DistributionView = {
  activeCategories: number;
  totalCategories: number;
  categories: CategoryView[];
  message: string | null;
};

const FONT_UI = 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

/** 各整備區塊預設圖示；可由元件設定 sectionIconImages 覆寫 */
const MAINTENANCE_SECTION_ICONS: Record<string, string> = {
  charging: presetIconUrl('facility/charging.png'),
  carWash: presetIconUrl('facility/wash.png'),
  maintenance: presetIconUrl('facility/maintainance.png'),
  preTrip: presetIconUrl('facility/repair.png'),
  mobile: presetIconUrl('facility/park.png'),
};

/** 編輯模式沒有資料：顯示空的分佈（原本是一組寫死的格位與佔用示範，已移除） */
const EMPTY_MAINTENANCE_DISTRIBUTION: DistributionView = {
  activeCategories: 0,
  totalCategories: 0,
  message: '無資料',
  categories: [],
};

function parseDistribution(row: Record<string, unknown> | undefined): DistributionView | null {
  if (!row || !Array.isArray(row.categories)) return null;
  const categories = (row.categories as Array<Record<string, unknown>>).map((category) => ({
    key: String(category.key ?? ''),
    label: String(category.label ?? category.key ?? ''),
    occupiedCount: Number(category.occupiedCount) || 0,
    slots: (Array.isArray(category.slots) ? category.slots as Array<Record<string, unknown>> : []).map((slot) => ({
      code: String(slot.code ?? ''),
      occupied: slot.occupied === true,
      vehicleCode: typeof slot.vehicleCode === 'string' ? slot.vehicleCode : null,
    })),
  }));
  return {
    activeCategories: Number(row.activeCategories) || 0,
    totalCategories: Number(row.totalCategories) || categories.length,
    categories,
    message: typeof row.message === 'string' ? row.message : null,
  };
}

/** 半寬卡片放得下的格位數；超過就整列（待命常常列了十來格） */
const SLOTS_PER_HALF_CARD = 6;

/**
 * 每張卡佔幾欄、總共幾列。格位多的卡佔滿一整列；最後一列只剩一張卡時也拉滿，
 * 不留半張空白。
 */
function layoutCategories(slotCounts: number[], columns: number): { spans: number[]; rows: number } {
  const spans = slotCounts.map((count) => (columns > 1 && count > SLOTS_PER_HALF_CARD ? columns : 1));
  let rows = 0;
  let used = columns; // 目前這一列已用掉幾欄（起始視為已滿，第一張卡會開新列）
  const rowStart: number[] = [];
  spans.forEach((span, index) => {
    if (used + span > columns) {
      rows += 1;
      used = 0;
      rowStart.push(index);
    }
    used += span;
  });
  // 每一列的最後一張卡補滿剩下的欄
  rowStart.forEach((start, rowIndex) => {
    const end = rowIndex + 1 < rowStart.length ? rowStart[rowIndex + 1]! : spans.length;
    const usedInRow = spans.slice(start, end).reduce((sum, span) => sum + span, 0);
    if (usedInRow < columns) spans[end - 1]! += columns - usedInRow;
  });
  return { spans, rows: Math.max(1, rows) };
}

function Slot({ slot, fontSize }: { slot: SlotView; fontSize: number }) {
  return (
    <div
      title={slot.occupied && slot.vehicleCode ? `${slot.code}：${slot.vehicleCode}` : slot.code}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        height: '100%',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: slot.occupied ? 600 : 500,
        letterSpacing: 0.2,
        userSelect: 'none',
        boxSizing: 'border-box',
        transition: 'background 0.25s ease, color 0.25s ease, box-shadow 0.25s ease',
        ...(slot.occupied
          ? {
              // 突起：亮底白字、上緣高光、下方投影
              background: 'linear-gradient(180deg, #5B5B63 0%, #4A4A52 100%)',
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 4px rgba(0,0,0,0.45)',
            }
          : {
              // 空格：凹下去的暗格
              background: 'rgba(24,24,27,0.55)',
              color: '#9F9FA9',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)',
            }),
      }}
    >
      {slot.code}
    </div>
  );
}

export function MaintenanceDistributionWidgetView({ widget }: { widget: MaintenanceDistributionType }) {
  const isEditMode = useIsEditMode();
  const hasBinding = widgetHasDataBinding(widget);
  const { data, loading, error } = useWidgetData({
    dataUrl: widget.dataUrl,
    dataSourceId: widget.dataSourceId,
    sqlQuery: widget.sqlQuery,
    refreshInterval: widget.refreshInterval,
    refreshMode: widget.refreshMode ?? 'event',
    invalidateTags: widget.invalidateTags ?? ['domain:maintenance_slots', 'table:operation_orders'],
    freshnessPolicy: widget.freshnessPolicy,
  });

  const live = useMemo(() => parseDistribution(data[0]), [data]);
  const isEditPreview = shouldShowEditPreview(isEditMode, hasBinding, Boolean(live?.categories.length));
  const view = isEditPreview ? EMPTY_MAINTENANCE_DISTRIBUTION : live;

  const columns = Math.max(1, widget.columns ?? 2);
  const titleFs = widget.titleFontSize ?? 16;
  const headerFs = widget.headerFontSize ?? 20;
  const cardTitleFs = widget.cardTitleFontSize ?? 16;
  const slotFs = widget.slotFontSize ?? 14;
  const icons = { ...MAINTENANCE_SECTION_ICONS, ...widget.sectionIconImages };
  const categories = view?.categories ?? [];
  const { spans, rows } = layoutCategories(categories.map((category) => category.slots.length), columns);

  return (
    <WidgetEditPreviewOutline
      active={isEditPreview}
      label={resolveWidgetPreviewLabel({ ...widget, type: 'maintenance-distribution', title: widget.title })}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          boxSizing: 'border-box',
          fontFamily: FONT_UI,
          ...(isEditPreview ? { opacity: 0.88 } : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, height: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: titleFs, fontWeight: 700, color: '#F3F4F6' }}>
            {widget.titleIconImage ? (
              <img src={widget.titleIconImage} alt="" style={{ width: titleFs + 4, height: titleFs + 4, objectFit: 'contain' }} />
            ) : null}
            <span>{widget.title || '整備分佈'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: '#D1D5DC' }}>
            <span style={{ fontSize: headerFs, fontWeight: 700, color: '#FFFFFF' }}>{view?.activeCategories ?? 0}</span>
            <span style={{ fontSize: Math.round(headerFs * 0.8) }}>/ {view?.totalCategories ?? 0}</span>
          </div>
        </div>

        {categories.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>
            {error ? '資料載入失敗' : loading ? '載入中…' : view?.message || '等待整備資料…'}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              gap: 4,
            }}
          >
            {categories.map((category, index) => (
              <div
                key={category.key}
                style={{
                  gridColumn: `span ${spans[index]}`,
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '4px 8px 6px',
                  borderRadius: 8,
                  background: 'rgba(212, 212, 216, 0.1)',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: cardTitleFs, fontWeight: 700, color: '#F3F4F6', minWidth: 0 }}>
                    {icons[category.key] ? (
                      <img src={icons[category.key]} alt="" style={{ width: cardTitleFs + 2, height: cardTitleFs + 2, objectFit: 'contain', flexShrink: 0 }} />
                    ) : null}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{category.label}</span>
                  </div>
                  <span style={{ fontSize: cardTitleFs, fontWeight: 700, color: '#D1D5DC' }}>{category.occupiedCount}</span>
                </div>
                <div style={{ flex: 1, minHeight: 20, display: 'flex', gap: 4 }}>
                  {category.slots.length > 0
                    ? category.slots.map((slot) => <Slot key={slot.code} slot={slot} fontSize={slotFs} />)
                    : (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', alignSelf: 'center' }}>
                        地圖上沒有這一類的格位
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetEditPreviewOutline>
  );
}
