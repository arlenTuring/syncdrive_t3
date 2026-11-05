import { AlertTriangle, ArrowRight, Check, Circle, CircleDot, Eye, EyeOff, FileText, Rocket, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SiteDateTimeInput } from '../../components/SiteDateTimeInput';
import { SiteMultiSelect } from '../../components/SiteMultiSelect';
import { SiteSelect } from '../../components/SiteSelect';
import {
  confirmItem,
  deployRules,
  fetchRecords,
  fetchToday,
  fetchVehicles,
  generateReport,
  setVehicleHold,
  skipItem,
  type CarView,
  type ChangeKind,
  type FleetCar,
  type HoldState,
  type ItemStatus,
  type PlanTaskKind,
  type RotationItem,
  type RotationMode,
  type RotationRecord,
  type RotationRules,
  type RotationToday,
  type ShuntChange,
  type ShuntOrder,
  type StepStatus,
} from './rotationData';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('zh-TW', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const dateTime = (ms: number) => `${new Date(ms).toLocaleDateString('zh-TW')} ${clock(ms)}`;
const km = (value: number) => value.toLocaleString('zh-TW');
const HOLD_LABEL: Record<HoldState, string> = { available: '可輪替', reserved: '保留', overhaul: '大保養' };
const POLL_MS = 15_000;

const MODE_LABEL: Record<RotationMode, string> = { confirm: '每日確認', auto: '自動執行' };
const CHANGE_STYLE: Record<ChangeKind, { label: string; className: string }> = {
  add: { label: '新增', className: 'bg-emerald-500/15 text-emerald-300' },
  cancel: { label: '取消', className: 'bg-rose-500/15 text-rose-300' },
  reassign: { label: '改派', className: 'bg-sky-500/15 text-sky-300' },
};
const TASK_LABEL: Record<PlanTaskKind, string> = { passenger: '載客', movement: '空車', maintenance: '整備' };
const STATUS_STYLE: Record<ItemStatus, { label: string; className: string }> = {
  pending: { label: '待確認', className: 'bg-amber-500/15 text-amber-300' },
  confirmed: { label: '監看中', className: 'bg-sky-500/15 text-sky-300' },
  skipped: { label: '已略過', className: 'bg-zinc-700/50 text-zinc-400' },
  done: { label: '已完成', className: 'bg-emerald-500/15 text-emerald-300' },
  aborted: { label: '已中止', className: 'bg-rose-500/15 text-rose-300' },
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
  slotOptions: string[];
  onClose: () => void;
  onDeploy: (rules: RotationRules) => Promise<void>;
}) {
  const { onClose } = props;
  const [draft, setDraft] = useState(props.rules);
  const patch = (next: Partial<RotationRules>) => setDraft((current) => ({ ...current, ...next }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = draft.intervalKm >= 1 && draft.takeoverSlots.length > 0;
  const deploy = () => {
    setSaving(true);
    setError(null);
    props.onDeploy(draft).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '部署失敗');
      setSaving(false);
    });
  };

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
              options={[...new Set([...props.slotOptions, ...draft.takeoverSlots])].map((value) => ({ value, label: value }))}
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
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          {error ? <span className="mr-auto text-xs text-rose-300">{error}</span> : null}
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>取消</button>
          <button type="button" disabled={!valid || saving} onClick={deploy} className={PRIMARY_BUTTON}>
            <Rocket className="size-3.5" aria-hidden />
            部署
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AutomationBar(props: { rules: RotationRules; deployedAt: number | null; onOpen: () => void }) {
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
      <span className="text-xs text-zinc-500">{props.deployedAt ? `${dateTime(props.deployedAt)} 部署` : '尚未部署，不會自動產出報告'}</span>
      <span className="ml-auto flex items-center gap-2">
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
function TakeoverStatus({ car, now }: { car: CarView; now: number }) {
  return (
    <div className="rounded-lg border border-[#2B7FFF]/40 bg-[#2B7FFF]/5 px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-zinc-400">接替車輛目前狀態</span>
        <span className="text-xl font-semibold text-[#51A2FF]">{car.code}</span>
        <span className="text-sm text-zinc-300">{HOLD_LABEL[car.hold]}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
        <BigStat label="電量" value={car.battery_pct == null ? '無資料' : String(Math.round(car.battery_pct))} unit={car.battery_pct == null ? undefined : '%'} />
        <BigStat label="目前里程" value={km(car.current_km)} unit="km" />
        <BigStat label="所在格位" value={car.location ?? '未知'} />
        <BigStat label="運營狀態" value={car.state} />
        <BigStat
          label="已休息"
          value={car.rest_since == null ? '無資料' : ((now - car.rest_since) / 3_600_000).toFixed(1)}
          unit={car.rest_since == null ? undefined : '小時'}
        />
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

const STEP_WORD: Partial<Record<StepStatus, { text: string; className: string }>> = {
  running: { text: '進行中', className: 'text-sky-300' },
  done: { text: '已完成', className: 'text-emerald-300' },
  fault: { text: '異常', className: 'text-rose-300' },
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <Check className="size-4 text-emerald-400" aria-hidden />;
  if (status === 'fault') return <AlertTriangle className="size-4 text-rose-400" aria-hidden />;
  if (status === 'running') return <CircleDot className="size-4 text-sky-400" aria-hidden />;
  return <Circle className="size-4 text-zinc-600" aria-hidden />;
}

function MonitorPanel({ item }: { item: RotationItem }) {
  return (
    <div className="rounded-lg border border-zinc-800 px-4 py-3">
      <ol className="grid gap-3 md:grid-cols-4">
        {item.steps.map((step) => {
          const word = STEP_WORD[step.status];
          return (
            <li key={step.key} className="flex min-w-0 gap-2">
              <span className="mt-0.5 shrink-0"><StepIcon status={step.status} /></span>
              <span className="min-w-0">
                <span className={`block text-sm ${step.status === 'fault' ? 'text-rose-300' : step.status === 'waiting' ? 'text-zinc-500' : 'text-zinc-100'}`}>
                  {step.label}
                  {word ? <span className={`ml-2 text-xs ${word.className}`}>{word.text}</span> : null}
                </span>
                <span className="block text-xs text-zinc-500">
                  {step.at == null ? '' : `${clock(step.at)} `}
                  {step.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {item.fault ? <p className="mt-3 border-t border-zinc-800 pt-3 text-sm text-rose-300">{item.fault}</p> : null}
    </div>
  );
}

function ReportCard(props: { item: RotationItem; now: number; busy: boolean; onConfirm: () => void; onSkip: () => void }) {
  const { item } = props;
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
          第 {window.row} 列｜{window.zone} {window.location}｜{clock(window.takeoverDepartAt)} 動身｜{item.effective_day} 起換列
        </span>
        {item.status === 'pending' ? (
          <span className="ml-auto flex gap-2">
            <button type="button" disabled={props.busy} onClick={props.onSkip} className={`${SECONDARY_BUTTON} disabled:opacity-50`}>今天略過</button>
            <button type="button" disabled={props.busy} onClick={props.onConfirm} className={PRIMARY_BUTTON}>確認輪替</button>
          </span>
        ) : null}
      </div>
      {item.status === 'skipped' ? null : (
        <div className="flex flex-col gap-3 p-4">
          {item.incoming_status && item.status === 'pending' ? <TakeoverStatus car={item.incoming_status} now={props.now} /> : null}
          {item.status === 'pending' ? null : <MonitorPanel item={item} />}
          <ShuntChanges order={order} />
        </div>
      )}
    </section>
  );
}

function TodayTab(props: {
  today: RotationToday;
  busy: boolean;
  onConfirm: (id: string) => void;
  onSkip: (id: string) => void;
  onGenerate: () => void;
}) {
  const { today } = props;
  const nothing = today.items.length === 0 && today.blocked.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {nothing ? (
        <div className={`${PANEL} flex flex-col items-center gap-3 px-4 py-12 text-sm text-zinc-500`}>
          {today.report_generated_at == null
            ? `今天的報告還沒產出，每日 ${today.rules.reportBy} 前產出`
            : '今天沒有車到達輪替里程，不需要輪替'}
          {today.report_generated_at == null ? (
            <button type="button" disabled={props.busy} onClick={props.onGenerate} className={SECONDARY_BUTTON}>
              <FileText className="size-3.5" aria-hidden />
              立刻產出報告
            </button>
          ) : null}
        </div>
      ) : null}
      {today.blocked.length ? (
        <section className={PANEL}>
          <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-medium text-amber-300">今日無法輪替</h2>
          {today.blocked.map((item) => (
            <p key={item.code} className="flex gap-4 border-b border-zinc-800/60 px-5 py-2.5 text-sm last:border-b-0">
              <span className="w-16 font-medium text-zinc-100">{item.code}</span>
              <span className="text-zinc-400">{item.reason}，車照常跑</span>
            </p>
          ))}
        </section>
      ) : null}
      {today.items.map((item) => (
        <ReportCard
          key={item.id}
          item={item}
          now={today.now}
          busy={props.busy}
          onConfirm={() => props.onConfirm(item.id)}
          onSkip={() => props.onSkip(item.id)}
        />
      ))}
    </div>
  );
}

function FleetTab(props: { cars: FleetCar[]; onHold: (code: string, hold: HoldState) => void }) {
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
            const remain = Math.round(car.next_rotation_km - car.current_km);
            return (
              <tr key={car.code} className="border-b border-zinc-800/60 last:border-b-0">
                <td className="py-2 pl-5 pr-3 font-medium text-zinc-100">{car.code}</td>
                <td className="py-2 pr-3 tabular-nums text-zinc-400">{car.row}</td>
                <td className="py-2 pr-3 text-zinc-300">{car.state}</td>
                <td className="py-2 pr-3 tabular-nums text-zinc-300">{car.location ?? '未知'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">{km(car.current_km)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{km(car.last_rotation_km)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${remain <= 0 && car.on_line ? 'text-amber-300' : 'text-zinc-300'}`}>
                  {remain === 0 ? '已到' : remain < 0 ? `已過 ${km(-remain)}` : km(remain)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">{car.battery_pct == null ? '無資料' : `${Math.round(car.battery_pct)}%`}</td>
                <td className={`py-2 pr-3 text-xs ${car.blockers.length ? 'text-zinc-500' : 'text-emerald-300'}`}>
                  {car.blockers.length ? car.blockers.join('、') : '可接替'}
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

const RESULT_VIEW: Record<RotationRecord['result'], { label: string; className: string }> = {
  done: { label: '完成', className: 'text-emerald-300' },
  aborted: { label: '已中止', className: 'text-rose-300' },
  skipped: { label: '略過', className: 'text-zinc-500' },
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
          {records.length === 0 ? (
            <tr><td colSpan={6} className="py-12 text-center text-zinc-500">還沒有輪替紀錄</td></tr>
          ) : null}
          {records.map((record) => (
            <tr key={record.id} className="border-b border-zinc-800/60 last:border-b-0">
              <td className="py-2 pl-5 pr-3 tabular-nums text-zinc-300">{record.at == null ? record.operating_day : dateTime(record.at)}</td>
              <td className="py-2 pr-3 text-zinc-300">{record.outgoing}</td>
              <td className="py-2 pr-3 text-zinc-300">{record.incoming}</td>
              <td className="py-2 pr-3 tabular-nums text-zinc-400">{record.location}</td>
              <td className={`py-2 pr-3 ${RESULT_VIEW[record.result].className}`} title={record.fault ?? undefined}>{RESULT_VIEW[record.result].label}</td>
              <td className="py-2 pr-5 text-zinc-400">{record.by ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function VehicleRotationPage() {
  const [today, setToday] = useState<RotationToday | null>(null);
  const [cars, setCars] = useState<FleetCar[]>([]);
  const [records, setRecords] = useState<RotationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [rulesOpen, setRulesOpen] = useState(false);

  const load = useCallback(async () => {
    const [nextToday, nextCars, nextRecords] = await Promise.all([fetchToday(), fetchVehicles(), fetchRecords()]);
    setToday(nextToday);
    setCars(nextCars.items);
    setRecords(nextRecords.items);
    setError(null);
  }, []);

  useEffect(() => {
    const refresh = () => {
      void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '讀取失敗'));
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    void action()
      .then(load)
      .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : '操作失敗'))
      .finally(() => setBusy(false));
  };

  if (!today) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#0a0a0b] text-sm text-zinc-500">
        {error ?? '載入中'}
      </div>
    );
  }

  const pending = today.items.filter((item) => item.status === 'pending').length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'today', label: '今日輪替', count: pending || undefined },
    { id: 'fleet', label: '車輛清單' },
    { id: 'records', label: '輪替紀錄' },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-[#0a0a0b] text-zinc-100">
      <AutomationBar rules={today.rules} deployedAt={today.deployed_at} onOpen={() => setRulesOpen(true)} />
      {actionError ?? error ? (
        <div className="border-b border-rose-500/20 bg-rose-500/5 px-6 py-2 text-xs text-rose-200">{actionError ?? error}</div>
      ) : null}
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
            today={today}
            busy={busy}
            onConfirm={(id) => run(() => confirmItem(id))}
            onSkip={(id) => run(() => skipItem(id))}
            onGenerate={() => run(generateReport)}
          />
        ) : null}
        {tab === 'fleet' ? <FleetTab cars={cars} onHold={(code, hold) => run(() => setVehicleHold(code, hold))} /> : null}
        {tab === 'records' ? <RecordsTab records={records} /> : null}
      </div>
      {rulesOpen ? (
        <RulesDialog
          rules={today.rules}
          slotOptions={today.slot_options}
          onClose={() => setRulesOpen(false)}
          onDeploy={async (rules) => {
            await deployRules(rules);
            setRulesOpen(false);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}
