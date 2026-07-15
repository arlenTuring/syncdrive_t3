import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ATTRIBUTE_CARD_FIELD_HEIGHT_PX,
  ATTRIBUTE_CARD_HEADER_ROW_PX,
  ATTRIBUTE_CARD_HEIGHT_PX,
  ATTRIBUTE_CARD_WIDTH_PX,
  ATTRIBUTE_NAME_LIMIT_HINT,
  clampAttributeNameInput,
  isAttributeNameWithinLimit,
  type TimeSlotAttribute,
} from '../types/editor';
import { AttributeColorPalette } from './AttributeColorPalette';

const EDIT_FIELD_CLASS =
  'w-full rounded-md bg-[rgba(142,197,255,0.08)] px-2 py-0 text-xs leading-none text-[#D1D5DC] placeholder:text-[#99A1AF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/40';

const CARD_CLASS =
  'relative flex shrink-0 flex-col gap-0.5 rounded-lg bg-[rgba(142,197,255,0.08)] px-2.5 pb-1 pt-0.5';

const CARD_STYLE = {
  width: ATTRIBUTE_CARD_WIDTH_PX,
  height: ATTRIBUTE_CARD_HEIGHT_PX,
};

const CARD_HEADER_ROW_CLASS = 'flex w-full items-center gap-2';

const CARD_HEADER_ROW_STYLE = { height: ATTRIBUTE_CARD_HEADER_ROW_PX };

const CARD_VALUE_ROW_CLASS = 'flex items-end gap-0.5';

const CARD_VALUE_ROW_STYLE = { height: ATTRIBUTE_CARD_FIELD_HEIGHT_PX };

const EDIT_FIELD_STYLE = { height: ATTRIBUTE_CARD_FIELD_HEIGHT_PX };

const ACTION_BUTTON_STYLE = {
  width: ATTRIBUTE_CARD_FIELD_HEIGHT_PX,
  height: ATTRIBUTE_CARD_FIELD_HEIGHT_PX,
};

type TimeSlotAttributeCardProps = {
  attribute: TimeSlotAttribute;
  onChange: (patch: Partial<TimeSlotAttribute>) => void;
  onConfirm: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
};

