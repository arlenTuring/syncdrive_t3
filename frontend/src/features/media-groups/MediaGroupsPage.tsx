import { ArrowDownUp, ChevronDown, ChevronUp, GripVertical, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { AddMediaDialog } from './AddMediaDialog';
import { ApiError, GROUPS_PAGE_SIZE, listGroups, removeMember, reorderMembers, type GroupList, type GroupMember, type MediaGroup } from './api';
import { DeleteGroupDialog, GroupNameDialog, Toast } from './dialogs';
import { clampPage, moveItem } from './selection';
import { Pagination, TypeBadge } from './widgets';
import { useCoalescedQuery } from '../../lib/useCoalescedQuery';

type Notice = { text: string; tone: 'success' | 'error'; id: number };

/**
 * 媒體管理模組 → 媒體分組清單。
 *
 * 搜尋只比對分組名稱、分頁以分組為單位（同一分組的成員不會被拆到不同頁）。
 * 每個分組的展開狀態各自保留，資料刷新（自己的操作、其他人的修改通知）不會全部收合。
 */
export function MediaGroupsPage() {
  const auth = useAuth();
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [nameDialog, setNameDialog] = useState<{ groupId?: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState<MediaGroup | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((text: string, tone: Notice['tone'] = 'success') => setNotice({ text, tone, id: Date.now() }), []);
  const queryKey = `${keyword}|${page}|${direction}|${auth.user?.id ?? ''}`;
  const loadGroups = useCallback((signal: AbortSignal) => listGroups({ keyword, page, direction }, signal), [keyword, page, direction]);
  const query = useCoalescedQuery<GroupList>({ enabled: true, queryKey, load: loadGroups });
  const data = query.data;
  const reload = query.refresh;
  const backgroundReload = query.backgroundRefresh;
  const setQueryData = query.setData;
  useEffect(() => {
    if (!data) return;
    const fixed = clampPage(page, data.total, GROUPS_PAGE_SIZE);
    // 刪除最後一頁資料後，以後端回傳的總數修正頁碼。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fixed !== page) setPage(fixed);
  }, [data, page]);
  // 其他頁面或其他使用者改了媒體／分組：重新取得（沿用既有失效通知，不另外輪詢）
  useEffect(() => {
    const onLocal = () => reload();
    window.addEventListener('media-library:changed', onLocal);
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes('table:media_library_items')) backgroundReload();
    });
    return () => {
      window.removeEventListener('media-library:changed', onLocal);
      unsubscribe();
    };
  }, [reload, backgroundReload]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const replaceGroup = useCallback((group: MediaGroup) => {
    setQueryData((current) => ({ ...current, items: current.items.map((item) => (item.id === group.id ? group : item)) }));
  }, [setQueryData]);
  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const search = () => {
    setPage(1);
    setKeyword(draft.trim());
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-zinc-100">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
            placeholder="請輸入關鍵字"
            aria-label="搜尋分組名稱"
            className="h-11 w-64 rounded-xl bg-[#222831] pr-3 pl-10 outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <button type="button" onClick={search} className="rounded-xl bg-[#27303d] p-3" aria-label="搜尋">
          <Search className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setKeyword('');
            setPage(1);
            setDirection('asc');
          }}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-zinc-400"
        >
          <RefreshCw className="size-4" />
          重置
        </button>
        <button
          type="button"
          onClick={() => auth.require('media.groups.create') && setNameDialog({})}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-medium hover:bg-blue-500"
        >
          <Plus className="size-5" />
          建立分組
        </button>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-auto">
        <div className="flex items-center border-b border-zinc-800 px-4 py-4 text-zinc-400">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
            }}
            className="inline-flex flex-1 items-center justify-between pr-36"
            aria-label={`依分組名稱排序（目前${direction === 'asc' ? '遞增' : '遞減'}）`}
          >
            分組名稱
            <ArrowDownUp className="size-4 text-sky-400" />
          </button>
        </div>
        {data?.items.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            expanded={expanded.has(group.id)}
            onToggle={() => toggleExpanded(group.id)}
            onEdit={() => auth.require('media.groups.edit') && setNameDialog({ groupId: group.id })}
            onDelete={() => auth.require('media.groups.delete') && setDeleting(group.id)}
            onAdd={() => auth.require('media.groups.edit') && setAdding(group)}
            canEdit={auth.can('media.groups.edit')}
            requireEdit={() => auth.require('media.groups.edit')}
            onGroupChanged={replaceGroup}
            onStale={reload}
            notify={notify}
          />
        ))}
        {query.backgroundError ? <State text={`背景更新失敗，已保留目前資料：${query.backgroundError}`} retry={reload} compact /> : null}
        {query.initialLoading ? <State text="載入中…" /> : query.initialError ? <State text={`載入失敗：${query.initialError}`} retry={reload} /> : data && !data.items.length ? <State text={keyword ? '沒有符合的分組' : '尚無媒體分組'} /> : null}
      </div>
      {data && data.total > GROUPS_PAGE_SIZE ? <Pagination page={page} total={data.total} pageSize={GROUPS_PAGE_SIZE} onChange={setPage} /> : null}

      {nameDialog ? (
        <GroupNameDialog
          groupId={nameDialog.groupId}
          onClose={() => setNameDialog(null)}
          onSaved={(group, created) => {
            setNameDialog(null);
            if (created) {
              // 新分組直接展開，讓使用者馬上加入媒體
              setExpanded((current) => new Set(current).add(group.id));
              notify('分組建立成功');
            } else {
              replaceGroup(group);
              notify('分組名稱已更新');
            }
            reload();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteGroupDialog
          groupId={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            notify('分組已刪除');
            reload();
          }}
        />
      ) : null}
      {adding ? (
        <AddMediaDialog
          group={adding}
          onClose={() => setAdding(null)}
          onAdded={(group, count) => {
            setAdding(null);
            replaceGroup(group);
            setExpanded((current) => new Set(current).add(group.id));
            notify(`已加入 ${count} 個媒體`);
          }}
        />
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

function State({ text, retry, compact = false }: { text: string; retry?: () => void; compact?: boolean }) {
  return (
    <div className={`${compact ? 'py-2 text-amber-300' : 'py-16 text-zinc-500'} text-center`}>
      {text}
      {retry ? (
        <button type="button" onClick={retry} className="ml-3 text-sky-300 underline">
          重試
        </button>
      ) : null}
    </div>
  );
}

function GroupRow({
  group,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
  canEdit,
  requireEdit,
  onGroupChanged,
  onStale,
  notify,
}: {
  group: MediaGroup;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAdd: () => void;
  canEdit: boolean;
  requireEdit: () => boolean;
  onGroupChanged: (group: MediaGroup) => void;
  onStale: () => void;
  notify: (text: string, tone?: 'success' | 'error') => void;
}) {
  const panelId = `media-group-${group.id}`;
  return (
    <div className="border-b border-zinc-800">
      <div className="flex items-center gap-4 px-4 py-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? '收合' : '展開'} ${group.name}`}
          className="rounded-lg bg-zinc-800 p-1.5 hover:bg-zinc-700"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <span className="truncate text-lg">{group.name}</span>
          <span className="ml-3 text-sm text-zinc-500">{group.member_count} 個媒體</span>
          {!group.playable ? <span className="ml-3 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">{group.unavailable_label}（不可播放）</span> : null}
        </div>
        <button type="button" onClick={onEdit} aria-label={`編輯分組 ${group.name}`} className="rounded-lg p-2 hover:bg-white/5">
          <Pencil className="size-5" />
        </button>
        <button type="button" onClick={onDelete} aria-label={`刪除分組 ${group.name}`} className="rounded-lg p-2 hover:bg-red-500/10 hover:text-red-400">
          <Trash2 className="size-5" />
        </button>
      </div>
      {expanded ? (
        <div id={panelId} className="bg-[#1c2028]">
          <MemberList key={`${group.id}:${group.version}`} group={group} canEdit={canEdit} requireEdit={requireEdit} onGroupChanged={onGroupChanged} onStale={onStale} notify={notify} />
          <div className="px-4 py-4 pl-[4.5rem]">
            <button type="button" onClick={onAdd} className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300">
              <Plus className="size-4" />
              加入媒體
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 成員清單：拖曳把手或鍵盤調整順序，放開後才保存一次；保存中鎖住這個分組的操作；
 * 失敗還原到伺服器確認過的順序。
 */
function MemberList({
  group,
  canEdit,
  requireEdit,
  onGroupChanged,
  onStale,
  notify,
}: {
  group: MediaGroup;
  canEdit: boolean;
  requireEdit: () => boolean;
  onGroupChanged: (group: MediaGroup) => void;
  onStale: () => void;
  notify: (text: string, tone?: 'success' | 'error') => void;
}) {
  const confirmed = group.members;
  const [order, setOrder] = useState<GroupMember[]>(confirmed);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const dragStartOrder = useRef<GroupMember[]>(confirmed);
  const handleArmed = useRef<string | null>(null);

  const save = async (next: GroupMember[]) => {
    if (next.map((item) => item.id).join() === confirmed.map((item) => item.id).join()) return;
    if (!requireEdit()) {
      setOrder(confirmed);
      return;
    }
    setBusy(true);
    try {
      const saved = await reorderMembers(group.id, next.map((item) => item.id), group.version);
      notify('順序已儲存');
      onGroupChanged(saved);
    } catch (reason) {
      setOrder(confirmed);
      notify(`順序儲存失敗，已還原：${(reason as Error).message}`, 'error');
      if (reason instanceof ApiError && reason.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: GroupMember) => {
    if (busy || !requireEdit()) return;
    setBusy(true);
    try {
      const saved = await removeMember(group.id, member.id, group.version);
      notify('已從分組移除');
      onGroupChanged(saved);
    } catch (reason) {
      notify(`移除失敗：${(reason as Error).message}`, 'error');
      if (reason instanceof ApiError && reason.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  };

  const onDragStart = (event: DragEvent, id: string) => {
    // 只能從把手開始拖；沒有編輯權限不能拖
    if (busy || handleArmed.current !== id || !canEdit) {
      event.preventDefault();
      if (!canEdit) requireEdit();
      return;
    }
    dragStartOrder.current = order;
    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (event: DragEvent, overId: string) => {
    if (!dragging) return;
    event.preventDefault();
    if (overId === dragging) return;
    setOrder((current) => moveItem(current, current.findIndex((item) => item.id === dragging), current.findIndex((item) => item.id === overId)));
  };
  const onDragEnd = () => {
    if (!dragging) return;
    setDragging(null);
    handleArmed.current = null;
    void save(order);
  };

  const onHandleKey = (event: KeyboardEvent, member: GroupMember, index: number) => {
    if (busy) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (grabbed === member.id) {
        setGrabbed(null);
        setAnnounce(`已放下 ${member.name}，位置 ${index + 1}，儲存中`);
        void save(order);
      } else {
        if (!requireEdit()) return;
        dragStartOrder.current = order;
        setGrabbed(member.id);
        setAnnounce(`已拿起 ${member.name}，目前第 ${index + 1} 項；用上下鍵移動，空白鍵放下，Esc 取消`);
      }
    } else if (grabbed === member.id && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= order.length) return;
      setOrder((current) => moveItem(current, index, to));
      setAnnounce(`${member.name} 移到第 ${to + 1} 項`);
    } else if (grabbed === member.id && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setGrabbed(null);
      setOrder(dragStartOrder.current);
      setAnnounce('已取消移動');
    }
  };

  if (!order.length) {
    return <p className="px-4 pt-5 pb-1 pl-[4.5rem] text-zinc-400">尚未加入媒體（空分組不會被當成可播放的資源）</p>;
  }
  return (
    <>
      <div className="grid grid-cols-[4.5rem_1fr_10rem_4rem] border-b border-zinc-700/60 px-4 py-4 text-zinc-400">
        <span className="pl-6">排序</span>
        <span>檔案名稱</span>
        <span>檔案類型</span>
        <span className="sr-only">移除</span>
      </div>
      <ul aria-label="分組成員（依播放順序）" aria-busy={busy}>
        {order.map((member, index) => (
          <li
            key={member.id}
            draggable
            onDragStart={(event) => onDragStart(event, member.id)}
            onDragOver={(event) => onDragOver(event, member.id)}
            onDrop={(event) => event.preventDefault()}
            onDragEnd={onDragEnd}
            className={`grid grid-cols-[4.5rem_1fr_10rem_4rem] items-center border-b border-zinc-700/60 px-4 py-4 last:border-b-0 ${dragging === member.id || grabbed === member.id ? 'bg-blue-500/10 ring-1 ring-blue-500/60 ring-inset' : ''} ${busy ? 'opacity-70' : ''}`}
          >
            <button
              type="button"
              aria-label={`調整「${member.name ?? member.id}」的順序（目前第 ${index + 1} 項，空白鍵拿起後用上下鍵移動）`}
              aria-pressed={grabbed === member.id}
              disabled={busy}
              onPointerDown={() => {
                handleArmed.current = member.id;
              }}
              onKeyDown={(event) => onHandleKey(event, member, index)}
              onBlur={() => {
                if (grabbed === member.id) {
                  setGrabbed(null);
                  setOrder(dragStartOrder.current);
                }
              }}
              className="ml-4 w-fit cursor-grab rounded p-1 text-zinc-400 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:cursor-wait"
            >
              <GripVertical className="size-5" />
            </button>
            <span className="min-w-0 truncate pr-3">
              {member.missing ? <span className="text-red-300">媒體已不存在（{member.id}）</span> : member.name}
              {!member.missing && !member.available ? <span className="ml-2 text-xs text-amber-300">無法播放：{member.unavailable_label}</span> : null}
            </span>
            <span>{member.missing ? '—' : <TypeBadge type={member.media_type} />}</span>
            <button
              type="button"
              onClick={() => void remove(member)}
              disabled={busy}
              aria-label={`從此分組移除「${member.name ?? member.id}」（不會刪除媒體）`}
              title="從此分組移除（不會刪除媒體）"
              className="justify-self-end rounded-lg p-1.5 text-zinc-300 hover:bg-white/10 disabled:opacity-40"
            >
              <X className="size-5" />
            </button>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="assertive">{announce}</p>
    </>
  );
}

export default MediaGroupsPage;
