import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AUDIT_ACTIONS, TARGET_TYPE_LABEL, auditInfo, redact } from '../audit/audit-catalog';
import { SystemFoundationSettingsService } from '../system-health/system-foundation-settings.service';
import { formatInZone, toCsv, type CsvColumn } from './csv';
import { DEFAULT_TIME_ZONE, EXPORT_LIMIT, LOG_PAGE_SIZE } from './event-log.constants';
import { enumParam, likePattern, pageParams, rangeParams, rejectUnknown, textParam } from './query-params';

export const LOG_CATEGORIES = ['system', 'permissions', 'operations', 'authentication'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

const RESULTS = ['SUCCESS', 'FAILED', 'REJECTED'] as const;
const RESULT_LABEL: Record<string, string> = { SUCCESS: '成功', FAILED: '失敗', REJECTED: '被拒' };
const CHANGE_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'GRANT', 'REVOKE'] as const;
const CHANGE_LABEL: Record<string, string> = { CREATE: '新增', UPDATE: '修改', DELETE: '刪除', GRANT: '授予', REVOKE: '撤銷' };
const PERM_TARGETS = ['ACCOUNT', 'ROLE', 'PERMISSION', 'ACCOUNT_ROLE', 'ROLE_PERMISSION'] as const;
const PERM_TARGET_LABEL: Record<string, string> = { ACCOUNT: '帳號', ROLE: '角色', PERMISSION: '權限', ACCOUNT_ROLE: '帳號角色', ROLE_PERMISSION: '角色權限' };
const LOGIN_TYPES = ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] as const;
const LOGIN_LABEL: Record<string, string> = { LOGIN: '登入系統', LOGOUT: '登出系統', LOGIN_FAILED: '登入失敗' };
const SPECIAL_OPERATOR: Record<string, string> = { system: '系統（自動）', 'external-api': '外部整合（API 金鑰）', anonymous: '未登入' };

const COMMON_KEYS = ['from', 'to', 'page', 'pageSize', 'direction'];
const CATEGORY_KEYS: Record<LogCategory, string[]> = {
  system: [...COMMON_KEYS, 'operator', 'actionType', 'result', 'keyword'],
  operations: [...COMMON_KEYS, 'operator', 'actionType', 'result', 'vehicleCode', 'keyword'],
  permissions: [...COMMON_KEYS, 'account', 'role', 'changeType', 'targetType', 'keyword'],
  authentication: [...COMMON_KEYS, 'account', 'eventType', 'ip'],
};

type NameSource = 'snapshot' | 'current' | 'unknown' | 'system';
type Named = { id: string | null; name: string | null; nameSource: NameSource };

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 日誌管理模組：四類日誌各自查自己的表，查詢與匯出共用同一條件建構器。
 * 日誌唯讀：沒有修改／刪除 API；查詢不產生新的稽核（只有匯出記一次）。
 * 名稱以操作當時的快照為準；沒有快照時標示「目前名稱」或「未知」，不追溯捏造。
 */
@Injectable()
export class LogsService {
  constructor(private readonly dataSource: DataSource, @Optional() private readonly settings?: SystemFoundationSettingsService) {}

