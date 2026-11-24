import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SiteSelect } from '../../components/SiteSelect';
import { useAuth } from '../access-control/AuthContext';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { Pagination } from '../media-groups/widgets';
import { fetchEventTypes, saveEventTypes, type EventType } from './api';
import { SeverityBadge } from './eventBadges';
import { isHttpUrl, SEVERITY_OPTIONS } from './eventSeverity';
import { Button, IconButton, fieldClass } from '../../components/ui';

export const TYPE_PAGE_SIZE = 7;
export const SOP_TEXT_MAX = 100;
const NAME_MAX = 64;
const CODE_MAX = 64;
const URL_MAX = 500;
const CODE_PATTERN = /^[A-Za-z0-9_]+$/;

const field = fieldClass({ size: 'md' });
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
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-tertiary" />
            <input value={draft} maxLength={64} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="請輸入關鍵字" aria-label="事件類型關鍵字" className={`${field} pl-12`} />
          </label>
          <IconButton label="搜尋事件類型" hierarchy="subordinate" variant="tonal" icon={<Search />} onPress={search} />
          <Button hierarchy="subordinate" variant="outlined" onPress={reset} leadingIcon={<RefreshCw />}>重置</Button>
          {canManage ? (
            <Button className="ml-auto" onPress={() => setEditing({ index: null })} disabled={!items} leadingIcon={<Plus />}>新增事件類型</Button>
          ) : null}
        </div>

        {loadError ? <ErrorLine text={`載入失敗：${loadError}`} /> : null}
        <div className="mt-6 overflow-x-auto">
          <table className="t3-table w-full min-w-[56rem] table-fixed text-left text-body-s">
            <thead className="text-text-tertiary">
              <tr className="border-b border-border-quaternary">
                <th className="w-36 px-4 py-3 font-normal">嚴重等級</th>
                <th className="w-64 px-4 py-3 font-normal">事件名稱</th>
                <th className="w-80 px-4 py-3 font-normal">事件類型代碼</th>
                <th className="px-4 py-3 font-normal">建議處置SOP</th>
                <th className="w-32 px-4 py-3"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ item, index }) => (
                <tr key={`${item.code}-${index}`} className="border-b border-border-quaternary">
                  <td className="px-4 py-3"><SeverityBadge severity={item.severity} /></td>
                  <td className="truncate px-4 py-3" title={item.name}>{item.name}</td>
                  <td className="px-4 py-3"><span className="inline-block max-w-full truncate rounded-md bg-link-standard px-2.5 py-0.5 font-mono text-status-warning" title={item.code}>{item.code}</span></td>
                  <td className="truncate px-4 py-3" title={[item.sopText, item.sopUrl].filter(Boolean).join('\n')}>
                    {item.sopUrl ? <a href={item.sopUrl} target="_blank" rel="noreferrer noopener" className="text-text-theme hover:underline">{item.sopText || item.sopUrl}</a> : item.sopText || <span className="text-text-quaternary">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <span className="flex items-center justify-end gap-1">
                        <IconButton label={`編輯 ${item.name}`} size="small" hierarchy="subordinate" variant="standard" icon={<Pencil />} onPress={() => setEditing({ index })} />
                        <IconButton label={`刪除 ${item.name}`} size="small" hierarchy="danger" variant="standard" icon={<Trash2 />} onPress={() => change(items!.filter((_, at) => at !== index))} />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items && !loadError ? <p className="py-12 text-center text-text-quaternary">載入中…</p> : null}
          {items && !shown.length ? <p className="py-12 text-center text-text-quaternary">{keyword ? '沒有符合的事件類型' : '尚未設定事件類型'}</p> : null}
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
          <p className="text-body-s text-text-secondary">事件類型的修改還沒儲存，關閉後這些修改會遺失。</p>
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

  const label = (text: string, required = false) => <span className="mb-2 block px-1 text-body-s text-text-tertiary">{required ? <span className="text-status-error-emphasis">*</span> : null}{text}</span>;

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
          <SiteSelect aria-label="嚴重等級" value={severity} placeholder="請選擇" options={SEVERITY_OPTIONS.map((option) => ({ ...option }))} onChange={(event) => { setSeverity(event.target.value); setError(''); }} size="md" className="w-full" />
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
          <span className="mt-1 block px-1 text-body-xs text-text-tertiary">{chars(sopText)}/{SOP_TEXT_MAX}</span>
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
