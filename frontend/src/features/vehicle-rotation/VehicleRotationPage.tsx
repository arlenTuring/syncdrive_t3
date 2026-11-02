import { AlertTriangle, ArrowRight, Check, Circle, CircleDot, Eye, EyeOff, Rocket, RotateCcw, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { SiteMultiSelect } from '../../components/SiteMultiSelect';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import {
  applySimulatedSwap,
  buildDailyReport,
  DEFAULT_ROTATION_RULES,
  HOLD_LABEL,
  monitorSteps,
  nextRotationKm,
  rowLocationAt,
  rowStateAt,
  takeoverBlockers,
  type ChangeKind,
  type DailyReport,
  type FleetCar,
  type HoldState,
  type PlanTask,
  type PlanTaskKind,
  type ReportItem,
  type ReportStatus,
  type RotationMode,
  type RotationRules,
  type ShuntChange,
  type ShuntOrder,
} from './rotationModel';
import {
  buildSampleFleet,
  buildSampleRecords,
  fetchOperatingNow,
  fetchRotationPlan,
  readPocState,
  writePocState,
  type RotationPlan,
  type RotationRecord,
} from './rotationData';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('zh-TW', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const dateTime = (ms: number) => `${new Date(ms).toLocaleDateString('zh-TW')} ${clock(ms)}`;
const km = (value: number) => value.toLocaleString('zh-TW');
const startOfDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const MODE_LABEL: Record<RotationMode, string> = { confirm: '每日確認', auto: '自動執行' };
const CHANGE_STYLE: Record<ChangeKind, { label: string; className: string }> = {
  add: { label: '新增', className: 'bg-emerald-500/15 text-emerald-300' },
  cancel: { label: '取消', className: 'bg-rose-500/15 text-rose-300' },
  reassign: { label: '改派', className: 'bg-sky-500/15 text-sky-300' },
};
const TASK_LABEL: Record<PlanTaskKind, string> = { passenger: '載客', movement: '空車', maintenance: '整備' };
const STATUS_STYLE: Record<ReportStatus, { label: string; className: string }> = {
  pending: { label: '待確認', className: 'bg-amber-500/15 text-amber-300' },
  confirmed: { label: '監看中', className: 'bg-sky-500/15 text-sky-300' },
  skipped: { label: '已略過', className: 'bg-zinc-700/50 text-zinc-400' },
  done: { label: '已完成', className: 'bg-emerald-500/15 text-emerald-300' },
};

const PANEL = 'rounded-lg border border-zinc-800 bg-[#111114]';
const FIELD =
  'h-8 rounded-md border border-zinc-700 bg-[#18181b] px-2 text-sm text-zinc-100 outline-none focus:border-[#2B7FFF]';
const SECONDARY_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800';
const PRIMARY_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2B7FFF] px-3 text-sm text-white hover:bg-[#1f6fe8] disabled:opacity-50';

/** 規則視窗的輸入框：跟格位下拉同高同色 */
const DIALOG_FIELD =
  'h-10 w-36 rounded-xl bg-[#222831] px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-500';

type Tab = 'today' | 'fleet' | 'records';

function RulesDialog(props: {
  rules: RotationRules;
  slotOptions: { value: string; label: string }[];
  onClose: () => void;
  onDeploy: (rules: RotationRules) => void;
}) {
  const { onClose } = props;
  const [draft, setDraft] = useState(props.rules);
  const patch = (next: Partial<RotationRules>) => setDraft((current) => ({ ...current, ...next }));
  const valid = draft.intervalKm >= 1 && draft.takeoverSlots.length > 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-label="輪替規則" className="flex max-h-[90vh] w-[min(520px,96vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-[#141416] shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">輪替規則</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5 text-sm text-zinc-300">
          <label className="flex flex-col gap-2">
            每多少里程需要接替
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={draft.intervalKm}
                onChange={(event) => patch({ intervalKm: Number(event.target.value) })}
                className={`${DIALOG_FIELD} tabular-nums`}
              />
              公里
            </span>
          </label>
          <div className="flex flex-col gap-2">
            可接替車輛的格位
            <SiteMultiSelect
              values={draft.takeoverSlots}
              options={props.slotOptions}
              onChange={(takeoverSlots) => patch({ takeoverSlots })}
              ariaLabel="可接替車輛的格位"
              allLabel="請加入格位"
              triggerLabel={draft.takeoverSlots.length ? `已選 ${draft.takeoverSlots.length} 個格位` : '請加入格位'}
              filterPlaceholder="篩選格位"
              hideAllOption
              className="w-full"
            />
            {draft.takeoverSlots.length ? (
              <span className="flex flex-wrap gap-1.5">
                {draft.takeoverSlots.map((slot) => (
                  <span key={slot} className="inline-flex items-center gap-1 rounded bg-zinc-800 py-1 pl-2.5 pr-1.5 text-sm text-zinc-200">
                    {slot}
                    <button
                      type="button"
                      aria-label={`移除 ${slot}`}
                      onClick={() => patch({ takeoverSlots: draft.takeoverSlots.filter((item) => item !== slot) })}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-xs text-amber-300">至少要加入一個格位</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            期望執行時段
            <span className="flex items-center gap-2">
              <SiteDateTimeInput type="time" aria-label="期望執行時段開始" value={draft.windowStart} onChange={(event) => patch({ windowStart: event.target.value || draft.windowStart })} className={DIALOG_FIELD} />
              到
              <SiteDateTimeInput type="time" aria-label="期望執行時段結束" value={draft.windowEnd} onChange={(event) => patch({ windowEnd: event.target.value || draft.windowEnd })} className={DIALOG_FIELD} />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            執行方式
            <span className="inline-flex w-fit rounded-lg bg-[#1f1f22] p-0.5">
              {(Object.keys(MODE_LABEL) as RotationMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={draft.mode === mode}
                  onClick={() => patch({ mode })}
                  className={`h-7 rounded-md px-4 text-sm ${draft.mode === mode ? 'bg-[#2B7FFF] text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {MODE_LABEL[mode]}
                </button>
              ))}
            </span>
          </div>
          {draft.mode === 'confirm' ? (
            <div className="flex flex-col gap-2">
              待確認報告產出時間
              <span className="flex items-center gap-2">
                每日
                <SiteDateTimeInput type="time" aria-label="待確認報告產出時間" value={draft.reportBy} onChange={(event) => patch({ reportBy: event.target.value || draft.reportBy })} className={DIALOG_FIELD} />
                前產出
              </span>
            </div>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>取消</button>
          <button type="button" disabled={!valid} onClick={() => props.onDeploy(draft)} className={PRIMARY_BUTTON}>
            <Rocket className="size-3.5" aria-hidden />
            部署
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AutomationBar(props: { rules: RotationRules; deployedAt: number | null; onOpen: () => void; onReset: () => void }) {
  const { rules } = props;
  const summary = [
    `每 ${km(rules.intervalKm)} 公里`,
    `格位 ${rules.takeoverSlots.join('、')}`,
    `時段 ${rules.windowStart}–${rules.windowEnd}`,
    rules.mode === 'confirm' ? `每日 ${rules.reportBy} 前產出報告` : '報告自動執行',
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800/60 px-6 py-3">
      <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-100">
        <span className={`size-2 rounded-full ${props.deployedAt ? 'bg-emerald-400' : 'bg-zinc-500'}`} aria-hidden />
        {MODE_LABEL[rules.mode]}
      </span>
      <span className="text-xs text-zinc-400">{summary.join('｜')}</span>
      <span className="text-xs text-zinc-500">{props.deployedAt ? `${dateTime(props.deployedAt)} 部署` : '尚未部署，使用預設規則'}</span>
      <span className="ml-auto flex items-center gap-2">
        <button type="button" onClick={props.onReset} className={SECONDARY_BUTTON}>
          <RotateCcw className="size-3.5" aria-hidden />
          還原範例
        </button>
        <button type="button" onClick={props.onOpen} title="輪替規則" aria-label="輪替規則" className="inline-flex size-8 items-center justify-center rounded-full bg-[#1f1f22] text-zinc-300 transition hover:bg-zinc-800 hover:text-white">
          <Settings className="size-4" />
        </button>
      </span>
    </div>
  );
}

function BigStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-semibold text-zinc-100">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-zinc-400">{unit}</span> : null}
      </div>
    </div>
  );
}

/** 確認報告最重要的一塊：人靠這裡判斷這台車能不能上場 */
function TakeoverStatus({ car, tasks, now }: { car: FleetCar; tasks: readonly PlanTask[]; now: number }) {
  const rested = car.restSince == null ? '線上' : `${((now - car.restSince) / 3_600_000).toFixed(1)}`;
  return (
    <div className="rounded-lg border border-[#2B7FFF]/40 bg-[#2B7FFF]/5 px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-zinc-400">接替車輛目前狀態</span>
        <span className="text-xl font-semibold text-[#51A2FF]">{car.code}</span>
        <span className="text-sm text-zinc-300">{HOLD_LABEL[car.hold]}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
        <BigStat label="電量" value={String(car.batteryPct)} unit="%" />
        <BigStat label="目前里程" value={km(car.currentKm)} unit="km" />
        <BigStat label="所在格位" value={rowLocationAt(tasks, car.row, now) ?? '未知'} />
        <BigStat label="運營狀態" value={rowStateAt(tasks, car.row, now)} />
        <BigStat label="已休息" value={rested} unit={car.restSince == null ? undefined : '小時'} />
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: ShuntChange }) {
  const style = CHANGE_STYLE[change.kind];
  return (
    <tr className="border-b border-zinc-800/60 last:border-b-0">
      <td className="py-2 pl-4 pr-3 tabular-nums text-zinc-300">{clock(change.at)}</td>
      <td className="py-2 pr-3">
        <span className={`rounded px-1.5 py-0.5 text-xs ${style.className}`}>{style.label}</span>
      </td>
      <td className="py-2 pr-3 text-xs text-zinc-500">{TASK_LABEL[change.taskKind]}</td>
      <td className="py-2 pr-3 tabular-nums text-zinc-300">{change.tripCode ?? '調車移動'}</td>
      <td className="py-2 pr-3 text-zinc-300">
        {change.route}
        {change.estimated ? <span className="ml-2 text-xs text-amber-300">時間預估</span> : null}
      </td>
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-1.5 tabular-nums text-sm">
          <span className={change.after ? 'text-zinc-500' : 'text-rose-300 line-through'}>{change.before ?? '無'}</span>
          <ArrowRight className="size-3.5 text-zinc-600" aria-hidden />
          <span className={change.after ? 'text-zinc-100' : 'text-zinc-500'}>{change.after ?? '不開'}</span>
        </span>
      </td>
    </tr>
  );
}

function ShuntChanges({ order }: { order: ShuntOrder }) {
  const [showContext, setShowContext] = useState(false);
  const { counts } = order;
  return (
    <div className="rounded-lg border border-zinc-800">
      <p className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">
        班次時刻不變。改派 {counts.reassign} 筆（載客 {counts.passenger} 班）、新增 {counts.add} 筆、取消 {counts.cancel} 筆，
        其餘 {counts.unaffected} 筆不受影響
      </p>
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 bg-[#111114]">
            <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
              <th className="py-2 pl-4 pr-3 font-medium">時間</th>
              <th className="py-2 pr-3 font-medium">變動</th>
              <th className="py-2 pr-3 font-medium">類型</th>
              <th className="py-2 pr-3 font-medium">班次</th>
              <th className="py-2 pr-3 font-medium">路線</th>
              <th className="py-2 pr-4 font-medium">車輛</th>
            </tr>
          </thead>
          <tbody>
            {order.changes.map((change) => (
              <ChangeRow key={change.key} change={change} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-zinc-800">
        <button
          type="button"
          onClick={() => setShowContext((value) => !value)}
          className="flex w-full items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          {showContext ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
          {showContext ? '隱藏' : '顯示'}換手前後 30 分鐘未受影響的班次（{order.context.length}）
        </button>
        {showContext ? (
          <ul className="max-h-[200px] overflow-auto px-4 pb-3 tabular-nums text-xs text-zinc-600">
            {order.context.map((task) => (
              <li key={task.trip_code} className="flex gap-3 py-0.5">
                <span>{clock(task.depart_at)}</span>
                <span className="w-24">{task.trip_code}</span>
                <span className="w-14">{task.vehicle_code}</span>
                <span>
                  {task.origin} → {task.destination}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function MonitorPanel(props: { item: ReportItem; onAdvance: () => void; onFault: () => void }) {
  const { item } = props;
  const steps = monitorSteps(item.order);
  const finished = item.status === 'done';
  return (
    <div className="rounded-lg border border-zinc-800 px-4 py-3">
      <ol className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => {
          const done = index < item.stepsDone;
          const current = !finished && index === item.stepsDone;
          const fault = current && item.fault;
          return (
            <li key={step.key} className="flex min-w-0 gap-2">
              <span className="mt-0.5 shrink-0">
                {done ? <Check className="size-4 text-emerald-400" aria-label="已完成" /> : null}
                {fault ? <AlertTriangle className="size-4 text-rose-400" aria-label="異常" /> : null}
                {current && !fault ? <CircleDot className="size-4 text-sky-400" aria-label="進行中" /> : null}
                {!done && !current ? <Circle className="size-4 text-zinc-600" aria-label="未開始" /> : null}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${fault ? 'text-rose-300' : done || current ? 'text-zinc-100' : 'text-zinc-500'}`}>
                  {step.label}
                  {current && !fault ? <span className="ml-2 text-xs text-sky-300">進行中</span> : null}
                  {done ? <span className="ml-2 text-xs text-emerald-300">已完成</span> : null}
                </span>
                <span className="block text-xs text-zinc-500">
                  {step.at == null ? '' : `${clock(step.at)} `}
                  {step.detail}
                </span>
                {fault ? <span className="block text-xs text-rose-300">異常，需人工處理</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {finished ? null : (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <span className="mr-auto text-xs text-zinc-500">POC 沒有真的派車，用下面按鈕推進看畫面變化</span>
          <button type="button" onClick={props.onFault} disabled={item.fault} className={`${SECONDARY_BUTTON} disabled:opacity-50`}>模擬異常</button>
          <button type="button" onClick={props.onAdvance} className={PRIMARY_BUTTON}>模擬下一步</button>
        </div>
      )}
    </div>
  );
}

function ReportCard(props: {
  item: ReportItem;
  incoming: FleetCar | undefined;
  tasks: readonly PlanTask[];
  now: number;
  onConfirm: () => void;
  onSkip: () => void;
  onAdvance: () => void;
  onFault: () => void;
}) {
  const { item, incoming } = props;
  const { order } = item;
  const { window } = order;
  const status = item.fault && item.status === 'confirmed'
    ? { label: '異常', className: 'bg-rose-500/15 text-rose-300' }
    : STATUS_STYLE[item.status];
  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-3">
        <h2 className="inline-flex items-center gap-2 text-base font-medium text-zinc-100">
          {order.outgoing}
          <ArrowRight className="size-4 text-zinc-500" aria-hidden />
          {order.incoming}
        </h2>
        <span className={`rounded px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
        <span className="text-sm text-zinc-400">
          第 {window.row} 列｜{window.zone} {window.location}｜{clock(window.takeoverDepartAt)} 動身
        </span>
        {window.endOfDay ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">收班後</span> : null}
        {item.status === 'pending' ? (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={props.onSkip} className={SECONDARY_BUTTON}>今天略過</button>
            <button type="button" onClick={props.onConfirm} className={PRIMARY_BUTTON}>確認輪替</button>
          </span>
        ) : null}
      </div>
      {item.status === 'skipped' ? null : (
        <div className="flex flex-col gap-3 p-4">
          {incoming && item.status === 'pending' ? <TakeoverStatus car={incoming} tasks={props.tasks} now={props.now} /> : null}
          {item.status === 'pending' ? null : <MonitorPanel item={item} onAdvance={props.onAdvance} onFault={props.onFault} />}
          <ShuntChanges order={order} />
        </div>
      )}
    </section>
  );
}

function TodayTab(props: {
  report: DailyReport;
  cars: FleetCar[];
  tasks: readonly PlanTask[];
  now: number;
  onStatus: (id: string, status: ReportStatus) => void;
  onAdvance: (id: string) => void;
  onFault: (id: string) => void;
}) {
  const { report } = props;
  const nothing = report.items.length === 0 && report.blocked.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {nothing ? (
        <div className={`${PANEL} px-4 py-12 text-center text-sm text-zinc-500`}>今天沒有車到達輪替里程，不需要輪替</div>
      ) : null}
      {report.blocked.length ? (
        <section className={PANEL}>
          <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-medium text-amber-300">今日無法輪替</h2>
          {report.blocked.map((item) => (
            <p key={item.code} className="flex gap-4 border-b border-zinc-800/60 px-5 py-2.5 text-sm last:border-b-0">
              <span className="w-16 font-medium text-zinc-100">{item.code}</span>
              <span className="text-zinc-400">{item.reason}，車照常跑</span>
            </p>
          ))}
        </section>
      ) : null}
      {report.items.map((item) => (
        <ReportCard
          key={item.id}
          item={item}
          incoming={props.cars.find((car) => car.code === item.order.incoming)}
          tasks={props.tasks}
          now={props.now}
          onConfirm={() => props.onStatus(item.id, 'confirmed')}
          onSkip={() => props.onStatus(item.id, 'skipped')}
          onAdvance={() => props.onAdvance(item.id)}
          onFault={() => props.onFault(item.id)}
        />
      ))}
    </div>
  );
}

function FleetTab(props: {
  cars: FleetCar[];
  tasks: readonly PlanTask[];
  rules: RotationRules;
  now: number;
  dayStart: number;
  onHold: (code: string, hold: HoldState) => void;
}) {
  const { rules, now, tasks, dayStart } = props;
  return (
    <section className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[920px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
            <th className="py-2.5 pl-5 pr-3 font-medium">車輛</th>
            <th className="py-2.5 pr-3 font-medium">擔任列</th>
            <th className="py-2.5 pr-3 font-medium">運營狀態</th>
            <th className="py-2.5 pr-3 font-medium">位置</th>
            <th className="py-2.5 pr-3 text-right font-medium">目前里程</th>
            <th className="py-2.5 pr-3 text-right font-medium">上次輪替里程</th>
            <th className="py-2.5 pr-3 text-right font-medium">距下次輪替</th>
            <th className="py-2.5 pr-3 text-right font-medium">電量</th>
            <th className="py-2.5 pr-3 font-medium">接替資格</th>
            <th className="py-2.5 pr-5 font-medium">車輛設定</th>
          </tr>
        </thead>
        <tbody>
          {props.cars.map((car) => {
            const location = rowLocationAt(tasks, car.row, now);
            const remain = nextRotationKm(car, rules) - car.currentKm;
            const blockers = takeoverBlockers(car, rules, location, dayStart);
            return (
              <tr key={car.code} className="border-b border-zinc-800/60 last:border-b-0">
                <td className="py-2 pl-5 pr-3 font-medium text-zinc-100">{car.code}</td>
                <td className="py-2 pr-3 tabular-nums text-zinc-400">{car.row}</td>
                <td className="py-2 pr-3 text-zinc-300">{rowStateAt(tasks, car.row, now)}</td>
                <td className="py-2 pr-3 tabular-nums text-zinc-300">{location ?? '未知'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">{km(car.currentKm)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{km(car.lastRotationKm)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${remain <= 0 && car.onLine ? 'text-amber-300' : 'text-zinc-300'}`}>
                  {remain === 0 ? '已到' : remain < 0 ? `已過 ${km(-remain)}` : km(remain)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">{car.batteryPct}%</td>
                <td className={`py-2 pr-3 text-xs ${blockers.length ? 'text-zinc-500' : 'text-emerald-300'}`}>
                  {blockers.length ? blockers.join('、') : '可接替'}
                </td>
                <td className="py-2 pr-5">
                  <SiteSelect
                    value={car.hold}
                    aria-label={`${car.code} 車輛設定`}
                    onChange={(event) => props.onHold(car.code, event.target.value as HoldState)}
                    options={(Object.keys(HOLD_LABEL) as HoldState[]).map((hold) => ({ value: hold, label: HOLD_LABEL[hold] }))}
                    panelWidth={140}
                    className={`${FIELD} w-[108px] text-xs`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const RESULT_STYLE: Record<RotationRecord['result'], string> = {
  完成: 'text-emerald-300',
  異常: 'text-rose-300',
  略過: 'text-zinc-500',
};

function RecordsTab({ records }: { records: RotationRecord[] }) {
  return (
    <section className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
            <th className="py-2.5 pl-5 pr-3 font-medium">時間</th>
            <th className="py-2.5 pr-3 font-medium">換下車輛</th>
            <th className="py-2.5 pr-3 font-medium">接替車輛</th>
            <th className="py-2.5 pr-3 font-medium">地點</th>
            <th className="py-2.5 pr-3 font-medium">結果</th>
            <th className="py-2.5 pr-5 font-medium">確認人</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-b border-zinc-800/60 last:border-b-0">
              <td className="py-2 pl-5 pr-3 tabular-nums text-zinc-300">{dateTime(record.at)}</td>
              <td className="py-2 pr-3 text-zinc-300">{record.outgoing}</td>
              <td className="py-2 pr-3 text-zinc-300">{record.incoming}</td>
              <td className="py-2 pr-3 tabular-nums text-zinc-400">{record.location}</td>
              <td className={`py-2 pr-3 ${RESULT_STYLE[record.result]}`}>{record.result}</td>
              <td className="py-2 pr-5 text-zinc-400">{record.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function VehicleRotationPage() {
  const auth = useAuth();
  const [saved] = useState(readPocState);
  const [plan, setPlan] = useState<RotationPlan | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<RotationRules>({ ...DEFAULT_ROTATION_RULES, ...saved.rules });
  const [deployedAt, setDeployedAt] = useState<number | null>(saved.deployedAt ?? null);
  const [cars, setCars] = useState<FleetCar[]>([]);
  const [report, setReport] = useState<DailyReport>({ items: [], blocked: [] });
  const [records, setRecords] = useState<RotationRecord[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  const [rulesOpen, setRulesOpen] = useState(false);

  const tasks = useMemo(() => plan?.tasks ?? [], [plan]);
  const dayStart = startOfDay(now);

  const generate = (args: { tasks: readonly PlanTask[]; cars: FleetCar[]; rules: RotationRules; now: number; keep: readonly ReportItem[] }): DailyReport => {
    // POC 看的是整份班表，不管時段是否已過，白天打開也有報告可看
    const next = buildDailyReport({ ...args, dayStart: startOfDay(args.now), notBefore: 0 });
    if (args.rules.mode !== 'auto') return next;
    return { ...next, items: next.items.map((item) => (item.status === 'pending' ? { ...item, status: 'confirmed' as const } : item)) };
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchRotationPlan(), fetchOperatingNow().catch(() => Date.now())])
      .then(([nextPlan, operatingNow]) => {
        if (cancelled) return;
        const fleet = nextPlan
          ? buildSampleFleet(nextPlan.tasks, operatingNow).map((car) => ({ ...car, hold: saved.holds?.[car.code] ?? car.hold }))
          : [];
        setPlan(nextPlan);
        setNow(operatingNow);
        setCars(fleet);
        setRecords(buildSampleRecords(operatingNow));
        setReport(generate({ tasks: nextPlan?.tasks ?? [], cars: fleet, rules, now: operatingNow, keep: [] }));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '讀取失敗');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // 只在進頁面時讀一次；之後的規則與車輛變動由各自的動作重新產出
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slotOptions = useMemo(() => {
    const slots = new Set(tasks.filter((task) => task.kind === 'maintenance').map((task) => task.origin));
    return [...slots].sort((x, y) => x.localeCompare(y)).map((value) => ({ value, label: value }));
  }, [tasks]);

  const persist = (next: { rules?: RotationRules; deployedAt?: number; cars?: FleetCar[] }) =>
    writePocState({
      rules: next.rules ?? rules,
      deployedAt: next.deployedAt ?? deployedAt ?? undefined,
      holds: Object.fromEntries((next.cars ?? cars).map((car) => [car.code, car.hold])),
    });

  const deploy = (nextRules: RotationRules) => {
    const at = Date.now();
    setRules(nextRules);
    setDeployedAt(at);
    setRulesOpen(false);
    persist({ rules: nextRules, deployedAt: at });
    setReport(generate({ tasks, cars, rules: nextRules, now, keep: report.items }));
  };
  const setHold = (code: string, hold: HoldState) => {
    const nextCars = cars.map((car) => (car.code === code ? { ...car, hold } : car));
    setCars(nextCars);
    persist({ cars: nextCars });
    setReport(generate({ tasks, cars: nextCars, rules, now, keep: report.items }));
  };
  const addRecord = (item: ReportItem, result: RotationRecord['result']) =>
    setRecords((current) => [
      {
        id: `${item.id}-${result}`,
        at: now,
        outgoing: item.order.outgoing,
        incoming: item.order.incoming,
        location: item.order.window.location,
        result,
        by: rules.mode === 'auto' ? '自動執行' : auth.user?.display_name ?? '未登入',
      },
      ...current,
    ]);
  const patchItem = (id: string, patch: Partial<ReportItem>) =>
    setReport((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  const setStatus = (id: string, status: ReportStatus) => {
    const item = report.items.find((entry) => entry.id === id);
    patchItem(id, { status });
    if (item && status === 'skipped') addRecord(item, '略過');
  };
  const advance = (id: string) => {
    const item = report.items.find((entry) => entry.id === id);
    if (!item) return;
    const stepsDone = item.stepsDone + 1;
    if (stepsDone < monitorSteps(item.order).length) {
      patchItem(id, { stepsDone, fault: false });
      return;
    }
    patchItem(id, { stepsDone, fault: false, status: 'done' });
    setCars(applySimulatedSwap(cars, item.order, now));
    addRecord(item, '完成');
  };
  const reset = () => {
    if (!plan) return;
    const fleet = buildSampleFleet(plan.tasks, now);
    writePocState({});
    setRules(DEFAULT_ROTATION_RULES);
    setDeployedAt(null);
    setCars(fleet);
    setRecords(buildSampleRecords(now));
    setReport(generate({ tasks, cars: fleet, rules: DEFAULT_ROTATION_RULES, now, keep: [] }));
  };

  if (!loaded) {
    return <div className="flex flex-1 items-center justify-center bg-[#0a0a0b] text-sm text-zinc-500">載入今日班表中</div>;
  }
  if (error || !plan) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#0a0a0b] text-sm text-zinc-500">
        {error ?? '目前沒有部署中的班表'}
      </div>
    );
  }

  const pending = report.items.filter((item) => item.status === 'pending').length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'today', label: '今日輪替', count: pending || undefined },
    { id: 'fleet', label: '車輛清單' },
    { id: 'records', label: '輪替紀錄' },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-[#0a0a0b] text-zinc-100">
      <AutomationBar rules={rules} deployedAt={deployedAt} onOpen={() => setRulesOpen(true)} onReset={reset} />
      <div className="border-b border-amber-500/20 bg-amber-500/5 px-6 py-2 text-xs text-amber-200/80">
        POC 預覽：班次來自部署中的「{plan.shiftName}」，里程、電量、休息時間、監看進度、紀錄都是範例。這頁不會改動班表或訂單。
      </div>
      <div role="tablist" aria-label="車輛輪替管理" className="flex gap-1 border-b border-zinc-800 px-6">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-5 py-3 text-sm transition ${tab === item.id ? 'border-sky-400 text-sky-300' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
          >
            {item.label}
            {item.count ? <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs">{item.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="p-6">
        {tab === 'today' ? (
          <TodayTab
            report={report}
            cars={cars}
            tasks={tasks}
            now={now}
            onStatus={setStatus}
            onAdvance={advance}
            onFault={(id) => patchItem(id, { fault: true })}
          />
        ) : null}
        {tab === 'fleet' ? <FleetTab cars={cars} tasks={tasks} rules={rules} now={now} dayStart={dayStart} onHold={setHold} /> : null}
        {tab === 'records' ? <RecordsTab records={records} /> : null}
      </div>
      {rulesOpen ? <RulesDialog rules={rules} slotOptions={slotOptions} onClose={() => setRulesOpen(false)} onDeploy={deploy} /> : null}
    </div>
  );
}
