import { useEffect, useState } from 'react';
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

const IMAGE_MATCH_OPS: { value: VehicleMatchOp; label: string }[] = [
  { value: 'eq', label: '等於' },
  { value: 'neq', label: '不等於' },
  { value: 'gt', label: '大於' },
  { value: 'gte', label: '大於等於' },
  { value: 'lt', label: '小於' },
  { value: 'lte', label: '小於等於' },
  { value: 'contains', label: '包含' },
];

function ImageRulesEditor({
  rules,
  onChange,
  assetCategory = 'body',
}: {
  rules: VehicleImageRule[];
  onChange: (rules: VehicleImageRule[]) => void;
  assetCategory?: VehicleAssetCategory;
}) {
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
        <span className="text-[10px] font-semibold text-zinc-400">條件規則</span>
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
              placeholder="說明"
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
            placeholder="資料欄位"
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
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={rule.threshold}
              onChange={(e) => updateRule(i, { threshold: e.target.value })}
              className={inputCls}
              placeholder="門檻值"
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
            <Field label="命中時車體色">
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
              placeholder="染色"
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
  if (!selectedElement) {
    return (
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">載具屬性</h2>
        {selectedCount > 1 ? (
          <p className="mb-3 rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2 text-[10px] text-cyan-300">
            已選取 {selectedCount} 個元件。拖曳可一起移動；方向鍵每次 {VEHICLE_NUDGE_STEP} px（Shift ×{VEHICLE_NUDGE_SHIFT_STEP}）。
          </p>
        ) : null}
        <div className="space-y-3">
          <Field label="名稱">
            <input
              value={vehicle.name}
              onChange={(e) => onUpdateVehicle({ name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="畫布寬度 (px)">
            <input
              type="number"
              value={vehicle.width}
              onChange={(e) => onUpdateVehicle({ width: Number(e.target.value) })}
              className={inputCls}
            />
          </Field>
          <Field label="畫布高度 (px)">
            <input
              type="number"
              value={vehicle.height}
              onChange={(e) => onUpdateVehicle({ height: Number(e.target.value) })}
              className={inputCls}
            />
          </Field>
          <Field label="背景色">
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
                透明
              </label>
            </div>
          </Field>
          <Field label="預覽資料 (JSON)">
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
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">多選元件</h2>
        <p className="rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-cyan-200">
          已選取 {selectedCount} 個元件。可拖曳一起移動，或使用方向鍵微調（每次 {VEHICLE_NUDGE_STEP} px · Shift {VEHICLE_NUDGE_SHIFT_STEP} px）。
        </p>
      </aside>
    );
  }

  const patch = (p: Partial<VehicleElement>) => onUpdateElement(el.id, p);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          {el.type === 'body' && '車體'}
          {el.type === 'text' && '文字'}
          {el.type === 'light' && '車燈'}
          {el.type === 'door' && '車門'}
        </h2>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteElement(el.id);
          }}
          className="text-zinc-500 hover:text-red-400"
          title="刪除元件"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <Field key={key} label={key.toUpperCase()}>
              <input
                type="number"
                step={key === 'x' || key === 'y' ? VEHICLE_NUDGE_STEP : 1}
                value={el[key]}
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
          ))}
        </div>

        <Field label="旋轉角度">
          <input
            type="number"
            value={el.rotationDeg ?? 0}
            onChange={(e) =>
              patch({ rotationDeg: normalizeDegrees(Number(e.target.value)) })
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
            <Field label="預設車體色">
              <input
                type="color"
                value={el.defaultTintColor ?? DEFAULT_BODY_TINT}
                onChange={(e) =>
                  patch({ defaultImage: DEFAULT_BODY_IMAGE, defaultTintColor: e.target.value })
                }
                className="h-8 w-full cursor-pointer rounded border border-zinc-700"
              />
            </Field>
            <Field label="色碼欄位（選填）">
              <input
                value={el.colorField ?? ''}
                onChange={(e) => patch({ colorField: e.target.value || undefined })}
                className={inputCls}
                placeholder="icon_bg_color"
              />
              <p className="mt-1 text-[9px] text-zinc-600">
                無規則命中時，從 MQTT/SQL 讀取 #hex 色碼。
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
            <Field label="顯示欄位">
              <input
                value={el.valueField}
                onChange={(e) => patch({ valueField: e.target.value })}
                className={inputCls}
                placeholder="vehicle_code"
              />
            </Field>
            <Field label="字級">
              <input
                type="number"
                value={el.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="顏色">
              <input
                type="color"
                value={el.color}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700"
              />
            </Field>
            <Field label="對齊">
              <select
                value={el.textAlign}
                onChange={(e) => patch({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
                className={selectCls}
              >
                <option value="left">靠左</option>
                <option value="center">置中</option>
                <option value="right">靠右</option>
              </select>
            </Field>
          </>
        )}

        {el.type === 'light' && (
          <>
            <p className="rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2 py-1.5 text-[10px] text-zinc-400">
              圖檔固定為 <span className="font-mono text-amber-400/90">lights/lights.png</span>
              。位置請自行拖放；亮滅由下方開關欄位 + MQTT/SQL 決定。
            </p>
            <Field label="開關欄位">
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
              欄位為 true、1、on、yes 時亮燈；未設則檢視模式恆亮。編輯模式一律顯示以便擺位。
            </p>
          </>
        )}

        {el.type === 'door' && (
          <>
            <Field label="門片顏色">
              <input
                type="color"
                value={el.defaultColor ?? DEFAULT_DOOR_COLOR}
                onChange={(e) => patch({ defaultColor: e.target.value })}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-800"
              />
            </Field>
            <Field label="開度欄位">
              <input
                value={el.openPercentField}
                onChange={(e) => patch({ openPercentField: e.target.value })}
                className={inputCls}
                placeholder="door_open_percent"
              />
            </Field>
            <Field label="告警欄位（選填）">
              <input
                value={el.alarmField ?? ''}
                onChange={(e) => patch({ alarmField: e.target.value || undefined })}
                className={inputCls}
                placeholder="door_alarm"
              />
            </Field>
            <Field label="預設開度 (0–100)">
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
