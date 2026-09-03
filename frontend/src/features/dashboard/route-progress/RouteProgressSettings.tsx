import { NumberInput } from '../../../components/NumberInput'
import * as LucideIcons from 'lucide-react';
import { Plus, Trash2, Palette, MapPin, Zap, FolderOpen } from 'lucide-react';
import type {
  RouteProgressWidget,
  RouteStation,
  RouteActionIconRule,
  RouteActionMatchOp,
  RouteStationSource,
} from '../types';
import {
  VEHICLE_OPERATION_ACTION_ICONS_BASE,
  DEFAULT_ROUTE_ACTION_ICON_RULES,
  DEFAULT_VEHICLE_ICON_FILE,
  buildCatalogActionRules,
} from '../vehicle-operation-actions';
import { DashboardIconPicker } from '../components/DashboardIconPicker';
import { WidgetDataBindingSettings } from '../elements/WidgetDataBindingSettings';
const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

const selectCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer`;

function SH({ icon, label, color }: { icon: React.ReactNode; label: string; color?: string }) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider pb-1 border-b border-zinc-800"
      style={{ color: color ?? '#71717a' }}
    >
      {icon} {label}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{label}</label>
      {children}
    </div>
  );
}

function PositionFields({
  widget,
  onUpdate,
}: {
  widget: { x: number; y: number; width: number; height: number };
  onUpdate: (p: Partial<{ x: number; y: number; width: number; height: number }>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800">
      {(['x', 'y', 'width', 'height'] as const).map((k) => (
        <Field key={k} label={k.toUpperCase()}>
          <NumberInput
            value={widget[k]}
            onChange={(n) => onUpdate({ [k]: n })}
            className={inputCls}
          />
        </Field>
      ))}
    </div>
  );
}

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      className="w-full py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 hover:bg-red-900/40 transition-colors mt-2"
    >
      <Trash2 size={12} /> 移除元件
    </button>
  );
}

const MATCH_OPS: { value: RouteActionMatchOp; label: string }[] = [
  { value: 'present', label: '有值／為真' },
  { value: 'eq', label: '等於' },
  { value: 'gte', label: '大於等於' },
  { value: 'gt', label: '大於' },
];

export function RouteProgressSettings({
  w,
  onUpdate,
  onDelete,
}: {
  w: RouteProgressWidget;
  onUpdate: (patch: Partial<RouteProgressWidget>) => void;
  onDelete: () => void;
}) {
  const stationSource: RouteStationSource =
    w.stationSource ?? (w.dynamicStationFields ? 'legacy-columns' : 'manual');
  const rules = w.actionIconRules ?? [];

  const updateStation = (idx: number, patch: Partial<RouteStation>) => {
    const newStations = [...w.stations];
    newStations[idx] = { ...newStations[idx], ...patch };
    onUpdate({ stations: newStations });
  };
  const addStation = () => {
    const anchors = w.stations.length;
    onUpdate({
      stations: [
        ...w.stations,
        { id: `s_${Date.now()}`, name: '新站點', value: anchors > 0 ? 100 : 0 },
      ],
    });
  };
  const removeStation = (idx: number) => {
    onUpdate({ stations: w.stations.filter((_, i) => i !== idx) });
  };

  const updateRule = (idx: number, patch: Partial<RouteActionIconRule>) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    onUpdate({ actionIconRules: next });
  };
  const addRule = () => {
    onUpdate({
      actionIconRules: [
        ...rules,
        {
          id: `act_${Date.now()}`,
          label: '新動作',
          sourceVarKey: 'action_code',
          matchOp: 'present',
          iconFile: 'action.png',
          priority: 0,
        },
      ],
    });
  };
  const removeRule = (idx: number) => {
    onUpdate({ actionIconRules: rules.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-4">
      <SH icon={<LucideIcons.Route size={14} className="text-blue-400" />} label="路線進度設定" color="#3b82f6" />

      <Field label="版型">
        <select
          value={w.variant ?? 'track'}
          onChange={(e) => onUpdate({ variant: e.target.value as RouteProgressWidget['variant'] })}
          className={selectCls}
        >
          <option value="track">軌道</option>
          <option value="detail-card">詳情卡</option>
          <option value="service-card">服務卡</option>
        </select>
      </Field>
      <Field label="站點標籤字級 (px)">
        <NumberInput
          min={8}
          value={w.fontSize ?? 14}
          onChange={(n) => onUpdate({ fontSize: Math.max(8, n || 14) })}
          className={inputCls}
        />
      </Field>
      {(w.variant === 'detail-card' || w.variant === 'service-card') && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="站點欄標籤">
            <input value={w.cardStationLabel ?? ''} onChange={(e) => onUpdate({ cardStationLabel: e.target.value })} className={inputCls} placeholder="站點" />
          </Field>
          <Field label="指標欄標籤">
            <input value={w.cardMetricLabel ?? ''} onChange={(e) => onUpdate({ cardMetricLabel: e.target.value })} className={inputCls} placeholder="ETA" />
          </Field>
          <Field label="開始時間標籤">
            <input value={w.cardDepartLabel ?? ''} onChange={(e) => onUpdate({ cardDepartLabel: e.target.value })} className={inputCls} placeholder="開始" />
          </Field>
          <Field label="結束時間標籤">
            <input value={w.cardEndLabel ?? ''} onChange={(e) => onUpdate({ cardEndLabel: e.target.value })} className={inputCls} placeholder="結束" />
          </Field>
        </div>
      )}

      <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/50 text-[10px] text-zinc-400 leading-relaxed flex gap-2">
        <FolderOpen size={14} className="shrink-0 text-cyan-500 mt-0.5" />
        <span>
          作動行為圖示請放到{' '}
          <code className="text-cyan-400 font-mono">{VEHICLE_OPERATION_ACTION_ICONS_BASE}/</code>
          （專案內 <code className="font-mono">public/vehicle-operation-actions/icons/</code>）
        </span>
      </div>

      <div className="space-y-2">
        <WidgetDataBindingSettings w={w} onUpdate={onUpdate} />
        <Field label="總進度 fallback 欄位（0–100）">
          <input
            value={w.valueField}
            onChange={(e) => onUpdate({ valueField: e.target.value })}
            className={inputCls}
            placeholder="route_progress"
          />
        </Field>
        <Field label="MQTT 進度路徑（選填）">
          <input
            value={w.mqttProgressPath ?? ''}
            onChange={(e) => onUpdate({ mqttProgressPath: e.target.value || undefined })}
            className={inputCls}
            placeholder="route_progress"
          />
        </Field>
      </div>

      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <SH icon={<MapPin size={12} />} label="站點來源" color="#10b981" />
        <Field label="模式">
          <select
            value={stationSource}
            onChange={(e) => onUpdate({ stationSource: e.target.value as RouteStationSource })}
            className={selectCls}
          >
            <option value="json">JSON 陣列（站數浮動、等距）</option>
            <option value="legacy-columns">舊版三欄位站名（st_a…）</option>
            <option value="manual">手動站點（預覽／備援）</option>
          </select>
        </Field>
        {stationSource === 'json' && (
          <Field label="站點 JSON 變數鍵">
            <input
              value={w.stationsJsonVarKey ?? 'route_stations'}
              onChange={(e) => onUpdate({ stationsJsonVarKey: e.target.value })}
              className={inputCls}
            />
            <p className="text-[9px] text-zinc-500 mt-1 font-mono leading-relaxed">
              [{'{'}&quot;name&quot;:&quot;STATION_A&quot;,&quot;remain_pct&quot;:40{'}'}, …]
            </p>
          </Field>
        )}
        {stationSource === 'legacy-columns' && (
          <Field label="站名欄位（逗號分隔三鍵）">
            <input
              value={(w.dynamicStationFields ?? []).join(',')}
              onChange={(e) => {
                const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                onUpdate({
                  dynamicStationFields:
                    parts.length >= 3
                      ? ([parts[0], parts[1], parts[2]] as [string, string, string])
                      : undefined,
                });
              }}
              className={inputCls}
              placeholder="st_a,st_b,st_c"
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="區段索引變數">
            <input
              value={w.segmentIndexVarKey ?? 'segment_index'}
              onChange={(e) => onUpdate({ segmentIndexVarKey: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="區段剩餘 % 變數">
            <input
              value={w.segmentRemainPctVarKey ?? 'segment_remain_pct'}
              onChange={(e) => onUpdate({ segmentRemainPctVarKey: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
        <p className="text-[9px] text-zinc-500 leading-relaxed">
          車輛在兩站之間的位置：優先使用區段索引 + 剩餘 %；否則依 JSON 的 remain_pct；再 fallback 總進度欄位。
        </p>
      </div>

      {stationSource === 'manual' && (
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <SH icon={<MapPin size={12} />} label="手動站點（備援）" color="#10b981" />
            <button
              type="button"
              onClick={addStation}
              className="p-1 hover:bg-zinc-800 rounded text-green-500 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
          {w.stations.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-1 bg-zinc-800/40 p-1.5 rounded border border-zinc-700/50"
            >
              <input
                value={s.name}
                onChange={(e) => updateStation(i, { name: e.target.value })}
                className={`${inputCls} flex-1`}
                placeholder="站名"
                style={{ fontSize: 10 }}
              />
              <button
                type="button"
                onClick={() => removeStation(i)}
                className="p-1 text-zinc-500 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <SH icon={<Zap size={12} />} label="作動行為對應" color="#f59e0b" />
          <div className="flex gap-1">
            <button
              type="button"
              title="載入設計稿 11 種作動行為"
              onClick={() => onUpdate({ actionIconRules: buildCatalogActionRules() })}
              className="px-2 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400"
            >
              11 種
            </button>
            <button
              type="button"
              title="載入範例規則（含告警、延誤）"
              onClick={() => onUpdate({ actionIconRules: [...DEFAULT_ROUTE_ACTION_ICON_RULES] })}
              className="px-2 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400"
            >
              範例
            </button>
            <button
              type="button"
              onClick={addRule}
              className="p-1 hover:bg-zinc-800 rounded text-amber-500"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        {rules.length === 0 && (
          <p className="text-[10px] text-zinc-500">尚無規則；命中時在巴士上方顯示圖示。</p>
        )}
        {rules.map((rule, i) => (
          <div key={rule.id} className="space-y-1.5 p-2 rounded border border-zinc-700/50 bg-zinc-800/30">
            <div className="flex gap-1">
              <input
                value={rule.label ?? ''}
                onChange={(e) => updateRule(i, { label: e.target.value })}
                className={`${inputCls} flex-1`}
                placeholder="說明"
                style={{ fontSize: 10 }}
              />
              <button type="button" onClick={() => removeRule(i)} className="p-1 text-zinc-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
            <input
              value={rule.sourceVarKey}
              onChange={(e) => updateRule(i, { sourceVarKey: e.target.value })}
              className={inputCls}
              placeholder="變數鍵"
              style={{ fontSize: 10 }}
            />
            <div className="grid grid-cols-2 gap-1">
              <select
                value={rule.matchOp}
                onChange={(e) => updateRule(i, { matchOp: e.target.value as RouteActionMatchOp })}
                className={selectCls}
                style={{ fontSize: 10 }}
              >
                {MATCH_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                value={rule.threshold ?? ''}
                onChange={(e) => updateRule(i, { threshold: e.target.value })}
                className={inputCls}
                placeholder="門檻值"
                style={{ fontSize: 10 }}
                disabled={rule.matchOp === 'present'}
              />
            </div>
            <input
              value={rule.iconFile}
              onChange={(e) => updateRule(i, { iconFile: e.target.value })}
              className={inputCls}
              placeholder="charging.png"
              style={{ fontSize: 10 }}
            />
            <DashboardIconPicker
              compact
              value={rule.iconFile}
              onSelect={(file, _url, set) => {
                const entry = set.icons.find((x) => x.file === file);
                updateRule(i, {
                  iconFile: file,
                  ...(rule.sourceVarKey === 'operation_action' && entry?.code
                    ? { threshold: entry.code, matchOp: 'eq' as const, label: entry.label }
                    : {}),
                });
              }}
            />
            <NumberInput
              value={rule.priority ?? 0}
              onChange={(n) => updateRule(i, { priority: n })}
              className={inputCls}
              placeholder="優先序"
              style={{ fontSize: 10 }}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <SH icon={<Palette size={12} />} label="外觀樣式" color="#ec4899" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="走過路線顏色">
            <input
              type="color"
              value={w.activeColor}
              onChange={(e) => onUpdate({ activeColor: e.target.value })}
              className={inputCls}
              style={{ height: 28 }}
            />
          </Field>
          <Field label="未走路線顏色">
            <input
              type="color"
              value={w.inactiveColor}
              onChange={(e) => onUpdate({ inactiveColor: e.target.value })}
              className={inputCls}
              style={{ height: 28 }}
            />
          </Field>
          <Field label="車輛背景色（fallback）">
            <input
              type="color"
              value={w.iconBgColor}
              onChange={(e) => onUpdate({ iconBgColor: e.target.value })}
              className={inputCls}
              style={{ height: 28 }}
            />
          </Field>
          <Field label="車輛圖示顏色">
            <input
              type="color"
              value={w.iconColor}
              onChange={(e) => onUpdate({ iconColor: e.target.value })}
              className={inputCls}
              style={{ height: 28 }}
            />
          </Field>
        </div>
        <Field label="車輛圖示">
          <div className="flex gap-1">
            <input
              value={w.vehicleIcon}
              onChange={(e) => onUpdate({ vehicleIcon: e.target.value })}
              className={`${inputCls} flex-1`}
              placeholder={`${DEFAULT_VEHICLE_ICON_FILE} 或 Bus`}
            />
            <button
              type="button"
              title="使用預設車體圖 vehicle.svg"
              onClick={() => onUpdate({ vehicleIcon: DEFAULT_VEHICLE_ICON_FILE })}
              className="shrink-0 px-2 py-1 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:text-cyan-400"
            >
              預設
            </button>
          </div>
          <p className="text-[9px] text-zinc-500 mt-1">
            建議 vehicle.svg（依載具狀態染色）；亦可填 Lucide 名稱 Bus
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="車體底色變數">
            <input
              value={w.vehicleIconBgVarKey ?? 'icon_bg_color'}
              onChange={(e) => onUpdate({ vehicleIconBgVarKey: e.target.value })}
              className={inputCls}
              placeholder="icon_bg_color"
            />
          </Field>
          <Field label="健康 fallback">
            <input
              value={w.vehicleHealthVarKey ?? ''}
              onChange={(e) => onUpdate({ vehicleHealthVarKey: e.target.value })}
              className={inputCls}
              placeholder="health_status"
            />
          </Field>
        </div>
        <p className="text-[9px] text-zinc-500 leading-relaxed">
          底色優先讀 SQL／變數；若無則依健康狀態欄位：OK 藍、WARNING 橘、ERROR 紅
        </p>
      </div>

      <PositionFields widget={w} onUpdate={onUpdate} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}
