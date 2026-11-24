import { SiteSelect } from '../../components/SiteSelect';
import {
  ArrowUpDown,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search } from 'lucide-react';
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
import { Button, IconButton, Pagination } from '../../components/ui';

const PAGE_SIZE = 20;
const SELECT =
  'rounded-lg border border-border-quaternary bg-surface-primary px-3 py-2 text-body-s text-text-primary';

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
    <div className="flex min-h-0 flex-1 flex-col text-text-primary">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-quaternary px-6 py-4">
        <SiteSelect
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
        </SiteSelect>
        <SiteSelect
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
        </SiteSelect>
        <SiteSelect
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
        </SiteSelect>
        <SiteSelect
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
        </SiteSelect>
        <IconButton hierarchy="subordinate" variant="tonal" onPress={applyFilters} title={t('common.search')} label={t('common.search')} icon={<Search />} />
        <Button className="ml-auto w-fit shrink-0" onPress={() => setCreating(true)} leadingIcon={<Plus />}>{t('dispatchScheduling.create')}</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-2">
        <table className="t3-table w-full min-w-[960px] border-collapse text-body-s">
          <thead>
            <tr className="border-b border-border-quaternary text-left text-text-quaternary">
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
                <td colSpan={7} className="py-16 text-center text-text-quaternary">
                  {t('dispatchScheduling.empty')}
                </td>
              </tr>
            ) : (
              pageItems.map((row) => (
                <tr
                  key={row.dispatch_id}
                  className="border-b border-border-quaternary hover:bg-surface-primary"
                >
                  <td className="py-3 pr-4 font-medium text-text-primary">{row.dispatch_code}</td>
                  <td className="py-3 pr-4 text-text-primary">
                    {t(`dispatchScheduling.priority.${row.priority}`)}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">{row.location}</td>
                  <td className="py-3 pr-4 text-text-primary">{row.vehicle_code}</td>
                  <td className="py-3 pr-4">
                    <StatusTag
                      label={t(`dispatchScheduling.status.${row.status}`)}
                      style={DISPATCH_STATUS_TAG_STYLE[row.status]}
                    />
                  </td>
                  <td className="py-3 pr-4 font-mono text-text-tertiary">{row.created_at}</td>
                  <td className="relative py-3">
                    <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={() =>
            setOpenMenuId((prev) => (prev === row.dispatch_id ? null : row.dispatch_id))
           } title={t('common.moreActions')} label={t('common.moreActions')} icon={<MoreHorizontal />} />
                    {openMenuId === row.dispatch_id && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border-quaternary bg-[#222226] py-1 shadow-xl"
                      >
                        <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Pencil />} onPress={() => {
                            setOpenMenuId(null);
                            setEditing(row);
                            setCreating(true);
                          }}>{t('common.edit')}</Button>
                        <div className="my-1 h-px bg-link-standard-hover" />
                        <Button hierarchy="subordinate" variant="standard" className="w-full" leadingIcon={<Eye />} onPress={() => {
                            setOpenMenuId(null);
                            setReview({
                              row,
                              mode:
                                isSupervisor && row.status === 'pending_approval'
                                  ? 'approve'
                                  : 'view',
                            });
                          }}>{isSupervisor
                            ? t('dispatchScheduling.viewAndApprove')
                            : t('dispatchScheduling.view')}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex items-center justify-center border-t border-border-quaternary px-6 py-4">
        <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
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
          active ? 'text-text-secondary' : 'text-text-quaternary hover:text-text-secondary'
        }`}
      >
        {label}
        <ArrowUpDown className="size-3.5 opacity-70" />
      </button>
    </th>
  );
}
