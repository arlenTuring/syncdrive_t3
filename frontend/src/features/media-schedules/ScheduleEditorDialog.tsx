import { CalendarClock, GripVertical, Layers, Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { ApiError, type MediaGroup } from '../media-groups/api';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { MediaPickerDialog, type PickerPage } from '../media-groups/MediaPickerDialog';
import { moveItem } from '../media-groups/selection';
import { Checkbox, TypeBadge } from '../media-groups/widgets';
import {
  createSchedule,
  getSchedule,
  getScheduleSettings,
  listMediaOptions,
  listVehicleOptions,
  MEDIA_OPTIONS_PAGE_SIZE,
  SCHEDULE_NAME_MAX,
  updateSchedule,
  type PlaylistItem,
  type ScheduleDetail,
  type ScheduleVehicle,
} from './api';
import { draftFromDetail, emptyDraft, MODE_LABEL, PLAYLIST_MAX, timeZoneLabel, toInput, validateDraft, WEEKDAYS, weekdayLabel, type Draft } from './draft';
import { GroupPickerDialog } from './GroupPickerDialog';
import { WeeklyTimesDialog } from './WeeklyTimesDialog';

type Sub = 'weekly' | 'group' | 'media' | { replaceWith: MediaGroup } | null;

/**
 * 建立／編輯媒體排程。左：名稱、模式、時間、指派載具；右：播放清單。
 *
 * 所有修改都只在草稿，按「建立／儲存」才送出；子對話框（設定時間、套用分組、加入媒體）取消不影響草稿。
 * 編輯會完整還原（含版本），儲存時帶版本給後端做並行檢查。
 */
export function ScheduleEditorDialog({ scheduleId, onClose, onSaved, now = Date.now }: { scheduleId?: string; onClose: () => void; onSaved: (schedule: ScheduleDetail, created: boolean) => void; now?: () => number }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<ScheduleDetail | null>(null);
  const [vehicles, setVehicles] = useState<ScheduleVehicle[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [sub, setSub] = useState<Sub>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const nameId = useId();

  useEffect(() => {
    let cancelled = false;
    const load = scheduleId ? getSchedule(scheduleId).then((detail) => ({ detail, tz: detail.time_zone })) : getScheduleSettings().then((settings) => ({ detail: null, tz: settings.time_zone }));
    void Promise.all([load, listVehicleOptions()])
      .then(([{ detail, tz }, vehicleList]) => {
        if (cancelled) return;
        setOriginal(detail);
        setDraft(detail ? draftFromDetail(detail) : emptyDraft(tz));
        setVehicles(vehicleList.items);
      })
      .catch((reason: Error) => !cancelled && setLoadError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [scheduleId]);

  const update = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current)), []);
  const errors = useMemo(() => (draft ? validateDraft(draft, { now: now(), originalRunLocal: original?.mode === 'reserved' ? original.run_local : null }) : {}), [draft, original, now]);
  const shown = submitted ? errors : {};

  const save = async () => {
    if (!draft || saving) return;
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setError('');
    try {
      const saved = original ? await updateSchedule(original.id, toInput(draft, original.version)) : await createSchedule(toInput(draft));
      onSaved(saved, !original);
    } catch (reason) {
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 409 && /排程已被其他使用者修改/.test(reason.message)) setStale(true);
      setSaving(false);
    }
  };

  const applyGroup = (group: MediaGroup) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: group.members.map((member) => ({ ...member, missing: member.missing })),
            sourceGroup: { id: group.id, name: group.name, version: group.version },
          }
        : current,
    );
    setSub(null);
  };

  const mediaLoad = useCallback(
    async (query: { keyword: string; page: number }, signal: AbortSignal): Promise<PickerPage> => {
      const page = await listMediaOptions(query, signal);
      const inList = new Set(draft?.items.map((item) => item.id));
      return { items: page.items.map((item) => ({ ...item, included: inList.has(item.id) })), total: page.total, pageSize: MEDIA_OPTIONS_PAGE_SIZE };
    },
    [draft?.items],
  );
  const pickerItems = useRef(new Map<string, PlaylistItem>());

  const title = scheduleId ? '編輯媒體排程' : '建立媒體排程';
  return (
    <Dialog
      title={title}
      width="max-w-6xl"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          {submitted && Object.keys(errors).length ? <span className="mr-auto self-center text-sm text-red-400">尚有 {Object.keys(errors).length} 個欄位需要修正</span> : null}
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton disabled={!draft || saving || stale} onClick={() => void save()}>{saving ? '儲存中…' : scheduleId ? '儲存' : '建立'}</PrimaryButton>
        </>
      }
    >
      {loadError ? (
        <ErrorLine text={`載入失敗：${loadError}`} />
      ) : !draft || !vehicles ? (
        <p className="py-16 text-center text-zinc-500">載入中…</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-6">
            <Field label="排程名稱" required error={shown.name} htmlFor={nameId}>
              <input
                id={nameId}
                value={draft.name}
                maxLength={SCHEDULE_NAME_MAX}
                onChange={(event) => update('name', event.target.value)}
                placeholder="請輸入排程名稱"
                className="h-12 w-full rounded-xl bg-[#262a33] px-4 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </Field>
            <Field label="播放模式" required>
              <div role="radiogroup" aria-label="播放模式" className="flex gap-3">
                {(['reserved', 'timed'] as const).map((mode) => (
                  <label key={mode} className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${draft.mode === mode ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700'}`}>
                    <input type="radio" name="media-schedule-mode" checked={draft.mode === mode} onChange={() => update('mode', mode)} className="size-4 accent-blue-600" />
                    {MODE_LABEL[mode]}
                  </label>
                ))}
              </div>
            </Field>
            {draft.mode === 'reserved' ? (
              <Field label="開始時間" required error={shown.runLocal} hint={`時區：${timeZoneLabel(draft.timeZone, now())}`}>
                <SiteDateTimeInput
                  type="datetime-local"
                  value={draft.runLocal}
                  aria-label="預約播放開始時間"
                  onChange={(event) => update('runLocal', event.target.value.slice(0, 16))}
                  className="h-12 w-full rounded-xl bg-[#262a33] px-4"
                />
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="開始日期" required error={shown.startDate}>
                    <SiteDateTimeInput type="date" value={draft.startDate} aria-label="定時播放開始日期" onChange={(event) => update('startDate', event.target.value)} className="h-12 w-full rounded-xl bg-[#262a33] px-4" />
                  </Field>
                  <Field label="結束日期" error={shown.endDate} hint="空白＝無結束日期（含當天）">
                    <div className="flex items-center gap-2">
                      <SiteDateTimeInput type="date" value={draft.endDate} min={draft.startDate || undefined} aria-label="定時播放結束日期" onChange={(event) => update('endDate', event.target.value)} className="h-12 w-full rounded-xl bg-[#262a33] px-4" />
                      {draft.endDate ? (
                        <button type="button" onClick={() => update('endDate', '')} aria-label="清除結束日期" className="rounded p-1 text-zinc-400 hover:text-zinc-100">
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </Field>
                </div>
                <Field label="播放時間" required error={shown.weekly} hint={`時區：${timeZoneLabel(draft.timeZone, now())}`}>
                  <div className="rounded-xl bg-[#262a33] p-4">
                    {WEEKDAYS.some((day) => draft.weekly[day]?.length) ? (
                      <ul className="mb-3 space-y-2" aria-label="已設定的播放時間">
                        {WEEKDAYS.filter((day) => draft.weekly[day]?.length).map((day) => (
                          <li key={day} className="flex flex-wrap items-center gap-2">
                            <span className="w-10 text-zinc-300">{weekdayLabel(day)}</span>
                            {draft.weekly[day].map((time) => (
                              <span key={time} className="rounded-md bg-blue-500/15 px-2 py-0.5 text-sm text-blue-200">{time}</span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mb-3 text-sm text-zinc-500">尚未設定星期與時間</p>
                    )}
                    <button type="button" onClick={() => setSub('weekly')} className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300">
                      <CalendarClock className="size-4" />
                      設定時間
                    </button>
                  </div>
                </Field>
              </>
            )}
            <VehicleField draft={draft} vehicles={vehicles} error={shown.vehicles} onScope={(scope) => update('targetScope', scope)} onIds={(ids) => update('vehicleIds', ids)} />
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-lg font-medium text-zinc-100">排程清單</h3>
              <span className="text-sm text-zinc-500">{draft.items.length} / {PLAYLIST_MAX}</span>
              <button type="button" onClick={() => setSub('group')} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-zinc-600 px-3 py-2 text-sm hover:bg-white/5">
                <Layers className="size-4" />
                套用媒體分組
              </button>
            </div>
            {draft.sourceGroup ? <p className="mb-2 text-xs text-zinc-500">曾套用分組「{draft.sourceGroup.name}」（版本 {draft.sourceGroup.version}，僅供追溯，不會跟隨分組變動）</p> : null}
            <Playlist items={draft.items} onChange={(items) => update('items', items)} />
            <button
              type="button"
              disabled={draft.items.length >= PLAYLIST_MAX}
              onClick={() => setSub('media')}
              className="mt-3 inline-flex items-center gap-2 self-start text-blue-400 hover:text-blue-300 disabled:text-zinc-600"
            >
              <Plus className="size-4" />
              加入媒體
            </button>
            {shown.items ? <ErrorLine text={shown.items} /> : null}
          </div>
        </div>
      )}
      {error ? <ErrorLine text={error} /> : null}
      {stale ? <p className="mt-2 text-sm text-amber-300">排程已被其他使用者修改。請關閉後重新開啟以取得最新內容（目前的修改不會儲存）。</p> : null}

      {sub === 'weekly' && draft ? (
        <WeeklyTimesDialog
          value={draft.weekly}
          onClose={() => setSub(null)}
          onConfirm={(weekly) => {
            update('weekly', weekly);
            setSub(null);
          }}
        />
      ) : null}
      {sub === 'group' ? (
        <GroupPickerDialog onClose={() => setSub(null)} onApply={(group) => (draft?.items.length ? setSub({ replaceWith: group }) : applyGroup(group))} />
      ) : null}
      {sub && typeof sub === 'object' ? (
        <Dialog
          title="取代目前播放清單"
          onClose={() => setSub('group')}
          footer={
            <>
              <GhostButton onClick={() => setSub('group')}>取消</GhostButton>
              <PrimaryButton onClick={() => applyGroup(sub.replaceWith)}>取代</PrimaryButton>
            </>
          }
        >
          <p className="text-zinc-300">
            目前播放清單已有 {draft?.items.length ?? 0} 個媒體。套用「{sub.replaceWith.name}」會以該分組的 {sub.replaceWith.member_count} 個媒體取代目前清單（尚未儲存前都可以取消整個編輯）。
          </p>
        </Dialog>
      ) : null}
      {sub === 'media' && draft ? (
        <MediaPickerDialog
          load={async (query, signal) => {
            const page = await mediaLoad(query, signal);
            page.items.forEach((item) => pickerItems.current.set(item.id, item));
            return page;
          }}
          onClose={() => setSub(null)}
          targetLabel="播放清單"
          maxSelect={PLAYLIST_MAX - draft.items.length}
          limitHint={`播放清單最多 ${PLAYLIST_MAX} 個媒體，還可加入 ${PLAYLIST_MAX - draft.items.length} 個。`}
          onConfirm={async (ids) => {
            const added = ids.map((id) => pickerItems.current.get(id)).filter((item): item is PlaylistItem => Boolean(item));
            setDraft((current) => (current ? { ...current, items: [...current.items, ...added.filter((item) => !current.items.some((existing) => existing.id === item.id))] } : current));
            setSub(null);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function Field({ label, required, error, hint, htmlFor, children }: { label: string; required?: boolean; error?: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-zinc-300">
        {required ? <span className="mr-1 text-red-400">*</span> : null}
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 指派載具：全部載具（到期當下解析）或指定一台以上；已移除的載具保留顯示，需要手動移除才能儲存 */
function VehicleField({ draft, vehicles, error, onScope, onIds }: { draft: Draft; vehicles: ScheduleVehicle[]; error?: string; onScope: (scope: 'all' | 'vehicles') => void; onIds: (ids: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const known = new Set(vehicles.map((v) => v.id));
  const removed = draft.vehicleIds.filter((id) => !known.has(id));
  const keyword = filter.trim().toLowerCase();
  const visible = vehicles.filter((v) => !keyword || v.display_name.toLowerCase().includes(keyword) || v.vehicle_code.toLowerCase().includes(keyword));
  const toggle = (id: string) => onIds(draft.vehicleIds.includes(id) ? draft.vehicleIds.filter((item) => item !== id) : [...draft.vehicleIds, id]);
  return (
    <Field label="指派載具" required error={error ?? (removed.length && draft.targetScope === 'vehicles' ? `有 ${removed.length} 台載具已移除，請取消勾選後再儲存` : undefined)}>
      <div role="radiogroup" aria-label="指派載具範圍" className="flex gap-3">
        {(['all', 'vehicles'] as const).map((scope) => (
          <label key={scope} className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${draft.targetScope === scope ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700'}`}>
            <input type="radio" name="media-schedule-target" checked={draft.targetScope === scope} onChange={() => onScope(scope)} className="size-4 accent-blue-600" />
            {scope === 'all' ? '全部載具' : '指定載具'}
          </label>
        ))}
      </div>
      {draft.targetScope === 'all' ? (
        <p className="mt-2 text-xs text-zinc-500">每次到期時依當下的註冊載具決定名單；離線載具記錄為未下發，上線後不補播。</p>
      ) : (
        <div className="mt-3 rounded-xl bg-[#262a33] p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜尋載具名稱或代號" aria-label="搜尋載具" className="h-10 w-full rounded-lg bg-[#1b1d23] pr-3 pl-9 text-sm outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {removed.map((id) => (
              <div key={id} className="flex items-center gap-3 px-1 py-1">
                <Checkbox checked onChange={() => toggle(id)} label={`取消已移除的載具 ${id}`} />
                <span className="text-zinc-500 line-through">{id}</span>
                <span className="text-xs text-amber-300">已移除</span>
              </div>
            ))}
            {visible.map((vehicle) => (
              <div key={vehicle.id} className="flex items-center gap-3 px-1 py-1">
                <Checkbox checked={draft.vehicleIds.includes(vehicle.id)} onChange={() => toggle(vehicle.id)} label={`指定載具 ${vehicle.display_name}`} />
                <span className="text-zinc-100">{vehicle.display_name}</span>
                {vehicle.display_name !== vehicle.vehicle_code ? <span className="text-xs text-zinc-500">{vehicle.vehicle_code}</span> : null}
              </div>
            ))}
            {!vehicles.length ? <p className="py-4 text-center text-sm text-zinc-500">尚無註冊載具</p> : !visible.length && !removed.length ? <p className="py-4 text-center text-sm text-zinc-500">沒有符合的載具</p> : null}
          </div>
          <p className="mt-2 text-xs text-zinc-500">已指定 {draft.vehicleIds.length} 台</p>
        </div>
      )}
    </Field>
  );
}

/** 播放清單：拖曳把手或鍵盤（空白鍵拿起、上下鍵移動、空白鍵放下、Esc 取消）調整順序；× 只從這個排程移除 */
function Playlist({ items, onChange }: { items: PlaylistItem[]; onChange: (items: PlaylistItem[]) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<{ id: string; before: PlaylistItem[] } | null>(null);
  const [announce, setAnnounce] = useState('');
  const armed = useRef<string | null>(null);

  const onDragStart = (event: DragEvent, id: string) => {
    if (armed.current !== id) {
      event.preventDefault();
      return;
    }
    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (event: DragEvent, overId: string) => {
    if (!dragging) return;
    event.preventDefault();
    if (overId !== dragging) onChange(moveItem(items, items.findIndex((item) => item.id === dragging), items.findIndex((item) => item.id === overId)));
  };
  const onKey = (event: KeyboardEvent, item: PlaylistItem, index: number) => {
    const label = item.name ?? item.id;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (grabbed?.id === item.id) {
        setGrabbed(null);
        setAnnounce(`已放下 ${label}，位置 ${index + 1}`);
      } else {
        setGrabbed({ id: item.id, before: items });
        setAnnounce(`已拿起 ${label}，目前第 ${index + 1} 項；用上下鍵移動，空白鍵放下，Esc 取消`);
      }
    } else if (grabbed?.id === item.id && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= items.length) return;
      onChange(moveItem(items, index, to));
      setAnnounce(`${label} 移到第 ${to + 1} 項`);
    } else if (grabbed?.id === item.id && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onChange(grabbed.before);
      setGrabbed(null);
      setAnnounce(`已取消移動 ${label}`);
    }
  };

  return (
    <div className="min-h-[16rem] rounded-xl border border-zinc-700/70">
      <div className="grid grid-cols-[2.5rem_2rem_minmax(0,1.2fr)_6.5rem_minmax(0,1fr)_2.5rem] items-center border-b border-zinc-700/70 px-2 py-3 text-sm text-zinc-400">
        <span />
        <span>#</span>
        <span>媒體名稱</span>
        <span>檔案類型</span>
        <span>內容描述</span>
        <span />
      </div>
      {items.length ? (
        <ol aria-label="播放清單">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => onDragStart(event, item.id)}
              onDragOver={(event) => onDragOver(event, item.id)}
              onDragEnd={() => {
                setDragging(null);
                armed.current = null;
              }}
              className={`grid grid-cols-[2.5rem_2rem_minmax(0,1.2fr)_6.5rem_minmax(0,1fr)_2.5rem] items-center border-b border-zinc-800 px-2 py-2.5 ${dragging === item.id || grabbed?.id === item.id ? 'bg-blue-500/10' : ''}`}
            >
              <button
                type="button"
                onMouseDown={() => (armed.current = item.id)}
                onMouseUp={() => (armed.current = null)}
                onKeyDown={(event) => onKey(event, item, index)}
                aria-label={`調整 ${item.name ?? item.id} 的順序`}
                aria-pressed={grabbed?.id === item.id}
                data-captures-escape={grabbed?.id === item.id}
                className="cursor-grab rounded p-1 text-zinc-500 hover:text-zinc-200"
              >
                <GripVertical className="size-4" />
              </button>
              <span className="text-zinc-500">{index + 1}</span>
              <span className="min-w-0">
                <span className={`block truncate ${item.missing ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{item.name ?? '（已刪除的媒體）'}</span>
                {!item.available ? <span className="text-xs text-amber-300">{item.unavailable_label ?? '無法播放'}</span> : null}
              </span>
              <span>
                <TypeBadge type={item.media_type} />
              </span>
              <span className="truncate text-sm text-zinc-300" title={item.description}>{item.description || '—'}</span>
              <button type="button" onClick={() => onChange(items.filter((other) => other.id !== item.id))} aria-label={`從播放清單移除 ${item.name ?? item.id}`} className="rounded p-1 text-zinc-400 hover:text-red-400">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-14 text-center text-zinc-500">尚未加入媒體，請「加入媒體」或「套用媒體分組」</p>
      )}
      <p className="sr-only" aria-live="assertive">{announce}</p>
    </div>
  );
}
