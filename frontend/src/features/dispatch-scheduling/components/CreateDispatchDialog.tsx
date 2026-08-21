import { ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchMediaLibraryOptions, type MediaLibraryOption } from '../../shift-list/api/mediaLibraryApi';
import { ShiftMenuSelect } from '../../shift-list/components/ShiftMenuSelect';
import {
  SHIFT_ACTION_CATEGORY_CATALOG,
  labelForOffsetUnit,
  resolveShiftActionCategory,
} from '../../shift-list/utils/actionSettingsCatalog';
import {
  createEmptySegmentAction,
  type ShiftRouteSegmentAction,
} from '../../shift-list/utils/actionSettings';
import { DispatchStationActionRow } from './DispatchStationActionRow';
import {
  loadShiftRouteGroupCatalog,
  type ShiftLocationOption,
  type ShiftRouteGroupCatalogItem,
  type ShiftRouteOption,
} from '../../shift-list/utils/shiftRouteGroupCatalog';
import {
  ExecutionTimeField,
  formatLocalHm,
} from '../../shift-deployment/components/ExecutionTimeField';
import {
  CreateDispatchConfirmHeader,
  CreateDispatchConfirmStep,
  CONFIRM_PHRASE,
} from './CreateDispatchConfirmStep';
import { VehicleAssignSelect } from './VehicleAssignSelect';
import {
  PRIORITY_LABEL,
  type DispatchCreateInput,
  type DispatchListItem,
  type DispatchPriorityKey,
} from '../types';

type CreateDispatchDialogProps = {
  existingCodes: string[];
  reservedVehicleCodes: string[];
  editing?: DispatchListItem | null;
  onClose: () => void;
  onCreate: (input: DispatchCreateInput) => void;
};

type StationStop = { id: string; stationId: string; actions: ShiftRouteSegmentAction[] };

const FIELD_LABEL = 'mb-1.5 block text-xs text-zinc-400';
const INPUT =
  'h-10 w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#2B7FFF] focus:ring-1 focus:ring-[#2B7FFF]/30';

const DEPARTURE_MODES = [
  { value: 'punctual', label: '準點發車' },
  { value: 'immediate', label: '到站即發' },
  { value: 'hold', label: '等候發車指令' },
];

const STATION_ACTION_OPTIONS = SHIFT_ACTION_CATEGORY_CATALOG.filter(
  (item) => item.group === 'station',
).map((item) => ({ value: item.id, label: item.label }));

