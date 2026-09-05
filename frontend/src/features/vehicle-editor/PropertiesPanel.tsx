import { NumberInput } from '../../components/NumberInput'
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { WidgetDataBindingSettings } from '../dashboard/elements/WidgetDataBindingSettings';
import { VehicleAssetPicker } from './components/VehicleAssetPicker';
import type { VehicleAssetCategory } from './constants/assetLibrary';
import { DEFAULT_BODY_IMAGE, DEFAULT_BODY_TINT, DEFAULT_DOOR_COLOR } from './constants/palette';
import type {
  VehicleDefinition,
  VehicleElement,
  VehicleImageRule,
  VehicleMatchOp,
} from './types';
import { normalizeDegrees } from '../map-editor/utils/rotation';
import { VehicleRotationToolbar } from './components/VehicleRotationToolbar';
import { newRuleId } from './utils/id';
import { isTransparentColor, toColorInputHex } from './utils/colorInput';
import { VEHICLE_NUDGE_SHIFT_STEP, VEHICLE_NUDGE_STEP } from './utils/vehicleNudge';

const inputCls =
  'w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20';
const selectCls = `${inputCls} cursor-pointer`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-bold uppercase tracking-tight text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

/** 0–100 整數；編輯中允許空白，避免 number input 刪不掉前導 0 */
function PercentInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Math.min(100, Math.max(0, Number.parseInt(raw, 10) || 0));
    setText(String(n));
    onChange(n);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || /^\d{1,3}$/.test(v)) setText(v);
      }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}

const IMAGE_MATCH_OPS: VehicleMatchOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'];

