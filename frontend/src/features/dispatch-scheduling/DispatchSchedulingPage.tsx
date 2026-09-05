import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '../../components/StatusTag';
import { VTMS_VEHICLE_POOL } from '../dashboard/constants/vtmsVehiclePool';
import { useDemoAccount } from '../schedule-management/utils/demoAccountPreference';
import { readSupervisorApprovalPreference } from '../schedule-management/utils/supervisorApprovalPreference';
import { CreateDispatchDialog } from './components/CreateDispatchDialog';
import { DispatchReviewDialog } from './components/DispatchReviewDialog';
import { reservedVehicleCodesFromRows } from './components/VehicleAssignSelect';
import { FALLBACK_DISPATCH_ITEMS } from './fallback';
import {
  DISPATCH_STATUS_TAG_STYLE,
  PRIORITY_LABEL,
  PRIORITY_SORT_ORDER,
  STATUS_LABEL,
  STATUS_SORT_ORDER,
  type DispatchCreateInput,
  type DispatchListItem,
  type DispatchPriorityKey,
  type DispatchStatusKey,
} from './types';

const PAGE_SIZE = 20;
const SELECT =
  'rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200';

type SortKey = 'priority' | 'vehicle_code' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

function formatCreatedAt(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

function compareRows(a: DispatchListItem, b: DispatchListItem, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'priority') {
    return (PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority]) * sign;
  }
  if (key === 'status') {
    return (STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]) * sign;
  }
  return a[key].localeCompare(b[key]) * sign;
}

