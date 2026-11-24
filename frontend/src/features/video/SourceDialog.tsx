import { X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { ErrorLine } from '../media-groups/dialogs';
import { LivePlayer, type PlayerStats } from './LivePlayer';
import { videoApi, type ConnectionInput, type Protocol, type SourceTest, type VideoSourceItem } from './api';
import { tagKey } from './layout';
import { Button, Checkbox, Dialog, Field, IconButton, SegmentedControl, Switch, TextInput, fieldClass, cn } from '../../components/ui';

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

/** 對話框裡的一個區塊：圓角外框＋標題（設計稿 2026-11-20） */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-quaternary p-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-body-m-bold text-text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 開關卡片：左邊標題＋說明，右邊開關 */
function SwitchCard({ title, description, checked, onChange, disabled }: { title: string; description: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border-quaternary px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body-m text-text-primary">{title}</div>
        <div className="mt-0.5 text-body-s text-text-tertiary">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </div>
  );
}

/** 來源標籤輸入：Enter 或逗號加入、Backspace 移除最後一個；全半形與大小寫不同的視為同一個 */
function TagInput({ id, value, onChange, suggestions }: { id?: string; value: string[]; onChange: (next: string[]) => void; suggestions: string[] }) {
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
    <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded-lg border border-transparent bg-surface-secondary px-2 py-1 focus-within:border-border-theme">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-theme px-2 py-0.5 text-body-xs text-text-theme">
          {t}
          <IconButton size="small" hierarchy="superior" variant="icon" className="-my-2 -mr-2" label={`移除標籤 ${t}`} icon={<X />} onPress={() => onChange(value.filter((x) => x !== t))} />
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
        placeholder={value.length ? '' : '請輸入（Enter 加入）'}
        id={id}
        aria-label="來源標籤"
        className={cn(fieldClass({ size: 'sm', fullWidth: false }), 'min-w-[8rem] flex-1')}
        maxLength={TAG_LENGTH_MAX}
      />
      <datalist id={listId}>{suggestions.filter((s) => !value.some((v) => tagKey(v) === tagKey(s))).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/**
 * 新增／編輯影像來源（設計稿 2026-11-20；只有這裡能測試連線與預覽）。
 * - 左邊：基本設定、連線設定（參數／網址）、設備屬性、啟用來源連線、儲存全時錄影；右邊：即時連線預覽。
 * - 「儲存全時錄影」預設開：來源啟用後就由伺服器持續錄影，與是否放進監控格、是否開著網頁無關。
 * - 名稱、標籤、啟用、儲存錄影的修改不會重啟串流；改連線或鏡頭關聯才建立新版本。
 * - 密碼只寫不讀：編輯時空白＝保留原密碼，要移除需明確勾選。預覽是暫時的、不會錄影，關閉就釋放。
 * - 必填沒填完時「新增」不能按；編輯時沒動到連線就不檢查連線欄位（沿用原設定）。
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
  const connectionReady = editing && !connectionTouched
    ? true
    : connMode === 'url'
      ? Boolean(form.url.trim())
      : Boolean(form.host.trim() && form.port.trim() && form.path.trim());
  const ready = Boolean(form.name.trim() && form.tags.length && connectionReady);

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
    if (!ready) return;
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
      title={editing ? '編輯來源' : '新增來源'}
      widthClassName="max-w-5xl"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button hierarchy="subordinate" variant="standard" onPress={onClose} disabled={saving}>取消</Button>
          <Button onPress={() => void save()} disabled={!ready || saving}>{saving ? '儲存中…' : editing ? '儲存' : '新增'}</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Section title="基本設定">
            <Field label="影像名稱" required>
              {(id) => <TextInput id={id} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="請輸入" />}
            </Field>
            <Field label="來源標籤" required hint="分類用，最多 10 個；與監控分頁無關">
              {(id) => <TagInput id={id} value={form.tags} onChange={(tags) => set({ tags })} suggestions={tagSuggestions} />}
            </Field>
          </Section>

          <Section
            title="連線設定"
            action={<SegmentedControl label="連線設定方式" value={connMode} onChange={setConnMode} options={[{ id: 'fields' as const, label: '參數' }, { id: 'url' as const, label: '網址' }]} />}
          >
            {connMode === 'url' ? (
              <Field label="完整網址" required={!editing} hint={editing ? '空白＝沿用目前的連線；儲存後只顯示遮蔽後的網址' : '儲存後只顯示遮蔽後的網址'}>
                {(id) => <TextInput id={id} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder={editing?.connection?.maskedUrl ?? 'rtsp://…'} autoComplete="off" />}
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="協定" required>
                    <SiteSelect aria-label="協定" value={form.protocol} options={PROTOCOLS} onChange={(e) => set({ protocol: e.target.value as Protocol })} size="md" className="w-full" />
                  </Field>
                  <Field label="主機 IP / Domain" required>
                    {(id) => <TextInput id={id} value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="請輸入" />}
                  </Field>
                  <Field label="連接埠" required>
                    {(id) => <TextInput id={id} value={form.port} inputMode="numeric" onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} placeholder="請輸入" />}
                  </Field>
                </div>
                <Field label="路徑" required>
                  {(id) => <TextInput id={id} value={form.path} onChange={(e) => set({ path: e.target.value })} placeholder="請輸入" />}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="帳號">
                    {(id) => <TextInput id={id} value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" placeholder="請輸入" />}
                  </Field>
                  <Field label="密碼" hint={editing?.connection?.hasPassword ? (form.clearPassword ? '儲存後移除已存的密碼' : '已設定；空白＝保留原密碼') : undefined}>
                    {(id) => <TextInput id={id} type="password" value={form.password} disabled={form.clearPassword} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" placeholder={editing?.connection?.hasPassword && !form.clearPassword ? '••••••（保留）' : '請輸入'} />}
                  </Field>
                </div>
                {editing?.connection?.hasPassword ? (
                  <Checkbox size="small" label="移除已存的密碼（攝影機改成不需密碼時勾選；清空帳號也會一併移除）" checked={form.clearPassword} onCheckedChange={(clearPassword) => set({ clearPassword, password: '' })} />
                ) : null}
              </>
            )}
          </Section>

          <Section title="設備屬性">
            <div className="grid grid-cols-3 gap-3">
              <Field label="載具識別">
                {(id) => <TextInput id={id} value={form.vehicleCode} onChange={(e) => set({ vehicleCode: e.target.value })} placeholder="請輸入" />}
              </Field>
              <Field label="攝影機識別">
                {(id) => <TextInput id={id} value={form.cameraId} onChange={(e) => set({ cameraId: e.target.value })} placeholder="請輸入" />}
              </Field>
              <Field label="位置/視角">
                {(id) => <TextInput id={id} value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="請輸入" />}
              </Field>
            </div>
          </Section>

          <SwitchCard title="啟用來源連線" description="開啟後開始接收串流。停用時停止本站接入（不影響硬體電源）" checked={form.enabled} onChange={(enabled) => set({ enabled })} />
          <SwitchCard
            title="儲存全時錄影"
            description={`啟用後由伺服器持續錄影。取消僅停止新錄影，不刪除歷史影片${canRecord ? '' : '（變更需要錄影管理權限）'}`}
            checked={form.recordingEnabled}
            onChange={(recordingEnabled) => set({ recordingEnabled })}
          />
        </div>

        <section className="flex min-h-[20rem] flex-col gap-3 rounded-xl border border-border-quaternary p-4">
          <div className="flex items-center gap-3">
            <h3 className="flex-1 text-body-m-bold text-text-primary">即時連線預覽</h3>
            <span className="text-body-s text-text-tertiary">暫時預覽，不寫入存檔</span>
            <Button hierarchy="subordinate" variant="outlined" onPress={() => void runTest()} disabled={testing}>
              {testing ? '測試中…' : '測試並預覽'}
            </Button>
          </div>
          <div className="relative min-h-[14rem] flex-1 overflow-hidden rounded-lg bg-surface-sub-background">
            {test?.status === 'ready' && test.hlsUrl ? (
              <LivePlayer hlsUrl={test.hlsUrl} whepUrl={test.whepUrl} onStats={setPreviewStats} className="absolute inset-0" />
            ) : test?.status === 'failed' || testing ? (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-body-s">
                {test?.status === 'failed' ? <span className="text-status-error-emphasis">{test.error}</span> : <span className="text-text-quaternary">連線中…</span>}
              </div>
            ) : null}
          </div>
          {test ? (
            <p className="truncate text-body-xs text-text-tertiary" title={test.maskedUrl}>
              {[test.maskedUrl, test.tracks.length ? test.tracks.join('、') : '編碼未知', previewStats?.width ? `${previewStats.width}×${previewStats.height}` : '', previewStats?.fps ? `${previewStats.fps} fps` : ''].filter(Boolean).join('・')}
            </p>
          ) : null}
        </section>
      </div>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
