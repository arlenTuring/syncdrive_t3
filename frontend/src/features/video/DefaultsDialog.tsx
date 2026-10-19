import { useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { videoApi, type ApplyItem, type Defaults, type Protocol, type Settings, type Tab } from './api';

const field = 'h-10 w-full rounded-lg bg-[#262a33] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500';
const ACTION_LABEL: Record<ApplyItem['action'], string> = { create: '建立來源', replace: '改綁新來源', skip: '略過', error: '無法套用' };

/**
 * 全域來源預設與批次套用。
 * - 「儲存全域預設」只影響之後新建的來源；「套用到既有格子」才修改現有格子，套用前先看變更前後。
 * - 預設只填尚未設定的格子；勾選「覆蓋已自訂的格子」才會改綁已設定的格子（不修改共用來源本身）。
 * - 進階：影像連線範圍（允許的攝影機網段／主機）。
 */
export function DefaultsDialog({ defaults, settings, tabs, currentTab, onClose, onChanged }: { defaults: Defaults; settings: Settings; tabs: Tab[]; currentTab: Tab | null; onClose: () => void; onChanged: () => void }) {
  const [form, setForm] = useState({
    protocol: defaults.protocol,
    host: defaults.host ?? '',
    port: defaults.port ? String(defaults.port) : '',
    pathPrefix: defaults.pathPrefix ?? '',
    pathTemplate: defaults.pathTemplate ?? '',
    username: defaults.username ?? '',
    password: '',
    recordingDefault: defaults.recordingDefault,
  });
  const [version, setVersion] = useState(defaults.version);
  const [scope, setScope] = useState<'tab' | 'tiles' | 'all'>('tab');
  const [picked, setPicked] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
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
      const next = await videoApi.updateDefaults({ ...form, port: form.port || null, password: form.password || undefined, expectedVersion: version });
      setVersion(next.version);
      set({ password: '' });
      setPreview(null);
      setInfo('已儲存全域預設（只影響之後新建的來源）');
      onChanged();
    });
  const doPreview = () => run(async () => setPreview(await videoApi.previewApply({ scope, tabId: currentTab?.id, tileIds: scope === 'tiles' ? picked : undefined, overwrite })));
  const doApply = () =>
    run(async () => {
      if (!preview) return;
      const result = await videoApi.apply({ scope, tabId: currentTab?.id, tileIds: scope === 'tiles' ? picked : undefined, overwrite, defaultsVersion: preview.defaultsVersion });
      setInfo(`已套用 ${result.applied.length} 格（略過 ${result.skipped} 格）；連線由後端依序套用，格子上會顯示連線狀態`);
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
    <Dialog title="全域來源預設" width="max-w-4xl" onClose={busy ? undefined : onClose} footer={<GhostButton onClick={onClose} disabled={busy}>關閉</GhostButton>}>
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.recordingDefault} onChange={(e) => set({ recordingDefault: e.target.checked })} className="accent-blue-600" />
          新來源預設勾選「儲存錄影」
        </label>
        <div className="flex justify-end">
          <PrimaryButton onClick={() => void saveDefaults()} disabled={busy}>儲存全域預設</PrimaryButton>
        </div>
      </section>

      <section className="mt-6 space-y-3 border-t border-zinc-800 pt-5">
        <h3 className="text-sm font-medium">套用到既有格子</h3>
        <p className="text-xs text-zinc-400">每一格依它的樣板變數（第幾格＝{'{index}'}）算出路徑，可再到各格修改最終路徑。相同連線的格子會共用同一個來源，只錄一份。</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'tab'} onChange={() => setScope('tab')} className="accent-blue-600" />目前標籤（{currentTab?.name ?? '—'}）</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'tiles'} onChange={() => setScope('tiles')} className="accent-blue-600" />勾選格子</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-blue-600" />全部標籤（{tabs.length} 頁）</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-blue-600" />覆蓋已自訂的格子</label>
          <button type="button" onClick={() => void doPreview()} disabled={busy || (scope !== 'all' && !currentTab) || (scope === 'tiles' && !picked.length)} className="ml-auto rounded-lg border border-zinc-600 px-3 py-1.5 hover:bg-white/5 disabled:opacity-50">預覽變更</button>
        </div>
        {scope === 'tiles' && currentTab ? (
          <div className="flex flex-wrap gap-2 text-xs" aria-label="勾選要套用的格子">
            {currentTab.tiles.map((t) => (
              <label key={t.id} className="flex items-center gap-1 rounded-md bg-[#232730] px-2 py-1">
                <input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))} className="accent-blue-600" />
                第 {t.position + 1} 格{t.sourceId ? '（已設定）' : ''}
              </label>
            ))}
          </div>
        ) : null}
        {preview ? (
          <div className="max-h-64 overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#16181d] text-zinc-400"><tr><th className="px-3 py-2">格子</th><th className="px-3 py-2">動作</th><th className="px-3 py-2">變更前</th><th className="px-3 py-2">變更後</th></tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.tileId} className="border-t border-zinc-800">
                    <td className="px-3 py-1.5">{item.tabName} 第 {item.position + 1} 格</td>
                    <td className={`px-3 py-1.5 ${item.action === 'error' ? 'text-red-300' : item.action === 'skip' ? 'text-zinc-500' : 'text-sky-200'}`}>{ACTION_LABEL[item.action]}{item.sharedWith ? `（共用「${item.sharedWith.name}」）` : ''}{item.reason ? `：${item.reason}` : ''}</td>
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
            <PrimaryButton onClick={() => void doApply()} disabled={busy || !preview.items.some((i) => i.action === 'create' || i.action === 'replace')}>
              套用 {preview.items.filter((i) => i.action === 'create' || i.action === 'replace').length} 格
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
