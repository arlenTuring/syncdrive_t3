import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, type GroupList, type MediaGroup } from '../media-groups/api';
import { Dialog, ErrorLine, GhostButton, PrimaryButton } from '../media-groups/dialogs';
import { Pagination, TypeBadge } from '../media-groups/widgets';
import { listGroupOptions } from './api';

/**
 * 「套用媒體分組」：搜尋、分頁、單選；展開只是查看成員，跟選取無關。
 * 空分組、成員缺失或無法播放的分組標示原因且不能套用。
 * 套用前再取一次最新資料比對版本，分組在開著對話框時被改過就提示重新確認。
 */
export function GroupPickerDialog({ onClose, onApply }: { onClose: () => void; onApply: (group: MediaGroup) => void }) {
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<GroupList | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<MediaGroup | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listGroupOptions({ keyword, page }, controller.signal)
      .then((next) => {
        setLoadError('');
        setData(next);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setLoadError(reason.message);
      });
    return () => controller.abort();
  }, [keyword, page, reload]);

  const search = () => {
    setPage(1);
    setKeyword(draft.trim());
  };
  const apply = async () => {
    if (!selected || checking) return;
    setChecking(true);
    setError('');
    try {
      // 以名稱搜尋取最新的同一個分組（選項端點只給摘要，不需要分組編輯權限）
      const fresh = await listGroupOptions({ keyword: selected.name, page: 1 });
      const latest = fresh.items.find((item) => item.id === selected.id);
      if (!latest) {
        setSelected(null);
        setReload((value) => value + 1);
        throw new ApiError('這個分組已被刪除或改名，已重新載入清單，請重新選擇', 409);
      }
      if (latest.version !== selected.version) {
        setSelected(latest);
        setReload((value) => value + 1);
        throw new ApiError('分組內容已被修改，已更新為最新內容，請確認後再套用', 409);
      }
      if (!latest.playable) throw new ApiError(`這個分組無法套用：${latest.unavailable_label}`, 409);
      onApply(latest);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog
      title="套用媒體分組"
      width="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-zinc-400">{selected ? `已選：${selected.name}（${selected.member_count} 個媒體）` : '尚未選擇分組'}</span>
          <GhostButton onClick={onClose}>取消</GhostButton>
          <PrimaryButton disabled={!selected || !selected.playable || checking} onClick={() => void apply()}>{checking ? '確認中…' : '套用'}</PrimaryButton>
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
          aria-label="搜尋分組名稱"
          className="w-full rounded-xl bg-[#262a33] py-3.5 pr-4 pl-12 text-lg outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div role="radiogroup" aria-label="媒體分組" className="mt-4">
        {(data?.items ?? []).map((group) => {
          const open = expanded.has(group.id);
          return (
            <div key={group.id} className="border-b border-zinc-700/70">
              <div className="flex items-center gap-3 py-3">
                <label className={`flex min-w-0 flex-1 items-center gap-3 ${group.playable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                  <input
                    type="radio"
                    name="media-group"
                    checked={selected?.id === group.id}
                    disabled={!group.playable}
                    onChange={() => setSelected(group)}
                    aria-label={`選擇分組 ${group.name}`}
                    className="size-5 accent-blue-600"
                  />
                  <span className="truncate text-zinc-100">{group.name}</span>
                  <span className="shrink-0 text-sm text-zinc-500">{group.member_count} 個媒體</span>
                  {!group.playable ? <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">{group.unavailable_label}（不可套用）</span> : null}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  aria-expanded={open}
                  aria-label={`${open ? '收合' : '展開'}分組 ${group.name} 的成員`}
                  className="rounded-lg bg-zinc-800 p-1.5 hover:bg-zinc-700"
                >
                  {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
              </div>
              {open ? (
                <ol className="mb-3 space-y-1 rounded-xl bg-[#1c2028] px-4 py-3 text-sm">
                  {group.members.length ? (
                    group.members.map((member, index) => (
                      <li key={member.id} className="flex items-center gap-3">
                        <span className="w-6 text-right text-zinc-500">{index + 1}</span>
                        <span className={`min-w-0 flex-1 truncate ${member.available ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}>{member.name ?? '（已刪除的媒體）'}</span>
                        <TypeBadge type={member.media_type} />
                        {!member.available ? <span className="text-xs text-amber-300">{member.unavailable_label}</span> : null}
                      </li>
                    ))
                  ) : (
                    <li className="text-zinc-500">此分組沒有媒體</li>
                  )}
                </ol>
              ) : null}
            </div>
          );
        })}
      </div>
      {loadError ? <ErrorLine text={`分組清單載入失敗：${loadError}`} /> : !data ? <p className="py-10 text-center text-zinc-500">載入中…</p> : !data.items.length ? <p className="py-10 text-center text-zinc-500">{keyword ? '沒有符合的分組' : '尚無媒體分組'}</p> : null}
      {data && data.total > data.page_size ? <Pagination page={page} total={data.total} pageSize={data.page_size} onChange={setPage} /> : null}
      <p className="mt-3 text-xs text-zinc-500">套用會把分組「目前」的媒體與順序複製到播放清單；之後分組再修改，不會影響這個排程。</p>
      {error ? <ErrorLine text={error} /> : null}
    </Dialog>
  );
}
