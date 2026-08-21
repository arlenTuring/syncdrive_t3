import { X } from 'lucide-react';
import { ShiftMenuSelect, type ShiftMenuGroup } from '../../shift-list/components/ShiftMenuSelect';
import {
  SHIFT_ACTION_BEHAVIOR_OPTIONS,
  SHIFT_ACTION_OFFSET_UNIT_OPTIONS,
  isMediaBehavior,
  resolveDefaultOffsetUnit,
  resolveShiftActionCategory,
  type ShiftActionBehavior,
  type ShiftActionCategoryId,
  type ShiftActionOffsetUnit,
} from '../../shift-list/utils/actionSettingsCatalog';
import {
  resolveVisibleActionStages,
  shouldShowResourceStage,
  type ShiftRouteSegmentAction,
} from '../../shift-list/utils/actionSettings';

const OFFSET_INPUT =
  'h-8 w-[44px] shrink-0 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-1.5 text-xs tabular-nums text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF] focus:ring-1 focus:ring-[#2B7FFF]/30';
const FIELD_LABEL = 'mb-1 block text-[11px] leading-none text-zinc-400';

type DispatchStationActionRowProps = {
  action: ShiftRouteSegmentAction;
  stationId: string;
  categoryOptions: Array<{ value: string; label: string }>;
  mediaGroups: ShiftMenuGroup[];
  onChange: (next: ShiftRouteSegmentAction) => void;
  onRemove: () => void;
};

export function DispatchStationActionRow({
  action,
  stationId,
  categoryOptions,
  mediaGroups,
  onChange,
  onRemove,
}: DispatchStationActionRowProps) {
  const category = resolveShiftActionCategory(action.categoryId);
  const visibleStages = resolveVisibleActionStages(action);
  const showResource = shouldShowResourceStage(action);
  const offsetUnit = action.offsetUnit ?? resolveDefaultOffsetUnit(category);

  return (
    <div className="flex items-start gap-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
        <ShiftMenuSelect
          label="行動類別"
          hideLabel
          size="sm"
          value={action.categoryId ?? ''}
          placeholder="請選擇行動"
          options={categoryOptions}
          onChange={(nextValue) => {
            const categoryId = (nextValue || null) as ShiftActionCategoryId | null;
            const nextCategory = resolveShiftActionCategory(categoryId);
            onChange({
              ...action,
              categoryId,
              revealedStageCount: 0,
              offsetValue: null,
              offsetUnit: resolveDefaultOffsetUnit(nextCategory),
              targetKind: nextCategory?.group === 'station' ? 'specific_station' : null,
              targetId: nextCategory?.group === 'station' ? stationId : null,
              behavior: null,
              resourceId: null,
            });
          }}
          widthClass="w-[128px] shrink-0"
          panelWidth={168}
        />

        {visibleStages.includes('offset') && category ? (
          <div className="shrink-0">
            <span className={FIELD_LABEL}>{category.offsetLabel ?? '偏移'}</span>
            <div className="flex h-8 items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={action.offsetValue == null ? '' : String(action.offsetValue)}
                placeholder="0"
                className={OFFSET_INPUT}
                aria-label="偏移數值"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  onChange({
                    ...action,
                    offsetValue: digits === '' ? null : Number(digits),
                    offsetUnit,
                  });
                }}
              />
              <ShiftMenuSelect
                label="偏移單位"
                hideLabel
                size="sm"
                value={offsetUnit ?? ''}
                widthClass="w-[72px] shrink-0"
                panelWidth={72}
                options={SHIFT_ACTION_OFFSET_UNIT_OPTIONS.filter((unit) =>
                  category.offsetUnits.includes(unit.value),
                ).map((unit) => ({
                  value: unit.value,
                  label: unit.label,
                }))}
                onChange={(nextValue) => {
                  onChange({
                    ...action,
                    offsetUnit: (nextValue || null) as ShiftActionOffsetUnit | null,
                  });
                }}
              />
            </div>
          </div>
        ) : null}

        {visibleStages.includes('behavior') && category ? (
          <ShiftMenuSelect
            label="行為"
            hideLabel
            size="sm"
            value={action.behavior ?? ''}
            placeholder="行為"
            widthClass="w-[108px] shrink-0"
            panelWidth={128}
            options={SHIFT_ACTION_BEHAVIOR_OPTIONS.filter((behavior) =>
              category.behaviors.includes(behavior.value),
            ).map((behavior) => ({
              value: behavior.value,
              label: behavior.label,
            }))}
            onChange={(nextValue) => {
              onChange({
                ...action,
                behavior: (nextValue || null) as ShiftActionBehavior | null,
                resourceId: null,
              });
            }}
          />
        ) : null}

        {visibleStages.includes('resource') && showResource && isMediaBehavior(action.behavior) ? (
          <ShiftMenuSelect
            label="媒體／媒體群組"
            hideLabel
            size="sm"
            value={action.resourceId ?? ''}
            placeholder="語音／媒體"
            groups={mediaGroups}
            onChange={(nextValue) => {
              onChange({
                ...action,
                resourceId: nextValue.trim() || null,
              });
            }}
            widthClass="min-w-[140px] flex-1"
            panelWidth={200}
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        aria-label="刪除行動"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
