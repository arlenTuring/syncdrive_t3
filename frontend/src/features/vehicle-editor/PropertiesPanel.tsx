import { SiteColorInput } from '../../components/SiteColorInput';
import { SiteSelect } from '../../components/SiteSelect';
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
import { Button, Checkbox, IconButton } from '../../components/ui';

const inputCls =
  'w-full rounded-md border border-border-quaternary bg-surface-secondary px-2.5 py-1.5 text-body-xs text-text-primary focus:border-status-warning focus:outline-none focus:ring-1 focus:ring-amber-500/20';
const selectCls = `${inputCls} cursor-pointer`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-caption-2 uppercase text-text-quaternary">{label}</label>
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
        <span className="text-caption-2 text-text-tertiary">{t('vehicleEditor.properties.imageRules')}</span>
        <Button hierarchy="subordinate" variant="standard" onPress={addRule}><Plus size={14} /></Button>
      </div>
      {rules.map((rule, i) => (
        <div key={rule.id} className="space-y-1.5 rounded border border-border-quaternary bg-link-standard p-2">
          <div className="flex gap-1">
            <input
              value={rule.label ?? ''}
              onChange={(e) => updateRule(i, { label: e.target.value })}
              className={`${inputCls} flex-1`}
              placeholder={t('vehicleEditor.properties.ruleLabel')}
              style={{ fontSize: 10 }}
            />
            <Button hierarchy="danger" variant="text" onPress={() => onChange(rules.filter((_, j) => j !== i))}><Trash2 size={12} /></Button>
          </div>
          <input
            value={rule.sourceField}
            onChange={(e) => updateRule(i, { sourceField: e.target.value })}
            className={inputCls}
            placeholder={t('vehicleEditor.properties.sourceField')}
            style={{ fontSize: 10 }}
          />
          <div className="grid grid-cols-2 gap-1">
            <SiteSelect
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
            </SiteSelect>
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
              <SiteColorInput
                value={rule.tintColor ?? DEFAULT_BODY_TINT}
                onChange={(e) => updateRule(i, { tintColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-border-quaternary"
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
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-quaternary bg-surface-sub-background p-4">
        <h2 className="mb-4 text-body-xs-bold uppercase text-text-quaternary">
          {t('vehicleEditor.properties.vehicleProps')}
        </h2>
        {selectedCount > 1 ? (
          <p className="mb-3 rounded-md border border-border-theme-light-trn bg-surface-theme-light px-2.5 py-2 text-caption-2 text-text-theme">
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
              <SiteColorInput
                value={toColorInputHex(vehicle.backgroundColor)}
                disabled={isTransparentColor(vehicle.backgroundColor)}
                onChange={(e) => onUpdateVehicle({ backgroundColor: e.target.value })}
                className="h-8 min-w-0 flex-1 cursor-pointer rounded border border-border-quaternary bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40"
               />
              <label className="flex shrink-0 items-center gap-1.5 text-caption-2 text-text-tertiary">
                <Checkbox checked={isTransparentColor(vehicle.backgroundColor)} onCheckedChange={(checked) => onUpdateVehicle({
                      backgroundColor: checked
                        ? 'transparent'
                        : toColorInputHex(vehicle.backgroundColor),
                    })
                  } />
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
              className={`${inputCls} font-mono text-caption-2`}
            />
          </Field>
        </div>
      </aside>
    );
  }

  const el = selectedElement;

  if (selectedCount > 1) {
    return (
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-quaternary bg-surface-sub-background p-4">
        <h2 className="mb-4 text-body-xs-bold uppercase text-text-quaternary">
          {t('vehicleEditor.properties.multiSelect')}
        </h2>
        <p className="rounded-md border border-border-theme-light-trn bg-surface-theme-light px-2.5 py-2 text-caption-2 text-cyan-200">
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
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-quaternary bg-surface-sub-background p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-body-xs-bold uppercase text-text-quaternary">{typeTitle}</h2>
        <IconButton hierarchy="danger" variant="standard" onPress={(e) => {
            e.stopPropagation();
            onDeleteElement(el.id);
          }} title={t('vehicleEditor.properties.deleteElement')} label={t('vehicleEditor.properties.deleteElement')} icon={<Trash2 />} />
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
              <SiteColorInput
                value={el.defaultTintColor ?? DEFAULT_BODY_TINT}
                onChange={(e) =>
                  patch({ defaultImage: DEFAULT_BODY_IMAGE, defaultTintColor: e.target.value })
                }
                className="h-8 w-full cursor-pointer rounded border border-border-quaternary"
               />
            </Field>
            <Field label={t('vehicleEditor.properties.colorField')}>
              <input
                value={el.colorField ?? ''}
                onChange={(e) => patch({ colorField: e.target.value || undefined })}
                className={inputCls}
                placeholder="icon_bg_color"
              />
              <p className="mt-1 text-caption-2 text-text-disabled">
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
              <SiteColorInput
                value={el.color}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-border-quaternary"
               />
            </Field>
            <Field label={t('vehicleEditor.properties.align')}>
              <SiteSelect
                value={el.textAlign}
                onChange={(e) => patch({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
                className={selectCls}
              >
                <option value="left">{t('vehicleEditor.properties.alignLeft')}</option>
                <option value="center">{t('vehicleEditor.properties.alignCenter')}</option>
                <option value="right">{t('vehicleEditor.properties.alignRight')}</option>
              </SiteSelect>
            </Field>
          </>
        )}

        {el.type === 'light' && (
          <>
            <p className="rounded-md border border-border-quaternary bg-surface-primary px-2 py-1.5 text-caption-2 text-text-tertiary">
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
            <p className="text-caption-2 text-text-disabled">
              {t('vehicleEditor.properties.visibilityHint')}
            </p>
          </>
        )}

        {el.type === 'door' && (
          <>
            <Field label={t('vehicleEditor.properties.doorColor')}>
              <SiteColorInput
                value={el.defaultColor ?? DEFAULT_DOOR_COLOR}
                onChange={(e) => patch({ defaultColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-border-quaternary bg-surface-secondary"
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
