import { ArrowDownUp, History, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { Toast } from '../media-groups/dialogs';
import { clampPage } from '../media-groups/selection';
import { Pagination } from '../media-groups/widgets';
import { listSchedules, MEDIA_SCHEDULE_TAG, SCHEDULES_PAGE_SIZE, type MediaSchedule, type ScheduleList, type SortKey } from './api';
import { DeleteScheduleDialog, ScheduleResultsDialog } from './dialogs';
import { formatInZone, MODE_LABEL } from './draft';
import { ScheduleEditorDialog } from './ScheduleEditorDialog';

type Notice = { text: string; tone: 'success' | 'error'; id: number };

/**
 * 媒體管理模組 → 媒體排程設定（預約播放、定時播放）。
 * 排序依原始欄位或下一次時點（後端），同值依 ID 穩定排序；長摘要截斷，點一下展開完整內容。
 */
export function MediaSchedulesPage() {
  const auth = useAuth();
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: SortKey; direction: 'asc' | 'desc' }>({ by: 'created_at', direction: 'desc' });
  const [data, setData] = useState<ScheduleList | null>(null);
  const [settled, setSettled] = useState<{ key: string; error: string }>({ key: '', error: '' });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [deleting, setDeleting] = useState<MediaSchedule | null>(null);
  const [viewing, setViewing] = useState<MediaSchedule | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const requestKey = `${keyword}|${page}|${sort.by}|${sort.direction}|${reloadTick}`;
  const loading = settled.key !== requestKey;
  const error = settled.key === requestKey ? settled.error : '';
  const notify = useCallback((text: string, tone: Notice['tone'] = 'success') => setNotice({ text, tone, id: Date.now() }), []);
  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void listSchedules({ keyword, page, sortBy: sort.by, direction: sort.direction }, controller.signal)
      .then((next) => {
        const fixed = clampPage(page, next.total, SCHEDULES_PAGE_SIZE);
        if (fixed !== page) setPage(fixed);
        else {
          setData(next);
          setSettled({ key: requestKey, error: '' });
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, error: reason.message });
      });
    return () => controller.abort();
  }, [keyword, page, sort, requestKey]);

  // 到期處理、其他使用者修改、媒體被改：沿用既有失效通知重新取得
  useEffect(() => {
    const onLocal = () => reload();
    window.addEventListener('media-library:changed', onLocal);
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes(MEDIA_SCHEDULE_TAG) || payload.tags.includes('table:media_library_items')) reload();
    });
    return () => {
      window.removeEventListener('media-library:changed', onLocal);
      unsubscribe();
    };
  }, [reload]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const search = () => {
    setPage(1);
    setKeyword(draft.trim());
  };
  const sortBy = (by: SortKey) => {
    setPage(1);
    setSort((current) => ({ by, direction: current.by === by && current.direction === 'asc' ? 'desc' : 'asc' }));
  };
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const header = (label: string, by: SortKey) => (
    <button type="button" onClick={() => sortBy(by)} className="inline-flex items-center gap-2" aria-label={`依${label}排序${sort.by === by ? `（目前${sort.direction === 'asc' ? '遞增' : '遞減'}）` : ''}`}>
      {label}
      <ArrowDownUp className={`size-4 ${sort.by === by ? 'text-sky-400' : 'text-zinc-600'}`} />
    </button>
  );

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
            aria-label="搜尋排程名稱"
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
            setSort({ by: 'created_at', direction: 'desc' });
          }}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-zinc-400"
        >
          <RefreshCw className="size-4" />
          重置
        </button>
        <button type="button" onClick={() => auth.require('media.schedule.create') && setEditing({})} className="ml-auto inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-medium hover:bg-blue-500">
          <Plus className="size-5" />
          建立媒體排程
        </button>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-left">
          <thead className="text-zinc-400">
            <tr className="border-b border-zinc-800">
              <th className="w-[22%] px-4 py-4 font-normal">{header('排程名稱', 'name')}</th>
              <th className="px-4 py-4 font-normal">{header('播放時間', 'next_run_at')}</th>
              <th className="w-32 px-4 py-4 font-normal">{header('播放模式', 'mode')}</th>
              <th className="w-[20%] px-4 py-4 font-normal">{header('指派載具', 'target')}</th>
              <th className="w-36 px-4 py-4 font-normal">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((schedule) => {
              const open = expanded.has(schedule.id);
              const targets = schedule.target_scope === 'all' ? '全部載具' : schedule.vehicles.map((v) => (v.active === false ? `${v.display_name}（已移除）` : v.display_name)).join('、');
              return (
                <tr key={schedule.id} className="border-b border-zinc-800 align-top">
                  <td className="px-4 py-4">
                    <div className="truncate" title={schedule.name}>{schedule.name}</div>
                    <div className="text-xs text-zinc-500">{schedule.item_count} 個媒體</div>
                  </td>
                  <td className="px-4 py-4">
                    <button type="button" onClick={() => toggle(schedule.id)} aria-expanded={open} aria-label={`${open ? '收合' : '查看完整'}播放時間：${schedule.name}`} className={`block w-full text-left ${open ? 'break-words whitespace-normal' : 'truncate'}`} title={schedule.summary}>
                      {schedule.summary}
                    </button>
                    <div className="mt-1 text-xs text-zinc-500">
                      {schedule.status === 'completed' ? '已完成，不會再播放' : schedule.next_run_at ? `下次：${formatInZone(schedule.next_run_at, schedule.time_zone)}` : '—'}
                      <span className="ml-2">{schedule.time_zone}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">{MODE_LABEL[schedule.mode] ?? `不支援的模式（${schedule.mode}）`}</td>
                  <td className="px-4 py-4">
                    <button type="button" onClick={() => toggle(schedule.id)} className={`block w-full text-left ${open ? 'break-words whitespace-normal' : 'truncate'}`} title={targets} aria-label={`${open ? '收合' : '查看完整'}指派載具：${targets}`}>
                      {targets}
                    </button>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setViewing(schedule)} aria-label={`到期處理結果 ${schedule.name}`} className="rounded-lg p-2 hover:bg-white/5">
                        <History className="size-5" />
                      </button>
                      <button type="button" onClick={() => auth.require('media.schedule.edit') && setEditing({ id: schedule.id })} aria-label={`編輯排程 ${schedule.name}`} className="rounded-lg p-2 hover:bg-white/5">
                        <Pencil className="size-5" />
                      </button>
                      <button type="button" onClick={() => auth.require('media.schedule.delete') && setDeleting(schedule)} aria-label={`刪除排程 ${schedule.name}`} className="rounded-lg p-2 hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="size-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && !data ? <State text="載入中…" /> : error ? <State text={`載入失敗：${error}`} retry={reload} /> : data && !data.items.length ? <State text={keyword ? '沒有符合的排程' : '尚無媒體排程'} /> : null}
      </div>
      {data && data.total > SCHEDULES_PAGE_SIZE ? <Pagination page={page} total={data.total} pageSize={SCHEDULES_PAGE_SIZE} onChange={setPage} /> : null}

      {editing ? (
        <ScheduleEditorDialog
          scheduleId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={(_, created) => {
            setEditing(null);
            notify(created ? '媒體排程建立成功' : '媒體排程已儲存');
            reload();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteScheduleDialog
          schedule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            notify('媒體排程已刪除');
            reload();
          }}
        />
      ) : null}
      {viewing ? <ScheduleResultsDialog schedule={viewing} onClose={() => setViewing(null)} /> : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}

function State({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="py-16 text-center text-zinc-500">
      {text}
      {retry ? (
        <button type="button" onClick={retry} className="ml-3 text-sky-300 underline">
          重試
        </button>
      ) : null}
    </div>
  );
}
