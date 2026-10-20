import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { videoApi, type ConnectionInput, type Protocol, type SourceTest, type VideoSourceItem } from './api';
import { tagKey } from './layout';

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
const TAGS_MAX = 10;
const TAG_LENGTH_MAX = 30;

function Labeled({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

/** 來源標籤輸入：Enter 或逗號加入、Backspace 移除最後一個；全半形與大小寫不同的視為同一個 */
function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (next: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const tag = raw.replace(/\s+/g, ' ').trim();
    if (!tag) return;
    if ([...tag].length > TAG_LENGTH_MAX || value.length >= TAGS_MAX) return;
    if (value.some((t) => tagKey(t) === tagKey(tag))) return;
    onChange([...value, tag]);
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-lg bg-[#262a33] px-2 py-1.5 focus-within:ring-1 focus-within:ring-sky-500">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-xs text-sky-100">
          {t}
          <button type="button" aria-label={`移除標籤 ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-sky-300 hover:text-white">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,，]/.test(v)) {
            v.split(/[,，]/).forEach(add);
            setDraft('');
          } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
            setDraft('');
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => {
          add(draft);
          setDraft('');
        }}
        placeholder={value.length ? '' : '例如：前門、PMS01、月台（Enter 加入）'}
        aria-label="來源標籤"
        className="h-7 min-w-[8rem] flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        maxLength={TAG_LENGTH_MAX}
      />
      <datalist id={listId}>{suggestions.filter((s) => !value.some((v) => tagKey(v) === tagKey(s))).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/**
 * 新增／編輯影像來源（只有這裡能測試連線與預覽）。
 * - 「儲存錄影」預設勾選：來源啟用後就由伺服器持續錄影，與是否放進監控格、是否開著網頁無關。
 * - 名稱、標籤、啟用、儲存錄影的修改不會重啟串流；改連線或鏡頭關聯才建立新版本。
 * - 密碼只寫不讀：編輯時空白＝保留原密碼，要移除需明確勾選。預覽是暫時的、不會錄影，關閉就釋放。
 */
export function SourceDialog({ source, tagSuggestions, onClose, onSaved }: { source: VideoSourceItem | null; tagSuggestions: string[]; onClose: () => void; onSaved: (saved: VideoSourceItem) => void }) {
  const auth = useAuth();
  const editing = source;
  const [connMode, setConnMode] = useState<'fields' | 'url'>('fields');
  const [form, setForm] = useState(() => ({
    name: source?.name ?? '',
    tags: source?.tags ?? [],
    enabled: source?.enabled ?? true,
    recordingEnabled: source?.recordingEnabled ?? true,
    protocol: (source?.connection?.protocol ?? 'rtsp') as Protocol,
    host: source?.connection?.host ?? '',
    port: source?.connection?.port ? String(source.connection.port) : '',
    path: source?.connection?.path ?? '',
    username: source?.connection?.username ?? '',
    password: '',
    clearPassword: false,
    url: '',
    vehicleCode: source?.vehicleCode ?? '',
    cameraId: source?.cameraId ?? '',
    location: source?.location ?? '',
  }));
  const [test, setTest] = useState<SourceTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [previewStats, setPreviewStats] = useState<PlayerStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const canRecord = auth.can('events.video.recording-manage');

  // 關閉或重新測試時釋放暫時預覽
  useEffect(() => () => {
    if (test?.id) void videoApi.deleteTest(test.id).catch(() => undefined);
  }, [test?.id]);

  const connection = (): ConnectionInput =>
    connMode === 'url'
      ? { mode: 'url', url: form.url.trim() }
      : { mode: 'fields', protocol: form.protocol, host: form.host.trim(), port: form.port.trim() || null, path: form.path.trim(), username: form.username.trim(), password: form.password || undefined, clearPassword: form.clearPassword || undefined };
  const connectionTouched = connMode === 'url'
    ? Boolean(form.url.trim())
    : !editing || form.protocol !== editing.connection?.protocol || form.host !== editing.connection?.host || form.port !== String(editing.connection?.port ?? '') || form.path !== editing.connection?.path || form.username !== (editing.connection?.username ?? '') || Boolean(form.password) || form.clearPassword;

  const runTest = async () => {
    setTesting(true);
    setError('');
    if (test?.id) void videoApi.deleteTest(test.id).catch(() => undefined);
    setTest(null);
    try {
      const body = editing && !connectionTouched ? { sourceId: editing.id } : { connection: connection(), ...(editing ? { sourceId: editing.id } : {}) };
      setTest(await videoApi.createTest(body));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) return setError('請輸入影像名稱');
    setSaving(true);
    try {
      const meta = {
        name: form.name.trim(),
        tags: form.tags,
        enabled: form.enabled,
        vehicleCode: form.vehicleCode.trim() || null,
        cameraId: form.cameraId.trim() || null,
        location: form.location.trim() || null,
      };
      let saved: VideoSourceItem;
      if (!editing) {
        saved = await videoApi.createSource({ ...meta, recordingEnabled: form.recordingEnabled, connection: connection() });
      } else {
        saved = await videoApi.updateSource(editing.id, {
          ...meta,
          ...(form.recordingEnabled !== editing.recordingEnabled ? { recordingEnabled: form.recordingEnabled } : {}),
          ...(connectionTouched ? { connection: connection() } : {}),
          expectedVersion: editing.version,
        });
      }
      onSaved(saved);
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={editing ? `編輯來源：${editing.name}` : '新增影像來源'}
      width="max-w-4xl"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>{saving ? '儲存中…' : editing ? '儲存來源' : '新增來源'}</PrimaryButton>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Labeled label="影像名稱">
            <input className={field} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="例如：一號車前鏡頭" />
          </Labeled>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400">來源標籤（分類用，最多 10 個；與監控標籤頁無關）</span>
            <TagInput value={form.tags} onChange={(tags) => set({ tags })} suggestions={tagSuggestions} />
          </div>
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
          <div className="space-y-2 rounded-lg bg-[#232730] px-3 py-2.5 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-0.5 accent-blue-600" />
              <span>
                啟用來源
                <span className="block text-xs text-zinc-400">停用會停止本站接入、即時播放與新錄影（不是關掉攝影機電源），已錄的影片保留。</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={form.recordingEnabled} onChange={(e) => set({ recordingEnabled: e.target.checked })} className="mt-0.5 accent-blue-600" />
              <span>
                儲存錄影
                <span className="block text-xs text-zinc-400">
                  來源啟用時由伺服器持續錄影，與是否放進監控畫面、是否開著網頁無關；取消只停止新的錄影，不刪除已錄的影片。
                  {!canRecord ? ' 變更這個設定需要錄影管理權限。' : ''}
                </span>
              </span>
            </label>
            <p className="text-xs text-zinc-500">錄影品質：原始（保留來源碼流，不重新壓縮）。</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runTest()} disabled={testing} className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50">
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