function ColorSwatch({
  color,
  onClick,
  buttonRef,
}: {
  color: string;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="flex size-4 shrink-0 items-center justify-center rounded bg-[rgba(212,212,216,0.1)] p-0.5"
      aria-label="選擇顏色"
    >
      <span
        className="size-3 rounded-[2px]"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function EditModeCard({
  attribute,
  onChange,
  onConfirm,
  canConfirm,
  headwayInput,
  colorRef,
  paletteRef,
  nameInputRef,
  paletteOpen,
  onOpenPalette,
  onClosePalette,
}: {
  attribute: TimeSlotAttribute;
  onChange: (patch: Partial<TimeSlotAttribute>) => void;
  onConfirm: () => void;
  canConfirm: boolean;
  headwayInput: string;
  colorRef: React.RefObject<HTMLButtonElement | null>;
  paletteRef: React.RefObject<HTMLDivElement | null>;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  paletteOpen: boolean;
  onOpenPalette: () => void;
  onClosePalette: (color: string) => void;
}) {
  const palettePos = paletteOpen && colorRef.current
    ? (() => {
        const rect = colorRef.current.getBoundingClientRect();
        return { top: rect.top - 4, left: rect.left };
      })()
    : null;

  return (
    <article className={CARD_CLASS} style={CARD_STYLE}>
      <div className={CARD_HEADER_ROW_CLASS} style={CARD_HEADER_ROW_STYLE}>
        <div className="relative shrink-0">
          <ColorSwatch
            color={attribute.color}
            onClick={onOpenPalette}
            buttonRef={colorRef}
          />
          {paletteOpen && palettePos && createPortal(
            <div
              ref={paletteRef}
              className="fixed z-[9999]"
              style={{ top: palettePos.top, left: palettePos.left, transform: 'translateY(-100%)' }}
            >
              <AttributeColorPalette
                value={attribute.color}
                onChange={onClosePalette}
              />
            </div>,
            document.body,
          )}
        </div>

        <input
          ref={nameInputRef}
          value={attribute.name}
          onChange={(e) => onChange({ name: clampAttributeNameInput(e.target.value) })}
          placeholder="請輸入"
          className={`min-w-0 flex-1 ${EDIT_FIELD_CLASS}`}
          style={EDIT_FIELD_STYLE}
          title={ATTRIBUTE_NAME_LIMIT_HINT}
        />

        <button
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#2B7FFF] text-white transition hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:opacity-40"
          style={ACTION_BUTTON_STYLE}
          aria-label="確認"
        >
          <Check className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="flex w-full items-center gap-3">
        <div className="w-[72px] shrink-0">
          <div className="text-[10px] font-medium leading-none text-[#99A1AF] pb-0.5">
            班距
          </div>
          <input
            value={headwayInput}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '');
              onChange({
                headwaySeconds: raw === '' ? null : Number(raw),
              });
            }}
            placeholder="請輸入"
            inputMode="numeric"
            className={EDIT_FIELD_CLASS}
            style={EDIT_FIELD_STYLE}
          />
        </div>

        <div className="w-[72px] shrink-0">
          <div className="text-[10px] leading-none text-[#99A1AF] pb-0.5">運能</div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            <span className="text-xs font-medium leading-none text-[#D1D5DC]">
              {attribute.capacityPphpd}
            </span>
            <span className="text-[9px] leading-none text-[#99A1AF] pb-[1px]">pphpd</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function ViewModeCard({
  attribute,
  menuOpen,
  menuRef,
  colorRef,
  onToggleMenu,
  onStartEdit,
  onDelete,
}: {
  attribute: TimeSlotAttribute;
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  colorRef: React.RefObject<HTMLButtonElement | null>;
  onToggleMenu: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  const headwaySeconds =
    attribute.headwaySeconds != null && attribute.headwaySeconds > 0
      ? attribute.headwaySeconds
      : null;

  return (
    <article className={CARD_CLASS} style={CARD_STYLE}>
      <div className={CARD_HEADER_ROW_CLASS} style={CARD_HEADER_ROW_STYLE}>
        <ColorSwatch color={attribute.color} onClick={() => {}} buttonRef={colorRef} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium leading-none text-[#F3F4F6]">
          {attribute.name}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={onToggleMenu}
            className="inline-flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
            style={ACTION_BUTTON_STYLE}
            aria-label="更多操作"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[90px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-0.5 shadow-xl">
              <button
                type="button"
                onClick={onStartEdit}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <Pencil className="size-3 text-zinc-400" />
                編輯
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <Trash2 className="size-3 text-zinc-400" />
                刪除
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full items-center gap-3">
        <div className="w-[72px] shrink-0">
          <div className="text-[10px] font-medium leading-none text-[#99A1AF] pb-0.5">
            班距
          </div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            {headwaySeconds != null ? (
              <>
                <span className="text-xs font-medium leading-none text-[#D1D5DC]">
                  {headwaySeconds}
                </span>
                <span className="text-[9px] leading-none text-[#D1D5DC] pb-[1px]">秒</span>
              </>
            ) : (
              <span className="text-xs font-medium leading-none text-[#D1D5DC]">—</span>
            )}
          </div>
        </div>
        <div className="w-[72px] shrink-0">
          <div className="text-[10px] leading-none text-[#99A1AF] pb-0.5">運能</div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            <span className="text-xs font-medium leading-none text-[#D1D5DC]">
              {attribute.capacityPphpd.toLocaleString('en-US')}
            </span>
            <span className="text-[9px] leading-none text-[#99A1AF] pb-[1px]">pphpd</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function TimeSlotAttributeCard({
  attribute,
  onChange,
  onConfirm,
  onDelete,
  onStartEdit,
}: TimeSlotAttributeCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const colorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isEditing = attribute.isDraft;

  const headwayInput =
    attribute.headwaySeconds == null ? '' : String(attribute.headwaySeconds);

  const canConfirm =
    attribute.name.trim().length > 0
    && isAttributeNameWithinLimit(attribute.name.trim())
    && attribute.headwaySeconds != null
    && attribute.headwaySeconds > 0;

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
    }
  }, [isEditing, attribute.id]);

  useEffect(() => {
    if (!menuOpen && !paletteOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (colorRef.current?.contains(target)) return;
      if (paletteRef.current?.contains(target)) return;
      setMenuOpen(false);
      setPaletteOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen, paletteOpen]);

  if (isEditing) {
    return (
      <EditModeCard
        attribute={attribute}
        onChange={onChange}
        onConfirm={onConfirm}
        canConfirm={canConfirm}
        headwayInput={headwayInput}
        colorRef={colorRef}
        paletteRef={paletteRef}
        nameInputRef={nameInputRef}
        paletteOpen={paletteOpen}
        onOpenPalette={() => {
          setPaletteOpen(true);
          setMenuOpen(false);
        }}
        onClosePalette={(color) => {
          onChange({ color });
          setPaletteOpen(false);
        }}
      />
    );
  }

  return (
    <ViewModeCard
      attribute={attribute}
      menuOpen={menuOpen}
      menuRef={menuRef}
      colorRef={colorRef}
      onToggleMenu={() => setMenuOpen((open) => !open)}
      onStartEdit={() => {
        setMenuOpen(false);
        onStartEdit();
        setPaletteOpen(true);
      }}
      onDelete={() => {
        setMenuOpen(false);
        onDelete();
      }}
    />
  );
}