const STATION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function stationLetter(index: number): string {
  if (index < 26) return STATION_LETTERS[index];
  return `${STATION_LETTERS[Math.floor(index / 26) - 1]}${STATION_LETTERS[index % 26]}`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyStation(): StationStop {
  return { id: newId('st'), stationId: '', actions: [] };
}

function nextDispatchCode(existingCodes: string[]): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const prefix = now.getHours() < 12 ? 'D' : 'U';
  const base = `${prefix}${hh}${mm}`;
  if (!existingCodes.includes(base)) return base;
  let i = 1;
  while (existingCodes.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function minutesFromNow(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  let diff = target.getTime() - now.getTime();
  if (diff < -30_000) {
    target.setDate(target.getDate() + 1);
    diff = target.getTime() - now.getTime();
  }
  return Math.round(diff / 60000);
}

function formatStationActionLabel(
  action: ShiftRouteSegmentAction,
  mediaNameById: Map<string, string>,
): string | null {
  const category = resolveShiftActionCategory(action.categoryId);
  if (!category) return null;
  const parts = [category.label];
  if (action.offsetValue != null && action.offsetUnit) {
    const unit = labelForOffsetUnit(action.offsetUnit);
    parts.push(`${category.offsetLabel ?? ''} ${action.offsetValue} ${unit}`.trim());
  }
  if (action.behavior === 'play_music') parts.push('播放音樂');
  const resource = action.resourceId ? mediaNameById.get(action.resourceId) : null;
  if (resource) parts.push(resource);
  return parts.join(' · ');
}

function RequiredLabel({ children }: { children: string }) {
  return (
    <span className={FIELD_LABEL}>
      <span className="mr-0.5 text-red-500">*</span>
      {children}
    </span>
  );
}

export function CreateDispatchDialog({
  existingCodes,
  reservedVehicleCodes,
  editing = null,
  onClose,
  onCreate,
}: CreateDispatchDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [execTime, setExecTime] = useState(editing?.exec_time ?? '');
  const [priority, setPriority] = useState(editing?.priority ?? '');
  const [vehicleCode, setVehicleCode] = useState(editing?.vehicle_code ?? '');
  const [taskName, setTaskName] = useState('');
  const [tripMinutes, setTripMinutes] = useState(
    editing?.trip_minutes ? String(editing.trip_minutes) : '',
  );
  const [departureMode, setDepartureMode] = useState('');
  const [broadcastMedia, setBroadcastMedia] = useState('');
  const [stations, setStations] = useState<StationStop[]>(
    editing?.stations?.length
      ? editing.stations.map((stop) => ({
          id: stop.id,
          stationId: stop.stationId,
          actions: [],
        }))
      : [emptyStation()],
  );
  const [routeGroupId, setRouteGroupId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groups, setGroups] = useState<ShiftRouteGroupCatalogItem[]>([]);
  const [trackLocations, setTrackLocations] = useState<ShiftLocationOption[]>([]);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibraryOption[]>([]);
  const [estimateMinutes, setEstimateMinutes] = useState(0);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadShiftRouteGroupCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setGroups(catalog.groups);
          setTrackLocations(catalog.trackLocations);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([]);
          setTrackLocations([]);
        }
      });
    void fetchMediaLibraryOptions()
      .then((items) => {
        if (!cancelled) setMediaLibrary(items);
      })
      .catch(() => {
        if (!cancelled) setMediaLibrary([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stationOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const group of groups) {
      for (const route of group.routes) {
        route.stationIds.forEach((id, index) => {
          if (!byId.has(id)) byId.set(id, route.stationNames[index] || id);
        });
      }
    }
    return [...byId.entries()].map(([value, label]) => ({ value, label }));
  }, [groups]);

  const locationSelectGroups = useMemo(() => {
    const groupsOut = [];
    if (stationOptions.length > 0) {
      groupsOut.push({ label: '停靠點', options: stationOptions });
    }
    if (trackLocations.length > 0) {
      groupsOut.push({ label: '軌道', options: trackLocations });
    }
    return groupsOut;
  }, [stationOptions, trackLocations]);

  const stationNameById = useMemo(() => {
    const byId = new Map(stationOptions.map((item) => [item.value, item.label]));
    for (const track of trackLocations) byId.set(track.value, track.label);
    return byId;
  }, [stationOptions, trackLocations]);

  const mediaOptions = useMemo(
    () => mediaLibrary.map((item) => ({ value: item.id, label: item.name })),
    [mediaLibrary],
  );

  const mediaResourceGroups = useMemo(() => {
    const mediaItems = mediaLibrary.filter((item) => item.kind === 'media');
    const mediaGroups = mediaLibrary.filter((item) => item.kind === 'group');
    return [
      ...(mediaItems.length > 0
        ? [
            {
              label: '媒體',
              options: mediaItems.map((item) => ({ value: item.id, label: item.name })),
            },
          ]
        : []),
      ...(mediaGroups.length > 0
        ? [
            {
              label: '媒體群組',
              options: mediaGroups.map((item) => ({ value: item.id, label: item.name })),
            },
          ]
        : []),
    ];
  }, [mediaLibrary]);

  const mediaNameById = useMemo(
    () => new Map(mediaLibrary.map((item) => [item.id, item.name])),
    [mediaLibrary],
  );

  const selectedGroup = groups.find((group) => group.groupId === routeGroupId) ?? null;
  const confirmStations = useMemo(
    () =>
      stations
        .filter((stop) => stop.stationId)
        .map((stop, index) => {
          const labels = stop.actions
            .map((action) => formatStationActionLabel(action, mediaNameById))
            .filter((label): label is string => Boolean(label));
          if (index === 0 && broadcastMedia && !labels.includes('廣播')) {
            labels.unshift('廣播');
          }
          return {
            id: stop.id,
            stationId: stop.stationId,
            name: stationNameById.get(stop.stationId) || stop.stationId,
            taskLabels: labels,
          };
        }),
    [stations, stationNameById, broadcastMedia, mediaNameById],
  );
  const canCreate = confirmText.trim() === CONFIRM_PHRASE;
  const timeOffset = execTime ? minutesFromNow(execTime) : null;
  const timeOk = timeOffset != null && timeOffset >= 0 && timeOffset <= 60;
  const tripOk = Number(tripMinutes) > 0;
  const stationsOk = stations.some((stop) => stop.stationId);
  const canNext = Boolean(
    timeOk &&
      priority &&
      vehicleCode &&
      taskName.trim() &&
      tripOk &&
      departureMode &&
      stationsOk,
  );

  const applyRoute = (group: ShiftRouteGroupCatalogItem, route: ShiftRouteOption) => {
    setRouteGroupId(group.groupId);
    setRouteId(route.routeId);
    setStations(
      route.stationIds.map((stationId) => ({
        id: newId('st'),
        stationId,
        actions: [],
      })),
    );
    const minutes = route.avgTravelTimeSeconds
      ? Math.max(1, Math.round(route.avgTravelTimeSeconds / 60))
      : 0;
    setEstimateMinutes(minutes);
    if (!tripMinutes && minutes > 0) setTripMinutes(String(minutes));
    if (!taskName.trim()) setTaskName(route.label);
    setGroupPickerOpen(false);
  };

  const updateStation = (id: string, stationId: string) => {
    setStations((prev) =>
      prev.map((stop) => (stop.id === id ? { ...stop, stationId } : stop)),
    );
  };

  const addAction = (stationId: string) => {
    setStations((prev) =>
      prev.map((stop) =>
        stop.id === stationId
          ? { ...stop, actions: [...stop.actions, createEmptySegmentAction()] }
          : stop,
      ),
    );
  };

  const updateAction = (stationId: string, next: ShiftRouteSegmentAction) => {
    setStations((prev) =>
      prev.map((stop) =>
        stop.id === stationId
          ? {
              ...stop,
              actions: stop.actions.map((action) => (action.id === next.id ? next : action)),
            }
          : stop,
      ),
    );
  };

  const removeAction = (stationId: string, actionId: string) => {
    setStations((prev) =>
      prev.map((stop) =>
        stop.id === stationId
          ? { ...stop, actions: stop.actions.filter((action) => action.id !== actionId) }
          : stop,
      ),
    );
  };

  const submit = () => {
    if (confirmText.trim() !== CONFIRM_PHRASE) return;
    const firstStation =
      stations.find((stop) => stop.stationId)?.stationId ?? '';
    onCreate({
      dispatch_code: editing?.dispatch_code ?? nextDispatchCode(existingCodes),
      dispatch_id: editing?.dispatch_id,
      priority: priority as DispatchPriorityKey,
      location: stationNameById.get(firstStation) || firstStation || '—',
      vehicle_code: vehicleCode,
      exec_time: execTime,
      trip_minutes: Number(tripMinutes) || estimateMinutes,
      stations: confirmStations,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-dispatch-title"
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#18181b] shadow-2xl ${
          step === 1 ? 'max-w-5xl' : 'max-w-lg'
        }`}
      >
        {step === 1 ? (
          <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
            <h2 id="create-dispatch-title" className="text-base font-semibold text-zinc-100">
              {editing ? '編輯派遣' : '建立派遣'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="關閉"
            >
              <X className="size-4" />
            </button>
          </header>
        ) : (
          <CreateDispatchConfirmHeader onClose={onClose} />
        )}

        {step === 1 ? (
          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
            <aside className="space-y-4 overflow-auto border-r border-zinc-800/80 px-6 py-1">
              <div>
                <RequiredLabel>執行時間</RequiredLabel>
                <ExecutionTimeField
                  value={execTime}
                  placeholder="限選擇1小時內的特定時間"
                  onChange={setExecTime}
                  onNow={() => setExecTime(formatLocalHm(new Date()))}
                />
                {execTime && !timeOk ? (
                  <p className="mt-1 text-[11px] text-red-400">請選擇現在起一小時內的時間</p>
                ) : null}
              </div>
              <div>
                <RequiredLabel>優先等級</RequiredLabel>
                <ShiftMenuSelect
                  label="優先等級"
                  hideLabel
                  value={priority}
                  placeholder="請選擇"
                  options={(Object.keys(PRIORITY_LABEL) as DispatchPriorityKey[]).map((key) => ({
                    value: key,
                    label: PRIORITY_LABEL[key],
                  }))}
                  onChange={setPriority}
                  widthClass="w-full"
                  panelWidth={200}
                />
              </div>
              <div>
                <RequiredLabel>指派載具</RequiredLabel>
                <VehicleAssignSelect
                  value={vehicleCode}
                  reservedCodes={reservedVehicleCodes}
                  onChange={setVehicleCode}
                />
              </div>
            </aside>

            <div className="min-h-0 overflow-auto px-6 py-1 pb-4">
              <section className="mb-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-200">基本資料</h3>
                  <button
                    type="button"
                    onClick={() => setGroupPickerOpen((open) => !open)}
                    className="inline-flex items-center text-sm text-[#51A2FF] hover:text-[#7CB8FF]"
                  >
                    選擇路線群組
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                {groupPickerOpen ? (
                  <div className="mb-4 max-h-56 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
                    {groups.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-zinc-500">目前地圖沒有可用路線群組</p>
                    ) : (
                      groups.map((group) => (
                        <div key={group.groupId} className="mb-2 last:mb-0">
                          <p className="px-2 py-1 text-[11px] text-zinc-500">{group.groupName}</p>
                          {group.routes.map((route) => (
                            <button
                              key={route.routeId}
                              type="button"
                              onClick={() => applyRoute(group, route)}
                              className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5 ${
                                routeId === route.routeId ? 'bg-white/10 text-zinc-100' : 'text-zinc-300'
                              }`}
                            >
                              <span>{route.label}</span>
                              <span className="text-[11px] text-zinc-500">{route.stationPathLabel}</span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
                {selectedGroup ? (
                  <p className="mb-3 text-[11px] text-zinc-500">
                    已選 {selectedGroup.groupName}
                    {routeId
                      ? `／${selectedGroup.routes.find((r) => r.routeId === routeId)?.label ?? ''}`
                      : ''}
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <RequiredLabel>派遣任務名稱</RequiredLabel>
                    <input
                      value={taskName}
                      onChange={(e) => setTaskName(e.target.value)}
                      placeholder="請輸入"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <RequiredLabel>行程時間</RequiredLabel>
                    <div className="relative">
                      <input
                        value={tripMinutes}
                        onChange={(e) => setTripMinutes(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="請輸入"
                        className={`${INPUT} pr-12`}
                        inputMode="numeric"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                        分鐘
                      </span>
                    </div>
                  </div>
                  <div>
                    <RequiredLabel>首站發車模式</RequiredLabel>
                    <ShiftMenuSelect
                      label="首站發車模式"
                      hideLabel
                      value={departureMode}
                      placeholder="請選擇"
                      options={DEPARTURE_MODES}
                      onChange={setDepartureMode}
                      widthClass="w-full"
                      panelWidth={220}
                    />
                  </div>
                  <div className="col-span-2">
                    <span className={FIELD_LABEL}>廣播媒體</span>
                    <ShiftMenuSelect
                      label="廣播媒體"
                      hideLabel
                      value={broadcastMedia}
                      placeholder="請選擇"
                      options={mediaOptions}
                      onChange={setBroadcastMedia}
                      widthClass="w-full"
                      panelWidth={280}
                    />
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-200">派遣任務規劃</h3>
                  <button
                    type="button"
                    onClick={() => setStations((prev) => [...prev, emptyStation()])}
                    className="inline-flex items-center gap-1 text-sm text-[#51A2FF] hover:text-[#7CB8FF]"
                  >
                    <Plus className="size-3.5" />
                    建立站點
                  </button>
                </div>

                <div className="space-y-3">
                  {stations.map((stop, index) => (
                    <div
                      key={stop.id}
                      className="flex overflow-visible rounded-xl border border-zinc-800 bg-zinc-950/40"
                    >
                      <div className="flex w-8 shrink-0 items-center justify-center rounded-l-xl bg-[#2B7FFF] text-sm font-semibold text-white">
                        {stationLetter(index)}
                      </div>
                      <div className="min-w-0 flex-1 p-3">
                        <ShiftMenuSelect
                          label="站點"
                          hideLabel
                          value={stop.stationId}
                          placeholder="請選擇"
                          groups={locationSelectGroups}
                          onChange={(value) => updateStation(stop.id, value)}
                          widthClass="w-full"
                          panelWidth={280}
                        />
                        <div className="mt-2 space-y-2">
                          {stop.actions.map((action) => (
                            <DispatchStationActionRow
                              key={action.id}
                              action={action}
                              stationId={stop.stationId}
                              categoryOptions={STATION_ACTION_OPTIONS}
                              mediaGroups={mediaResourceGroups}
                              onChange={(next) => updateAction(stop.id, next)}
                              onRemove={() => removeAction(stop.id, action.id)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => addAction(stop.id)}
                          className="mt-2 inline-flex items-center gap-1 text-sm text-[#51A2FF] hover:text-[#7CB8FF]"
                        >
                          <Plus className="size-3.5" />
                          建立行動
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setStations((prev) =>
                            prev.length <= 1
                              ? [emptyStation()]
                              : prev.filter((item) => item.id !== stop.id),
                          )
                        }
                        className="m-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        aria-label="刪除站點"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between text-sm text-zinc-400">
                  <span>總行程時間</span>
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                    行程預估 {estimateMinutes} min
                  </span>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <CreateDispatchConfirmStep
            execTime={execTime}
            priority={priority as DispatchPriorityKey | ''}
            vehicleCode={vehicleCode}
            tripMinutes={Number(tripMinutes) || estimateMinutes}
            stations={confirmStations}
            confirmText={confirmText}
            onConfirmTextChange={setConfirmText}
          />
        )}

        <footer className="flex shrink-0 items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            取消
          </button>
          {step === 1 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={() => {
                setConfirmText('');
                setStep(2);
              }}
              className="rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#2569e6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一步
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-[#51A2FF] hover:bg-[#2B7FFF]/10"
              >
                上一步
              </button>
              <button
                type="button"
                disabled={!canCreate}
                onClick={submit}
                className="rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#2569e6] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                建立
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
