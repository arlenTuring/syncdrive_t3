import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Plus,
  Route,
  Search,
  TrainFront,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SiteDateTimeInput } from "../../components/SiteDateTimeInput";
import { SiteSelect } from "../../components/SiteSelect";
import { useAuth } from "../access-control/AuthContext";
import {
  createSchedule,
  fetchScheduleCalendar,
  fetchScheduleDetail,
  fetchScheduleOptions,
  type CalendarCategory,
  type CalendarItem,
  type ScheduleOptions,
} from "./api";
import {
  addCivilDays,
  civilToEpoch,
  dayKey,
  formatDateTime,
  formatWeekday,
  weekStart,
} from "./dateTime";
import { Button, Dialog, IconButton, Radio, SegmentedControl, fieldClass } from '../../components/ui';

const CATEGORIES: Array<{
  key: CalendarCategory;
  label: string;
  tone: string;
}> = [
  { key: "running", label: "執行中", tone: "text-text-primary" },
  { key: "pending", label: "待執行", tone: "text-text-primary" },
  { key: "fault", label: "異常", tone: "text-status-error-emphasis" },
  { key: "completed", label: "結束", tone: "text-text-secondary" },
  { key: "cancelled", label: "取消", tone: "text-text-tertiary" },
];

const PAGE_BOOT_TIME = Date.now();

const nowInput = (timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  formatter.formatToParts(new Date(Date.now() + 5 * 60_000)).forEach((part) => {
    if (part.type !== "literal") p[part.type] = part.value;
  });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog title={title} onClose={onClose} padded={false} widthClassName={wide ? "max-w-6xl" : "max-w-2xl"}>
      {children}
    </Dialog>
  );
}

