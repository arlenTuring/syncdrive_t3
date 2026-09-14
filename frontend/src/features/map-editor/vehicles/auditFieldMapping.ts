import type { MapAreaObject } from '../types/area';
import { fieldMetersAtAreaLocal } from '../utils/fieldFromArea';
import { getTrackGenPaths, pointAlongPath } from '../utils/trackGenPaths';
import {
  buildTrackNetwork,
  resolveVehiclePlacementAcrossAreas,
} from './resolveVehicleTrackPlacement';
import { pxPerMeterOnFacility } from './resolveMapVehicleTrackSizing';

/**
 * 圖資健檢：車畫在現場的哪裡，準不準。
 *
 * <h3>往返誤差</h3>
 * 沿每一塊的真實中心線取樣，走完整條「車輛定位」那條路算出圖面位置，再把那個圖面位置
 * 換<strong>回</strong>現場座標，兩者相減。同一個點來回一趟應該回到原地；回不去，就表示
 * 這一塊的某個環節壞了。
 *
 * 這個指標的好處是<strong>不必看畫面、也不必知道正確答案</strong>：它比對的是系統自己
 * 的兩個方向，任何一邊壞掉都會露出來。實測抓到過：
 *
 * <pre>
 *   缺 trackGenLatPerBox      換算回傳容器網域的數字   往返誤差 1400 公尺
 *   共用同一份中心線          兩塊宣稱自己是同一段路   往返誤差 330 公尺
 *   停靠點的座標沒跟著重算    畫的位置與座標差一塊     往返誤差 76 公尺
 * </pre>
 *
 * <h3>判給別塊</h3>
 * 取樣點取自某一塊自己的中心線，定位卻判給另一塊——那是「誰來解釋這個點」挑錯了。
 * 路口的元件互相重疊，少數幾筆是正常的；一整塊九筆全中就是壞了。
 *
 * <h3>比例尺</h3>
 * 每一塊「一公尺畫幾像素」。示意圖本來就不是等比例，但差距太大的地方要小心：載具、
 * 停靠點這些「放進去的東西」如果用同一個像素尺寸走遍全圖，在比例尺小的地方會塞不下。
 */

export type FieldMappingAudit = {
  /** 逐塊結果，往返誤差大的排前面 */
  blocks: Array<{
    code: string;
    id: string;
    /** 元件種類：Rail／RailCorner／RailTaper／RailSwitch／RailCross */
    kind: string;
    /** 路口的元件（斜接、分岔、交叉）多條帶子重疊，取樣點被鄰居接走是正常的 */
    junction: boolean;
    /** 往返誤差最大值（公尺） */
    worstM: number;
    /** 取樣點被判給別塊的次數 */
    wrongBlock: number;
    samples: number;
    alongPxPerM: number | null;
    acrossPxPerM: number | null;
  }>;
  medianWorstM: number;
  /** 往返誤差超過門檻的塊 */
  overThreshold: string[];
  /** 沿線比例尺的最小、中位、最大 */
  alongPxPerM: { min: number; median: number; max: number } | null;
};

const SAMPLE_FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export function auditFieldMapping(
  areas: MapAreaObject[],
  options?: { thresholdM?: number },
): FieldMappingAudit {
  const thresholdM = options?.thresholdM ?? 1;
  const net = buildTrackNetwork(areas);
  const blocks: FieldMappingAudit['blocks'] = [];

  for (const area of areas) {
    for (const f of area.facilities) {
      if (f.type !== 'Track') continue;
      const paths = getTrackGenPaths(f.parameters);
      if (!paths) continue;
      let worstM = 0;
      let wrongBlock = 0;
      for (const t of SAMPLE_FRACTIONS) {
        const pt = pointAlongPath(paths.real, t);
        const place = resolveVehiclePlacementAcrossAreas(areas, pt.x, pt.y, net);
        if (!place) {
          wrongBlock += 1;
          continue;
        }
        if (place.placement.trackId !== f.id) wrongBlock += 1;
        const back = fieldMetersAtAreaLocal(
          place.area,
          place.placement.areaLocalX,
          place.placement.areaLocalY,
        );
        const err = Math.hypot(back.xM - pt.x, back.yM - pt.y);
        if (Number.isFinite(err) && err > worstM) worstM = err;
      }
      const scale = pxPerMeterOnFacility(f, area);
      blocks.push({
        code: f.customName?.trim() || f.id,
        id: f.id,
        kind: f.name,
        junction: /Taper|Switch|Cross/.test(f.name),
        worstM: Number(worstM.toFixed(2)),
        wrongBlock,
        samples: SAMPLE_FRACTIONS.length,
        alongPxPerM: scale ? Number(scale.alongPxPerM.toFixed(3)) : null,
        acrossPxPerM: scale ? Number(scale.acrossPxPerM.toFixed(3)) : null,
      });
    }
  }

  blocks.sort((a, b) => b.worstM - a.worstM);
  const median = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const alongs = blocks
    .map((b) => b.alongPxPerM)
    .filter((v): v is number => v != null);

  return {
    blocks,
    medianWorstM: median(blocks.map((b) => b.worstM)),
    overThreshold: blocks.filter((b) => b.worstM > thresholdM).map((b) => b.code),
    alongPxPerM: alongs.length
      ? {
          min: Math.min(...alongs),
          median: median(alongs),
          max: Math.max(...alongs),
        }
      : null,
  };
}

/** 健檢結果印成一段話，給 console 用 */
export function describeFieldMappingAudit(audit: FieldMappingAudit): string {
  const lines = [
    `[圖資健檢] ${audit.blocks.length} 塊軌道，往返誤差中位數 ${audit.medianWorstM} m`,
  ];
  if (audit.overThreshold.length > 0) {
    lines.push(
      `  往返誤差偏大：${audit.blocks
        .filter((b) => audit.overThreshold.includes(b.code))
        .slice(0, 10)
        .map((b) => `${b.code} ${b.worstM}m`)
        .join('、')}`,
    );
  }
  const wrong = audit.blocks.filter((b) => b.wrongBlock > 0);
  if (wrong.length > 0) {
    lines.push(
      `  取樣點被判給別塊：${wrong
        .slice(0, 10)
        .map((b) => `${b.code} ${b.wrongBlock}/${b.samples}`)
        .join('、')}`,
    );
  }
  if (audit.alongPxPerM) {
    const { min, median, max } = audit.alongPxPerM;
    lines.push(
      `  沿線比例尺 ${min} ~ ${max} px/m（中位 ${median}），最大與最小差 ${(max / Math.max(1e-6, min)).toFixed(0)} 倍`,
    );
  }
  return lines.join('\n');
}
