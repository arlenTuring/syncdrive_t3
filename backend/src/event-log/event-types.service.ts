import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../access-control/auth.service';
import { AuditService } from '../audit/audit.service';
import { ActionResult } from '../database/entities/operator-action-log.entity';
import { EventCode, Severity } from '../database/entities/security-event-log.entity';
import { DatasourceInvalidationService } from '../events/datasource-invalidation.service';

export const EVENT_TYPE_NAME_MAX = 64;
export const EVENT_TYPE_CODE_MAX = 64;
export const EVENT_TYPE_SOP_TEXT_MAX = 100;
export const EVENT_TYPE_SOP_URL_MAX = 500;
const CODE_PATTERN = /^[A-Za-z0-9_]+$/;
const SEVERITIES = Object.values(Severity) as string[];

/** 表格還沒建立時（尚未跑 migration）退回的內建名稱 */
export const BUILT_IN_EVENT_LABEL: Record<string, string> = {
  UNSCHEDULED_DOOR_OPEN: '非預期開門',
  OBSTACLE_DETECTED: '偵測到障礙物',
  PATH_BLOCKED: '路徑受阻',
  DIRECTION_VIOLATION: '行向偏離',
  INTERLOCK_REQ: '路口聯鎖請求',
  SYSTEM_HEALTH_DEGRADED: '車載系統健康度下降',
  TRIP_DELAYED: '班車延誤',
  SYSTEM_BACKUP_FAILED: '自動備份失敗',
};

export type EventType = {
  code: string;
  name: string;
  severity: string;
  sopText: string | null;
  sopUrl: string | null;
};

type Row = { code: string; name: string; severity: string; sop_text: string | null; sop_url: string | null };

function text(raw: unknown, label: string, max: number, required: boolean): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestException(`${label}為必填`);
    return null;
  }
  if (typeof raw !== 'string') throw new BadRequestException(`${label}必須是文字`);
  const value = raw.trim();
  if (!value) {
    if (required) throw new BadRequestException(`${label}為必填`);
    return null;
  }
  if ([...value].length > max) throw new BadRequestException(`${label}最多 ${max} 字`);
  return value;
}

