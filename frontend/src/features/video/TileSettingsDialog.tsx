import { useEffect, useMemo, useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { videoApi, type ConnectionInput, type Protocol, type RecordingProfile, type SourceTest, type Tab, type Tile, type VideoSourceItem } from './api';

type Mode = 'existing' | 'new' | 'shared';

const field = 'h-10 w-full rounded-lg bg-[#262a33] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500';
const PROTOCOLS: Array<{ value: Protocol; label: string }> = [
  { value: 'rtsp', label: 'RTSP' },
  { value: 'rtsps', label: 'RTSPS' },
  { value: 'rtmp', label: 'RTMP' },
  { value: 'rtmps', label: 'RTMPS' },
  { value: 'https', label: 'HLS（HTTPS）' },
  { value: 'http', label: 'HLS（HTTP）' },
  { value: 'srt', label: 'SRT' },
];
const PROFILES: Array<{ value: RecordingProfile; label: string }> = [
  { value: 'original', label: '原始（保留來源畫質，不重新壓縮）' },
  { value: 'balanced', label: '平衡（需要轉碼時採用）' },
  { value: 'saving', label: '節省空間（需要轉碼時採用，畫質較低）' },
];

function Labeled({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

/**
 * 格子設定：影像名稱、選用現有來源或建立新來源、連線（欄位或完整網址）、載具／攝影機／位置、儲存錄影（預設勾選）、
 * 測試連線與預覽、儲存設定。修改共用來源時列出所有受影響的格子；密碼只寫不讀（空白＝保留原密碼）。
 */
export function TileSettingsDialog({
  tab,
  tile,
  sources,
  onClose,
  onSaved,
}: {
  tab: Tab;
  tile: Tile;
  sources: VideoSourceItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = sources.find((s) => s.id === tile.sourceId);
  const [mode, setMode] = useState<Mode>(current ? 'existing' : sources.length ? 'existing' : 'new');
  const [selected, setSelected] = useState(tile.sourceId ?? '');
  const [displayName, setDisplayName] = useState(tile.displayName ?? '');
  const [recording, setRecording] = useState(tile.sourceId ? tile.recordingRequested : true);
  const [connMode, setConnMode] = useState<'fields' | 'url'>('fields');
  const editing = mode === 'shared' ? current : undefined;
  const [form, setForm] = useState(() => ({
    name: current?.name ?? '',
    protocol: (current?.connection?.protocol ?? 'rtsp') as Protocol,
    host: current?.connection?.host ?? '',
    port: current?.connection?.port ? String(current.connection.port) : '',
    path: current?.connection?.path ?? '',
    username: current?.connection?.username ?? '',
    password: '',
    clearPassword: false,
    url: '',
    vehicleCode: current?.vehicleCode ?? '',
    cameraId: current?.cameraId ?? '',
    location: current?.location ?? '',
    profile: (current?.recordingProfile ?? 'original') as RecordingProfile,
  }));
  const [test, setTest] = useState<SourceTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [previewStats, setPreviewStats] = useState<PlayerStats | null>(null);
  const [usedBy, setUsedBy] = useState<VideoSourceItem['usedBy']>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'shared' && current) void videoApi.source(current.id).then((s) => setUsedBy(s.usedBy ?? []), () => undefined);
  }, [mode, current]);
  // 關閉對話框時清掉暫時預覽
  useEffect(() => () => {
    if (test?.id) void videoApi.deleteTest(test.id).catch(() => undefined);
  }, [test?.id]);

  const connection = (): ConnectionInput =>
    connMode === 'url'
      ? { mode: 'url', url: form.url.trim() }
      : { mode: 'fields', protocol: form.protocol, host: form.host.trim(), port: form.port.trim() || null, path: form.path.trim(), username: form.username.trim(), password: form.password || undefined, clearPassword: form.clearPassword || undefined };
  const connectionTouched = connMode === 'url' ? Boolean(form.url.trim()) : !editing || form.protocol !== editing.connection?.protocol || form.host !== editing.connection?.host || form.port !== String(editing.connection?.port ?? '') || form.path !== editing.connection?.path || form.username !== (editing.connection?.username ?? '') || Boolean(form.password) || form.clearPassword;

  const runTest = async () => {
    setTesting(true);
    setError('');
    if (test?.id) void videoApi.deleteTest(test.id).catch(() => undefined);
    setTest(null);
    try {
      const body = mode === 'existing' ? { sourceId: selected } : mode === 'shared' && !connectionTouched ? { sourceId: current!.id } : { connection: connection(), ...(mode === 'shared' ? { sourceId: current!.id } : {}) };
      setTest(await videoApi.createTest(body));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      let sourceId: string | null = null;
      if (mode === 'existing') {
        if (!selected) throw new Error('請選擇影像來源');
        sourceId = selected;
      } else {
        const body = {
          name: form.name.trim() || displayName.trim(),
          vehicleCode: form.vehicleCode.trim() || null,
          cameraId: form.cameraId.trim() || null,
          location: form.location.trim() || null,
          recordingProfile: form.profile,
          ...(mode === 'new' || connectionTouched ? { connection: connection() } : {}),
        };
        if (mode === 'new') sourceId = (await videoApi.createSource(body)).id;
        else sourceId = (await videoApi.updateSource(current!.id, { ...body, expectedVersion: current!.version })).id;
      }
      await videoApi.saveTiles(tab.id, { expectedVersion: tab.version, tiles: [{ position: tile.position, sourceId, displayName: displayName.trim() || null, recordingRequested: recording, enabled: true, templateVars: tile.templateVars }] });
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await videoApi.saveTiles(tab.id, { expectedVersion: tab.version, tiles: [{ position: tile.position, sourceId: null, displayName: null, recordingRequested: true, enabled: true, templateVars: tile.templateVars }] });
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };

  const options = useMemo(() => sources.map((s) => ({ value: s.id, label: `${s.name}${s.vehicleCode ? `（${s.vehicleCode}）` : ''}${s.usage.tiles ? `・${s.usage.tiles} 格使用中` : ''}` })), [sources]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      title={`設定影像來源：${tab.name} 第 ${tile.position + 1} 格`}
      width="max-w-4xl"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          {tile.sourceId ? <button type="button" onClick={() => void clear()} disabled={saving} className="mr-auto text-sm text-zinc-400 hover:text-red-300">清除此格（不刪來源與錄影）</button> : null}
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>{saving ? '儲存中…' : '儲存設定'}</PrimaryButton>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Labeled label="影像名稱（顯示在格子上）">
            <input className={field} value={displayName} maxLength={120} onChange={(e) => setDisplayName(e.target.value)} placeholder={current?.name ?? '例如：一號車前鏡頭'} />
          </Labeled>
          <div role="radiogroup" aria-label="來源" className="flex flex-wrap gap-2 text-sm">
            {([['existing', '選用現有來源'], ['new', '建立新來源'], ...(current ? [['shared', `修改共用來源（${current.usage.tiles} 格使用）`]] : [])] as Array<[Mode, string]>).map(([value, label]) => (
              <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${mode === value ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700'}`}>
                <input type="radio" checked={mode === value} onChange={() => setMode(value)} className="accent-blue-600" />
                {label}
              </label>
            ))}
          </div>
          {mode === 'existing' ? (
            <Labeled label="影像來源" hint="同一個來源被多格使用時只接入、錄製一份">
              <SiteSelect aria-label="影像來源" value={selected} options={[{ value: '', label: '請選擇' }, ...options]} onChange={(e) => setSelected(e.target.value)} className={field} />
            </Labeled>
          ) : (
            <>
              {mode === 'shared' && usedBy?.length ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  修改會影響這些格子：{usedBy.map((u) => `${u.tab_name} 第 ${u.position + 1} 格`).join('、')}。若只想換這一格，請改選「選用現有來源」或「建立新來源」。
                </p>
              ) : null}
              <Labeled label="來源名稱">
                <input className={field} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="例如：一號車前鏡頭" />
              </Labeled>
              <div className="flex gap-2 text-xs">
                {(['fields', 'url'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setConnMode(m)} aria-pressed={connMode === m} className={`rounded-md px-2.5 py-1 ${connMode === m ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                    {m === 'fields' ? '分欄輸入' : '完整網址'}
                  </button>
                ))}
              </div>
              {connMode === 'url' ? (
                <Labeled label="完整網址" hint="例如 rtsp://帳號:密碼@10.20.0.10:554/cameras/front01/main；儲存後只顯示遮蔽後的網址">
                  <input className={field} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder={editing?.connection?.maskedUrl ?? 'rtsp://…'} autoComplete="off" />
                </Labeled>
              ) : (
                <div className="grid grid-cols-[8rem_minmax(0,1fr)_6rem] gap-2">
                  <Labeled label="協定">
                    <SiteSelect aria-label="協定" value={form.protocol} options={PROTOCOLS} onChange={(e) => set({ protocol: e.target.value as Protocol })} className={field} />
                  </Labeled>
                  <Labeled label="主機">
                    <input className={field} value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="10.20.0.10" />
                  </Labeled>
                  <Labeled label="連接埠">
                    <input className={field} value={form.port} inputMode="numeric" onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} placeholder="預設" />
                  </Labeled>
                  <div className="col-span-3">
                    <Labeled label="路徑">
                      <input className={field} value={form.path} onChange={(e) => set({ path: e.target.value })} placeholder="/cameras/front01/main" />
                    </Labeled>
                  </div>
                  <div className="col-span-3 grid grid-cols-2 gap-2">
                    <Labeled label="帳號（選填）" hint="攝影機沒有設帳密就留空">
                      <input className={field} value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
                    </Labeled>
                    <Labeled label="密碼（選填）" hint={editing?.connection?.hasPassword ? (form.clearPassword ? '儲存後移除已存的密碼' : '已設定；空白＝保留原密碼') : undefined}>
                      <input className={field} type="password" value={form.password} disabled={form.clearPassword} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" placeholder={editing?.connection?.hasPassword && !form.clearPassword ? '••••••（保留）' : ''} />
                    </Labeled>
                    {editing?.connection?.hasPassword ? (
                      <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-400">
                        <input type="checkbox" checked={form.clearPassword} onChange={(e) => set({ clearPassword: e.target.checked, password: '' })} className="accent-blue-600" />
                        移除已存的密碼（攝影機改成不需密碼時勾選；清空帳號也會一併移除）
                      </label>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <Labeled label="載具（選填）">
                  <input className={field} value={form.vehicleCode} onChange={(e) => set({ vehicleCode: e.target.value })} placeholder="PMS01" />
                </Labeled>
                <Labeled label="攝影機識別（選填）">
                  <input className={field} value={form.cameraId} onChange={(e) => set({ cameraId: e.target.value })} placeholder="front01" />
                </Labeled>
                <Labeled label="位置／視角（選填）">
                  <input className={field} value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="車頭" />
                </Labeled>
              </div>
              <Labeled label="錄影品質">
                <SiteSelect aria-label="錄影品質" value={form.profile} options={PROFILES} onChange={(e) => set({ profile: e.target.value as RecordingProfile })} className={field} />
              </Labeled>
            </>
          )}
          <label className="flex items-start gap-2 rounded-lg bg-[#232730] px-3 py-2.5 text-sm">
            <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} className="mt-0.5 accent-blue-600" />
            <span>
              儲存錄影
              <span className="block text-xs text-zinc-400">由伺服器持續錄影，關閉網頁也會繼續；取消只停止新的錄影，不刪除已錄的影片。</span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runTest()} disabled={testing || (mode === 'existing' && !selected)} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50">
              {testing ? '測試中…' : '測試連線並預覽'}
            </button>
            <span className="text-xs text-zinc-500">預覽是暫時的，不會錄影</span>
          </div>
          <div className="aspect-video overflow-hidden rounded-lg border border-zinc-800 bg-black">
            {test?.status === 'ready' && test.hlsUrl ? (
              <LivePlayer hlsUrl={test.hlsUrl} whepUrl={test.whepUrl} onStats={setPreviewStats} />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500">
                {test?.status === 'failed' ? <span className="text-red-300">{test.error}</span> : testing ? '連線中…' : '按「測試連線並預覽」查看畫面'}
              </div>
            )}
          </div>
          {test ? (
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1 text-xs">
              <dt className="text-zinc-500">位址</dt>
              <dd className="truncate text-zinc-300">{test.maskedUrl}</dd>
              <dt className="text-zinc-500">編碼</dt>
              <dd className="text-zinc-300">{test.tracks.length ? test.tracks.join('、') : '未知'}</dd>
              <dt className="text-zinc-500">解析度</dt>
              <dd className="text-zinc-300">{previewStats?.width ? `${previewStats.width}×${previewStats.height}` : '未知'}</dd>
              <dt className="text-zinc-500">fps</dt>
              <dd className="text-zinc-300">{previewStats?.fps ?? '未知'}</dd>
            </dl>
          ) : null}
        </div>
      </div>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
