import { Hourglass } from 'lucide-react';
import type { ControlMode } from '../constants';

export type DoorKind = 'vehicle' | 'platform';

export type DoorMonitorState = {
  id: string;
  /**
   * MQTT 端使用的識別碼，與畫面上的 <code>id</code> 不一定相同。
   *
   * 目前沒有任何地方會設值，所以 DoorDetailPage 那個「先用 id 查、查不到再用
   * mqttId 查」的 fallback 實際上恆為假。保留這個選填欄位是因為它是刻意留的
   * 對應點——月台門在 MQTT 端本來就可能用另一組編號；欄位不存在的話那段
   * fallback 連編都編不過（2026-08-24）。
   */
  mqttId?: string;
  label: string;
  mode: ControlMode;
  latency: string;
  bodyStatus: string;
  connection: string;
  opening: string;
  autoLock: string;
  antiPinch: string;
  speed?: string;
  alignment?: string;
  videoUrl?: string | null;
};

function ModeToggle({
  value,
  onChange,
}: {
  value: ControlMode;
  onChange: (next: ControlMode) => void;
}) {
  const btn = (active: boolean) =>
    `rounded px-3 py-1.5 text-[12px] leading-none ${
      active
        ? 'border border-[#2B7FFF] bg-[#2B7FFF] text-white'
        : 'border border-white/25 bg-[#1c1c1f] text-zinc-200 hover:border-white/40'
    }`;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-zinc-300">控制模式</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange('auto')} className={btn(value === 'auto')}>
          自動控制
        </button>
        <button type="button" onClick={() => onChange('manual')} className={btn(value === 'manual')}>
          手動控制
        </button>
      </div>
    </div>
  );
}

function StatusCard({ label, value, dot }: { label: string; value: string; dot?: boolean }) {
  return (
    <div className="min-w-0 rounded-md bg-[#2a2a2e] px-2.5 py-2">
      <p className="text-[11px] leading-none text-zinc-400">{label}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] leading-none text-white">
        {dot ? <span className="size-1.5 shrink-0 rounded-full bg-[#22c55e]" aria-hidden /> : null}
        {value}
      </p>
    </div>
  );
}

function CameraWell({ src }: { src?: string | null }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-[#0c0c0e]">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full min-h-[120px] w-full items-center justify-center">
          <p className="text-[14px] tracking-[0.4px] text-zinc-400">尚未連接</p>
        </div>
      )}
    </div>
  );
}

const ACTIONS = [
  { id: 'open', label: '開門' },
  { id: 'close', label: '關門' },
  { id: 'stop', label: '停止' },
  { id: 'lock', label: '鎖定' },
] as const;

function formatHms(totalSeconds: number | null): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return null;
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(r)}`;
}

export function DoorMonitorCard({
  kind,
  door,
  dwellSeconds,
  onModeChange,
}: {
  kind: DoorKind;
  door: DoorMonitorState;
  dwellSeconds?: number | null;
  onModeChange: (mode: ControlMode) => void;
}) {
  const controlTitle = kind === 'platform' ? '手動控制' : door.mode === 'manual' ? '手動控制' : '自動控制';
  const timer = formatHms(dwellSeconds ?? null);

  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-white/15 bg-[#161618] p-3">
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-3">
        <p className="text-[14px] text-white">{door.label}</p>
        <ModeToggle value={door.mode} onChange={onModeChange} />
      </div>

      <CameraWell src={door.videoUrl} />

      <div className="mt-3 grid shrink-0 grid-cols-[minmax(148px,0.78fr)_minmax(0,1.22fr)] gap-0">
        <div className="min-w-0 pr-4">
          <div className="mb-2.5 flex items-center gap-2">
            <p className="text-[13px] text-white">{controlTitle}</p>
            <span className="rounded-full border border-white/25 bg-[#1c1c1f] px-2 py-0.5 text-[10px] leading-none text-zinc-300">
              延遲 {door.latency}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="rounded-md border border-white/30 bg-transparent py-3 text-[13px] text-white hover:border-white/60 hover:bg-white/5"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 border-l border-white/10 pl-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[13px] text-white">車門狀態</p>
            <p className="flex items-center gap-1.5 text-[12px] text-zinc-300">
              <Hourglass className="size-3.5 stroke-[1.5]" aria-hidden />
              {timer ?? '尚未停靠'}
            </p>
          </div>
          {kind === 'vehicle' ? (
            <div className="grid grid-cols-3 gap-2">
              <StatusCard label="門體狀態" value={door.bodyStatus} />
              <StatusCard label="行車速度" value={door.speed ?? '0 km/h'} dot />
              <StatusCard label="門體開度" value={door.opening} dot />
              <StatusCard label="連線狀態" value={door.connection} />
              <StatusCard label="自動鎖定" value={door.autoLock} dot />
              <StatusCard label="防夾裝置" value={door.antiPinch} dot />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatusCard label="門體狀態" value={door.bodyStatus} />
              <StatusCard label="連線狀態" value={door.connection} />
              <StatusCard label="對準連鎖" value={door.alignment ?? '停準'} dot />
              <StatusCard label="自動鎖定" value={door.autoLock} dot />
              <StatusCard label="門體開度" value={door.opening} dot />
              <StatusCard label="防夾裝置" value={door.antiPinch} dot />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
