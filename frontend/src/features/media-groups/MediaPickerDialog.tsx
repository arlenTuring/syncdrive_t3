import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, type Candidate } from './api';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from './dialogs';
import { EMPTY_SELECTION, pageState, toggle, togglePage, type PageItem } from './selection';
import { Checkbox, Pagination, TypeBadge } from './widgets';

export type PickerItem = Omit<Candidate, 'in_group'> & { included: boolean };
export type PickerPage = { items: PickerItem[]; total: number; pageSize: number };

/**
 * 單一媒體多選（媒體分組與媒體排程共用）：只列 kind=media 的媒體，已在清單內的標「已加入」、
 * 無法播放的標原因，兩者都不能勾。暫選以媒體 ID 記，翻頁、搜尋都保留；送出順序＝第一次勾選的順序。
 */
export function MediaPickerDialog({
  load,
  onConfirm,
  onClose,
  maxSelect,
  limitHint,
  targetLabel,
  reloadKey,
}: {
  load: (query: { keyword: string; page: number }, signal: AbortSignal) => Promise<PickerPage>;
  /** 丟出錯誤＝失敗（保留選取並顯示原因）；409 會提示重新取得清單 */
  onConfirm: (ids: string[], names: string[]) => Promise<void>;
  onClose: () => void;
  maxSelect: number;
  limitHint: string;
  /** 加到哪裡（提示文字用，例如「分組」「播放清單」） */
  targetLabel: string;
  reloadKey?: unknown;
}) {
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PickerPage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void load({ keyword, page }, controller.signal)
      .then((next) => {
        if (page > 1 && next.total <= (page - 1) * next.pageSize) setPage(Math.max(1, Math.ceil(next.total / next.pageSize)));
        else {
          setLoadError('');
          setData(next);
          // 重新取得後已加入或已無法加入的項目，從暫選中拿掉（不會被送出）
          const blocked = new Set(next.items.filter((item) => item.included || !item.available).map((item) => item.id));
          setSelection((current) => (current.order.some((id) => blocked.has(id)) ? { order: current.order.filter((id) => !blocked.has(id)), names: current.names } : current));
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setLoadError(reason.message);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load 由呼叫端提供，依查詢條件與 reloadKey 重新取得
  }, [keyword, page, reload, reloadKey]);

  const items: PageItem[] = useMemo(
    () => (data?.items ?? []).map((item) => ({ id: item.id, name: item.name ?? item.id, selectable: !item.included && item.available })),
    [data],
  );
  const header = pageState(selection, items);
  const count = selection.order.length;
  const overLimit = count > maxSelect;

  const submit = async () => {
    if (!count || overLimit || saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm(selection.order, selection.order.map((id) => selection.names[id]));
    } catch (reason) {
      setError((reason as Error).message);
      if (reason instanceof ApiError && reason.status === 409) setNeedsRefresh(true);
      setSaving(false);
    }
  };
  const search = () => {
    setPage(1);
    setKeyword(draft.trim());
  };

  return (
    <Dialog
      title="加入媒體"
      width="max-w-3xl"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-zinc-400" aria-live="polite">
            已選 {count} 個{count ? `：${selection.order.map((id) => selection.names[id]).join('、')}` : ''}
          </span>
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton disabled={!count || overLimit || saving} onClick={() => void submit()}>{saving ? '加入中…' : '確定'}</PrimaryButton>
        </>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-zinc-400" />
        <input
          value={draft}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && search()}
          placeholder="請輸入關鍵字"
          aria-label="搜尋媒體名稱或內容描述"
          className="w-full rounded-xl bg-[#262a33] py-3.5 pr-4 pl-12 text-lg outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <table className="mt-4 w-full table-fixed text-left">
        <thead className="text-zinc-400">
          <tr className="border-b border-zinc-700/70">
            <th className="w-14 py-4 pl-3">
              <Checkbox
                indeterminate={header === 'some'}
                checked={header === 'all'}
                disabled={header === 'disabled'}
                onChange={() => setSelection((current) => togglePage(current, items))}
                label="全選本頁可加入的媒體"
              />
            </th>
            <th className="py-4">媒體名稱</th>
            <th className="w-32 py-4">檔案類型</th>
            <th className="py-4">檔案內容</th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((item) => {
            const selectable = !item.included && item.available;
            const checked = selection.order.includes(item.id);
            return (
              <tr key={item.id} className="border-b border-zinc-700/70">
                <td className="py-4 pl-3">
                  <Checkbox
                    checked={checked || item.included}
                    disabled={!selectable}
                    onChange={() => setSelection((current) => toggle(current, { id: item.id, name: item.name ?? item.id }))}
                    label={`選取 ${item.name}`}
                  />
                </td>
                <td className="py-4 pr-3">
                  <div className="truncate text-zinc-100">{item.name}</div>
                  {item.included ? <span className="text-xs text-sky-300">已加入</span> : !item.available ? <span className="text-xs text-amber-300">無法加入：{item.unavailable_label}</span> : null}
                </td>
                <td className="py-4">
                  <TypeBadge type={item.media_type} />
                </td>
                <td className="py-4 pr-2 text-zinc-200">
                  <div className="truncate">{item.description || '—'}</div>
                  <div className="truncate text-xs text-zinc-500">{item.media_type === 'text' ? item.text_excerpt : item.original_name}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loadError ? <ErrorLine text={`媒體清單載入失敗：${loadError}`} /> : !data ? <p className="py-10 text-center text-zinc-500">載入中…</p> : !data.items.length ? <p className="py-10 text-center text-zinc-500">{keyword ? '沒有符合的媒體' : '尚無媒體內容'}</p> : null}
      {data && data.total > data.pageSize ? <Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /> : null}
      <p className="mt-3 text-xs text-zinc-500">
        表頭勾選只作用於本頁可加入的媒體。依勾選順序加入{targetLabel}末端，加入後可拖曳調整順序。{limitHint}
      </p>
      {overLimit ? <ErrorLine text={`超過上限：${limitHint}`} /> : null}
      {error ? <ErrorLine text={error} /> : null}
      {needsRefresh ? (
        <button
          type="button"
          onClick={() => {
            setNeedsRefresh(false);
            setError('');
            setReload((value) => value + 1);
          }}
          className="mt-2 text-sm text-sky-300 underline"
        >
          重新取得媒體清單（保留目前選取）
        </button>
      ) : null}
    </Dialog>
  );
}
