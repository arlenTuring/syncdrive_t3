import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  sortSelectedRoutesByExecutionOrder,
  type ShiftScheduleSelectedRoute,
} from '../types/create';
import {
  fetchMediaLibraryOptions,
  type MediaLibraryOption,
} from '../api/mediaLibraryApi';
import {
  SHIFT_ACTION_BEHAVIOR_OPTIONS,
  SHIFT_ACTION_OFFSET_UNIT_OPTIONS,
  SHIFT_ACTION_ZONE_LABELS,
  isMediaBehavior,
  resolveDefaultOffsetUnit,
  resolveShiftActionCategory,
  type ShiftActionBehavior,
  type ShiftActionCategoryId,
  type ShiftActionOffsetUnit,
  type ShiftActionTargetKind,
  type ShiftActionZoneKind,
} from '../utils/actionSettingsCatalog';
import {
  buildActionModuleKey,
  cloneActionsForModuleApply,
  createEmptySegmentAction,
  listActionModuleSources,
  listCategoriesAllowedInZone,
  reorderActionsInList,
  resolveVisibleActionStages,
  shouldShowResourceStage,
  syncActionSettingsWithSelectedRoutes,
  type ActionModuleSource,
  type ShiftRouteSegmentAction,
  type ShiftScheduleActionSettingsDraft,
} from '../utils/actionSettings';
import {
  encodeFacilityTargetValue,
  findFacilityTypeForTarget,
  loadActionFacilityGroups,
  resolveFacilityTargetLabel,
  type ActionFacilityType,
  type ActionFacilityTypeGroup,
} from '../utils/actionFacilityOptions';
import {
  ShiftMenuSelect,
  type ShiftMenuGroup,
  type ShiftMenuOption,
} from './ShiftMenuSelect';
import { IconButton } from '../../../components/ui';

const INPUT_CLASS =
  'h-10 w-[56px] shrink-0 rounded-lg border border-border-quaternary bg-surface-primary px-2 text-body-s tabular-nums text-text-primary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';
const FIELD_LABEL_CLASS = 'mb-1.5 block text-body-xs text-text-tertiary';
const MEDIA_FIELD_WIDTH_CLASS = 'w-[168px]';

const MENU_PANEL_WIDTH = 160;
const menuPanelClass =
  'absolute flex max-h-[312px] flex-col items-stretch overflow-hidden rounded-lg bg-surface-primary py-1 shadow-lg shadow-black-30';
const menuListClass =
  'flex max-h-[304px] w-full flex-col items-stretch overflow-y-auto [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]';

function menuOptionClass(active: boolean, disabled = false) {
  return [
    'flex h-10 w-full shrink-0 items-center px-3 text-left text-body-s font-normal leading-[18px] tracking-[0.5px] transition-colors',
    disabled
      ? 'cursor-not-allowed text-text-quaternary'
      : active
        ? 'bg-link-standard-hover text-text-primary'
        : 'text-text-primary hover:bg-link-standard',
  ].join(' ');
}

/** 與設施選單同風格的單層下拉（行動設定別名） */
function ActionMenuSelect({
  label,
  value,
  placeholder,
  options,
  groups,
  onChange,
  widthClass = 'w-[176px]',
  panelWidth = 160,
  disabled = false,
  hideLabel = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options?: ShiftMenuOption[];
  groups?: ShiftMenuGroup[];
  onChange: (value: string) => void;
  widthClass?: string;
  panelWidth?: number;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <ShiftMenuSelect
      label={label}
      value={value}
      placeholder={placeholder}
      options={options}
      groups={groups}
      onChange={onChange}
      widthClass={widthClass}
      panelWidth={panelWidth}
      disabled={disabled}
      hideLabel={hideLabel}
    />
  );
}

type StepShiftActionSettingsProps = {
  draft: ShiftScheduleActionSettingsDraft;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  mapId: string;
  onChange: (next: ShiftScheduleActionSettingsDraft) => void;
};

type ZonePath =
  | { kind: 'before_arrive'; routeId: string; stationId: string }
  | { kind: 'after_arrive'; routeId: string; stationId: string }
  | {
      kind: 'moving';
      routeId: string;
      fromStationId: string;
      toStationId: string;
    };

