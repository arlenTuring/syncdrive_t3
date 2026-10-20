import { useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { videoApi, type ApplyItem, type Defaults, type Protocol, type Settings } from './api';

const field = 'h-10 w-full rounded-lg bg-[#262a33] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500';
const ACTION_LABEL: Record<ApplyItem['action'], string> = { update: '更新連線', same: '不需變更', error: '無法套用' };

/**
 * 影像資源管理 › 進階設定：全域來源預設、批次套用到來源、影像連線範圍。
 * - 「儲存全域預設」只影響之後新建的來源，不會自動改既有連線。
 * - 「套用到來源」先預覽每個來源的變更前後，明確按下才修改（有變化的來源建立新版本）。
 * - 樣板只允許白名單變數，密碼只在後端解開。
 */
export function DefaultsDialog({ defaults, settings, selectedSourceIds, tagOptions, onClose, onChanged }: { defaults: Defaults; settings: Settings; selectedSourceIds: string[]; tagOptions: string[]; onClose: () => void; onChanged: () => void }) {
  const [form, setForm] = useState({
    protocol: defaults.protocol,
    host: defaults.host ?? '',
    port: defaults.port ? String(defaults.port) : '',
    pathPrefix: defaults.pathPrefix ?? '',
    pathTemplate: defaults.pathTemplate ?? '',
    username: defaults.username ?? '',
    password: '',
  });
  const [version, setVersion] = useState(defaults.version);
  const [scope, setScope] = useState<'sources' | 'tags' | 'all'>(selectedSourceIds.length ? 'sources' : 'tags');
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ defaultsVersion: number; items: ApplyItem[] } | null>(null);
  const [networks, setNetworks] = useState(settings.allowedNetworks.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveDefaults = () =>
    run(async () => {
      const next = await videoApi.updateDefaults({ ...form, recordingDefault: defaults.recordingDefault, port: form.port || null, password: form.password || undefined, expectedVersion: version });
      setVersion(next.version);
      set({ password: '' });
      setPreview(null);
      setInfo('已儲存全域預設（只影響之後新建的來源）');
      onChanged();
    });
  const scopeBody = () => ({ scope, sourceIds: scope === 'sources' ? selectedSourceIds : undefined, tags: scope === 'tags' ? pickedTags : undefined });
  const doPreview = () => run(async () => setPreview(await videoApi.previewApply(scopeBody())));
  const doApply = () =>
    run(async () => {
      if (!preview) return;
      const result = await videoApi.apply({ ...scopeBody(), defaultsVersion: preview.defaultsVersion });
      setInfo(`已更新 ${result.applied.length} 個來源的連線（${result.unchanged} 個不需變更）；連線由背景依序套用，清單會顯示實際狀態`);
      setPreview(null);
      onChanged();
    });
  const saveNetworks = () =>
    run(async () => {
      await videoApi.updateSettings({ allowedNetworks: networks.split(/[\n,]/).map((v) => v.trim()).filter(Boolean), expectedVersion: settings.version });
      setInfo('已更新影像連線範圍');
      onChanged();
    });

  return (
    <Dialog title="全域來源預設與連線範圍" width="max-w-4xl" onClose={busy ? undefined : onClose} footer={<GhostButton onClick={onClose} disabled={busy}>關閉</GhostButton>}>
      <section className="space-y-3">
        <div className="grid grid-cols-[8rem_minmax(0,1fr)_6rem] gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">協定
            <SiteSelect aria-label="協定" value={form.protocol} options={[{ value: 'rtsp', label: 'RTSP' }, { value: 'rtsps', label: 'RTSPS' }, { value: 'rtmp', label: 'RTMP' }, { value: 'https', label: 'HLS（HTTPS）' }, { value: 'http', label: 'HLS（HTTP）' }, { value: 'srt', label: 'SRT' }]} onChange={(e) => set({ protocol: e.target.value as Protocol })} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">主機
            <input className={field} value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="10.20.0.10" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">連接埠
            <input className={field} value={form.port} inputMode="numeric" onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} placeholder="554" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">共同路徑前綴
            <input className={field} value={form.pathPrefix} onChange={(e) => set({ pathPrefix: e.target.value })} placeholder="/cameras" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">路徑樣板（可用 {'{vehicleCode}'}、{'{cameraId}'}、{'{index}'}）
            <input className={field} value={form.pathTemplate} onChange={(e) => set({ pathTemplate: e.target.value })} placeholder="/{cameraId}/main" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">帳號
            <input className={field} value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">密碼{defaults.hasPassword ? '（已設定；空白＝保留）' : ''}
            <input className={field} type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
          </label>
        </div>
        <div className="flex justify-end">
          <PrimaryButton onClick={() => void saveDefaults()} disabled={busy}>儲存全域預設</PrimaryButton>
        </div>
      </section>

      <section className="mt-6 space-y-3 border-t border-zinc-800 pt-5">
        <h3 className="text-sm font-medium">套用到來源</h3>
        <p className="text-xs text-zinc-400">依每個來源的載具（{'{vehicleCode}'}）、攝影機識別（{'{cameraId}'}）與在這批中的順序（{'{index}'}）算出路徑；先預覽，確認後才修改。</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'sources'} onChange={() => setScope('sources')} disabled={!selectedSourceIds.length} className="accent-blue-600" />清單勾選的來源（{selectedSourceIds.length} 個）</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'tags'} onChange={() => setScope('tags')} className="accent-blue-600" />依來源標籤</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-blue-600" />全部來源</label>
          <button type="button" onClick={() => void doPreview()} disabled={busy || (scope === 'sources' && !selectedSourceIds.length) || (scope === 'tags' && !pickedTags.length)} className="ml-auto rounded-lg border border-zinc-600 px-3 py-1.5 hover:bg-white/5 disabled:opacity-50">預覽變更</button>
        </div>
        {scope === 'tags' ? (
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="選擇來源標籤">
            {tagOptions.length ? tagOptions.map((t) => (
              <button key={t} type="button" aria-pressed={pickedTags.includes(t)} onClick={() => setPickedTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
                className={`rounded-md border px-2 py-1 ${pickedTags.includes(t) ? 'border-sky-500 bg-sky-500/15 text-sky-100' : 'border-zinc-700 text-zinc-300 hover:bg-white/5'}`}>{t}</button>
            )) : <span className="text-zinc-500">還沒有來源標籤</span>}
          </div>
        ) : null}
        {preview ? (
          <div className="max-h-64 overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#16181d] text-zinc-400"><tr><th className="px-3 py-2">來源</th><th className="px-3 py-2">動作</th><th className="px-3 py-2">變更前</th><th className="px-3 py-2">變更後</th></tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.sourceId} className="border-t border-zinc-800">
                    <td className="px-3 py-1.5">{item.name}</td>
                    <td className={`px-3 py-1.5 ${item.action === 'error' ? 'text-red-300' : item.action === 'same' ? 'text-zinc-500' : 'text-sky-200'}`}>{ACTION_LABEL[item.action]}{item.reason && item.action === 'error' ? `：${item.reason}` : ''}</td>
                    <td className="max-w-[14rem] truncate px-3 py-1.5 text-zinc-400" title={item.before ?? ''}>{item.before ?? '—'}</td>
                    <td className="max-w-[14rem] truncate px-3 py-1.5 text-zinc-200" title={item.after ?? ''}>{item.after ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {preview ? (
          <div className="flex justify-end">
            <PrimaryButton onClick={() => void doApply()} disabled={busy || !preview.items.some((i) => i.action === 'update') || preview.items.some((i) => i.action === 'error')}>
              更新 {preview.items.filter((i) => i.action === 'update').length} 個來源
            </PrimaryButton>
          </div>
        ) : null}
      </section>

      <details className="mt-6 border-t border-zinc-800 pt-5">
        <summary className="cursor-pointer text-sm text-zinc-300">進階：影像連線範圍</summary>
        <p className="mt-2 text-xs text-zinc-400">只允許連線到這些攝影機網段（CIDR）或主機名稱；本機、link-local 與雲端 metadata 位址一律拒絕。一行一筆。</p>
        <textarea value={networks} onChange={(e) => setNetworks(e.target.value)} className="mt-2 h-28 w-full rounded-lg bg-[#262a33] p-3 font-mono text-xs outline-none focus:ring-1 focus:ring-sky-500" aria-label="允許的攝影機網段" />
        <div className="mt-2 flex justify-end">
          <GhostButton onClick={() => void saveNetworks()} disabled={busy}>儲存連線範圍</GhostButton>
        </div>
      </details>
      {info ? <p className="mt-3 rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-200" role="status">{info}</p> : null}
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