/** 驗證整份事件類型清單（儲存時整份取代）；錯誤訊息標出第幾列 */
export function parseEventTypes(input: unknown): EventType[] {
  const items = (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new BadRequestException('事件類型清單格式不正確');
  if (items.length > 500) throw new BadRequestException('事件類型最多 500 筆');
  const seen = new Set<string>();
  return items.map((item, index) => {
    const row = `第 ${index + 1} 筆`;
    if (!item || typeof item !== 'object') throw new BadRequestException(`${row}格式不正確`);
    const raw = item as Record<string, unknown>;
    const unknown = Object.keys(raw).filter((key) => !['code', 'name', 'severity', 'sopText', 'sopUrl'].includes(key));
    if (unknown.length) throw new BadRequestException(`${row}有不接受的欄位：${unknown.join('、')}`);
    const code = text(raw.code, `${row}的事件類型代碼`, EVENT_TYPE_CODE_MAX, true)!;
    if (!CODE_PATTERN.test(code)) throw new BadRequestException(`${row}的事件類型代碼只能用英文字母、數字與底線`);
    const key = code.toUpperCase();
    if (seen.has(key)) throw new BadRequestException(`事件類型代碼 ${code} 重複`);
    seen.add(key);
    const name = text(raw.name, `${row}的事件名稱`, EVENT_TYPE_NAME_MAX, true)!;
    if (typeof raw.severity !== 'string' || !SEVERITIES.includes(raw.severity)) throw new BadRequestException(`${row}請選擇嚴重等級`);
    const sopText = text(raw.sopText, `${row}的建議處置 SOP 文字`, EVENT_TYPE_SOP_TEXT_MAX, false);
    const sopUrl = text(raw.sopUrl, `${row}的建議處置 SOP 連結`, EVENT_TYPE_SOP_URL_MAX, false);
    if (sopUrl) {
      let ok = false;
      try {
        ok = ['http:', 'https:'].includes(new URL(sopUrl).protocol);
      } catch {
        ok = false;
      }
      if (!ok) throw new BadRequestException(`${row}的建議處置 SOP 連結須為 http 或 https 網址`);
    }
    return { code, name, severity: raw.severity, sopText, sopUrl };
  });
}

/**
 * 事件類型管理：代碼、名稱、嚴重等級與建議處置 SOP。
 * 事件列只存代碼；畫面上的類型名稱與 SOP 都從這裡查，查不到就顯示內建名稱或代碼本身。
 */
@Injectable()
export class EventTypesService {
  private cache: Promise<Map<string, EventType>> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Optional() private readonly invalidation?: DatasourceInvalidationService,
  ) {}

  /** 代碼（不分大小寫）對應的類型定義 */
  async byCode(): Promise<Map<string, EventType>> {
    this.cache ??= this.load().catch((error: Error) => {
      this.cache = null;
      throw error;
    });
    return this.cache;
  }

  private async load(): Promise<Map<string, EventType>> {
    const map = new Map<string, EventType>();
    try {
      for (const item of await this.list()) map.set(item.code.toUpperCase(), item);
    } catch {
      // 尚未建立表格：只用內建名稱
      for (const [code, name] of Object.entries(BUILT_IN_EVENT_LABEL)) {
        map.set(code, { code, name, severity: Severity.WARNING, sopText: null, sopUrl: null });
      }
    }
    return map;
  }

  async labelOf(code: string): Promise<string> {
    return (await this.byCode()).get(code.toUpperCase())?.name ?? BUILT_IN_EVENT_LABEL[code] ?? code;
  }

  async list(): Promise<EventType[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT code, name, severity, sop_text, sop_url FROM event_type_definitions ORDER BY sort_order ASC, code ASC`,
    );
    return rows.map((row) => ({ code: row.code, name: row.name, severity: row.severity, sopText: row.sop_text, sopUrl: row.sop_url }));
  }

  /** 篩選選單：已定義的類型，加上事件裡會出現但還沒定義的內建代碼 */
  async options(): Promise<Array<{ value: string; label: string }>> {
    const map = await this.byCode();
    const result = [...map.values()].map((item) => ({ value: item.code, label: item.name }));
    for (const code of Object.values(EventCode)) {
      if (!map.has(code.toUpperCase())) result.push({ value: code, label: BUILT_IN_EVENT_LABEL[code] ?? code });
    }
    return result;
  }

  /** 整份取代（對話框按「儲存」時一次送出），同一交易寫稽核 */
  async replace(input: unknown, actor: AuthUser, client: { ip?: string; userAgent?: string | null }): Promise<EventType[]> {
    const items = parseEventTypes(input);
    const now = Date.now();
    await this.dataSource.transaction(async (manager) => {
      const before: Row[] = await manager.query(`SELECT code, name, severity, sop_text, sop_url FROM event_type_definitions`);
      await manager.query(`DELETE FROM event_type_definitions`);
      for (const [index, item] of items.entries()) {
        await manager.query(
          `INSERT INTO event_type_definitions (code, name, severity, sop_text, sop_url, sort_order, created_at, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
          [item.code, item.name, item.severity, item.sopText, item.sopUrl, index + 1, now, actor.id],
        );
      }
      const previous = new Set(before.map((row) => row.code.toUpperCase()));
      const next = new Set(items.map((item) => item.code.toUpperCase()));
      await this.audit.record(
        {
          operatorId: actor.id,
          operatorName: actor.display_name,
          sourceIp: client.ip,
          userAgent: client.userAgent ?? null,
          actionType: 'EVENT_TYPE_UPDATE',
          targetType: 'EVENT_TYPE',
          actionDetail: {
            added: items.filter((item) => !previous.has(item.code.toUpperCase())).map((item) => item.code),
            removed: before.filter((row) => !next.has(row.code.toUpperCase())).map((row) => row.code),
            total: items.length,
          },
          result: ActionResult.SUCCESS,
        },
        manager,
      );
    });
    this.cache = null;
    this.invalidation?.emitEventCenter();
    return this.list();
  }
}
