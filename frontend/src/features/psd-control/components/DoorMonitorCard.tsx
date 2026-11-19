import { Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ControlMode } from '../constants';
import { Button, SegmentedControl } from '../../../components/ui';

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
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-body-xs text-text-secondary">{t('psdControl.controlMode')}</span>
      <SegmentedControl
        label={t('psdControl.controlMode')}
        value={value}
        onChange={onChange}
        options={[
          { id: 'auto', label: t('psdControl.autoControl') },
          { id: 'manual', label: t('psdControl.manualControl') },
        ]}
      />
    </div>
  );
}

/** 「0 km/h」「79 %」拆成數字與單位：設計稿數字粗體、單位縮小 */
function splitUnit(value: string): { main: string; unit: string | null } {
  const match = /^(-?[\d.,]+)\s*([^\d\s].*)$/.exec(value.trim());
  return match ? { main: match[1], unit: match[2] } : { main: value, unit: null };
}

function StatusCard({ label, value, dot }: { label: string; value: string; dot?: boolean }) {
  const { main, unit } = splitUnit(value);
  return (
    // 設計稿：綠點在欄位名稱前，數值粗體、單位小一級
    <div className="min-w-0 rounded-md bg-surface-secondary px-2.5 py-1.5">
      <p className="flex items-center gap-1.5 text-body-xs text-text-tertiary">
        {dot ? <span className="size-2 shrink-0 rounded-full bg-status-success" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 flex items-baseline gap-1 text-body-m-bold text-text-primary">
        <span className="truncate">{main}</span>
        {unit ? <span className="shrink-0 text-body-xs text-text-secondary">{unit}</span> : null}
      </p>
    </div>
  );
}

function CameraWell({ src }: { src?: string | null }) {
  const { t } = useTranslation();
  return (
    // 設計稿比例：影像框寬高約 875：325（35：13），直角、貼齊卡片左右，不隨畫面高度壓扁；畫面矮時整頁往下捲
    <div className="relative aspect-[35/13] shrink-0 overflow-hidden bg-surface-primary">
      {src ? (
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-body-s tracking-[0.4px] text-text-tertiary">{t('psdControl.notConnected')}</p>
        </div>
      )}
    </div>
  );
}

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
  const { t } = useTranslation();
  const controlTitle =
    kind === 'platform'
      ? t('psdControl.manualControl')
      : door.mode === 'manual'
        ? t('psdControl.manualControl')
        : t('psdControl.autoControl');
  const timer = formatHms(dwellSeconds ?? null);
  const actions = [
    { id: 'open', label: t('psdControl.actions.open') },
    { id: 'close', label: t('psdControl.actions.close') },
    { id: 'stop', label: t('psdControl.actions.stop') },
    { id: 'lock', label: t('psdControl.actions.lock') },
  ] as const;

  return (
    // 設計稿：門與門之間只靠間距分開，不另外加框；影像貼齊卡片左右，標題與控制區內縮
    // @container：卡片窄（側邊窗格、手機）時，控制區與車門狀態改成上下排，不再把字擠成一字一行
    <div className="@container flex min-w-0 flex-col">
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-3 px-3">
        <p className="text-body-m text-text-primary">{door.label}</p>
        <ModeToggle value={door.mode} onChange={onModeChange} />
      </div>

      <CameraWell src={door.videoUrl} />

      {/*
        * 設計稿：左邊控制區只佔按鈕需要的寬度（兩欄固定寬按鈕，約三成），其餘給車門狀態。
        * 按鈕照系統規格（高 34），用灰色有底色的樣式接近設計稿的深色方塊。
        */}
      <div className="mt-3 grid shrink-0 grid-cols-1 gap-3 px-3 @[30rem]:grid-cols-[auto_minmax(0,1fr)] @[30rem]:gap-0">
        <div className="min-w-0 @[30rem]:pr-4">
          <div className="mb-2.5 flex items-center gap-2">
            <p className="whitespace-nowrap text-body-m text-text-primary">{controlTitle}</p>
            <span className="whitespace-nowrap rounded-lg border border-border-secondary px-2 py-0.5 text-body-s text-text-secondary">
              {t('psdControl.latency', { value: door.latency })}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(2,5.5rem)] gap-2">
            {actions.map((action) => (
              <Button block hierarchy="subordinate" variant="tonal" key={action.id}>{action.label}</Button>
            ))}
          </div>
        </div>

        <div className="min-w-0 border-t border-border-quaternary pt-3 @[30rem]:border-t-0 @[30rem]:border-l @[30rem]:pt-0 @[30rem]:pl-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-body-m text-text-primary">{t('psdControl.doorStatus')}</p>
            <p className="flex items-center gap-1.5 text-body-s text-text-secondary">
              <Hourglass className="size-3.5 stroke-[1.5]" aria-hidden />
              {timer ?? t('psdControl.notDocked')}
            </p>
          </div>
          {kind === 'vehicle' ? (
            <div className="grid grid-cols-3 gap-2">
              <StatusCard label={t('psdControl.fields.bodyStatus')} value={door.bodyStatus} />
              <StatusCard
                label={t('psdControl.fields.speed')}
                value={door.speed ?? t('psdControl.status.defaultSpeed')}
                dot
              />
              <StatusCard label={t('psdControl.fields.opening')} value={door.opening} dot />
              <StatusCard label={t('psdControl.fields.connection')} value={door.connection} />
              <StatusCard label={t('psdControl.fields.autoLock')} value={door.autoLock} dot />
              <StatusCard label={t('psdControl.fields.antiPinch')} value={door.antiPinch} dot />
            </div>
          ) : (
            // 與車門同一套排列：上排 門體狀態／（月台門以對準取代行車速度）／門體開度，下排 連線／自動鎖定／防夾
            <div className="grid grid-cols-3 gap-2">
              <StatusCard label={t('psdControl.fields.bodyStatus')} value={door.bodyStatus} />
              <StatusCard
                label={t('psdControl.fields.alignment')}
                value={door.alignment ?? t('psdControl.status.aligned')}
                dot
              />
              <StatusCard label={t('psdControl.fields.opening')} value={door.opening} dot />
              <StatusCard label={t('psdControl.fields.connection')} value={door.connection} />
              <StatusCard label={t('psdControl.fields.autoLock')} value={door.autoLock} dot />
              <StatusCard label={t('psdControl.fields.antiPinch')} value={door.antiPinch} dot />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
