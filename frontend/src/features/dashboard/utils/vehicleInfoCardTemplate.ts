import type {
  AlertBannerWidget,
  CanvasElementProps,
  ChildWidget,
  DashboardPlane,
  GaugeWidget,
  ImageWidget,
  ObstacleRingWidget,
  StatusBadgeWidget,
  TextWidget,
} from '../types';
import { createWidget } from '../types';
import { BUILTIN_BACKGROUND_IMAGES } from '../constants/backgroundImages';

/**
 * 總控大屏最下方的車輛卡片（群組「車輛狀態」，每台車一張）：舊版半圓儀表 → 新版資訊卡。
 *
 * 新版：上方車輛名稱與班次、左側四個子系統健康、中央俯視車輛＋八方向障礙點、右側速度與電量
 * （數字＋水平色帶）、底部凹槽裡的位置；卡片造型是背景圖 bg1。
 *
 * 規則：
 * - 只改這個群組的樣板與背景；群組 ID、資料來源、查詢、排序（依 vehicle_code）、外部位置與尺寸不動。
 * - 依「角色」認出既有子元件（不是 ID），保留它們的 ID 與資料綁定，只改位置、尺寸與呈現。
 * - 只升級舊版樣板：已經有八方向障礙元件就當作新版（可能被使用者再調整過），整個跳過。
 * - 拿掉的只有卡片底色／外框色塊與位置列底色：新背景圖本身就是卡片造型，色塊會蓋住它。
 */

export const VEHICLE_CARD_GROUP_LABEL = '車輛狀態';
export const VEHICLE_TOP_VIEW_SRC = '/dashboard-icons/vehicles/vehicles.svg';
const BG1 = BUILTIN_BACKGROUND_IMAGES.find((item) => item.id === 'bg1')!.url;

const HEALTH_FIELDS = ['status_computing', 'status_sensing', 'status_communication', 'status_chassis'] as const;

function isVehicleCardGroup(element: CanvasElementProps): boolean {
  return !!element.isGroup && element.label === VEHICLE_CARD_GROUP_LABEL;
}

function textContent(child: ChildWidget): string {
  return child.type === 'text' ? String((child as TextWidget).content ?? '') : '';
}

function gaugePath(child: ChildWidget): string {
  return child.type === 'gauge' ? String((child as GaugeWidget).mqttValuePath ?? '') : '';
}

/** 舊版：有半圓速度／電量儀表、還沒有八方向障礙元件 */
export function isLegacyVehicleCardTemplate(element: CanvasElementProps): boolean {
  if (!isVehicleCardGroup(element)) return false;
  const children = element.children ?? [];
  if (children.some((child) => child.type === 'obstacle-ring')) return false;
  return children.some(
    (child) => child.type === 'gauge' && (child as GaugeWidget).gaugeVariant === 'semi-arc',
  );
}

function place<T extends ChildWidget>(child: T, x: number, y: number, width: number, height: number): T {
  return { ...child, x, y, width, height };
}

/** 一個群組的樣板升級（不是舊版就原樣回傳） */
export function upgradeVehicleCardGroup(element: CanvasElementProps): CanvasElementProps {
  if (!isLegacyVehicleCardTemplate(element)) return element;
  const children = element.children ?? [];
  const out: ChildWidget[] = [];
  for (const child of children) {
    // 卡片底色／健康外框色塊、位置列底色：被背景圖取代
    if (child.type === 'color-block') continue;

    if (child.type === 'text' && textContent(child).includes('{vehicle_code}')) {
      out.push(
        place(
          {
            ...(child as TextWidget),
            // 系統顯示名稱（vehicles.display_name，沒有時就是 vehicle_code），不自行改寫車輛 ID
            content: textContent(child).split('{vehicle_code}').join('{vehicle_display}'),
            fontSize: 18,
            textAlign: 'left',
          } as TextWidget,
          96,
          12,
          128,
          26,
        ),
      );
      continue;
    }
    if (child.type === 'status-badge') {
      out.push(place({ ...(child as StatusBadgeWidget), fontSize: 16 }, 228, 13, 90, 24));
      continue;
    }
    if (child.type === 'alert-banner') {
      // 健康告警：照舊在有狀況時浮出（輪播），平常不佔位置
      out.push(place(child as AlertBannerWidget, 12, 42, 306, 20));
      continue;
    }
    const gauge = gaugePath(child);
    if (gauge === 'kinematics.velocity' || gauge === 'energy.battery_level') {
      const speed = gauge === 'kinematics.velocity';
      out.push(
        place(
          {
            ...(child as GaugeWidget),
            gaugeVariant: 'band',
            arcVariant: speed ? 'speed' : 'load',
            gaugeDecimals: 1,
            gaugeBandHeight: 5,
            gaugeValueFontSize: 22,
            gaugeUnitFontSize: 12,
            gaugeTextGap: 4,
            gaugeContentPadding: { top: 6, right: 10, bottom: 8, left: 10 },
            panelBackgroundColor: 'rgba(212, 212, 216, 0.1)',
            panelBorderRadius: 8,
          },
          222,
          speed ? 46 : 112,
          96,
          58,
        ),
      );
      continue;
    }
    const healthIndex = HEALTH_FIELDS.indexOf(
      String((child as TextWidget & { colorOnlyField?: string }).colorOnlyField ?? '') as (typeof HEALTH_FIELDS)[number],
    );
    if (child.type === 'text' && healthIndex >= 0) {
      out.push(place({ ...(child as TextWidget), fontSize: 16 }, 14, 48 + healthIndex * 32, 88, 26));
      continue;
    }
    if (child.type === 'text' && textContent(child).includes('{segment_label}')) {
      out.push(
        place(
          { ...(child as TextWidget), fontSize: 13, backgroundColor: 'transparent', textAlign: 'center' },
          121,
          170,
          88,
          20,
        ),
      );
      continue;
    }
    // 認不出角色的元件（使用者自己加的）：原樣保留
    out.push(child);
  }

  const image: ImageWidget = {
    ...(createWidget('image', 145, 68) as ImageWidget),
    id: `${element.id}-vehicle-top-view`,
    // vehicles.svg 原比例 38×72；中心與八方向點陣中心（164, 104）對齊
    width: 38,
    height: 72,
    src: VEHICLE_TOP_VIEW_SRC,
    objectFit: 'contain',
    borderRadius: 0,
    backgroundColor: 'transparent',
  };
  const ring: ObstacleRingWidget = {
    ...(createWidget('obstacle-ring', 118, 46) as ObstacleRingWidget),
    id: `${element.id}-obstacle-ring`,
    width: 92,
    height: 116,
  };
  return {
    ...element,
    backgroundImage: BG1,
    backgroundImageFit: 'contain',
    children: [...out, image, ring],
  };
}

/** 整張版面：只動車輛卡片群組，其他元素原物件回傳 */
export function upgradeVehicleCardTemplate(plane: DashboardPlane): { plane: DashboardPlane; upgraded: string[] } {
  const upgraded: string[] = [];
  const elements = plane.elements.map((element) => {
    const next = upgradeVehicleCardGroup(element);
    if (next !== element) upgraded.push(element.id);
    return next;
  });
  return { plane: upgraded.length ? { ...plane, elements } : plane, upgraded };
}
