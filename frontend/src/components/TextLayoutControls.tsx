import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  Crosshair,
  WrapText,
} from 'lucide-react';
import type { TextWrapMode } from '../lib/textLayout';
import type { LabelPlacement } from '../features/map-editor/utils/facilityLabelStyle';
import { LABEL_PLACEMENT_LABELS } from '../features/map-editor/utils/facilityLabelStyle';

type Props = {
  textWrap: TextWrapMode;
  onTextWrapChange: (value: TextWrapMode) => void;
  labelBoxWidthPx?: number;
  labelBoxHeightPx?: number;
  onLabelBoxWidthChange: (value: number | undefined) => void;
  onLabelBoxHeightChange: (value: number | undefined) => void;
  labelPlacement?: LabelPlacement;
  onLabelPlacementChange?: (value: LabelPlacement) => void;
  showPlacement?: boolean;
  disabled?: boolean;
};

function LayoutButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex size-8 items-center justify-center rounded-md border transition-colors',
        active
          ? 'border-cyan-500/70 bg-cyan-500/15 text-cyan-300'
          : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const PLACEMENT_ORDER: LabelPlacement[] = ['above', 'below', 'left', 'right', 'center'];

const PLACEMENT_ICONS: Record<LabelPlacement, ReactNode> = {
  above: <ArrowUp size={15} strokeWidth={2} />,
  below: <ArrowDown size={15} strokeWidth={2} />,
  left: <ArrowLeft size={15} strokeWidth={2} />,
  right: <ArrowRight size={15} strokeWidth={2} />,
  center: <Crosshair size={15} strokeWidth={2} />,
};

export function TextLayoutControls({
  textWrap,
  onTextWrapChange,
  labelBoxWidthPx,
  labelBoxHeightPx,
  onLabelBoxWidthChange,
  onLabelBoxHeightChange,
  labelPlacement = 'center',
  onLabelPlacementChange,
  showPlacement = false,
  disabled = false,
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1.5 text-[10px] text-zinc-500">文字排列</p>
        <div className="flex gap-1">
          <LayoutButton
            active={textWrap === 'single'}
            disabled={disabled}
            title="單行（拉平不換行）"
            onClick={() => onTextWrapChange('single')}
          >
            <ArrowRightToLine size={15} strokeWidth={2} />
          </LayoutButton>
          <LayoutButton
            active={textWrap === 'wrap'}
            disabled={disabled}
            title="自動換行"
            onClick={() => onTextWrapChange('wrap')}
          >
            <WrapText size={15} strokeWidth={2} />
          </LayoutButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">標籤寬度（px）</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={16}
              max={960}
              step={1}
              disabled={disabled}
              value={labelBoxWidthPx ?? ''}
              placeholder="自動"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onLabelBoxWidthChange(undefined);
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n)) onLabelBoxWidthChange(n);
              }}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onLabelBoxWidthChange(undefined)}
              className="shrink-0 rounded border border-zinc-600 px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            >
              自動
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-zinc-500">標籤高度（px）</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={12}
              max={240}
              step={1}
              disabled={disabled}
              value={labelBoxHeightPx ?? ''}
              placeholder="自動"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onLabelBoxHeightChange(undefined);
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n)) onLabelBoxHeightChange(n);
              }}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onLabelBoxHeightChange(undefined)}
              className="shrink-0 rounded border border-zinc-600 px-1.5 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
            >
              自動
            </button>
          </div>
        </div>
      </div>

      {showPlacement && onLabelPlacementChange ? (
        <div>
          <p className="mb-1.5 text-[10px] text-zinc-500">名稱位置</p>
          <div className="flex flex-wrap gap-1">
            {PLACEMENT_ORDER.map((placement) => (
              <LayoutButton
                key={placement}
                active={labelPlacement === placement}
                disabled={disabled}
                title={LABEL_PLACEMENT_LABELS[placement]}
                onClick={() => onLabelPlacementChange(placement)}
              >
                {PLACEMENT_ICONS[placement]}
              </LayoutButton>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
