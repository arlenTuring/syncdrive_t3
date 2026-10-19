import { useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { formatDateTime } from '../event-log-shared/time';
import { formatBytes, videoApi, type StorageStatus } from './api';

const GIB = 1024 ** 3;
const field = 'h-10 w-full rounded-lg bg-[#262a33] px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-500';

/** 錄影儲存設定：保留天數、影片最大用量、最低剩餘容量、水位、儲存位置（本機／GCS）、高效率壓縮；顯示實際用量與預估可存天數 */
export function StorageDialog({ status, timeZone, onClose, onChanged }: { status: StorageStatus; timeZone: string; onClose: () => void; onChanged: (next: StorageStatus) => void }) {
  const auth = useAuth();
  const p = status.policy;
  const [form, setForm] = useState({
    retentionDays: String(p.retentionDays),
    maxGiB: p.maxBytes ? (p.maxBytes / GIB).toFixed(1) : '',
    minFreeGiB: p.minFreeBytes !== null ? (p.minFreeBytes / GIB).toFixed(1) : '',
    high: String(p.highWatermarkPct),
    low: String(p.lowWatermarkPct),
    storageType: p.storageType,
    gcsBucket: p.gcsBucket ?? '',
    gcsPrefix: p.gcsPrefix ?? '',
    compression: p.compression.enabled,
    codec: p.compression.codec,
    replaceOriginal: p.compression.replaceOriginal,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!auth.require('events.video.recording-manage')) return;
    setBusy(true);
    setError('');
    try {
      const next = await videoApi.updateStoragePolicy({
        expectedVersion: p.version,
        retentionDays: Number(form.retentionDays),
        maxBytes: form.maxGiB ? Math.round(Number(form.maxGiB) * GIB) : null,
        minFreeBytes: form.minFreeGiB ? Math.round(Number(form.minFreeGiB) * GIB) : null,
        highWatermarkPct: Number(form.high),
        lowWatermarkPct: Number(form.low),
        storageType: form.storageType,
        gcsBucket: form.gcsBucket || null,
        gcsPrefix: form.gcsPrefix || null,
        compression: { ...p.compression, enabled: form.compression, codec: form.codec, replaceOriginal: form.replaceOriginal },
      });
      onChanged(next);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="錄影儲存設定" width="max-w-3xl" onClose={busy ? undefined : onClose} footer={<><GhostButton onClick={onClose} disabled={busy}>關閉</GhostButton><PrimaryButton onClick={() => void save()} disabled={busy}>{busy ? '儲存中…' : '儲存'}</PrimaryButton></>}>
      <section className="grid grid-cols-2 gap-3 rounded-xl bg-[#232730] p-4 text-sm md:grid-cols-4">
        <div><div className="text-xs text-zinc-400">錄影用量</div><div>{formatBytes(status.usedBytes)} / {formatBytes(status.allowedBytes)}（{status.usagePct}%）</div></div>
        <div><div className="text-xs text-zinc-400">磁碟剩餘</div><div>{formatBytes(status.freeBytes)}（保留 {formatBytes(status.minFreeBytes)}）</div></div>
        <div><div className="text-xs text-zinc-400">錄影中來源</div><div>{status.recordingSources} 個</div></div>
        <div><div className="text-xs text-zinc-400">預估可存</div><div>{status.estimatedDays !== null ? `約 ${status.estimatedDays} 天` : '量測中（尚無足夠錄影資料）'}</div></div>
        <div className="col-span-2"><div className="text-xs text-zinc-400">最早可回放</div><div>{status.earliestAvailableAt ? formatDateTime(status.earliestAvailableAt, timeZone) : '尚無錄影'}</div></div>
        <div className="col-span-2"><div className="text-xs text-zinc-400">狀態</div><div className={status.paused ? 'text-amber-200' : 'text-emerald-200'}>{status.paused ? `錄影暫停：${status.paused.reason}（即時監看照常）` : '正常'}</div></div>
      </section>
      <p className="mt-2 text-xs text-zinc-500">保留天數與容量上限先到者優先：容量可能讓實際保存短於設定天數。預估依最近一小時實測碼率計算。</p>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">保留天數<input className={field} value={form.retentionDays} inputMode="numeric" onChange={(e) => set({ retentionDays: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">影片最大用量（GiB；空白＝自動 {formatBytes(p.autoBudgetBytes)}）<input className={field} value={form.maxGiB} onChange={(e) => set({ maxGiB: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">最低剩餘容量（GiB；空白＝自動）<input className={field} value={form.minFreeGiB} onChange={(e) => set({ minFreeGiB: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">開始回收（%）<input className={field} value={form.high} inputMode="numeric" onChange={(e) => set({ high: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">回收到（%）<input className={field} value={form.low} inputMode="numeric" onChange={(e) => set({ low: e.target.value.replace(/\D/g, '') })} /></label>
      </section>

      <details className="mt-5">
        <summary className="cursor-pointer text-sm text-zinc-300">進階：儲存位置與高效率壓縮</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.storageType === 'local'} onChange={() => set({ storageType: 'local' })} className="accent-blue-600" />本機錄影空間</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.storageType === 'gcs'} onChange={() => set({ storageType: 'gcs' })} className="accent-blue-600" />Google Cloud Storage（Standard）</label>
          {form.storageType === 'gcs' ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">Bucket<input className={field} value={form.gcsBucket} onChange={(e) => set({ gcsBucket: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">路徑前綴<input className={field} value={form.gcsPrefix} onChange={(e) => set({ gcsPrefix: e.target.value })} placeholder="vtms/recordings" /></label>
              <p className="col-span-2 text-xs text-zinc-500">使用部署主機的服務身分上傳，不需要貼金鑰。完成的片段驗證後才上傳，雲端確認後才回收本機副本；bucket 的 soft delete 會讓刪除後仍暫時佔用雲端空間。</p>
            </>
          ) : null}
          <label className="col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.compression} onChange={(e) => set({ compression: e.target.checked })} className="mt-0.5 accent-blue-600" />
            <span>背景高效率壓縮已完成的錄影（預設關閉）
              <span className="block text-xs text-zinc-500">低優先權、一次一個；容量至少省 15% 且品質通過門檻才保留，失敗保留原檔。</span>
            </span>
          </label>
          {form.compression ? (
            <>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.codec === 'av1'} onChange={() => set({ codec: 'av1' })} className="accent-blue-600" />AV1</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.codec === 'hevc'} onChange={() => set({ codec: 'hevc' })} className="accent-blue-600" />HEVC</label>
              <label className="col-span-2 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={form.replaceOriginal} onChange={(e) => set({ replaceOriginal: e.target.checked })} className="mt-0.5 accent-blue-600" />
                <span>驗證後以壓縮版取代原檔<span className="block text-xs text-amber-200/80">有損重新壓縮；受保護片段不取代。未勾選時保留原檔與壓縮版（佔用兩份空間）。</span></span>
              </label>
            </>
          ) : null}
        </div>
      </details>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
