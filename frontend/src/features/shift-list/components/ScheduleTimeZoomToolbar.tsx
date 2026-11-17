import { Minus, Plus } from 'lucide-react';
import {
  clampGridZoom,
  GRID_ZOOM_MAX,
  GRID_ZOOM_MIN,
  GRID_ZOOM_STEP,
} from '../../time-templates/types/editor';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/ui';

type ScheduleTimeZoomToolbarProps = {
  zoom: number;
  onChange: (zoom: number) => void;
  /** 獨立成一組邊框工具列（預覽頁）；調整步驟已包在更大的工具列裡 */
  standalone?: boolean;
};

/**
 * 班表格線時間刻度縮放（−／讀數／＋）。
 * 讀數固定寬度，倍率從 40% 變到 300% 時工具列不會跟著抖。
 */
export function ScheduleTimeZoomToolbar({
  zoom,
  onChange,
  standalone = false,
}: ScheduleTimeZoomToolbarProps) {
  const { t } = useTranslation();
  const inner = (
    <>
      <button
        type="button"
        disabled={zoom <= GRID_ZOOM_MIN}
        onClick={() => onChange(clampGridZoom(zoom - GRID_ZOOM_STEP))}
        className={`rounded p-1.5 transition ${
          zoom > GRID_ZOOM_MIN
            ? 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
            : 'cursor-not-allowed text-text-disabled opacity-40'
        }`}
        title={t('shiftList.timeZoom.zoomOut')}
      >
        <Minus className="size-4" />
      </button>

      <Button hierarchy="subordinate" variant="standard" className="w-10 shrink-0" onPress={() => onChange(1)} title={t('shiftList.timeZoom.reset')}>{Math.round(zoom * 100)}%</Button>

      <button
        type="button"
        disabled={zoom >= GRID_ZOOM_MAX}
        onClick={() => onChange(clampGridZoom(zoom + GRID_ZOOM_STEP))}
        className={`rounded p-1.5 transition ${
          zoom < GRID_ZOOM_MAX
            ? 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
            : 'cursor-not-allowed text-text-disabled opacity-40'
        }`}
        title={t('shiftList.timeZoom.zoomIn')}
      >
        <Plus className="size-4" />
      </button>
    </>
  );

  if (!standalone) return inner;

  return (
    <div className="flex shrink-0 select-none items-center gap-2 rounded-lg border border-border-quaternary bg-surface-primary px-2 py-1">
      {inner}
    </div>
  );
}
