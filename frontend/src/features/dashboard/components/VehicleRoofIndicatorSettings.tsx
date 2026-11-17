import type { CanvasElementProps } from '../types';
import {
  DEFAULT_ROOF_INDICATOR,
  resolveRoofIndicatorConfig,
  type VehicleRoofIndicatorConfig,
} from '../../map-editor/vehicles/vehicleRoofIndicator';
import { Checkbox } from '../../../components/ui';

const inputCls = 'w-full rounded bg-surface-secondary border border-border-quaternary px-2 py-1 text-body-xs text-text-primary';

/** 圖台容器：車頂軌道進度指標（軌道名稱、進度線、百分比） */
export function VehicleRoofIndicatorSettings({
  el,
  onUpdate,
}: {
  el: CanvasElementProps;
  onUpdate: (p: Partial<CanvasElementProps>) => void;
}) {
  const current = resolveRoofIndicatorConfig(el.vehicleRoofIndicator);
  const patch = (p: Partial<VehicleRoofIndicatorConfig>) =>
    onUpdate({ vehicleRoofIndicator: { ...current, ...p } });

  const check = (key: 'enabled' | 'showTrackName' | 'showPercent', label: string) => (
    <label className="flex items-center gap-2 text-body-xs text-text-secondary cursor-pointer">
      <Checkbox checked={current[key]} onCheckedChange={e => patch({ [key]: e })} />
      {label}
    </label>
  );
  const color = (key: 'progressColor' | 'railColor' | 'backgroundColor' | 'textColor', label: string) => (
    <label className="block text-caption-2 text-text-quaternary">
      {label}
      <input
        value={current[key]}
        onChange={e => patch({ [key]: e.target.value })}
        className={inputCls}
        placeholder={DEFAULT_ROOF_INDICATOR[key]}
      />
    </label>
  );

  return (
    <div className="space-y-2 rounded-lg border border-border-theme-light bg-surface-theme-light p-3">
      <div className="text-caption-2 uppercase text-text-theme">車頂軌道進度</div>
      <p className="text-caption-2 text-text-quaternary">
        名稱＝車目前判給的軌道；線段左端是這次通行的入口、箭頭是出口；百分比是這條軌道走了幾成（換軌道重算，不是整張訂單的進度）。停在格位、在場區移動（沒有對應軌道）時不顯示。
      </p>
      {check('enabled', '顯示')}
      {current.enabled && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {check('showTrackName', '軌道名稱')}
            {check('showPercent', '百分比')}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-caption-2 text-text-quaternary">
              字級（px）
              <input
                type="number"
                min={8}
                max={48}
                value={current.fontSizePx}
                onChange={e => patch({ fontSizePx: Math.min(48, Math.max(8, Number(e.target.value) || DEFAULT_ROOF_INDICATOR.fontSizePx)) })}
                className={inputCls}
              />
            </label>
            <label className="block text-caption-2 text-text-quaternary">
              線段長度（px）
              <input
                type="number"
                min={24}
                max={240}
                value={current.barWidthPx}
                onChange={e => patch({ barWidthPx: Math.min(240, Math.max(24, Number(e.target.value) || DEFAULT_ROOF_INDICATOR.barWidthPx)) })}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {color('progressColor', '已走線段／移動點')}
            {color('railColor', '未走線段／入口／出口')}
            {color('textColor', '文字')}
            {color('backgroundColor', '底色')}
          </div>
        </>
      )}
    </div>
  );
}
