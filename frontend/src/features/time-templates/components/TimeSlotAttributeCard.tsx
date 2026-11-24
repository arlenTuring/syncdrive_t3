import { Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ATTRIBUTE_CARD_FIELD_HEIGHT_PX,
  ATTRIBUTE_CARD_HEADER_ROW_PX,
  ATTRIBUTE_CARD_HEIGHT_PX,
  ATTRIBUTE_CARD_WIDTH_PX,
  clampAttributeNameInput,
  isAttributeNameWithinLimit,
  type TimeSlotAttribute,
} from '../types/editor';
import { AttributeColorPalette } from './AttributeColorPalette';
import { Button, cn, fieldClass } from '../../../components/ui';

const EDIT_FIELD_CLASS =
  cn(fieldClass({ size: 'sm', fullWidth: true }));

const CARD_CLASS =
  'relative flex shrink-0 flex-col gap-0.5 rounded-lg bg-surface-theme px-2.5 pb-1 pt-0.5';

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
  ariaLabel,
}: {
  color: string;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  ariaLabel: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="flex size-4 shrink-0 items-center justify-center rounded bg-surface-secondary p-0.5"
      aria-label={ariaLabel}
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
  const { t } = useTranslation();
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
            ariaLabel={t('timeTemplates.attributes.selectColor')}
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
          placeholder={t('timeTemplates.attributes.placeholder')}
          className={`min-w-0 flex-1 ${EDIT_FIELD_CLASS}`}
          style={EDIT_FIELD_STYLE}
          title={t('timeTemplates.attributes.nameLimitHint')}
        />

        <button
          type="button"
          disabled={!canConfirm}
          onClick={onConfirm}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-link-theme-filled text-text-primary transition hover:bg-link-theme-filled-hover disabled:cursor-not-allowed disabled:opacity-40"
          style={ACTION_BUTTON_STYLE}
          aria-label={t('timeTemplates.attributes.confirm')}
        >
          <Check className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="flex w-full items-center gap-3">
        <div className="w-[72px] shrink-0">
          <div className="text-caption-2 text-text-tertiary pb-0.5">
            {t('timeTemplates.attributes.headway')}
          </div>
          <input
            value={headwayInput}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '');
              onChange({
                headwaySeconds: raw === '' ? null : Number(raw),
              });
            }}
            placeholder={t('timeTemplates.attributes.placeholder')}
            inputMode="numeric"
            className={EDIT_FIELD_CLASS}
            style={EDIT_FIELD_STYLE}
          />
        </div>

        <div className="w-[72px] shrink-0">
          <div className="text-caption-2 text-text-tertiary pb-0.5">
            {t('timeTemplates.attributes.capacity')}
          </div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            <span className="text-body-xs-bold text-text-secondary">
              {attribute.capacityPphpd}
            </span>
            <span className="text-caption-2 text-text-tertiary pb-[1px]">pphpd</span>
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
  const { t } = useTranslation();
  const headwaySeconds =
    attribute.headwaySeconds != null && attribute.headwaySeconds > 0
      ? attribute.headwaySeconds
      : null;

  return (
    <article className={CARD_CLASS} style={CARD_STYLE}>
      <div className={CARD_HEADER_ROW_CLASS} style={CARD_HEADER_ROW_STYLE}>
        <ColorSwatch
          color={attribute.color}
          onClick={() => {}}
          buttonRef={colorRef}
          ariaLabel={t('timeTemplates.attributes.selectColor')}
        />
        <span className="min-w-0 flex-1 truncate text-body-xs-bold text-text-primary">
          {attribute.name}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={onToggleMenu}
            className="inline-flex items-center justify-center rounded-md text-text-quaternary hover:bg-surface-secondary hover:text-text-secondary"
            style={ACTION_BUTTON_STYLE}
            aria-label={t('common.moreActions')}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[90px] overflow-hidden rounded-md border border-border-quaternary bg-surface-primary py-0.5 shadow-xl">
              <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Pencil />} onPress={onStartEdit}>{t('common.edit')}</Button>
              <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Trash2 />} onPress={onDelete}>{t('common.delete')}</Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full items-center gap-3">
        <div className="w-[72px] shrink-0">
          <div className="text-caption-2 text-text-tertiary pb-0.5">
            {t('timeTemplates.attributes.headway')}
          </div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            {headwaySeconds != null ? (
              <>
                <span className="text-body-xs-bold text-text-secondary">
                  {headwaySeconds}
                </span>
                <span className="text-caption-2 text-text-secondary pb-[1px]">
                  {t('timeTemplates.attributes.seconds')}
                </span>
              </>
            ) : (
              <span className="text-body-xs-bold text-text-secondary">—</span>
            )}
          </div>
        </div>
        <div className="w-[72px] shrink-0">
          <div className="text-caption-2 text-text-tertiary pb-0.5">
            {t('timeTemplates.attributes.capacity')}
          </div>
          <div className={CARD_VALUE_ROW_CLASS} style={CARD_VALUE_ROW_STYLE}>
            <span className="text-body-xs-bold text-text-secondary">
              {attribute.capacityPphpd.toLocaleString('en-US')}
            </span>
            <span className="text-caption-2 text-text-tertiary pb-[1px]">pphpd</span>
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
