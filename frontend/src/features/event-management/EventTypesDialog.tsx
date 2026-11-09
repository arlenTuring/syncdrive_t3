import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { Pagination } from '../media-groups/widgets';
import { fetchEventTypes, saveEventTypes, type EventType } from './api';
import { SeverityBadge } from './eventBadges';
import { isHttpUrl, SEVERITY_OPTIONS } from './eventSeverity';

export const TYPE_PAGE_SIZE = 7;
export const SOP_TEXT_MAX = 100;
const NAME_MAX = 64;
const CODE_MAX = 64;
const URL_MAX = 500;
const CODE_PATTERN = /^[A-Za-z0-9_]+$/;

const field = 'h-[38px] w-full rounded-lg bg-[#232730] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-sky-500';
const chars = (text: string) => [...text].length;
const clip = (text: string, max: number) => [...text].slice(0, max).join('');

/**
 * 事件類型管理（依設計稿）：查詢、新增、編輯、刪除都先在對話框裡改，按「儲存」才整份送出。
 * 沒按儲存就關閉會先問一次，避免改到一半的內容默默消失。
 */
export function EventTypesDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const auth = useAuth();
  const canManage = auth.can('events.events.manage');
  const [items, setItems] = useState<EventType[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchEventTypes(controller.signal)
      .then((result) => setItems(result.items))
      .catch((reason: Error) => !controller.signal.aborted && setLoadError(reason.message));
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const list = (items ?? []).map((item, index) => ({ item, index }));
    const word = keyword.trim().toLowerCase();
    if (!word) return list;
    return list.filter(({ item }) => [item.name, item.code, item.sopText ?? '', item.sopUrl ?? ''].some((value) => value.toLowerCase().includes(word)));
  }, [items, keyword]);
  const pages = Math.max(1, Math.ceil(visible.length / TYPE_PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = visible.slice((current - 1) * TYPE_PAGE_SIZE, current * TYPE_PAGE_SIZE);

  const close = () => (dirty ? setLeaving(true) : onClose());
  const search = () => { setKeyword(draft); setPage(1); };
  const reset = () => { setDraft(''); setKeyword(''); setPage(1); };
  const change = (next: EventType[]) => { setItems(next); setDirty(true); setSaveError(''); };

  const save = async () => {
    if (!items || saving || !auth.require('events.events.manage')) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveEventTypes(items);
      onSaved();
    } catch (reason) {
      setSaveError(`儲存失敗：${(reason as Error).message}`);
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        title="事件類型管理"
        width="max-w-6xl"
        onClose={saving ? undefined : close}
        footer={<PrimaryButton disabled={!dirty || saving || !canManage} onClick={() => void save()}>{saving ? '儲存中…' : '儲存'}</PrimaryButton>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block w-full max-w-[22rem]">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-zinc-400" />
            <input value={draft} maxLength={64} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="請輸入關鍵字" aria-label="事件類型關鍵字" className={`${field} pl-12`} />
          </label>
          <button type="button" onClick={search} aria-label="搜尋事件類型" className="flex size-12 items-center justify-center rounded-xl bg-[#2a2e37] text-zinc-300 hover:bg-[#323743]"><Search className="size-5" /></button>
          <button type="button" onClick={reset} className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-white/5"><RefreshCw className="size-4" />重置</button>
          {canManage ? (
            <button type="button" onClick={() => setEditing({ index: null })} disabled={!items} className="ml-auto inline-flex h-[38px] items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"><Plus className="size-4" />新增事件類型</button>
          ) : null}
        </div>

        {loadError ? <ErrorLine text={`載入失敗：${loadError}`} /> : null}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
            <thead className="text-zinc-400">
              <tr className="border-b border-zinc-800">
                <th className="w-36 px-4 py-3 font-normal">嚴重等級</th>
                <th className="w-64 px-4 py-3 font-normal">事件名稱</th>
                <th className="w-80 px-4 py-3 font-normal">事件類型代碼</th>
                <th className="px-4 py-3 font-normal">建議處置SOP</th>
                <th className="w-32 px-4 py-3"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ item, index }) => (
                <tr key={`${item.code}-${index}`} className="border-b border-zinc-800">
                  <td className="px-4 py-3"><SeverityBadge severity={item.severity} /></td>
                  <td className="truncate px-4 py-3" title={item.name}>{item.name}</td>
                  <td className="px-4 py-3"><span className="inline-block max-w-full truncate rounded-md bg-[#2a2d34] px-2.5 py-0.5 font-mono tracking-wide text-amber-400" title={item.code}>{item.code}</span></td>
                  <td className="truncate px-4 py-3" title={[item.sopText, item.sopUrl].filter(Boolean).join('\n')}>
                    {item.sopUrl ? <a href={item.sopUrl} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline">{item.sopText || item.sopUrl}</a> : item.sopText || <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <span className="flex items-center justify-end gap-5">
                        <button type="button" onClick={() => setEditing({ index })} aria-label={`編輯 ${item.name}`} className="text-zinc-200 hover:text-white"><Pencil className="size-4" /></button>
                        <button type="button" onClick={() => change(items!.filter((_, at) => at !== index))} aria-label={`刪除 ${item.name}`} className="text-zinc-200 hover:text-red-300"><Trash2 className="size-4" /></button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items && !loadError ? <p className="py-12 text-center text-zinc-500">載入中…</p> : null}
          {items && !shown.length ? <p className="py-12 text-center text-zinc-500">{keyword ? '沒有符合的事件類型' : '尚未設定事件類型'}</p> : null}
        </div>
        <Pagination page={current} total={visible.length} pageSize={TYPE_PAGE_SIZE} onChange={setPage} />
        {saveError ? <ErrorLine text={saveError} /> : null}
      </Dialog>

      {editing && items ? (
        <EventTypeForm
          initial={editing.index === null ? null : items[editing.index]}
          taken={items.filter((_, at) => at !== editing.index).map((item) => item.code.toUpperCase())}
          onClose={() => setEditing(null)}
          onSubmit={(value) => {
            if (editing.index === null) {
              change([...items, value]);
              setKeyword('');
              setDraft('');
              setPage(Math.ceil((items.length + 1) / TYPE_PAGE_SIZE));
            } else {
              change(items.map((item, at) => (at === editing.index ? value : item)));
            }
            setEditing(null);
          }}
        />
      ) : null}

      {leaving ? (
        <Dialog
          title="尚未儲存變更"
          width="max-w-md"
          onClose={() => setLeaving(false)}
          footer={<><GhostButton onClick={() => setLeaving(false)}>繼續編輯</GhostButton><PrimaryButton danger onClick={onClose}>放棄變更</PrimaryButton></>}
        >
          <p className="text-sm text-zinc-300">事件類型的修改還沒儲存，關閉後這些修改會遺失。</p>
        </Dialog>
      ) : null}
    </>
  );
}

/** 新增／編輯事件類型（依設計稿）：必填欄位都填好才可按下 */
export function EventTypeForm({ initial, taken, onClose, onSubmit }: { initial: EventType | null; taken: string[]; onClose: () => void; onSubmit: (value: EventType) => void }) {
  const [severity, setSeverity] = useState<string>(initial?.severity ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [sopText, setSopText] = useState(initial?.sopText ?? '');
  const [sopUrl, setSopUrl] = useState(initial?.sopUrl ?? '');
  const [error, setError] = useState('');
  const ready = Boolean(severity && name.trim() && code.trim());

  const submit = () => {
    const trimmedCode = code.trim();
    const url = sopUrl.trim();
    if (!CODE_PATTERN.test(trimmedCode)) return setError('事件類型代碼只能用英文字母、數字與底線');
    if (taken.includes(trimmedCode.toUpperCase())) return setError(`事件類型代碼 ${trimmedCode} 已經存在`);
    if (url && !isHttpUrl(url)) return setError('建議處置SOP連結須為 http:// 或 https:// 開頭的網址');
    onSubmit({ severity: severity as EventType['severity'], name: name.trim(), code: trimmedCode, sopText: sopText.trim() || null, sopUrl: url || null });
  };

  const label = (text: string, required = false) => <span className="mb-2 block px-1 text-sm text-zinc-400">{required ? <span className="text-red-400">*</span> : null}{text}</span>;

  return (
    <Dialog
      title={initial ? '編輯事件類型' : '新增事件類型'}
      width="max-w-lg"
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>取消</GhostButton><PrimaryButton disabled={!ready} onClick={submit}>{initial ? '確定' : '新增'}</PrimaryButton></>}
    >
      <div className="space-y-5">
        <label className="block">
          {label('嚴重等級', true)}
          <SiteSelect aria-label="嚴重等級" value={severity} placeholder="請選擇" options={SEVERITY_OPTIONS.map((option) => ({ ...option }))} onChange={(event) => { setSeverity(event.target.value); setError(''); }} className={field} />
        </label>
        <label className="block">
          {label('事件名稱', true)}
          <input data-autofocus value={name} maxLength={NAME_MAX} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder="請輸入" aria-label="事件名稱" className={field} />
        </label>
        <label className="block">
          {label('事件類型代碼', true)}
          <input value={code} maxLength={CODE_MAX} onChange={(event) => { setCode(event.target.value); setError(''); }} placeholder="請輸入" aria-label="事件類型代碼" className={`${field} font-mono`} />
        </label>
        <label className="block">
          {label('建議處置SOP文字')}
          <textarea rows={3} value={sopText} onChange={(event) => setSopText(clip(event.target.value, SOP_TEXT_MAX))} placeholder="請輸入" aria-label="建議處置SOP文字" className={`${field} h-auto resize-y py-3`} />
          <span className="mt-1 block px-1 text-xs text-zinc-400">{chars(sopText)}/{SOP_TEXT_MAX}</span>
        </label>
        <label className="block">
          {label('建議處置SOP連結')}
          <input value={sopUrl} maxLength={URL_MAX} onChange={(event) => { setSopUrl(event.target.value); setError(''); }} placeholder="請輸入" aria-label="建議處置SOP連結" className={field} />
        </label>
        {error ? <ErrorLine text={error} /> : null}
      </div>
    </Dialog>
  );
}
