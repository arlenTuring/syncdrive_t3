import { ChevronDown, ChevronUp, ChevronsUpDown, Pencil, Plus, RotateCw, Save, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../access-control/AuthContext';
import { subscribeDatasourceInvalidation } from '../dashboard/utils/datasourceInvalidationBus';
import { SiteMultiSelect } from '../../components/SiteMultiSelect';
import { Toast } from '../media-groups/dialogs';
import { videoApi, type SourceOption, type SourceSort, type StorageStatus, type VideoSourceItem } from './api';
import { SourceDialog } from './SourceDialog';
import { onlineBadge, recordingBadge } from './status';
import { StorageDialog } from './StorageDialog';
import { useCoalescedQuery } from '../../lib/useCoalescedQuery';
import { Badge, Button, Dialog, IconButton, Pagination, cn, type BadgeTone } from '../../components/ui';

const PAGE_SIZE = 20;
const ONLINE_TONE: Record<ReturnType<typeof onlineBadge>['tone'], BadgeTone> = { green: 'success', red: 'error', amber: 'warning', sky: 'info', zinc: 'neutral' };
/** 篩選用的來源名稱、新增對話框用的既有標籤；任一個失敗不影響另一個 */
const loadOptions = () => Promise.all([videoApi.sourceOptions().catch(() => null), videoApi.sourceTags().catch(() => null)]);
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

type SortKey = 'name' | 'status';

/** 可排序的表頭：未排序時上下箭頭、排序中顯示方向（設計稿 2026-11-20） */
function SortHeader({ label, active, desc, onSort }: { label: string; active: boolean; desc: boolean; onSort: () => void }) {
  const Icon = !active ? ChevronsUpDown : desc ? ChevronDown : ChevronUp;
  return (
    <button type="button" onClick={onSort} className="flex w-full items-center justify-between gap-2 text-left hover:text-text-primary">
      {label}
      <Icon className={cn('size-4 shrink-0', active ? 'text-text-theme' : 'text-text-tertiary')} aria-hidden />
    </button>
  );
}

/**
 * 影像來源管理（設計稿 2026-11-20）：上方選擇影像來源＋搜尋／重置、右上錄影儲存狀態與新增來源；
 * 清單欄位為影像名稱、來源標籤、載具/位置、啟用狀態、連線狀態、操作（編輯、刪除），名稱與連線狀態可排序（伺服器排序，跨分頁正確）。
 *
 * - 清單不播放影片、不建立任何播放 session、不載入縮圖；歷史錄影由獨立「歷史影像紀錄」頁查詢。
 * - 「啟用」是使用者指令、「上線」是實際探測結果，分開顯示；錄影狀態放在連線狀態的滑鼠提示。啟停在編輯對話框裡切換。
 * - 來源連線逐筆設定；攝影機允許網段是部署設定，不在此頁修改。
 */
export function VideoResourcesPage() {
  const auth = useAuth();
  const canConfigure = auth.can('events.video.configure');
  const canManageRecording = auth.can('events.video.recording-manage');
  const canList = canConfigure || canManageRecording;

  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [page, setPage] = useState(1);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [tagOptions, setTagOptions] = useState<Array<{ tag: string; count: number }>>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ source: VideoSourceItem | null } | null>(null);
  const [deleting, setDeleting] = useState<{ source: VideoSourceItem; impact: { tabs: number; tiles: number; stopsRecording: boolean } } | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null);
  const notify = useCallback((text: string, tone: 'success' | 'error') => setNotice((n) => ({ text, tone, id: (n?.id ?? 0) + 1 })), [setNotice]);

  // reload 不是資料身分；帳號切換時也不能沿用前一位使用者的列。
  const sortParam: SourceSort = sort.desc ? `${sort.key}_desc` : sort.key;
  const queryKey = JSON.stringify({ ids: [...appliedIds].sort(), sort: sortParam, page, accountId: auth.user?.id ?? '', canList });
  const loadSources = useCallback(
    (signal: AbortSignal) => videoApi.sources({ ids: appliedIds, sort: sortParam, page, pageSize: PAGE_SIZE }, signal),
    [appliedIds, sortParam, page],
  );
  const sourceQuery = useCoalescedQuery({ enabled: canList, queryKey, load: loadSources });
  const items = sourceQuery.data?.items ?? [];
  const total = sourceQuery.data?.total ?? 0;
  const refresh = sourceQuery.refresh;
  const backgroundRefresh = sourceQuery.backgroundRefresh;
  const setSourceData = sourceQuery.setData;
  const setItems = useCallback((update: VideoSourceItem[] | ((current: VideoSourceItem[]) => VideoSourceItem[])) => {
    setSourceData((current) => ({
      ...current,
      items: typeof update === 'function' ? update(current.items) : update,
    }));
  }, [setSourceData]);
  const setTotal = useCallback((update: number | ((current: number) => number)) => {
    setSourceData((current) => ({
      ...current,
      total: typeof update === 'function' ? update(current.total) : update,
    }));
  }, [setSourceData]);

  // 選項：篩選用的來源名稱、對話框用的既有標籤；來源被刪掉時把它從選擇裡拿掉
  const applyOptions = useCallback(([opts, tags]: Awaited<ReturnType<typeof loadOptions>>) => {
    if (opts) {
      const valid = new Set(opts.items.map((o) => o.id));
      const keep = (current: string[]) => (current.every((id) => valid.has(id)) ? current : current.filter((id) => valid.has(id)));
      setSourceOptions(opts.items);
      setDraftIds(keep);
      setAppliedIds(keep);
    }
    if (tags) setTagOptions(tags);
  }, [setSourceOptions, setDraftIds, setAppliedIds, setTagOptions]);
  const refreshOptions = useCallback(() => loadOptions().then(applyOptions), [applyOptions]);
  useEffect(() => {
    if (canList) void loadOptions().then(applyOptions);
    if (canList) void videoApi.storageStatus().then(setStorage, () => undefined);
  }, [applyOptions, canList]);
  // 狀態變化（worker 探測、其他人修改）：有界地重新取得目前這一頁，不建立任何播放
  useEffect(() => {
    if (!canList) return undefined;
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes('table:video_sources')) {
        backgroundRefresh();
        void refreshOptions();
      }
    });
  }, [canList, backgroundRefresh, refreshOptions]);
  useEffect(() => {
    if (!canList) return undefined;
    const timer = window.setInterval(backgroundRefresh, 30_000);
    return () => window.clearInterval(timer);
  }, [canList, backgroundRefresh]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const replaceItem = (next: VideoSourceItem) => setItems((list) => list.map((s) => (s.id === next.id ? next : s)));

  const search = () => {
    setAppliedIds(draftIds);
    setPage(1);
  };
  const reset = () => {
    setDraftIds([]);
    setAppliedIds([]);
    setPage(1);
  };
  const toggleSort = (key: SortKey) => {
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: false }));
    setPage(1);
  };

  const askDelete = async (s: VideoSourceItem) => {
    if (!auth.require('events.video.configure')) return;
    try {
      const impact = await videoApi.deleteImpact(s.id);
      setDeleting({ source: s, impact });
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };

  const openStorage = async () => {
    try {
      setStorage(await videoApi.storageStatus());
      setStorageOpen(true);
    } catch (reason) {
      notify((reason as Error).message, 'error');
    }
  };

  const tagSuggestions = useMemo(() => tagOptions.map((t) => t.tag), [tagOptions]);
  const filterOptions = useMemo(() => sourceOptions.map((o) => ({ value: o.id, label: o.name })), [sourceOptions]);
  const draftNames = draftIds.map((id) => sourceOptions.find((o) => o.id === id)?.name ?? id);
  const filtered = appliedIds.length > 0;
  const th = 'px-5 py-4 font-normal';

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-4 text-text-primary">
      <div className="flex flex-wrap items-center gap-3">
        <SiteMultiSelect
          ariaLabel="選擇影像來源"
          allLabel="選擇影像來源"
          values={draftIds}
          options={filterOptions}
          onChange={setDraftIds}
          hideAllOption
          maxSelections={200}
          filterPlaceholder="搜尋影像來源"
          emptyLabel="還沒有影像來源"
          triggerLabel={draftNames.length ? draftNames.join('、') : undefined}
          className="w-[15.5rem]"
        />
        <IconButton label="搜尋" icon={<Search />} disabled={sameIds(draftIds, appliedIds)} onPress={search} />
        <Button variant="outlined" leadingIcon={<RotateCw />} disabled={!draftIds.length && !appliedIds.length} onPress={reset}>重置</Button>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button hierarchy={storage?.paused ? 'danger' : 'superior'} variant="outlined" leadingIcon={<Save />} onPress={() => void openStorage()}>
            {storage?.paused ? `錄影暫停：${storage.paused.reason}` : '錄影儲存狀態'}
          </Button>
          <Button leadingIcon={<Plus />} onPress={() => auth.require('events.video.configure') && setDialog({ source: null })}>
            新增來源
          </Button>
        </div>
      </div>
      {!canList ? (
        <div className="flex flex-1 items-center justify-center text-body-s text-text-tertiary">權限不足</div>
      ) : (
        <>
          {sourceQuery.refreshing ? <div role="status" className="text-body-xs text-text-theme">背景更新中，仍顯示目前資料…</div> : null}
          {sourceQuery.backgroundError ? (
            <div role="alert" className="rounded-lg border border-status-warning-light bg-status-warning-light px-3 py-2 text-body-xs text-status-warning">
              背景更新失敗，已保留目前資料：{sourceQuery.backgroundError}
              <Button variant="text" className="ml-2" onPress={refresh}>重試</Button>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <table className="w-full min-w-[56rem] table-fixed text-left text-body-m">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface-sub-background text-text-tertiary">
                <tr className="border-b border-border-quaternary">
                  <th className={th} aria-sort={sort.key === 'name' ? (sort.desc ? 'descending' : 'ascending') : undefined}><SortHeader label="影像名稱" active={sort.key === 'name'} desc={sort.desc} onSort={() => toggleSort('name')} /></th>
                  <th className={th}>來源標籤</th>
                  <th className={th}>載具/位置</th>
                  <th className={th}>啟用狀態</th>
                  <th className={th} aria-sort={sort.key === 'status' ? (sort.desc ? 'descending' : 'ascending') : undefined}><SortHeader label="連線狀態" active={sort.key === 'status'} desc={sort.desc} onSort={() => toggleSort('status')} /></th>
                  <th className={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const online = onlineBadge(s);
                  const rec = recordingBadge(s);
                  const statusTip = [s.actualStatus.reason, `錄影：${rec.text}`, s.connection?.maskedUrl].filter(Boolean).join('\n');
                  return (
                    <tr key={s.id} className={cn('border-b border-border-quaternary', highlight === s.id && 'bg-surface-theme-light')}>
                      <td className="px-5 py-3"><span className="block truncate" title={s.name}>{s.name}</span></td>
                      <td className="px-5 py-3"><span className="block truncate" title={s.tags.join('、')}>{s.tags.length ? s.tags.join('、') : <span className="text-text-disabled">—</span>}</span></td>
                      <td className="px-5 py-3"><span className="block truncate">{[s.vehicleCode, s.location].filter(Boolean).join('・') || <span className="text-text-disabled">—</span>}</span></td>
                      <td className="px-5 py-3"><Badge size="md" tone={s.enabled ? 'theme' : 'neutral'}>{s.enabled ? '啟用' : '未啟用'}</Badge></td>
                      <td className="px-5 py-3"><span title={statusTip}><Badge size="md" tone={ONLINE_TONE[online.tone]}>{online.text}</Badge></span></td>
                      <td className="px-5 py-2">
                        <div className="flex items-center gap-1">
                          <IconButton size="small" hierarchy="subordinate" variant="standard" label={`編輯 ${s.name}`} icon={<Pencil />} onPress={() => auth.require('events.video.configure') && setDialog({ source: s })} />
                          <IconButton size="small" hierarchy="subordinate" variant="standard" label={`刪除 ${s.name}`} icon={<Trash2 />} onPress={() => void askDelete(s)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sourceQuery.initialError ? (
              <div role="alert" className="py-14 text-center text-body-s text-status-error-emphasis">
                {sourceQuery.initialError}
                <Button variant="text" className="ml-3" onPress={refresh}>重試</Button>
              </div>
            ) : !items.length && sourceQuery.initialLoading ? (
              <div className="py-14 text-center text-body-s text-text-quaternary">載入中…</div>
            ) : !items.length ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-14 text-center text-text-secondary">
                <p className="text-headline-4">( ¯ㄴ¯ )ง</p>
                <p className="text-body-m">{filtered ? '沒有符合的影像來源' : '尚未新增影像來源'}</p>
              </div>
            ) : null}
          </div>
          {total > PAGE_SIZE ? <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} className="justify-center" /> : null}
        </>
      )}

      {dialog ? (
        <SourceDialog
          source={dialog.source}
          tagSuggestions={tagSuggestions}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            const isNew = !dialog.source;
            setDialog(null);
            if (isNew) {
              setItems((list) => [saved, ...list.filter((x) => x.id !== saved.id)]);
              setTotal((t) => t + 1);
              setHighlight(saved.id);
            } else replaceItem(saved);
            void refreshOptions();
            notify(isNew ? `已新增「${saved.name}」${saved.recordingEnabled ? '，啟用後由伺服器持續錄影' : ''}` : `已儲存「${saved.name}」`, 'success');
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog
          title="刪除影像來源"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button hierarchy="subordinate" variant="standard" onPress={() => setDeleting(null)}>取消</Button>
              <Button
                hierarchy="danger"
                onPress={() => {
                  const d = deleting;
                  setDeleting(null);
                  void videoApi.deleteSource(d.source.id, d.source.version).then(
                    () => { notify(`已刪除「${d.source.name}」；已錄的影片仍可在歷史影像紀錄查詢`, 'success'); refresh(); void refreshOptions(); },
                    (reason: Error) => notify(reason.message, 'error'),
                  );
                }}
              >
                刪除
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-body-s text-text-secondary">
            <p>確定刪除「{deleting.source.name}」？</p>
            <ul className="list-disc space-y-1 pl-5 text-text-tertiary">
              <li>{deleting.impact.tabs ? `${deleting.impact.tabs} 個監控分頁（${deleting.impact.tiles} 個視窗）引用這個來源：視窗保留位置，顯示「來源已刪除」，可重新選擇。` : '沒有監控分頁引用這個來源。'}</li>
              <li>{deleting.impact.stopsRecording ? '會停止這個來源的錄影（完成目前片段）。' : '這個來源目前沒有錄影。'}</li>
              <li>已錄的影片與稽核紀錄保留，仍可從「歷史影像紀錄」查詢；刪除影片需要另外的權限。</li>
            </ul>
          </div>
        </Dialog>
      ) : null}
      {storageOpen && storage ? (
        <StorageDialog status={storage} timeZone="Asia/Taipei" onClose={() => setStorageOpen(false)} onChanged={(next) => { setStorage(next); notify('已儲存錄影設定', 'success'); }} />
      ) : null}
      {notice ? <Toast key={notice.id} text={notice.text} tone={notice.tone} /> : null}
    </div>
  );
}
