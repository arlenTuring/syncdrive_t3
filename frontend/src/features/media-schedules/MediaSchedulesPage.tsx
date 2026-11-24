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
import { useCoalescedQuery } from '../../lib/useCoalescedQuery';
import { Button, IconButton, cn, fieldClass } from '../../components/ui';

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [deleting, setDeleting] = useState<MediaSchedule | null>(null);
  const [viewing, setViewing] = useState<MediaSchedule | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((text: string, tone: Notice['tone'] = 'success') => setNotice({ text, tone, id: Date.now() }), []);
  const queryKey = `${keyword}|${page}|${sort.by}|${sort.direction}|${auth.user?.id ?? ''}`;
  const loadSchedules = useCallback((signal: AbortSignal) => listSchedules({ keyword, page, sortBy: sort.by, direction: sort.direction }, signal), [keyword, page, sort]);
  const query = useCoalescedQuery<ScheduleList>({ enabled: true, queryKey, load: loadSchedules });
  const data = query.data;
  const reload = query.refresh;
  const backgroundReload = query.backgroundRefresh;
  useEffect(() => {
    if (!data) return;
    const fixed = clampPage(page, data.total, SCHEDULES_PAGE_SIZE);
    // 刪除最後一頁資料後，以後端回傳的總數修正頁碼。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fixed !== page) setPage(fixed);
  }, [data, page]);

  // 到期處理、其他使用者修改、媒體被改：沿用既有失效通知重新取得
  useEffect(() => {
    const onLocal = () => reload();
    window.addEventListener('media-library:changed', onLocal);
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes(MEDIA_SCHEDULE_TAG) || payload.tags.includes('table:media_library_items')) backgroundReload();
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
    <Button
      hierarchy="subordinate"
      variant="text"
      onPress={() => sortBy(by)}
      aria-label={`依${label}排序${sort.by === by ? `（目前${sort.direction === 'asc' ? '遞增' : '遞減'}）` : ''}`}
      trailingIcon={<ArrowDownUp className={sort.by === by ? 'text-text-theme' : 'text-text-disabled'} />}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col text-text-primary">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-quaternary" />
          <input
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
            placeholder="請輸入關鍵字"
            aria-label="搜尋排程名稱"
            className={cn(fieldClass({ fullWidth: false }), 'w-64 pl-10')}
          />
        </div>
        <IconButton label="搜尋" hierarchy="subordinate" variant="tonal" icon={<Search />} onPress={search} />
        <Button
          hierarchy="subordinate"
          variant="outlined"
          leadingIcon={<RefreshCw />}
          onPress={() => {
            setDraft('');
            setKeyword('');
            setPage(1);
            setSort({ by: 'created_at', direction: 'desc' });
          }}
        >
          重置
        </Button>
        <Button className="ml-auto" leadingIcon={<Plus />} onPress={() => auth.require('media.schedule.create') && setEditing({})}>
          建立媒體排程
        </Button>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-auto">
        <table className="t3-table w-full table-fixed text-left">
          <thead className="text-text-tertiary">
            <tr className="border-b border-border-quaternary">
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
                <tr key={schedule.id} className="border-b border-border-quaternary align-top">
                  <td className="px-4 py-4">
                    <div className="truncate" title={schedule.name}>{schedule.name}</div>
                    <div className="text-body-xs text-text-quaternary">{schedule.item_count} 個媒體</div>
                  </td>
                  <td className="px-4 py-4">
                    <button type="button" onClick={() => toggle(schedule.id)} aria-expanded={open} aria-label={`${open ? '收合' : '查看完整'}播放時間：${schedule.name}`} className={`block w-full text-left ${open ? 'break-words whitespace-normal' : 'truncate'}`} title={schedule.summary}>
                      {schedule.summary}
                    </button>
                    <div className="mt-1 text-body-xs text-text-quaternary">
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
                      <IconButton label={`到期處理結果 ${schedule.name}`} hierarchy="subordinate" variant="standard" icon={<History />} onPress={() => setViewing(schedule)} />
                      <IconButton label={`編輯排程 ${schedule.name}`} hierarchy="subordinate" variant="standard" icon={<Pencil />} onPress={() => auth.require('media.schedule.edit') && setEditing({ id: schedule.id })} />
                      <IconButton label={`刪除排程 ${schedule.name}`} hierarchy="danger" variant="standard" icon={<Trash2 />} onPress={() => auth.require('media.schedule.delete') && setDeleting(schedule)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {query.backgroundError ? <State text={`背景更新失敗，已保留目前資料：${query.backgroundError}`} retry={reload} compact /> : null}
        {query.initialLoading ? <State text="載入中…" /> : query.initialError ? <State text={`載入失敗：${query.initialError}`} retry={reload} /> : data && !data.items.length ? <State text={keyword ? '沒有符合的排程' : '尚無媒體排程'} /> : null}
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

function State({ text, retry, compact = false }: { text: string; retry?: () => void; compact?: boolean }) {
  return (
    <div className={`${compact ? 'py-2 text-status-warning' : 'py-16 text-text-quaternary'} text-center`}>
      {text}
      {retry ? (
        <Button variant="text" className="ml-3" onPress={retry}>
          重試
        </Button>
      ) : null}
    </div>
  );
}