function RoutePicker({
  options,
  selected,
  onApply,
  onClose,
}: {
  options: ScheduleOptions;
  selected: string;
  onApply: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(selected);
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const grouped = new Map<string, ScheduleOptions["routes"]>();
    const needle = keyword.trim().toLowerCase();
    for (const route of options.routes) {
      if (
        !`${route.route_name} ${route.stations.map((station) => station.station_name).join(" ")}`
          .toLowerCase()
          .includes(needle)
      )
        continue;
      grouped.set(route.group_name, [
        ...(grouped.get(route.group_name) ?? []),
        route,
      ]);
    }
    return [...grouped.entries()];
  }, [keyword, options.routes]);
  return (
    <Modal title="選擇路線任務" onClose={onClose}>
      <div className="min-h-0 overflow-y-auto px-6 pb-6">
        <label className="flex items-center gap-2 rounded-xl bg-surface-secondary px-4 py-3">
          <Search className="size-5 text-text-quaternary" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className={fieldClass({ size: 'md', fullWidth: true })}
            placeholder="搜尋路線或站點"
          />
        </label>
        <div className="mt-5 space-y-3">
          {groups.map(([group, routes]) => (
            <section
              key={group}
              className="overflow-hidden rounded-xl border border-border-quaternary"
            >
              <button
                type="button"
                className="flex w-full items-center gap-3 bg-surface-secondary px-4 py-4 text-left"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [group]: !prev[group] }))
                }
              >
                <ChevronDown
                  className={`size-5 transition ${expanded[group] ? "" : "-rotate-90"}`}
                />
                {group}
              </button>
              {expanded[group] ? (
                <div className="space-y-2 p-4">
                  {routes.map((route) => (
                    <label
                      key={route.route_id}
                      className={`flex gap-3 rounded-lg p-3 ${route.available ? "cursor-pointer hover:bg-link-standard" : "cursor-not-allowed opacity-50"}`}
                    >
                      <Radio
                        name="route"
                        disabled={!route.available}
                        checked={draft === route.route_id}
                        onChange={() => setDraft(route.route_id)}
                      />
                      <span>
                        <strong>{route.route_name}</strong>
                        <span className="mt-1 block text-body-s text-text-tertiary">
                          {route.available
                            ? route.stations
                                .map((station) => station.station_name)
                                .join(" → ")
                            : route.unavailable_reason || "此路線目前不可用"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
      <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
        <Button hierarchy="subordinate" variant="tonal" onPress={onClose}>
          取消
        </Button>
        <Button disabled={!draft} onPress={() => onApply(draft)}>
          確定
        </Button>
      </footer>
    </Modal>
  );
}

function CreateDialog({
  options,
  onClose,
  onCreated,
}: {
  options: ScheduleOptions;
  onClose: () => void;
  onCreated: (item: CalendarItem) => void;
}) {
  const auth = useAuth();
  const [name, setName] = useState("");
  const [start, setStart] = useState(nowInput(options.time_zone));
  const [vehicle, setVehicle] = useState("");
  const [routeId, setRouteId] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [validationNow, setValidationNow] = useState(0);
  useEffect(() => {
    const update = () => setValidationNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  const route = options.routes.find((item) => item.route_id === routeId);
  const valid =
    name.trim() &&
    vehicle &&
    route?.available &&
    validationNow > 0 &&
    civilToEpoch(start, options.time_zone) > validationNow;
  const submit = async () => {
    if (
      !auth.can("operations.dispatch.create") &&
      !auth.can("service.scheduled-orders.create")
    ) {
      auth.require("operations.dispatch.create");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const item = await createSchedule({
        request_key: crypto.randomUUID(),
        display_name: name.trim(),
        vehicle_code: vehicle,
        route_id: routeId,
        planned_start: civilToEpoch(start, options.time_zone),
      });
      onCreated(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <>
      <Modal title="建立排程訂單" onClose={busy ? () => {} : onClose} wide>
        <div className="grid min-h-0 flex-1 md:grid-cols-[340px_1fr]">
          <div className="space-y-5 border-b border-border-quaternary p-6 md:border-b-0 md:border-r">
            <label className="block">
              <span className="mb-2 block text-body-s text-text-secondary">
                <b className="text-status-error-emphasis">*</b> 訂單名稱
              </span>
              <input
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass()}
                placeholder="請輸入"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-body-s text-text-secondary">
                <b className="text-status-error-emphasis">*</b> 計畫開始
              </span>
              <SiteDateTimeInput
                type="datetime-local"
                step={1}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                size="md"
                className="w-full"
                aria-label="計畫開始日期時間"
              />
              <small className="mt-2 block text-text-quaternary">
                依 {options.time_zone} 解讀
              </small>
            </label>
            <label className="block">
              <span className="mb-2 block text-body-s text-text-secondary">
                <b className="text-status-error-emphasis">*</b> 指派載具
              </span>
              <SiteSelect
                value={vehicle}
                onChange={(event) => setVehicle(event.target.value)}
                placeholder="請選擇"
                options={options.vehicles.map((item) => ({
                  value: item.vehicle_code,
                  label: `${item.display_name}（${item.vehicle_code}）`,
                }))}
                size="md"
                className="w-full"
              />
            </label>
          </div>
          <div className="min-h-0 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-body-m-bold">基本資料</h3>
              <Button variant="text" trailingIcon={<ChevronRight />} onPress={() => setPicker(true)}>
                選擇路線任務
              </Button>
            </div>
            {!route ? (
              <div className="mt-6 rounded-xl border border-dashed border-border-quaternary p-10 text-center text-text-quaternary">
                請先選擇一條既有路線
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div>
                  <span className="text-body-s text-text-quaternary">路線名稱</span>
                  <p className="mt-1 text-body-m">{route.route_name}</p>
                </div>
                <div>
                  <span className="text-body-s text-text-quaternary">行程估計</span>
                  <p className="mt-1">
                    {route.estimated_minutes == null
                      ? "路線未提供可靠的行程時間"
                      : `${route.estimated_minutes} 分鐘`}
                  </p>
                </div>
                <div>
                  <span className="text-body-s text-text-quaternary">
                    唯讀站序與既有動作
                  </span>
                  <div className="mt-2 space-y-2">
                    {route.stations.map((station, index) => (
                      <div
                        key={`${station.station_id}-${station.order}`}
                        className="flex gap-3 rounded-xl bg-surface-secondary p-3"
                      >
                        <span className="grid size-8 place-items-center rounded-lg bg-status-success-emphasis">
                          {String.fromCharCode(65 + index)}
                        </span>
                        <span>
                          <b>{station.station_name}</b>
                          {station.actions.length ? (
                            <small className="block text-text-quaternary">
                              {station.actions.join("、")}
                            </small>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {error ? (
              <p role="alert" className="mt-5 text-body-s text-status-error-emphasis">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <footer className="flex justify-end gap-3 border-t border-border-quaternary px-6 py-4">
          <Button hierarchy="subordinate" variant="tonal" disabled={busy} onPress={onClose}>
            取消
          </Button>
          <Button disabled={!valid || busy} onPress={() => void submit()}>
            {busy ? "建立中…" : "建立"}
          </Button>
        </footer>
      </Modal>
      {picker ? (
        <RoutePicker
          options={options}
          selected={routeId}
          onClose={() => setPicker(false)}
          onApply={(id) => {
            setRouteId(id);
            setPicker(false);
          }}
        />
      ) : null}
    </>
  );
}

function DetailDrawer({
  item,
  timeZone,
  onClose,
}: {
  item: CalendarItem;
  timeZone: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[170] bg-black-50"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="訂單詳情"
        className="ml-auto h-full w-full max-w-md overflow-y-auto border-l border-border-quaternary bg-surface-popup p-6 text-body-s shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-mono text-body-m">
              {item.order_id || item.schedule_id || item.source_id}
            </h2>
            {!item.order_id ? (
              <span className="text-body-xs text-status-warning">
                {item.source === "plan"
                  ? "班表計畫編號／尚未下發"
                  : "排程編號／尚未下發"}
              </span>
            ) : null}
          </div>
          <IconButton label="關閉" hierarchy="subordinate" variant="standard" icon={<X />} onPress={onClose} />
        </div>
        <dl className="mt-8 grid grid-cols-[110px_1fr] gap-y-4 text-body-s">
          <dt className="text-text-tertiary">訂單名稱</dt>
          <dd className="text-right">{item.display_name}</dd>
          <dt className="text-text-tertiary">顯示分類</dt>
          <dd className="text-right">
            {CATEGORIES.find((c) => c.key === item.category)?.label} ·{" "}
            {item.status}
          </dd>
          <dt className="text-text-tertiary">載具名稱</dt>
          <dd className="text-right">{item.vehicle_code}</dd>
          <dt className="text-text-tertiary">計畫開始</dt>
          <dd className="text-right">
            {formatDateTime(item.planned_start, timeZone)}
          </dd>
          <dt className="text-text-tertiary">計畫結束</dt>
          <dd className="text-right">
            {formatDateTime(item.planned_end, timeZone)}
          </dd>
          <dt className="text-text-tertiary">實際開始</dt>
          <dd className="text-right">
            {formatDateTime(item.actual_start, timeZone)}
          </dd>
          <dt className="text-text-tertiary">實際結束</dt>
          <dd className="text-right">
            {formatDateTime(item.actual_end, timeZone)}
          </dd>
          <dt className="text-text-tertiary">原因／提示</dt>
          <dd className="text-right">
            {item.reason || item.status_hint || "未提供"}
          </dd>
        </dl>
        <section className="mt-7 rounded-xl bg-surface-secondary p-4">
          <div className="flex justify-between">
            <strong>{item.route_name}</strong>
            <span>{item.stations.length} 站</span>
          </div>
          <div className="mt-4 space-y-2">
            {item.stations.length === 0 ? (
              <p className="text-body-s text-text-quaternary">
                此計畫快照未保存可顯示的站序，不以目前路線反向猜測。
              </p>
            ) : null}
            {item.stations.map((station, index) => (
              <div
                key={`${station.station_id}-${station.order}`}
                className="flex items-center overflow-hidden rounded-lg bg-surface-primary"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center bg-status-success-emphasis">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="px-4">{station.station_name}</span>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>,
    document.body,
  );
}

function CalendarCard({
  item,
  timeZone,
  onClick,
}: {
  item: CalendarItem;
  timeZone: string;
  onClick: (item: CalendarItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="w-full rounded-xl bg-surface-secondary px-4 py-3 text-left transition hover:bg-link-standard-hover focus:outline-none focus:ring-2 focus:ring-border-theme"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <ListChecks className="size-4 text-text-quaternary" />
            {item.display_name}
          </p>
          <p className="flex items-center gap-2 text-body-s text-text-secondary">
            <Route className="size-4 text-text-quaternary" />
            {item.route_name}
          </p>
        </div>
        <div className="space-y-2 text-body-s text-text-secondary">
          <p className="flex items-center gap-2">
            <TrainFront className="size-4 text-text-quaternary" />
            {item.vehicle_code}
          </p>
          <p className="flex items-center gap-2">
            <Clock3 className="size-4 text-text-quaternary" />
            {formatDateTime(item.planned_start, timeZone)}
          </p>
        </div>
      </div>
      {item.status_hint ? (
        <p className="mt-3 text-body-xs text-status-warning">{item.status_hint}</p>
      ) : null}
    </button>
  );
}

export function ScheduledOrdersPage() {
  const auth = useAuth();
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [calendar, setCalendar] = useState<Awaited<
    ReturnType<typeof fetchScheduleCalendar>
  > | null>(null);
  const [mode, setMode] = useState<"day" | "week">("day");
  const [selectedDay, setSelectedDay] = useState(
    dayKey(PAGE_BOOT_TIME, "Asia/Taipei"),
  );
  const [currentNow, setCurrentNow] = useState(PAGE_BOOT_TIME);
  const [vehicle, setVehicle] = useState("");
  const [limitPerGroup, setLimitPerGroup] = useState(20);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const timeZone = options?.time_zone || calendar?.time_zone || "Asia/Taipei";
  const startKey = mode === "week" ? weekStart(selectedDay) : selectedDay;
  const keys = Array.from({ length: mode === "week" ? 7 : 1 }, (_, index) =>
    addCivilDays(startKey, index),
  );
  const load = useCallback(
    async (keep = false, signal?: AbortSignal) => {
      const request = ++requestRef.current;
      if (!keep) setLoading(true);
      setError("");
      try {
        const result = await fetchScheduleCalendar(
          civilToEpoch(startKey, timeZone),
          civilToEpoch(
            addCivilDays(startKey, mode === "week" ? 7 : 1),
            timeZone,
          ),
          vehicle,
          limitPerGroup,
          signal,
        );
        if (request === requestRef.current && !signal?.aborted)
          setCalendar(result);
      } catch (err) {
        if (
          request === requestRef.current &&
          (err as Error).name !== "AbortError"
        )
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (request === requestRef.current && !signal?.aborted)
          setLoading(false);
      }
    },
    [limitPerGroup, mode, startKey, timeZone, vehicle],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchScheduleOptions(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setOptions(value);
        setSelectedDay(dayKey(Date.now(), value.time_zone));
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError")
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!options) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void load(false, controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, options]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!options) return;
    let controller: AbortController | null = null;
    const timer = window.setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      void load(true, controller.signal);
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [load, options]);
  useEffect(() => () => detailAbortRef.current?.abort(), []);
  const openDetail = useCallback(async (item: CalendarItem) => {
    detailReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    const request = ++detailRequestRef.current;
    setDetail(item);
    try {
      const full = await fetchScheduleDetail(item, controller.signal);
      if (request === detailRequestRef.current && !controller.signal.aborted)
        setDetail(full);
    } catch {
      /* 保留列表快照 */
    }
  }, []);
  const closeDetail = () => {
    detailAbortRef.current?.abort();
    detailAbortRef.current = null;
    setDetail(null);
    window.setTimeout(() => detailReturnFocusRef.current?.focus(), 0);
  };
  const shift = (amount: number) => {
    setLimitPerGroup(20);
    setSelectedDay(
      addCivilDays(selectedDay, amount * (mode === "week" ? 7 : 1)),
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col p-5 text-body-s text-text-primary">
      <div className="flex flex-wrap items-center gap-3">
        <SiteSelect
          value={vehicle}
          onChange={(event) => {
            setLimitPerGroup(20);
            setVehicle(event.target.value);
          }}
          options={[
            { value: "", label: "全部載具" },
            ...(options?.vehicles.map((item) => ({
              value: item.vehicle_code,
              label: item.display_name,
            })) ?? []),
          ]}
          size="md"
          className="w-48"
        />
        <Button
          hierarchy="subordinate"
          variant="outlined"
          onPress={() => {
            setLimitPerGroup(20);
            setSelectedDay(dayKey(Date.now(), timeZone));
          }}
        >
          今天
        </Button>
        <IconButton label="上一個日期區間" hierarchy="subordinate" variant="standard" icon={<ChevronLeft />} onPress={() => shift(-1)} />
        <IconButton label="下一個日期區間" hierarchy="subordinate" variant="standard" icon={<ChevronRight />} onPress={() => shift(1)} />
        <strong className="min-w-52 flex-1 text-center text-body-m">
          {mode === "week" ? `${keys[0]} ～ ${keys[6]}` : selectedDay}
        </strong>
        <SegmentedControl
          label="檢視範圍"
          value={mode}
          onChange={(next) => {
            setLimitPerGroup(20);
            setMode(next);
          }}
          options={[
            { id: "day" as const, label: "日" },
            { id: "week" as const, label: "週" },
          ]}
        />
        <Button
          leadingIcon={<Plus />}
          onPress={() =>
            auth.can("operations.dispatch.create") ||
            auth.can("service.scheduled-orders.create")
              ? setCreateOpen(true)
              : auth.require("operations.dispatch.create")
          }
        >
          建立排程
        </Button>
      </div>
      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-border-danger-light bg-status-error-light p-3 text-status-error-emphasis"
        >
          {error}
        </div>
      ) : null}
      {calendar?.unscheduled_count ? (
        <div className="mt-4 rounded-lg border border-status-warning-light bg-status-warning-light p-3 text-body-s text-status-warning">
          另有 {calendar.unscheduled_count}{" "}
          筆缺少計畫開始時間的舊訂單，未以建立時間推測日期，因此不會歸入日曆。
        </div>
      ) : null}
      <div
        className={`mt-6 min-h-0 flex-1 overflow-auto ${mode === "week" ? "grid min-w-[1260px] grid-cols-7" : ""}`}
      >
        {loading && !calendar ? (
          <div className="grid h-full place-items-center text-text-quaternary">
            正在載入排程…
          </div>
        ) : (
          keys.map((key) => {
            const day = calendar?.days[key];
            const items = day?.items ?? [];
            const dayTotal = day
              ? Object.values(day.counts).reduce((sum, count) => sum + count, 0)
              : 0;
            return (
              <section
                key={key}
                className={`${mode === "week" ? "border-r border-border-quaternary px-3" : ""}`}
              >
                <header
                  className={`mb-3 border-b-2 pb-3 text-center ${key === dayKey(currentNow, timeZone) ? "border-border-theme text-text-theme" : "border-border-quaternary"}`}
                >
                  <CalendarDays className="mr-2 inline size-4" />
                  {formatWeekday(key, timeZone)} · {key}{" "}
                  <span className="rounded-full border border-border-tertiary px-2 text-body-xs">
                    {dayTotal}筆
                  </span>
                </header>
                {items.length === 0 ? (
                  <p className="py-5 text-center text-body-s text-text-quaternary">
                    此日期沒有排程或訂單
                  </p>
                ) : null}
                {CATEGORIES.map((category) => {
                  const groupKey = `${key}:${category.key}`;
                  const group = items.filter(
                    (item) => item.category === category.key,
                  );
                  const total = day?.counts[category.key] ?? group.length;
                  const isOpen =
                    expanded[groupKey] ??
                    ["running", "pending", "fault"].includes(category.key);
                  return (
                    <div key={groupKey} className="mb-3">
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 py-2 text-left ${category.tone}`}
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [groupKey]: !isOpen,
                          }))
                        }
                      >
                        <ChevronDown
                          className={`size-4 ${isOpen ? "" : "-rotate-90"}`}
                        />
                        <b>{category.label}</b>
                        <span className="h-px flex-1 bg-link-standard-hover" />
                        <span className="rounded-full border border-border-tertiary px-2 text-body-xs">
                          {total}筆
                        </span>
                      </button>
                      {isOpen ? (
                        <div className="space-y-2">
                          {group.map((item) => (
                            <CalendarCard
                              key={`${item.source}:${item.source_id}`}
                              item={item}
                              timeZone={timeZone}
                              onClick={openDetail}
                            />
                          ))}
                          {group.length < total ? (
                            <Button
                              variant="outlined"
                              block
                              onPress={() =>
                                setLimitPerGroup((value) =>
                                  Math.min(200, value + 20),
                                )
                              }
                              disabled={limitPerGroup >= 200}
                            >
                              {limitPerGroup >= 200
                                ? `已顯示前 ${group.length} 筆，請縮小載具或日期範圍`
                                : `載入更多（已顯示 ${group.length} / ${total}）`}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            );
          })
        )}
      </div>
      {createOpen && options ? (
        <CreateDialog
          options={options}
          onClose={() => setCreateOpen(false)}
          onCreated={(item) => {
            setCreateOpen(false);
            setLimitPerGroup(20);
            setVehicle(item.vehicle_code);
            setSelectedDay(dayKey(item.planned_start, timeZone));
            void load();
          }}
        />
      ) : null}
      {detail ? (
        <DetailDrawer item={detail} timeZone={timeZone} onClose={closeDetail} />
      ) : null}
    </div>
  );
}