export function DispatchSchedulingPage() {
  const { t } = useTranslation();
  const [account] = useDemoAccount();
  const isSupervisor = account.id === 'supervisor';
  const [rows, setRows] = useState<DispatchListItem[]>(FALLBACK_DISPATCH_ITEMS);
  const [priority, setPriority] = useState<DispatchPriorityKey | 'all'>('all');
  const [status, setStatus] = useState<DispatchStatusKey | 'all'>('all');
  const [vehicleCode, setVehicleCode] = useState('all');
  const [location, setLocation] = useState('all');
  const [applied, setApplied] = useState({
    priority: 'all' as DispatchPriorityKey | 'all',
    status: 'all' as DispatchStatusKey | 'all',
    vehicleCode: 'all',
    location: 'all',
  });
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DispatchListItem | null>(null);
  const [review, setReview] = useState<{
    row: DispatchListItem;
    mode: 'view' | 'approve';
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const priorityOptions = useMemo(
    () =>
      [
        { value: 'all' as const, label: t('dispatchScheduling.selectPriority') },
        ...(Object.keys(PRIORITY_LABEL) as DispatchPriorityKey[]).map((key) => ({
          value: key,
          label: t(`dispatchScheduling.priority.${key}`),
        })),
      ],
    [t],
  );

  const statusOptions = useMemo(
    () =>
      [
        { value: 'all' as const, label: t('dispatchScheduling.selectStatus') },
        ...(Object.keys(STATUS_LABEL) as DispatchStatusKey[]).map((key) => ({
          value: key,
          label: t(`dispatchScheduling.status.${key}`),
        })),
      ],
    [t],
  );

  const locations = useMemo(
    () => Array.from(new Set(rows.map((r) => r.location))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const next = rows.filter((row) => {
      if (applied.priority !== 'all' && row.priority !== applied.priority) return false;
      if (applied.status !== 'all' && row.status !== applied.status) return false;
      if (applied.vehicleCode !== 'all' && row.vehicle_code !== applied.vehicleCode) return false;
      if (applied.location !== 'all' && row.location !== applied.location) return false;
      return true;
    });
    next.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return next;
  }, [rows, applied, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

  const pageNumbers = useMemo(() => {
    const max = Math.min(5, totalPages);
    const start = Math.max(1, Math.min(page - 2, totalPages - max + 1));
    return Array.from({ length: max }, (_, i) => start + i);
  }, [page, totalPages]);

  const applyFilters = () => {
    setApplied({ priority, status, vehicleCode, location });
    setPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const upsertRow = (input: DispatchCreateInput, existing?: DispatchListItem) => {
    const needsApproval = readSupervisorApprovalPreference();
    const status: DispatchStatusKey = existing
      ? existing.status === 'pending_approval' || existing.status === 'pending'
        ? needsApproval
          ? 'pending_approval'
          : 'pending'
        : existing.status
      : needsApproval
        ? 'pending_approval'
        : 'pending';
    const item: DispatchListItem = {
      dispatch_id: existing?.dispatch_id ?? `dsp-${Date.now()}`,
      dispatch_code: input.dispatch_code,
      priority: input.priority,
      priority_label: PRIORITY_LABEL[input.priority],
      location: input.location,
      vehicle_code: input.vehicle_code,
      status,
      status_label: STATUS_LABEL[status],
      created_at: existing?.created_at ?? formatCreatedAt(),
      exec_time: input.exec_time,
      trip_minutes: input.trip_minutes,
      stations: input.stations,
    };
    setRows((prev) => {
      if (existing) {
        return prev.map((row) => (row.dispatch_id === existing.dispatch_id ? item : row));
      }
      return [item, ...prev];
    });
    return item;
  };

  const handleCreate = (input: DispatchCreateInput) => {
    const existing = editing ?? undefined;
    const item = upsertRow(input, existing);
    setCreating(false);
    setEditing(null);
    setPage(1);
    if (item.status === 'pending_approval') {
      setReview({
        row: item,
        mode: isSupervisor ? 'approve' : 'view',
      });
    } else if (item.status === 'pending') {
      setReview({ row: item, mode: 'view' });
    }
  };

  const patchStatus = (row: DispatchListItem, status: DispatchStatusKey) => {
    setRows((prev) =>
      prev.map((item) =>
        item.dispatch_id === row.dispatch_id
          ? { ...item, status, status_label: STATUS_LABEL[status] }
          : item,
      ),
    );
    setReview(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-100">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-6 py-4">
        <select
          value={priority}
          onChange={(e) => {
            const next = e.target.value as DispatchPriorityKey | 'all';
            setPriority(next);
            setApplied((prev) => ({ ...prev, priority: next }));
            setPage(1);
          }}
          className={SELECT}
        >
          {priorityOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            const next = e.target.value as DispatchStatusKey | 'all';
            setStatus(next);
            setApplied((prev) => ({ ...prev, status: next }));
            setPage(1);
          }}
          className={SELECT}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={vehicleCode}
          onChange={(e) => {
            const next = e.target.value;
            setVehicleCode(next);
            setApplied((prev) => ({ ...prev, vehicleCode: next }));
            setPage(1);
          }}
          className={SELECT}
        >
          <option value="all">{t('dispatchScheduling.selectVehicle')}</option>
          {VTMS_VEHICLE_POOL.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select
          value={location}
          onChange={(e) => {
            const next = e.target.value;
            setLocation(next);
            setApplied((prev) => ({ ...prev, location: next }));
            setPage(1);
          }}
          className={SELECT}
        >
          <option value="all">{t('dispatchScheduling.selectLocation')}</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={applyFilters}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-[#2B7FFF]/50 bg-[#2B7FFF]/15 text-[#51A2FF] transition hover:bg-[#2B7FFF]/25"
          title={t('common.search')}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-[34px] w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2B7FFF] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-white transition hover:bg-[#2569e6]"
        >
          <Plus className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
          {t('dispatchScheduling.create')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="py-3 pr-4 font-medium">{t('dispatchScheduling.columns.dispatchCode')}</th>
              <SortHeader
                label={t('dispatchScheduling.columns.priority')}
                active={sortKey === 'priority'}
                onClick={() => toggleSort('priority')}
              />
              <th className="py-3 pr-4 font-medium">{t('dispatchScheduling.columns.location')}</th>
              <SortHeader
                label={t('dispatchScheduling.columns.vehicle')}
                active={sortKey === 'vehicle_code'}
                onClick={() => toggleSort('vehicle_code')}
              />
              <SortHeader
                label={t('dispatchScheduling.columns.status')}
                active={sortKey === 'status'}
                onClick={() => toggleSort('status')}
              />
              <SortHeader
                label={t('dispatchScheduling.columns.createdAt')}
                active={sortKey === 'created_at'}
                onClick={() => toggleSort('created_at')}
              />
              <th className="w-10 py-3" />
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-zinc-500">
                  {t('dispatchScheduling.empty')}
                </td>
              </tr>
            ) : (
              pageItems.map((row) => (
                <tr
                  key={row.dispatch_id}
                  className="border-b border-zinc-800/60 hover:bg-zinc-900/50"
                >
                  <td className="py-3 pr-4 font-medium text-zinc-100">{row.dispatch_code}</td>
                  <td className="py-3 pr-4 text-zinc-200">
                    {t(`dispatchScheduling.priority.${row.priority}`)}
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{row.location}</td>
                  <td className="py-3 pr-4 text-zinc-200">{row.vehicle_code}</td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`dispatchScheduling.status.${row.status}`)}
                      style={DISPATCH_STATUS_TAG_STYLE[row.status]}
                    />
                  </td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{row.created_at}</td>
                  <td className="relative py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenuId((prev) => (prev === row.dispatch_id ? null : row.dispatch_id))
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title={t('common.moreActions')}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                    {openMenuId === row.dispatch_id && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-zinc-700 bg-[#222226] py-1 shadow-xl"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setEditing(row);
                            setCreating(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
                        >
                          <Pencil className="size-4 text-zinc-400" />
                          {t('common.edit')}
                        </button>
                        <div className="my-1 h-px bg-zinc-700/80" />
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuId(null);
                            setReview({
                              row,
                              mode:
                                isSupervisor && row.status === 'pending_approval'
                                  ? 'approve'
                                  : 'view',
                            });
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
                        >
                          <Eye className="size-4 text-zinc-400" />
                          {isSupervisor
                            ? t('dispatchScheduling.viewAndApprove')
                            : t('dispatchScheduling.view')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-center gap-2 border-t border-zinc-800/80 px-6 py-4">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            className={`inline-flex size-8 items-center justify-center rounded-full text-sm ${
              n === page
                ? 'bg-[#2B7FFF]/20 text-[#51A2FF] ring-1 ring-[#2B7FFF]/40'
                : 'text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </footer>

      {creating ? (
        <CreateDispatchDialog
          existingCodes={rows
            .filter((row) => row.dispatch_id !== editing?.dispatch_id)
            .map((row) => row.dispatch_code)}
          reservedVehicleCodes={reservedVehicleCodesFromRows(rows)}
          editing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onCreate={handleCreate}
        />
      ) : null}
      {review ? (
        <DispatchReviewDialog
          row={review.row}
          mode={review.mode}
          onClose={() => setReview(null)}
          onApprove={(row) => patchStatus(row, 'pending')}
          onReject={(row) => patchStatus(row, 'rejected')}
          onWithdraw={(row) => patchStatus(row, 'withdrawn')}
        />
      ) : null}
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="py-3 pr-4 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${
          active ? 'text-zinc-300' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        {label}
        <ArrowUpDown className="size-3.5 opacity-70" />
      </button>
    </th>
  );
}
