import { X } from 'lucide-react';
import type {
  ScheduleAnalysisReport,
  ScheduleAnalysisSuggestion,
} from '../utils/buildScheduleAnalysisReport';

function formatClock(minute: number): string {
  const total = Math.max(0, Math.round(minute));
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatVehicles(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

/** 過剩／不足的著色：只有偏離 1 台以上才上色，避免小數雜訊看起來像問題 */
function surplusClass(value: number | null): string {
  if (value == null) return 'text-zinc-500';
  if (value >= 1) return 'text-amber-300 font-semibold';
  if (value <= -1) return 'text-sky-300 font-semibold';
  return 'text-zinc-300';
}

/**
 * 建議照種類收合。
 *
 * 八個時段各講一句「班距會被拉開」會排出八個一模一樣的框，使用者要一行一行
 * 讀完才知道那其實是同一個問題（2026-08-10 使用者：「可以幫我整理或是折疊
 * 一下嗎」）。改成一個種類一個折疊區，標題直接講「幾個時段、最嚴重的是哪一個」。
 */
const SUGGESTION_GROUPS: Array<{
  code: ScheduleAnalysisSuggestion['code'];
  title: string;
  /** 這一類到底在講什麼、數字怎麼來的——收合起來也看得到 */
  hint: string;
}> = [
  {
    code: 'FLEET_SHORTAGE',
    title: '車不夠，追不上目標班距',
    hint:
      '要幾台同時在線 ＝ 一輪往返 ÷ 班距。一圈 26 分、每 3 分鐘發一班，'
      + '就要 9 台同時散在路上。算的是同時在路上的台數，不是時間線數——輪替接手不算多一台。',
  },
  {
    code: 'FLEET_SURPLUS',
    title: '車太多，多的沒有班次可跑',
    hint: '多的車沒有脈衝可接，只能停在終點站，接著就擠出站位碰撞。',
  },
  {
    code: 'BERTH_OVERFLOW',
    title: '停靠點停不下',
    hint: '一個停靠點只能停一台車。改線、改班距或減車。',
  },
  {
    code: 'NO_ALTERNATIVE_BERTH',
    title: '沒有替代停靠點',
    hint: '關聯圖上這一段跑完沒有別的終點可選，車只能擠同一站。',
  },
];

const TH = 'px-2 py-1.5 text-left text-[11px] font-semibold text-zinc-400';
const TD = 'px-2 py-1.5 text-[11px] text-zinc-200 tabular-nums';

export function ScheduleAnalysisReportPanel({
  report,
  onClose,
}: {
  report: ScheduleAnalysisReport;
  onClose: () => void;
}) {
  const { fleet, berths, suggestions, summary } = report;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-zinc-100">班表分析報表</span>
          <span className="text-[11px] text-zinc-500">
            {summary.timelineCount} 條時間線 · 全日 {summary.totalTrips} 班 ·
            載客 {summary.revenueVehicleHours.toFixed(1)} 車·小時
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          aria-label="關閉分析報表"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {suggestions.length === 0 ? (
          <p className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1.5 text-[11px] text-emerald-200">
            沒有發現車隊供需或停靠點容量的問題。
          </p>
        ) : (
          <div className="space-y-1.5">
            {SUGGESTION_GROUPS.map((group) => {
              const items = suggestions.filter((item) => item.code === group.code);
              if (items.length === 0) return null;
              return (
                <details
                  key={group.code}
                  // 只有一則就直接攤開；多則才收起來，避免一打開就是一整面
                  open={items.length <= 1}
                  className="rounded border border-amber-700/40 bg-amber-950/25 px-2 py-1.5"
                >
                  <summary className="cursor-pointer text-[11px] font-semibold text-amber-200 marker:text-amber-500/70">
                    {group.title}
                    <span className="ml-1 font-normal text-zinc-400">
                      （{items.length} 項）
                    </span>
                  </summary>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">{group.hint}</p>
                  <ul className="mt-1 space-y-0.5">
                    {items.map((item, index) => (
                      <li
                        key={`${item.code}-${index}`}
                        className="border-l border-amber-700/40 pl-2 text-[11px] leading-[16px] text-zinc-200"
                      >
                        {item.message}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}

        <h3 className="mb-1 mt-4 text-xs font-semibold text-zinc-300">
          各時段要幾台車
        </h3>
        <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
          需求 ＝ 一輪往返 ÷ 目標班距。「實際」比的是<b>同一時刻</b>平均幾台在跑，
          不是出現過幾條時間線——輪替接手不算多一台，那個列在「動用」欄。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className={TH}>時段</th>
                <th className={TH}>目標班距</th>
                <th className={TH}>一輪往返</th>
                <th className={TH}>需要</th>
                <th className={TH}>實際同時</th>
                <th className={TH}>尖峰同時</th>
                <th className={TH}>動用</th>
                <th className={TH}>差額</th>
                <th className={TH}>每台每小時空等</th>
                <th className={TH}>班次</th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((row) => (
                <tr key={row.intervalId} className="border-b border-zinc-900">
                  <td className={TD}>
                    <span className="text-zinc-100">{row.intervalName}</span>
                    <span className="ml-1 text-zinc-500">
                      {formatClock(row.startMinute)}–{formatClock(row.endMinute)}
                    </span>
                  </td>
                  <td className={TD}>
                    {row.targetHeadwaySeconds == null
                      ? '未設定'
                      : `${row.targetHeadwaySeconds} 秒`}
                  </td>
                  <td className={TD}>{(row.cycleSeconds / 60).toFixed(1)} 分</td>
                  <td className={TD}>{formatVehicles(row.requiredVehicles)} 台</td>
                  <td className={TD}>{row.actualVehicles.toFixed(1)} 台</td>
                  <td className={TD}>{row.peakConcurrentVehicles} 台</td>
                  <td className={TD}>{row.distinctRowCount} 條</td>
                  <td className={`${TD} ${surplusClass(row.surplusVehicles)}`}>
                    {row.surplusVehicles == null
                      ? '—'
                      : `${row.surplusVehicles > 0 ? '+' : ''}${row.surplusVehicles.toFixed(1)} 台`}
                  </td>
                  <td className={TD}>
                    {row.idleMinutesPerVehicleHour.toFixed(0)} 分
                  </td>
                  <td className={TD}>{row.tripCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mb-1 mt-4 text-xs font-semibold text-zinc-300">
          停靠點停不停得下
        </h3>
        <p className="mb-1.5 text-[10px] leading-4 text-zinc-500">
          一個停靠點同時只能停一台車。「可改停別站」是關聯圖上跑完這一段之後，
          還能不能換一條終點在別站的路線；若為 0，車就一定得擠在這一站。
        </p>
        {berths.length === 0 ? (
          <p className="text-[11px] text-zinc-500">沒有停靠點超出容量。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className={TH}>停靠點</th>
                  <th className={TH}>可停</th>
                  <th className={TH}>尖峰同時</th>
                  <th className={TH}>超出</th>
                  <th className={TH}>停最久</th>
                  <th className={TH}>可改停別站</th>
                </tr>
              </thead>
              <tbody>
                {berths.map((berth) => (
                  <tr key={berth.stationId} className="border-b border-zinc-900">
                    <td className={TD}>
                      <span className="text-zinc-100">{berth.stationName}</span>
                    </td>
                    <td className={TD}>{berth.capacity} 台</td>
                    <td className={TD}>
                      {berth.peakConcurrentVehicles} 台
                      <span className="ml-1 text-zinc-500">
                        {formatClock(berth.peakAtMinute)}
                      </span>
                    </td>
                    <td className={`${TD} text-amber-300 font-semibold`}>
                      {berth.overflowVehicles} 台
                    </td>
                    <td className={TD}>{berth.longestIdleMinutes.toFixed(0)} 分</td>
                    <td className={TD}>
                      {berth.alternativeBerthCount == null ? (
                        <span className="text-zinc-500">未提供關聯圖</span>
                      ) : berth.alternativeBerthCount === 0 ? (
                        <span className="text-amber-300 font-semibold">0 條</span>
                      ) : (
                        <span title={berth.alternativeBerthNames.join('、')}>
                          {berth.alternativeBerthCount} 條
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