function FacilityTargetPicker({
  targetKind,
  targetId,
  facilityGroups,
  onSelect,
}: {
  targetKind: ShiftActionTargetKind | null;
  targetId: string | null;
  facilityGroups: ActionFacilityTypeGroup[];
  onSelect: (next: {
    targetKind: ShiftActionTargetKind | null;
    targetId: string | null;
  }) => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const level1Ref = useRef<HTMLDivElement>(null);
  const level2Ref = useRef<HTMLDivElement>(null);
  const typeButtonRefs = useRef<Partial<Record<ActionFacilityType, HTMLButtonElement | null>>>(
    {},
  );
  const specificButtonRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<ActionFacilityType | null>(null);
  const [specificOpen, setSpecificOpen] = useState(false);
  const [level2Top, setLevel2Top] = useState(0);
  const [level3Top, setLevel3Top] = useState(0);

  const selectedValue = encodeFacilityTargetValue(targetKind, targetId);
  const displayLabel =
    resolveFacilityTargetLabel(targetKind, targetId, facilityGroups)
    || t('shiftList.actionSettings.selectPlaceholder');
  const activeGroup =
    facilityGroups.find((group) => group.type === activeType) ?? null;
  const canPickSpecific = (activeGroup?.facilities.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveType(null);
        setSpecificOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !activeType || !level1Ref.current) {
      setLevel2Top(0);
      return;
    }
    const typeButton = typeButtonRefs.current[activeType];
    if (!typeButton) {
      setLevel2Top(0);
      return;
    }
    const panelRect = level1Ref.current.getBoundingClientRect();
    const buttonRect = typeButton.getBoundingClientRect();
    setLevel2Top(Math.max(0, buttonRect.top - panelRect.top));
  }, [open, activeType, facilityGroups]);

  useEffect(() => {
    if (!open || !specificOpen || !level2Ref.current || !specificButtonRef.current) {
      setLevel3Top(0);
      return;
    }
    const panelRect = level2Ref.current.getBoundingClientRect();
    const buttonRect = specificButtonRef.current.getBoundingClientRect();
    setLevel3Top(Math.max(0, buttonRect.top - panelRect.top));
  }, [open, specificOpen, activeType, canPickSpecific]);

  const openPicker = () => {
    const selectedType = findFacilityTypeForTarget(targetKind, targetId, facilityGroups);
    setActiveType(selectedType);
    setSpecificOpen(
      targetKind === 'specific_facility'
        && selectedType != null
        && (facilityGroups.find((group) => group.type === selectedType)?.facilities.length ?? 0)
          > 0,
    );
    setOpen(true);
  };

  const closePicker = () => {
    setOpen(false);
    setActiveType(null);
    setSpecificOpen(false);
  };

  const pick = (nextKind: ShiftActionTargetKind, nextId: string) => {
    onSelect({ targetKind: nextKind, targetId: nextId });
    closePicker();
  };

  const activateType = (type: ActionFacilityType) => {
    setActiveType(type);
    setSpecificOpen(false);
  };

  return (
    <div ref={rootRef} className="relative block w-[200px] shrink-0">
      <span className={FIELD_LABEL_CLASS}>{t('shiftList.actionSettings.facility')}</span>
      <button
        type="button"
        className={[
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-surface-primary px-3 text-left text-body-s focus:outline-none',
          open
            ? 'border-border-theme text-text-primary'
            : 'border-border-quaternary text-text-primary focus:border-border-theme focus:ring-1 focus:ring-border-theme-light-trn',
        ].join(' ')}
        aria-label={t('shiftList.actionSettings.facilityTargetAria')}
        aria-expanded={open}
        onClick={() => (open ? closePicker() : openPicker())}
      >
        <span
          className={`truncate text-body-s leading-[18px] tracking-[0.5px] ${
            selectedValue ? 'text-text-primary' : 'text-text-tertiary'
          }`}
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-text-quaternary transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[41px] z-30 h-[312px]"
          style={{ width: MENU_PANEL_WIDTH * 3 }}
          onMouseLeave={() => {
            setActiveType(null);
            setSpecificOpen(false);
          }}
        >
          {/* Level 1：設施類型 */}
          <div
            ref={level1Ref}
            className={`${menuPanelClass} top-0`}
            style={{ left: 0, width: MENU_PANEL_WIDTH, isolation: 'isolate' }}
          >
            <div className={menuListClass}>
              {(['equipment', 'facility_area'] as const).map((category) => {
                const categoryGroups = facilityGroups.filter(
                  (group) => group.category === category,
                );
                if (categoryGroups.length === 0) return null;
                return (
                  <div key={category} className="flex w-full flex-col items-stretch">
                    <div className="flex h-8 items-center px-3">
                      <span className="px-2 text-body-xs-bold tracking-[0.5px] text-text-tertiary">
                        {category === 'equipment'
                          ? t('shiftList.actionSettings.equipment')
                          : t('shiftList.actionSettings.facility')}
                      </span>
                    </div>
                    {categoryGroups.map((group) => {
                      const isActive = activeType === group.type;
                      const hasSelectionInType =
                        findFacilityTypeForTarget(targetKind, targetId, [group])
                        === group.type;
                      return (
                        <button
                          key={group.type}
                          ref={(node) => {
                            typeButtonRefs.current[group.type] = node;
                          }}
                          type="button"
                          className={menuOptionClass(isActive || hasSelectionInType)}
                          onMouseEnter={() => activateType(group.type)}
                          onFocus={() => activateType(group.type)}
                          onClick={() => activateType(group.type)}
                        >
                          <span className="min-w-0 flex-1 truncate px-2">
                            {group.typeLabel}
                          </span>
                          <ChevronRight className="size-3.5 shrink-0 text-text-quaternary" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Level 2：全XXX / 指定設施 — 對齊目前類型列 */}
          {activeGroup ? (
            <div
              ref={level2Ref}
              className={menuPanelClass}
              style={{
                left: MENU_PANEL_WIDTH,
                top: level2Top,
                width: MENU_PANEL_WIDTH,
                isolation: 'isolate',
              }}
              onMouseEnter={() => setActiveType(activeGroup.type)}
            >
              <div className={menuListClass}>
                <button
                  type="button"
                  className={menuOptionClass(
                    selectedValue === `general:${activeGroup.type}`,
                  )}
                  onMouseEnter={() => setSpecificOpen(false)}
                  onClick={() => pick('general_facility', activeGroup.type)}
                >
                  <span className="min-w-0 flex-1 truncate px-2">
                    {activeGroup.generalLabel}
                  </span>
                </button>
                <button
                  ref={specificButtonRef}
                  type="button"
                  disabled={!canPickSpecific}
                  className={menuOptionClass(
                    specificOpen
                    || (targetKind === 'specific_facility'
                      && findFacilityTypeForTarget(targetKind, targetId, [activeGroup])
                        === activeGroup.type),
                    !canPickSpecific,
                  )}
                  onMouseEnter={() => {
                    if (canPickSpecific) setSpecificOpen(true);
                  }}
                  onClick={() => {
                    if (canPickSpecific) setSpecificOpen(true);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate px-2">
                    {activeGroup.category === 'facility_area'
                      ? t('shiftList.actionSettings.specifyFacility')
                      : t('shiftList.actionSettings.specifyEquipment')}
                  </span>
                  <span className="mr-1 shrink-0 text-body-xs tracking-[0.5px] text-text-tertiary">
                    ({activeGroup.facilities.length})
                  </span>
                  {canPickSpecific ? (
                    <ChevronRight className="size-3.5 shrink-0 text-text-quaternary" />
                  ) : null}
                </button>
              </div>
            </div>
          ) : null}

          {/* Level 3：個別設施 — 對齊「指定設施」列，緊貼第二層 */}
          {activeGroup && specificOpen && canPickSpecific ? (
            <div
              className={menuPanelClass}
              style={{
                left: MENU_PANEL_WIDTH * 2,
                top: level2Top + level3Top,
                width: MENU_PANEL_WIDTH,
                isolation: 'isolate',
              }}
              onMouseEnter={() => {
                setActiveType(activeGroup.type);
                setSpecificOpen(true);
              }}
            >
              <div className={menuListClass}>
                {activeGroup.facilities.map((facility) => {
                  const value = `facility:${facility.id}`;
                  return (
                    <button
                      key={facility.id}
                      type="button"
                      className={menuOptionClass(selectedValue === value)}
                      onClick={() => pick('specific_facility', facility.id)}
                    >
                      <span className="min-w-0 flex-1 truncate px-2">
                        {facility.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionCard({
  action,
  zone,
  stationIdForStationZone,
  mediaOptions,
  facilityGroups,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  action: ShiftRouteSegmentAction;
  zone: ShiftActionZoneKind;
  stationIdForStationZone: string | null;
  mediaOptions: MediaLibraryOption[];
  facilityGroups: ActionFacilityTypeGroup[];
  index: number;
  total: number;
  onChange: (next: ShiftRouteSegmentAction) => void;
  onRemove: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation();
  const category = resolveShiftActionCategory(action.categoryId);
  const visibleStages = resolveVisibleActionStages(action);
  const showResource = shouldShowResourceStage(action);
  const allowedCategories = listCategoriesAllowedInZone(zone);
  const offsetUnit = action.offsetUnit ?? resolveDefaultOffsetUnit(category);
  const mediaItems = mediaOptions.filter((item) => item.kind === 'media');
  const mediaGroups = mediaOptions.filter((item) => item.kind === 'group');

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-quaternary bg-zinc-950/70 px-4 py-3.5">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <IconButton size="small" hierarchy="subordinate" variant="standard" disabled={index <= 0} onPress={() => onMove('up')} title={t('shiftList.actionSettings.moveUp')} label={t('shiftList.actionSettings.moveUp')} icon={<ArrowUp />} />
        <span
          className="flex size-7 items-center justify-center rounded-full bg-surface-theme text-body-xs-bold uppercase text-text-theme"
          aria-label={t('shiftList.actionSettings.itemAria', {
            letter: String.fromCharCode(97 + index),
          })}
        >
          {String.fromCharCode(97 + index)}
        </span>
        <IconButton size="small" hierarchy="subordinate" variant="standard" disabled={index >= total - 1} onPress={() => onMove('down')} title={t('shiftList.actionSettings.moveDown')} label={t('shiftList.actionSettings.moveDown')} icon={<ArrowDown />} />
      </div>

      <div className="flex min-w-0 flex-1 flex-nowrap items-end gap-5">
        <ActionMenuSelect
          label={t('shiftList.actionSettings.category')}
          value={action.categoryId ?? ''}
          widthClass="w-[176px]"
          panelWidth={176}
          options={allowedCategories.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          onChange={(nextValue) => {
            const categoryId = (nextValue || null) as ShiftActionCategoryId | null;
            const nextCategory = resolveShiftActionCategory(categoryId);
            const isStationCategory = nextCategory?.group === 'station';
            onChange({
              ...action,
              categoryId,
              revealedStageCount: 0,
              offsetValue: null,
              offsetUnit: resolveDefaultOffsetUnit(nextCategory),
              targetKind: isStationCategory ? 'specific_station' : null,
              targetId: isStationCategory ? stationIdForStationZone : null,
              behavior: null,
              resourceId: null,
            });
          }}
        />

        {visibleStages.includes('offset') && category ? (
          <div className="block shrink-0">
            <span className={FIELD_LABEL_CLASS}>
              {category.offsetLabel ?? t('shiftList.actionSettings.offset')}
            </span>
            <div className="flex h-10 items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={action.offsetValue == null ? '' : String(action.offsetValue)}
                placeholder="0"
                className={INPUT_CLASS}
                aria-label={t('shiftList.actionSettings.offsetValueAria')}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  onChange({
                    ...action,
                    offsetValue: digits === '' ? null : Number(digits),
                    offsetUnit,
                  });
                }}
              />
              <ActionMenuSelect
                label={t('shiftList.actionSettings.offsetUnit')}
                hideLabel
                value={offsetUnit ?? ''}
                widthClass="w-[88px]"
                panelWidth={88}
                options={SHIFT_ACTION_OFFSET_UNIT_OPTIONS.filter((unit) =>
                  category.offsetUnits.includes(unit.value),
                ).map((unit) => ({
                  value: unit.value,
                  label: unit.label,
                }))}
                onChange={(nextValue) => {
                  const nextUnit = (nextValue || null) as ShiftActionOffsetUnit | null;
                  onChange({
                    ...action,
                    offsetUnit: nextUnit,
                  });
                }}
              />
            </div>
          </div>
        ) : null}

        {visibleStages.includes('target') && category?.requiresTargetSelect ? (
          <FacilityTargetPicker
            targetKind={action.targetKind}
            targetId={action.targetId}
            facilityGroups={facilityGroups}
            onSelect={({ targetKind, targetId }) => {
              onChange({
                ...action,
                targetKind,
                targetId,
                behavior: null,
                resourceId: null,
              });
            }}
          />
        ) : null}

        {visibleStages.includes('behavior') && category ? (
          <ActionMenuSelect
            label={t('shiftList.actionSettings.behavior')}
            value={action.behavior ?? ''}
            widthClass="w-[148px]"
            panelWidth={148}
            options={SHIFT_ACTION_BEHAVIOR_OPTIONS.filter((behavior) =>
              category.behaviors.includes(behavior.value),
            ).map((behavior) => ({
              value: behavior.value,
              label: behavior.label,
            }))}
            onChange={(nextValue) => {
              const behavior = (nextValue || null) as ShiftActionBehavior | null;
              onChange({
                ...action,
                behavior,
                resourceId: null,
              });
            }}
          />
        ) : null}

        {visibleStages.includes('resource') && showResource && isMediaBehavior(action.behavior) ? (
          <ActionMenuSelect
            label={t('shiftList.actionSettings.mediaOrGroup')}
            value={action.resourceId ?? ''}
            widthClass={MEDIA_FIELD_WIDTH_CLASS}
            panelWidth={200}
            groups={[
              ...(mediaItems.length > 0
                ? [
                    {
                      label: t('shiftList.actionSettings.media'),
                      options: mediaItems.map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    },
                  ]
                : []),
              ...(mediaGroups.length > 0
                ? [
                    {
                      label: t('shiftList.actionSettings.mediaGroup'),
                      options: mediaGroups.map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    },
                  ]
                : []),
            ]}
            onChange={(nextValue) => {
              onChange({
                ...action,
                resourceId: nextValue.trim() || null,
              });
            }}
          />
        ) : null}
      </div>

      <IconButton size="small" hierarchy="danger" variant="standard" className="shrink-0" onPress={onRemove} title={t('shiftList.actionSettings.removeAction')} label={t('shiftList.actionSettings.removeAction')} icon={<Trash2 />} />
    </div>
  );
}

function ActionZonePanel({
  zone,
  title,
  actions,
  stationIdForStationZone,
  mediaOptions,
  facilityGroups,
  moduleSources,
  onApplyModule,
  onAdd,
  onUpdateAction,
  onRemoveAction,
  onReorder,
}: {
  zone: ShiftActionZoneKind;
  title: string;
  actions: ShiftRouteSegmentAction[];
  stationIdForStationZone: string | null;
  mediaOptions: MediaLibraryOption[];
  facilityGroups: ActionFacilityTypeGroup[];
  moduleSources: ActionModuleSource[];
  onApplyModule: (sourceKey: string) => void;
  onAdd: () => void;
  onUpdateAction: (actionId: string, next: ShiftRouteSegmentAction) => void;
  onRemoveAction: (actionId: string) => void;
  onReorder: (actionId: string, direction: 'up' | 'down') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-border-quaternary bg-black-30 px-5 py-4">
      <div className="mb-4 flex min-w-0 flex-wrap items-end gap-3">
        <p className="pb-2 text-body-s-bold text-text-primary">{title}</p>
        <ActionMenuSelect
          label={t('shiftList.actionSettings.applyModule')}
          value=""
          placeholder={
            moduleSources.length > 0
              ? t('shiftList.actionSettings.selectModule')
              : t('shiftList.actionSettings.noModules')
          }
          widthClass="w-[260px]"
          panelWidth={280}
          disabled={moduleSources.length === 0}
          options={moduleSources.map((source) => ({
            value: source.key,
            label: t('shiftList.actionSettings.moduleOption', {
              label: source.label,
              count: source.actions.length,
            }),
          }))}
          onChange={(sourceKey) => {
            if (sourceKey) onApplyModule(sourceKey);
          }}
        />
      </div>

      <div className="space-y-3">
        {actions.map((action, index) => (
          <ActionCard
            key={action.id}
            action={action}
            zone={zone}
            stationIdForStationZone={stationIdForStationZone}
            mediaOptions={mediaOptions}
            facilityGroups={facilityGroups}
            index={index}
            total={actions.length}
            onChange={(next) => onUpdateAction(action.id, next)}
            onRemove={() => onRemoveAction(action.id)}
            onMove={(direction) => onReorder(action.id, direction)}
          />
        ))}

        <div className="flex justify-center py-1">
          <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onAdd} title={t('shiftList.actionSettings.addAction')} label={t('shiftList.actionSettings.addAction')} icon={<Plus />} />
        </div>
      </div>
    </div>
  );
}

export function StepShiftActionSettings({
  draft,
  selectedRoutes,
  mapId,
  onChange,
}: StepShiftActionSettingsProps) {
  const { t } = useTranslation();
  const [mediaOptions, setMediaOptions] = useState<MediaLibraryOption[]>([]);
  const [facilityGroups, setFacilityGroups] = useState<ActionFacilityTypeGroup[]>([]);

  const orderedRoutes = useMemo(
    () => sortSelectedRoutesByExecutionOrder(selectedRoutes),
    [selectedRoutes],
  );

  const displayDraft = useMemo(
    () => syncActionSettingsWithSelectedRoutes(draft, orderedRoutes),
    [draft, orderedRoutes],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchMediaLibraryOptions()
      .then((items) => {
        if (!cancelled) setMediaOptions(items);
      })
      .catch(() => {
        if (!cancelled) setMediaOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadActionFacilityGroups(mapId)
      .then((groups) => {
        if (!cancelled) setFacilityGroups(groups);
      })
      .catch(() => {
        if (!cancelled) setFacilityGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const patchRoute = (
    routeId: string,
    updater: (
      route: ReturnType<typeof syncActionSettingsWithSelectedRoutes>['routes'][number],
    ) => ReturnType<typeof syncActionSettingsWithSelectedRoutes>['routes'][number],
  ) => {
    const base = syncActionSettingsWithSelectedRoutes(draft, orderedRoutes);
    onChange({
      routes: base.routes.map((route) => (route.routeId === routeId ? updater(route) : route)),
    });
  };

  const updateActionsAtPath = (
    path: ZonePath,
    mapActions: (actions: ShiftRouteSegmentAction[]) => ShiftRouteSegmentAction[],
  ) => {
    patchRoute(path.routeId, (route) => {
      if (path.kind === 'moving') {
        return {
          ...route,
          movingLegs: route.movingLegs.map((leg) => {
            if (
              leg.fromStationId !== path.fromStationId
              || leg.toStationId !== path.toStationId
            ) {
              return leg;
            }
            return { ...leg, actions: mapActions(leg.actions) };
          }),
        };
      }
      return {
        ...route,
        stations: route.stations.map((station) => {
          if (station.stationId !== path.stationId) return station;
          if (path.kind === 'before_arrive') {
            return { ...station, beforeArrive: mapActions(station.beforeArrive) };
          }
          return { ...station, afterArrive: mapActions(station.afterArrive) };
        }),
      };
    });
  };

  const applyModuleAtPath = (path: ZonePath, sourceKey: string) => {
    const sources = listActionModuleSources(displayDraft, path.kind);
    const source = sources.find((item) => item.key === sourceKey);
    if (!source) return;
    const stationId =
      path.kind === 'moving' ? null : path.stationId;
    updateActionsAtPath(path, () =>
      cloneActionsForModuleApply(source.actions, stationId),
    );
  };

  if (orderedRoutes.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col">
        <h2 className="mb-2 text-headline-5 text-text-primary">
          {t('shiftList.actionSettings.title')}
        </h2>
        <p className="text-body-s text-text-quaternary">{t('shiftList.actionSettings.needRouteGroups')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-6 shrink-0 text-headline-5 text-text-primary">
        {t('shiftList.actionSettings.title')}
      </h2>

      <div className="space-y-0">
        {displayDraft.routes.map((route, routeIndex) => (
          <div key={route.routeId}>
            {routeIndex > 0 ? (
              <div className="my-8 flex items-center gap-4" aria-hidden>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-zinc-600 to-zinc-600" />
                <span className="shrink-0 rounded-full border border-border-tertiary bg-surface-primary px-3 py-1 text-body-xs-bold tracking-[0.2em] text-text-tertiary">
                  {t('shiftList.actionSettings.nextRoute')}
                </span>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-zinc-600 to-zinc-600" />
              </div>
            ) : null}
            <section className="rounded-2xl border border-border-quaternary bg-black-30 p-5 shadow-[inset_3px_0_0_0_rgba(43,127,255,0.55)]">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <h3 className="text-body-m-bold text-text-primary">{route.routeName}</h3>
                {route.routeCode ? (
                  <span className="rounded bg-surface-secondary px-2 py-0.5 text-body-xs text-text-tertiary">
                    {route.routeCode}
                  </span>
                ) : null}
              </div>

              <div className="space-y-4">
                {route.stations.map((station, stationIndex) => {
                  const nextStation = route.stations[stationIndex + 1];
                  const movingLeg = nextStation
                    ? route.movingLegs.find(
                        (leg) =>
                          leg.fromStationId === station.stationId
                          && leg.toStationId === nextStation.stationId,
                      )
                    : null;

                  const makeHandlers = (path: ZonePath) => {
                    const moduleKey =
                      path.kind === 'moving'
                        ? buildActionModuleKey(
                            'moving',
                            path.routeId,
                            `${path.fromStationId}->${path.toStationId}`,
                          )
                        : buildActionModuleKey(path.kind, path.routeId, path.stationId);
                    return {
                      moduleSources: listActionModuleSources(
                        displayDraft,
                        path.kind,
                        moduleKey,
                      ),
                      onApplyModule: (sourceKey: string) =>
                        applyModuleAtPath(path, sourceKey),
                      onAdd: () =>
                        updateActionsAtPath(path, (actions) => [
                          ...actions,
                          createEmptySegmentAction(
                            path.kind === 'moving'
                              ? undefined
                              : {
                                  targetKind: 'specific_station',
                                  targetId: path.stationId,
                                },
                          ),
                        ]),
                      onUpdateAction: (actionId: string, next: ShiftRouteSegmentAction) =>
                        updateActionsAtPath(path, (actions) =>
                          actions.map((action) => (action.id === actionId ? next : action)),
                        ),
                      onRemoveAction: (actionId: string) =>
                        updateActionsAtPath(path, (actions) =>
                          actions.filter((action) => action.id !== actionId),
                        ),
                      onReorder: (actionId: string, direction: 'up' | 'down') =>
                        updateActionsAtPath(path, (actions) =>
                          reorderActionsInList(actions, actionId, direction),
                        ),
                    };
                  };

                  return (
                    <div key={station.stationId} className="space-y-3">
                      <ActionZonePanel
                        zone="before_arrive"
                        title={`${SHIFT_ACTION_ZONE_LABELS.before_arrive} · ${station.stationName}`}
                        actions={station.beforeArrive}
                        stationIdForStationZone={station.stationId}
                        mediaOptions={mediaOptions}
                        facilityGroups={facilityGroups}
                        {...makeHandlers({
                          kind: 'before_arrive',
                          routeId: route.routeId,
                          stationId: station.stationId,
                        })}
                      />

                      <div className="flex items-center gap-3 rounded-xl border border-border-quaternary bg-surface-primary px-4 py-3">
                        <span className="flex size-7 items-center justify-center rounded-full bg-surface-theme text-body-xs-bold tabular-nums text-text-theme">
                          {stationIndex + 1}
                        </span>
                        <span className="text-body-m-bold text-text-primary">
                          {station.stationName}
                        </span>
                      </div>

                      <ActionZonePanel
                        zone="after_arrive"
                        title={`${SHIFT_ACTION_ZONE_LABELS.after_arrive} · ${station.stationName}`}
                        actions={station.afterArrive}
                        stationIdForStationZone={station.stationId}
                        mediaOptions={mediaOptions}
                        facilityGroups={facilityGroups}
                        {...makeHandlers({
                          kind: 'after_arrive',
                          routeId: route.routeId,
                          stationId: station.stationId,
                        })}
                      />

                      {movingLeg ? (
                        <ActionZonePanel
                          zone="moving"
                          title={`${SHIFT_ACTION_ZONE_LABELS.moving} · ${movingLeg.fromStationName} → ${movingLeg.toStationName}`}
                          actions={movingLeg.actions}
                          stationIdForStationZone={null}
                          mediaOptions={mediaOptions}
                          facilityGroups={facilityGroups}
                          {...makeHandlers({
                            kind: 'moving',
                            routeId: route.routeId,
                            fromStationId: movingLeg.fromStationId,
                            toStationId: movingLeg.toStationId,
                          })}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}
