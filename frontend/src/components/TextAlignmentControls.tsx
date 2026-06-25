import type { ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from 'lucide-react';
import type {
  TextHorizontalAlign,
  TextVerticalAlign,
} from '../lib/textAlignment';

type Props = {
  horizontal: TextHorizontalAlign;
  vertical: TextVerticalAlign;
  onHorizontalChange: (value: TextHorizontalAlign) => void;
  onVerticalChange: (value: TextVerticalAlign) => void;
  disabled?: boolean;
  horizontalLabel?: string;
  verticalLabel?: string;
};

function AlignButton({
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

export function TextAlignmentControls({
  horizontal,
  vertical,
  onHorizontalChange,
  onVerticalChange,
  disabled = false,
  horizontalLabel = '橫向對齊',
  verticalLabel = '縱向對齊',
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1.5 text-[10px] text-zinc-500">{horizontalLabel}</p>
        <div className="flex gap-1">
          <AlignButton
            active={horizontal === 'left'}
            disabled={disabled}
            title="靠左"
            onClick={() => onHorizontalChange('left')}
          >
            <AlignLeft size={15} strokeWidth={2} />
          </AlignButton>
          <AlignButton
            active={horizontal === 'center'}
            disabled={disabled}
            title="置中"
            onClick={() => onHorizontalChange('center')}
          >
            <AlignCenter size={15} strokeWidth={2} />
          </AlignButton>
          <AlignButton
            active={horizontal === 'right'}
            disabled={disabled}
            title="靠右"
            onClick={() => onHorizontalChange('right')}
          >
            <AlignRight size={15} strokeWidth={2} />
          </AlignButton>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] text-zinc-500">{verticalLabel}</p>
        <div className="flex gap-1">
          <AlignButton
            active={vertical === 'top'}
            disabled={disabled}
            title="靠上"
            onClick={() => onVerticalChange('top')}
          >
            <AlignVerticalJustifyStart size={15} strokeWidth={2} />
          </AlignButton>
          <AlignButton
            active={vertical === 'center'}
            disabled={disabled}
            title="置中"
            onClick={() => onVerticalChange('center')}
          >
            <AlignVerticalJustifyCenter size={15} strokeWidth={2} />
          </AlignButton>
          <AlignButton
            active={vertical === 'bottom'}
            disabled={disabled}
            title="靠下"
            onClick={() => onVerticalChange('bottom')}
          >
            <AlignVerticalJustifyEnd size={15} strokeWidth={2} />
          </AlignButton>
        </div>
      </div>
    </div>
  );
}
