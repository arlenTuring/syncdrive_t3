import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { IconButton } from '../../../components/ui';

const OFFSET_INPUT =
  'h-8 w-[44px] shrink-0 rounded-md border border-border-quaternary bg-surface-primary px-1.5 text-body-xs tabular-nums text-text-primary outline-none placeholder:text-text-quaternary focus:border-border-theme focus:ring-1 focus:ring-border-theme-light-trn';
const FIELD_LABEL = 'mb-1 block text-body-xs text-text-tertiary';

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
  const { t } = useTranslation();
  const category = resolveShiftActionCategory(action.categoryId);
  const visibleStages = resolveVisibleActionStages(action);
  const showResource = shouldShowResourceStage(action);
  const offsetUnit = action.offsetUnit ?? resolveDefaultOffsetUnit(category);

  return (
    <div className="flex items-start gap-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
        <ShiftMenuSelect
          label={t('dispatchScheduling.actionRow.category')}
          hideLabel
          size="sm"
          value={action.categoryId ?? ''}
          placeholder={t('dispatchScheduling.actionRow.selectAction')}
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
            <span className={FIELD_LABEL}>
              {category.offsetLabel ?? t('dispatchScheduling.actionRow.offset')}
            </span>
            <div className="flex h-8 items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={action.offsetValue == null ? '' : String(action.offsetValue)}
                placeholder="0"
                className={OFFSET_INPUT}
                aria-label={t('dispatchScheduling.actionRow.offsetValue')}
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
                label={t('dispatchScheduling.actionRow.offsetUnit')}
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
            label={t('dispatchScheduling.actionRow.behavior')}
            hideLabel
            size="sm"
            value={action.behavior ?? ''}
            placeholder={t('dispatchScheduling.actionRow.behavior')}
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
            label={t('dispatchScheduling.actionRow.media')}
            hideLabel
            size="sm"
            value={action.resourceId ?? ''}
            placeholder={t('dispatchScheduling.actionRow.mediaPlaceholder')}
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
      <IconButton size="small" hierarchy="subordinate" variant="standard" className="mt-0.5 shrink-0" onPress={onRemove} label={t('dispatchScheduling.actionRow.deleteAction')} icon={<X />} />
    </div>
  );
}