function ImageRulesEditor({
  rules,
  onChange,
  assetCategory = 'body',
}: {
  rules: VehicleImageRule[];
  onChange: (rules: VehicleImageRule[]) => void;
  assetCategory?: VehicleAssetCategory;
}) {
  const { t } = useTranslation();
  const matchLabel = (op: VehicleMatchOp) => {
    const map: Record<VehicleMatchOp, string> = {
      eq: t('vehicleEditor.properties.matchEq'),
      neq: t('vehicleEditor.properties.matchNeq'),
      gt: t('vehicleEditor.properties.matchGt'),
      gte: t('vehicleEditor.properties.matchGte'),
      lt: t('vehicleEditor.properties.matchLt'),
      lte: t('vehicleEditor.properties.matchLte'),
      contains: t('vehicleEditor.properties.matchContains'),
    };
    return map[op];
  };

  const updateRule = (idx: number, patch: Partial<VehicleImageRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRule = () => {
    onChange([
      ...rules,
      {
        id: newRuleId(),
        sourceField: 'overall_health',
        matchOp: 'eq',
        threshold: 'OK',
        imageFile: DEFAULT_BODY_IMAGE,
        tintColor: DEFAULT_BODY_TINT,
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-zinc-400">{t('vehicleEditor.properties.imageRules')}</span>
        <button type="button" onClick={addRule} className="rounded p-1 text-amber-500 hover:bg-zinc-800">
          <Plus size={14} />
        </button>
      </div>
      {rules.map((rule, i) => (
        <div key={rule.id} className="space-y-1.5 rounded border border-zinc-700/50 bg-zinc-800/30 p-2">
          <div className="flex gap-1">
            <input
              value={rule.label ?? ''}
              onChange={(e) => updateRule(i, { label: e.target.value })}
              className={`${inputCls} flex-1`}
              placeholder={t('vehicleEditor.properties.ruleLabel')}
              style={{ fontSize: 10 }}
            />
            <button
              type="button"
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
              className="p-1 text-zinc-500 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <input
            value={rule.sourceField}
            onChange={(e) => updateRule(i, { sourceField: e.target.value })}
            className={inputCls}
            placeholder={t('vehicleEditor.properties.sourceField')}
            style={{ fontSize: 10 }}
          />
          <div className="grid grid-cols-2 gap-1">
            <select
              value={rule.matchOp}
              onChange={(e) => updateRule(i, { matchOp: e.target.value as VehicleMatchOp })}
              className={selectCls}
              style={{ fontSize: 10 }}
            >
              {IMAGE_MATCH_OPS.map((o) => (
                <option key={o} value={o}>
                  {matchLabel(o)}
                </option>
              ))}
            </select>
            <input
              value={rule.threshold}
              onChange={(e) => updateRule(i, { threshold: e.target.value })}
              className={inputCls}
              placeholder={t('vehicleEditor.properties.threshold')}
              style={{ fontSize: 10 }}
            />
          </div>
          {assetCategory !== 'body' && (
            <VehicleAssetPicker
              category={assetCategory}
              value={rule.imageFile}
              compact
              onSelect={(file) => updateRule(i, { imageFile: file })}
            />
          )}
          {assetCategory === 'body' && (
            <Field label={t('vehicleEditor.properties.tintOnHit')}>
              <input
                type="color"
                value={rule.tintColor ?? DEFAULT_BODY_TINT}
                onChange={(e) => updateRule(i, { tintColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700"
              />
            </Field>
          )}
          {assetCategory !== 'body' && (
            <input
              value={rule.tintColor ?? ''}
              onChange={(e) => updateRule(i, { tintColor: e.target.value || undefined })}
              className={inputCls}
              placeholder={t('vehicleEditor.properties.tint')}
              style={{ fontSize: 10 }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function PropertiesPanel({
  vehicle,
  selectedElement,
  selectedCount = 0,
  onUpdateVehicle,
  onUpdateElement,
  onDeleteElement,
}: {
  vehicle: VehicleDefinition;
  selectedElement: VehicleElement | null;
  selectedCount?: number;
  onUpdateVehicle: (patch: Partial<VehicleDefinition>) => void;
  onUpdateElement: (
    id: string,
    patch: Partial<VehicleElement>,
    options?: { recordHistory?: boolean },
  ) => void;
  onDeleteElement: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (!selectedElement) {
    return (
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">
          {t('vehicleEditor.properties.vehicleProps')}
        </h2>
        {selectedCount > 1 ? (
          <p className="mb-3 rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2 text-[10px] text-cyan-300">
            {t('vehicleEditor.properties.multiSelectHint', {
              count: selectedCount,
              step: VEHICLE_NUDGE_STEP,
              shift: VEHICLE_NUDGE_SHIFT_STEP,
            })}
          </p>
        ) : null}
        <div className="space-y-3">
          <Field label={t('vehicleEditor.properties.name')}>
            <input
              value={vehicle.name}
              onChange={(e) => onUpdateVehicle({ name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t('vehicleEditor.properties.canvasWidth')}>
            <NumberInput
              value={vehicle.width}
              onChange={(n) => onUpdateVehicle({ width: n })}
              className={inputCls}
            />
          </Field>
          <Field label={t('vehicleEditor.properties.canvasHeight')}>
            <NumberInput
              value={vehicle.height}
              onChange={(n) => onUpdateVehicle({ height: n })}
              className={inputCls}
            />
          </Field>
          <Field label={t('vehicleEditor.properties.backgroundColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={toColorInputHex(vehicle.backgroundColor)}
                disabled={isTransparentColor(vehicle.backgroundColor)}
                onChange={(e) => onUpdateVehicle({ backgroundColor: e.target.value })}
                className="h-8 min-w-0 flex-1 cursor-pointer rounded border border-zinc-700 bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={isTransparentColor(vehicle.backgroundColor)}
                  onChange={(e) =>
                    onUpdateVehicle({
                      backgroundColor: e.target.checked
                        ? 'transparent'
                        : toColorInputHex(vehicle.backgroundColor),
                    })
                  }
                  className="rounded border-zinc-600"
                />
                {t('vehicleEditor.properties.transparent')}
              </label>
            </div>
          </Field>
          <Field label={t('vehicleEditor.properties.previewJson')}>
            <textarea
              value={JSON.stringify(vehicle.previewData ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  onUpdateVehicle({ previewData: JSON.parse(e.target.value) as Record<string, unknown> });
                } catch {
                  /* ignore invalid json while typing */
                }
              }}
              rows={8}
              className={`${inputCls} font-mono text-[10px]`}
            />
          </Field>
        </div>
      </aside>
    );
  }

  const el = selectedElement;

  if (selectedCount > 1) {
    return (
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">
          {t('vehicleEditor.properties.multiSelect')}
        </h2>
        <p className="rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-cyan-200">
          {t('vehicleEditor.properties.multiSelectHintAlt', {
            count: selectedCount,
            step: VEHICLE_NUDGE_STEP,
            shift: VEHICLE_NUDGE_SHIFT_STEP,
          })}
        </p>
      </aside>
    );
  }

  const patch = (p: Partial<VehicleElement>) => onUpdateElement(el.id, p);

  const typeTitle =
    el.type === 'body'
      ? t('vehicleEditor.properties.typeBody')
      : el.type === 'text'
        ? t('vehicleEditor.properties.typeText')
        : el.type === 'light'
          ? t('vehicleEditor.properties.typeLight')
          : t('vehicleEditor.properties.typeDoor');

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">{typeTitle}</h2>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteElement(el.id);
          }}
          className="text-zinc-500 hover:text-red-400"
          title={t('vehicleEditor.properties.deleteElement')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <Field key={key} label={key.toUpperCase()}>
              <NumberInput
                step={key === 'x' || key === 'y' ? VEHICLE_NUDGE_STEP : 1}
                value={el[key]}
                onChange={(n) => patch({ [key]: n })}
                className={inputCls}
              />
            </Field>
          ))}
        </div>

        <Field label={t('vehicleEditor.properties.rotation')}>
          <NumberInput
            value={el.rotationDeg ?? 0}
            onChange={(n) =>
              patch({ rotationDeg: normalizeDegrees(n) })
            }
            className={inputCls}
          />
        </Field>
        <VehicleRotationToolbar
          variant="inline"
          rotationDeg={el.rotationDeg ?? 0}
          onRotateLeft90={() => patch({ rotationDeg: normalizeDegrees((el.rotationDeg ?? 0) - 90) })}
          onRotateRight90={() => patch({ rotationDeg: normalizeDegrees((el.rotationDeg ?? 0) + 90) })}
          onRotateDelta={(delta) =>
            patch({ rotationDeg: normalizeDegrees((el.rotationDeg ?? 0) + delta) })
          }
        />

        <WidgetDataBindingSettings w={el} onUpdate={patch} />

        {el.type === 'body' && (
          <>
            <Field label={t('vehicleEditor.properties.defaultBodyColor')}>
              <input
                type="color"
                value={el.defaultTintColor ?? DEFAULT_BODY_TINT}
                onChange={(e) =>
                  patch({ defaultImage: DEFAULT_BODY_IMAGE, defaultTintColor: e.target.value })
                }
                className="h-8 w-full cursor-pointer rounded border border-zinc-700"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.colorField')}>
              <input
                value={el.colorField ?? ''}
                onChange={(e) => patch({ colorField: e.target.value || undefined })}
                className={inputCls}
                placeholder="icon_bg_color"
              />
              <p className="mt-1 text-[9px] text-zinc-600">
                {t('vehicleEditor.properties.colorFieldHint')}
              </p>
            </Field>
            <ImageRulesEditor
              rules={el.imageRules}
              assetCategory="body"
              onChange={(imageRules) =>
                patch({
                  imageRules: imageRules.map((r) => ({ ...r, imageFile: DEFAULT_BODY_IMAGE })),
                })
              }
            />
          </>
        )}

        {el.type === 'text' && (
          <>
            <Field label={t('vehicleEditor.properties.valueField')}>
              <input
                value={el.valueField}
                onChange={(e) => patch({ valueField: e.target.value })}
                className={inputCls}
                placeholder="vehicle_code"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.fontSize')}>
              <NumberInput
                value={el.fontSize}
                onChange={(n) => patch({ fontSize: n })}
                className={inputCls}
              />
            </Field>
            <Field label={t('vehicleEditor.properties.color')}>
              <input
                type="color"
                value={el.color}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.align')}>
              <select
                value={el.textAlign}
                onChange={(e) => patch({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
                className={selectCls}
              >
                <option value="left">{t('vehicleEditor.properties.alignLeft')}</option>
                <option value="center">{t('vehicleEditor.properties.alignCenter')}</option>
                <option value="right">{t('vehicleEditor.properties.alignRight')}</option>
              </select>
            </Field>
          </>
        )}

        {el.type === 'light' && (
          <>
            <p className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2 py-1.5 text-[10px] text-zinc-400">
              {t('vehicleEditor.properties.lightHint')}
            </p>
            <Field label={t('vehicleEditor.properties.visibilityField')}>
              <input
                value={el.visibilityField ?? ''}
                onChange={(e) =>
                  patch({ visibilityField: e.target.value.trim() || undefined })
                }
                className={inputCls}
                placeholder="head_light_on"
              />
            </Field>
            <p className="text-[9px] leading-relaxed text-zinc-600">
              {t('vehicleEditor.properties.visibilityHint')}
            </p>
          </>
        )}

        {el.type === 'door' && (
          <>
            <Field label={t('vehicleEditor.properties.doorColor')}>
              <input
                type="color"
                value={el.defaultColor ?? DEFAULT_DOOR_COLOR}
                onChange={(e) => patch({ defaultColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-800"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.openPercentField')}>
              <input
                value={el.openPercentField}
                onChange={(e) => patch({ openPercentField: e.target.value })}
                className={inputCls}
                placeholder="door_open_percent"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.alarmField')}>
              <input
                value={el.alarmField ?? ''}
                onChange={(e) => patch({ alarmField: e.target.value || undefined })}
                className={inputCls}
                placeholder="door_alarm"
              />
            </Field>
            <Field label={t('vehicleEditor.properties.defaultOpen')}>
              <PercentInput
                value={el.defaultOpenPercent}
                onChange={(defaultOpenPercent) => patch({ defaultOpenPercent })}
                className={inputCls}
              />
            </Field>
          </>
        )}
      </div>
    </aside>
  );
}
