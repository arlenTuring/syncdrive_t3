import type { CanvasElementProps, ChildWidget, DashboardPlane, LineChartWidget } from '../types';
import { CAPACITY_TREND_URL } from '../constants/demoSql';

/**
 * 運能趨勢圖（line-chart，資料來源 /operation-metrics/capacity-trend）的設定升級。
 *
 * 後端改回傳帶日期的營運時間戳（ts）、模板時段（segment_id／segment_color）與資料問題（data_issue）。
 * 舊設定以 HH:mm 字串當 X 軸、色帶寫死「執行中＝橘、排程＝綠」、每筆資料畫小圓點。這裡只改：
 * - X 軸：xField time → ts（跨午夜、倍速都依時間戳排序）
 * - 色帶：起點 ts、區段 segment_id、顏色直接取模板的 segment_color（不再維護第二份色表）
 * - 兩條線關閉每筆資料的小圓點；「現在」端點標在實際運能線（事件標記照舊；已升級的圖只補這一項）
 * - 資料問題欄位 data_issue
 * - 事件模式之外每 30 秒補查一次：數值不變時「現在」端點也跟著時間往前
 * 元件 ID、位置、尺寸、顏色、線寬、事件標籤樣式都不動。只升級 xField 還是 time 的舊設定（可重複執行，
 * 已升級或使用者另外調整過 X 軸欄位的不動）。
 */
export function isLegacyCapacityTrendChart(widget: { type: string; dataUrl?: string; xField?: string }): boolean {
  return isCapacityTrendChart(widget) && widget.xField === 'time';
}

function isCapacityTrendChart(widget: { type: string; dataUrl?: string }): boolean {
  return widget.type === 'line-chart' && (widget.dataUrl ?? '').split('?')[0].endsWith(CAPACITY_TREND_URL);
}

/** 「現在」端點標在實際運能那條（跟上方即時數值同一個值），不是預期線；已指定過就不動 */
function withActualNowEndpoint(widget: LineChartWidget): LineChartWidget {
  const series = widget.series ?? [];
  if (series.some((item) => item.nowEndpoint) || !series.some((item) => item.yField === 'actual_util')) return widget;
  return {
    ...widget,
    series: series.map((item) => (item.yField === 'actual_util' ? { ...item, nowEndpoint: true } : item)),
  };
}

export function upgradeCapacityTrendChart(widget: LineChartWidget): LineChartWidget {
  if (!isCapacityTrendChart(widget)) return widget;
  if (!isLegacyCapacityTrendChart(widget)) return withActualNowEndpoint(widget);
  return withActualNowEndpoint({
    ...widget,
    xField: 'ts',
    dataIssueField: 'data_issue',
    refreshInterval: widget.refreshInterval && widget.refreshInterval > 0 ? widget.refreshInterval : 30,
    series: widget.series?.map((series) => ({ ...series, showPoints: false })),
    axisBands: (widget.axisBands ?? []).map((band) =>
      band.axis === 'x' && band.segmentField === 'segment_code'
        ? {
            ...band,
            startField: 'ts',
            segmentField: 'segment_id',
            colorField: 'segment_color',
            colorRules: [],
          }
        : band),
  });
}

function upgradeChildren(children: ChildWidget[], upgraded: string[]): ChildWidget[] {
  let changed = false;
  const next = children.map((child) => {
    if (child.type !== 'line-chart') return child;
    const after = upgradeCapacityTrendChart(child as LineChartWidget);
    if (after !== child) {
      changed = true;
      upgraded.push(child.id);
    }
    return after as ChildWidget;
  });
  return changed ? next : children;
}

/** 整張版面：只動運能趨勢圖，其他元素原物件回傳 */
export function upgradeCapacityTrendCharts(plane: DashboardPlane): { plane: DashboardPlane; upgraded: string[] } {
  const upgraded: string[] = [];
  const elements = plane.elements.map((element: CanvasElementProps) => {
    const children = upgradeChildren(element.children ?? [], upgraded);
    return children === element.children ? element : { ...element, children };
  });
  return { plane: upgraded.length ? { ...plane, elements } : plane, upgraded };
}