  async timeZone() {
    try {
      return (await this.settings?.get())?.locale?.timeZone || DEFAULT_TIME_ZONE;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  }

  category(raw: string): LogCategory {
    if (!(LOG_CATEGORIES as readonly string[]).includes(raw)) throw new NotFoundException('沒有這一類日誌');
    return raw as LogCategory;
  }

  private build(category: LogCategory, query: Record<string, unknown>) {
    rejectUnknown(query, CATEGORY_KEYS[category]);
    const { from, to } = rangeParams(query.from, query.to);
    const direction = enumParam(query.direction, ['asc', 'desc'] as const, '排序方向') ?? 'desc';
    const params: unknown[] = [from, to];
    const clauses = ['l.created_at >= $1', 'l.created_at < $2'];
    const add = (sql: string, ...values: unknown[]) => {
      let out = sql;
      for (const value of values) {
        params.push(value);
        out = out.replace('?', `$${params.length}`);
      }
      clauses.push(out);
    };
    const keyword = textParam(query.keyword, '關鍵字', 60);
    let table: string;
    if (category === 'system' || category === 'operations') {
      table = 'operator_action_logs';
      add('l.category = ?', category === 'system' ? 'SYSTEM' : 'OPERATIONS');
      const codes = Object.entries(AUDIT_ACTIONS).filter(([, v]) => v.category === (category === 'system' ? 'SYSTEM' : 'OPERATIONS')).map(([k]) => k);
      const actionType = enumParam(query.actionType, codes, '操作類型');
      if (actionType) add('l.action_type = ?', actionType);
      const result = enumParam(query.result, RESULTS, '結果');
      if (result) add('l.result::text = ?', result);
      const operator = textParam(query.operator, '使用者', 64);
      if (operator) add('l.operator_id = ?', operator);
      if (category === 'operations') {
        const vehicle = textParam(query.vehicleCode, '載具', 64);
        if (vehicle) add("(upper(l.target_vehicle) = upper(?) OR (l.target_type = 'VEHICLE' AND upper(l.target_id) = upper(?)))", vehicle, vehicle);
      }
      if (keyword) add('(l.operator_name_snapshot ILIKE ? OR l.target_name_snapshot ILIKE ? OR l.target_id ILIKE ? OR l.action_type ILIKE ?)', ...Array(4).fill(likePattern(keyword)));
    } else if (category === 'permissions') {
      table = 'permission_change_logs';
      const account = textParam(query.account, '相關使用者', 64);
      if (account) add('(l.related_account_id = ? OR l.operator_id = ?)', account, account);
      const role = textParam(query.role, '角色', 64);
      if (role) add('l.related_role_ids @> ARRAY[?]::varchar(64)[]', role);
      const changeType = enumParam(query.changeType, CHANGE_TYPES, '異動類型');
      if (changeType) add('l.change_type::text = ?', changeType);
      const targetType = enumParam(query.targetType, PERM_TARGETS, '異動對象類型');
      if (targetType) add('l.target_type::text = ?', targetType);
      if (keyword) add('(l.operator_name_snapshot ILIKE ? OR l.target_name_snapshot ILIKE ?)', likePattern(keyword), likePattern(keyword));
    } else {
      table = 'login_logs';
      const account = textParam(query.account, '帳號', 64);
      if (account) add(UUID.test(account) ? 'l.account_id = ?' : 'lower(l.account_name) = lower(?)', account);
      const eventType = enumParam(query.eventType, LOGIN_TYPES, '紀錄類型');
      if (eventType) add('l.event_type::text = ?', eventType);
      const ip = textParam(query.ip, '來源 IP', 64);
      if (ip) add('l.source_ip = ?', ip);
    }
    const dir = direction === 'asc' ? 'ASC' : 'DESC';
    return { table, where: clauses.join(' AND '), params, order: `l.created_at ${dir}, l.id ${dir}`, from, to };
  }

  private columns(category: LogCategory) {
    if (category === 'system' || category === 'operations') {
      return `l.id::text AS id, l.created_at, l.source_ip, l.action_type AS type, l.operator_id, l.operator_name_snapshot,
        l.target_type, l.target_id, l.target_name_snapshot, l.target_vehicle, l.result::text AS result`;
    }
    if (category === 'permissions') {
      return `l.id::text AS id, l.created_at, l.source_ip, l.change_type::text AS type, l.operator_id, l.operator_name_snapshot,
        l.target_type::text AS target_type, l.target_id, l.target_name_snapshot, NULL AS target_vehicle, 'SUCCESS' AS result`;
    }
    return `l.id::text AS id, l.created_at, l.source_ip, l.event_type::text AS type, l.account_id AS operator_id, l.account_name AS operator_name_snapshot,
      NULL AS target_type, NULL AS target_id, NULL AS target_name_snapshot, NULL AS target_vehicle,
      CASE WHEN l.event_type::text = 'LOGIN_FAILED' THEN 'FAILED' ELSE 'SUCCESS' END AS result`;
  }

  async list(categoryRaw: string, query: Record<string, unknown>) {
    const category = this.category(categoryRaw);
    const q = this.build(category, query);
    const { page, pageSize } = pageParams(query.page, query.pageSize, LOG_PAGE_SIZE);
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(`SELECT ${this.columns(category)} FROM ${q.table} l WHERE ${q.where} ORDER BY ${q.order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, q.params),
      this.dataSource.query(`SELECT count(*)::int AS total FROM ${q.table} l WHERE ${q.where}`, q.params),
    ]);
    return { items: await this.present(category, rows), total: Number(total), page, pageSize, range: { from: q.from, to: q.to }, timeZone: await this.timeZone() };
  }

  /** 一頁一次批次補目前名稱（沒有快照時），不逐列查詢 */
  private async present(category: LogCategory, rows: Array<Record<string, any>>): Promise<LogItem[]> {
    const accountIds = new Set<string>();
    const roleIds = new Set<string>();
    const vehicleCodes = new Set<string>();
    for (const row of rows) {
      if (!row.operator_name_snapshot && row.operator_id && UUID.test(row.operator_id)) accountIds.add(row.operator_id);
      if (!row.target_name_snapshot && row.target_id) {
        if (row.target_type === 'VEHICLE') vehicleCodes.add(row.target_id);
        if ((row.target_type === 'ACCOUNT' || row.target_type === 'ACCOUNT_ROLE') && UUID.test(row.target_id)) accountIds.add(row.target_id);
        if ((row.target_type === 'ROLE' || row.target_type === 'ROLE_PERMISSION') && UUID.test(row.target_id)) roleIds.add(row.target_id);
      }
    }
    const [accounts, roles, vehicles] = await Promise.all([
      accountIds.size ? this.dataSource.query(`SELECT id::text, display_name, account_name, deleted_at FROM accounts WHERE id::text = ANY($1)`, [[...accountIds]]) : [],
      roleIds.size ? this.dataSource.query(`SELECT id::text, display_name FROM roles WHERE id::text = ANY($1)`, [[...roleIds]]) : [],
      vehicleCodes.size ? this.dataSource.query(`SELECT DISTINCT ON (upper(vehicle_code)) upper(vehicle_code) AS code, display_name FROM vehicles WHERE upper(vehicle_code) = ANY($1) ORDER BY upper(vehicle_code), is_active DESC`, [[...vehicleCodes].map((c) => c.toUpperCase())]) : [],
    ]);
    const accountName = new Map<string, string>(accounts.map((a: any) => [a.id, `${a.display_name}（${a.account_name}）${a.deleted_at ? '［已刪除］' : ''}`]));
    const roleName = new Map<string, string>(roles.map((r: any) => [r.id, r.display_name]));
    const vehicleName = new Map<string, string>(vehicles.map((v: any) => [v.code, v.display_name?.trim() || v.code]));

    return rows.map((row) => {
      const operator: Named = SPECIAL_OPERATOR[row.operator_id]
        ? { id: row.operator_id, name: SPECIAL_OPERATOR[row.operator_id], nameSource: 'system' }
        : row.operator_name_snapshot
          ? { id: row.operator_id, name: row.operator_name_snapshot, nameSource: 'snapshot' }
          : accountName.has(row.operator_id)
            ? { id: row.operator_id, name: accountName.get(row.operator_id)!, nameSource: 'current' }
            : { id: row.operator_id, name: null, nameSource: 'unknown' };
      let target: LogItem['target'] = null;
      if (row.target_type || row.target_id) {
        const current = row.target_type === 'VEHICLE' ? vehicleName.get(String(row.target_id).toUpperCase())
          : row.target_type === 'ROLE' || row.target_type === 'ROLE_PERMISSION' ? roleName.get(row.target_id)
          : row.target_type === 'ACCOUNT' || row.target_type === 'ACCOUNT_ROLE' ? accountName.get(row.target_id) : undefined;
        target = {
          type: row.target_type,
          typeLabel: (category === 'permissions' ? PERM_TARGET_LABEL[row.target_type] : TARGET_TYPE_LABEL[row.target_type]) ?? row.target_type,
          id: row.target_id,
          name: row.target_name_snapshot ?? current ?? null,
          nameSource: row.target_name_snapshot ? 'snapshot' : current ? 'current' : 'unknown',
        };
      }
      const typeLabel = category === 'permissions' ? CHANGE_LABEL[row.type] ?? row.type
        : category === 'authentication' ? LOGIN_LABEL[row.type] ?? row.type
        : auditInfo(row.type)?.label ?? row.type;
      const who = operator.name ?? `未知使用者（${operator.id ?? '—'}）`;
      const what = target ? `${target.typeLabel ?? ''}「${target.name ?? target.id ?? '—'}」` : '';
      const content = category === 'authentication'
        ? `${who} ${typeLabel}`
        : `${who} 對 ${what || '系統'} 進行了 ${typeLabel}${row.result !== 'SUCCESS' ? `（${RESULT_LABEL[row.result] ?? row.result}）` : ''}`;
      return {
        id: row.id,
        occurredAt: Number(row.created_at),
        sourceIp: row.source_ip ?? null,
        category,
        type: row.type,
        typeLabel,
        operator,
        target,
        content,
        result: row.result,
        resultLabel: RESULT_LABEL[row.result] ?? row.result,
      };
    });
  }

  async detail(categoryRaw: string, id: string) {
    const category = this.category(categoryRaw);
    if (!UUID.test(id)) throw new NotFoundException('找不到日誌');
    const table = category === 'permissions' ? 'permission_change_logs' : category === 'authentication' ? 'login_logs' : 'operator_action_logs';
    const extraWhere = category === 'system' ? ` AND l.category = 'SYSTEM'` : category === 'operations' ? ` AND l.category = 'OPERATIONS'` : '';
    const [row] = await this.dataSource.query(`SELECT l.*, ${this.columns(category)} FROM ${table} l WHERE l.id = $1::uuid${extraWhere}`, [id]);
    if (!row) throw new NotFoundException('找不到日誌（可能不屬於這一類）');
    const [item] = await this.present(category, [row]);
    if (category === 'system' || category === 'operations') {
      return {
        ...item,
        detail: redact(row.action_detail),
        failureReason: row.failure_reason,
        correlationId: row.correlation_id,
        userAgent: row.user_agent,
        targetVehicle: row.target_vehicle,
      };
    }
    if (category === 'permissions') return { ...item, ...(await this.permissionDiff(row)) };
    return { ...item, accountName: row.account_name, accountId: row.account_id, userAgent: row.user_agent, failureReason: row.failure_reason };
  }

  /** 異動前後差異：陣列列出新增／移除（附可讀名稱，ID 保留）；其他欄位列出前後值。新增沒有 before、刪除沒有 after。 */
  private async permissionDiff(row: Record<string, any>) {
    const before = (redact(row.before_value) ?? null) as Record<string, any> | null;
    const after = (redact(row.after_value) ?? null) as Record<string, any> | null;
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => k !== 'permission_codes');
    const roleIds = new Set<string>();
    const permIds = new Set<string>();
    for (const value of [before, after]) {
      (value?.role_ids ?? []).forEach((id: string) => roleIds.add(id));
      (value?.permission_ids ?? []).forEach((id: string) => permIds.add(id));
    }
    const [roles, perms] = await Promise.all([
      roleIds.size ? this.dataSource.query(`SELECT id::text, display_name FROM roles WHERE id::text = ANY($1)`, [[...roleIds]]) : [],
      permIds.size ? this.dataSource.query(`SELECT id::text, permission_code, display_name, module FROM permissions WHERE id::text = ANY($1)`, [[...permIds]]) : [],
    ]);
    const roleName = new Map<string, string>(roles.map((r: any) => [r.id, r.display_name]));
    const codeIn = (value: Record<string, any> | null, id: string) => {
      const idx = (value?.permission_ids ?? []).indexOf(id);
      return idx >= 0 ? value?.permission_codes?.[idx] ?? null : null;
    };
    const permName = new Map<string, string>(perms.map((p: any) => [p.id, `${p.module}／${p.display_name}（${p.permission_code}）`]));
    const label = (key: string, id: string) =>
      key === 'role_ids' ? roleName.get(id) ?? '（角色已刪除或未知）'
        : key === 'permission_ids' ? permName.get(id) ?? (codeIn(before, id) || codeIn(after, id) || '（權限未知）') : id;
    const changes = keys.map((key) => {
      const b = before?.[key];
      const a = after?.[key];
      if (Array.isArray(b) || Array.isArray(a)) {
        const bs = new Set((b ?? []) as string[]);
        const as = new Set((a ?? []) as string[]);
        return {
          field: key,
          added: [...as].filter((x) => !bs.has(x)).map((id) => ({ id, label: label(key, id) })),
          removed: [...bs].filter((x) => !as.has(x)).map((id) => ({ id, label: label(key, id) })),
        };
      }
      return { field: key, before: b ?? null, after: a ?? null };
    });
    return {
      changeType: row.change_type,
      targetType: row.target_type,
      relatedAccountId: row.related_account_id,
      relatedRoleIds: row.related_role_ids ?? [],
      before,
      after,
      changes,
    };
  }

  async exportCsv(categoryRaw: string, query: Record<string, unknown>) {
    const category = this.category(categoryRaw);
    const q = this.build(category, { ...query, page: undefined, pageSize: undefined });
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(`SELECT ${this.columns(category)}, l.failure_reason FROM ${q.table} l WHERE ${q.where} ORDER BY ${q.order} LIMIT ${EXPORT_LIMIT}`, q.params),
      this.dataSource.query(`SELECT count(*)::int AS total FROM ${q.table} l WHERE ${q.where}`, q.params),
    ]);
    const items = await this.present(category, rows);
    const failure = new Map<string, string | null>(rows.map((r: any) => [r.id, r.failure_reason ?? null]));
    const tz = await this.timeZone();
    const columns: CsvColumn<LogItem>[] = [
      { header: '日誌編號', value: (r) => r.id, raw: true },
      { header: `時間（${tz}）`, value: (r) => formatInZone(r.occurredAt, tz) },
      { header: '時間epoch毫秒', value: (r) => r.occurredAt, raw: true },
      { header: '來源IP', value: (r) => r.sourceIp, raw: true },
      { header: '日誌類型代碼', value: (r) => r.type, raw: true },
      { header: '日誌類型', value: (r) => r.typeLabel },
      { header: '操作者ID', value: (r) => r.operator.id, raw: true },
      { header: '操作者', value: (r) => r.operator.name },
      { header: '目標類型', value: (r) => r.target?.typeLabel ?? '' },
      { header: '目標ID', value: (r) => r.target?.id ?? '', raw: true },
      { header: '目標名稱', value: (r) => r.target?.name ?? '' },
      { header: '名稱依據', value: (r) => [r.operator.nameSource, r.target?.nameSource].filter(Boolean).join('/') },
      { header: '內容', value: (r) => r.content },
      { header: '結果', value: (r) => r.resultLabel },
      { header: '失敗原因', value: (r) => failure.get(r.id) ?? '' },
    ];
    return { csv: toCsv(items, columns), total: Number(total), exported: items.length, timeZone: tz };
  }

  /** 篩選選項：帳號（含已刪除）、角色、操作類型；日誌頁不需要帳號管理權限也能用 */
  async options() {
    const [accounts, roles] = await Promise.all([
      this.dataSource.query(`SELECT id::text, account_name, display_name, deleted_at IS NOT NULL AS deleted FROM accounts ORDER BY account_name`),
      this.dataSource.query(`SELECT id::text, display_name FROM roles ORDER BY display_name`),
    ]);
    const actions = (category: 'SYSTEM' | 'OPERATIONS') =>
      Object.entries(AUDIT_ACTIONS).filter(([, v]) => v.category === category).map(([value, v]) => ({ value, label: v.label }));
    return {
      accounts: accounts.map((a: any) => ({ id: a.id, accountName: a.account_name, displayName: a.display_name, deleted: a.deleted })),
      roles: roles.map((r: any) => ({ id: r.id, name: r.display_name })),
      systemActions: actions('SYSTEM'),
      operationActions: actions('OPERATIONS'),
      changeTypes: CHANGE_TYPES.map((value) => ({ value, label: CHANGE_LABEL[value] })),
      permissionTargets: PERM_TARGETS.map((value) => ({ value, label: PERM_TARGET_LABEL[value] })),
      loginTypes: LOGIN_TYPES.map((value) => ({ value, label: LOGIN_LABEL[value] })),
      results: RESULTS.map((value) => ({ value, label: RESULT_LABEL[value] })),
      timeZone: await this.timeZone(),
      pageSize: LOG_PAGE_SIZE,
      exportLimit: EXPORT_LIMIT,
    };
  }
}

export function assertNever(value: never): never {
  throw new BadRequestException(`未知分類：${String(value)}`);
}
