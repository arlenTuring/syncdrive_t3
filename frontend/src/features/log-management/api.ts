import { downloadCsv, getJson } from '../event-log-shared/api';

export type LogCategory = 'system' | 'permissions' | 'operations' | 'authentication';

type Named = { id: string | null; name: string | null; nameSource: 'snapshot' | 'current' | 'unknown' | 'system' };

export type LogItem = {
  id: string;
  occurredAt: number;
  sourceIp: string | null;
  category: LogCategory;
  type: string;
  typeLabel: string;
  operator: Named;
  target: (Named & { type: string | null; typeLabel: string | null }) | null;
  content: string;
  result: string;
  resultLabel: string;
};

export type LogDetail = LogItem & {
  detail?: unknown;
  failureReason?: string | null;
  correlationId?: string | null;
  userAgent?: string | null;
  targetVehicle?: string | null;
  accountName?: string;
  changeType?: string;
  relatedAccountId?: string | null;
  relatedRoleIds?: string[];
  before?: unknown;
  after?: unknown;
  changes?: Array<{ field: string; added?: Array<{ id: string; label: string }>; removed?: Array<{ id: string; label: string }>; before?: unknown; after?: unknown }>;
};

export type LogList = { items: LogItem[]; total: number; page: number; pageSize: number; range: { from: number; to: number }; timeZone: string };

type Opt = { value: string; label: string };
export type LogOptions = {
  accounts: Array<{ id: string; accountName: string; displayName: string; deleted: boolean }>;
  roles: Array<{ id: string; name: string }>;
  systemActions: Opt[];
  operationActions: Opt[];
  changeTypes: Opt[];
  permissionTargets: Opt[];
  loginTypes: Opt[];
  results: Opt[];
  timeZone: string;
  pageSize: number;
  exportLimit: number;
};

export type LogQuery = Record<string, string | number | undefined>;

export const fetchLogOptions = (signal?: AbortSignal) => getJson<LogOptions>('/logs/options', undefined, signal);
export const fetchLogs = (category: LogCategory, query: LogQuery, signal?: AbortSignal) => getJson<LogList>(`/logs/${category}`, query, signal);
export const fetchLog = (category: LogCategory, id: string, signal?: AbortSignal) => getJson<LogDetail>(`/logs/${category}/${encodeURIComponent(id)}`, undefined, signal);
export const exportLogs = (category: LogCategory, query: LogQuery) => downloadCsv(`/logs/${category}/export`, query);
