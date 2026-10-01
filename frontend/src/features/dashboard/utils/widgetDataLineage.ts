import type { CanvasElementProps, ChildWidget, GroupDataSource } from '../types';
import { MAINLINE_ROW_FIELD_ORIGINS } from './mainlineTaskModel';
import { MAINTENANCE_ROW_FIELD_ORIGINS } from './maintenanceTaskModel';

/**
 * 元件的資料從哪裡來——屬性面板「資料來源」卡片與全元件盤點腳本共用這一份判斷。
 *
 * 判斷只看元件與群組<strong>存下來的綁定</strong>，跟執行時元件實際拿資料的欄位一一對應
 * （SQL：dataSourceId＋sqlQuery；REST：dataUrl；MQTT：mqttDataSourceId＋mqttTopic；
 * 群組列：子元件內容裡的 {欄位}）。執行時沒有任何依元件名稱或文字內容偷換來源的規則，
 * 所以這裡說的就是實際跑的。
 */

export type LineageSourceKind = 'sql' | 'rest' | 'mqtt';

export interface LineageSource {
  kind: LineageSourceKind;
  /** SQL／MQTT 的資料來源 id；REST 為空 */
  dataSourceId?: string;
  /** SQL 查詢、REST 網址或 MQTT 主題 */
  target: string;
  /** MQTT JSON 路徑 */
  path?: string;
  /** 群組來源的名稱（泛用群組來源才有） */
  label?: string;
  /** 群組來源掛的後處理（例如依 MQTT 疊加即時欄位） */
  postProcessId?: string;
}

export interface LineageField {
  name: string;
  /** 前端依即時資料覆寫這個欄位時的說明；沒有就是來源原樣給的欄位 */
  derivedFrom?: string;
}

export type LineageStatus =
  /** 自己綁了資料來源 */
  | 'own'
  /** 讀群組每一列的欄位 */
  | 'group-row'
  /** 自己綁了，也讀群組列（例如 MQTT 主題裡用 ${vehicle_code}） */
  | 'own+group-row'
  /** 沒有任何資料來源：畫面上的字是寫死的 */
  | 'static'
  /** 固定標題文字（沒有數字、不是資料型元件），本來就不需要資料來源 */
  | 'label'
  /** 純樣式元件（色塊、圖片、時鐘），不顯示資料 */
  | 'decorative';

export interface WidgetDataLineage {
  status: LineageStatus;
  own: LineageSource[];
  group?: {
    id: string;
    label: string;
    sources: LineageSource[];
  };
  /** 元件讀的群組列欄位 */
  fields: LineageField[];
  /** 寫死在元件上的文字（status 為 static 時是畫面上那段字） */
  staticText?: string;
  /** 綁定設定不完整的地方 */
  problems: string[];
}

const DECORATIVE_TYPES = new Set<ChildWidget['type']>(['color-block', 'image', 'clock', 'empty-state', 'map-canvas']);
const TOKEN_RE = /\$?\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const IDENT_RE = /^\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;
/** 這些屬性的值是「欄位名」：元件從資料列讀這個欄位 */
const FIELD_KEY_RE = /(Field|VarKey|Var|VarName)$/;
/** 不是資料欄位、只是元件設定的鍵 */
const NON_FIELD_KEYS = new Set(['iteratorField', 'variableName', 'slotKeyField']);

function collectFieldRefs(value: unknown, key: string | null, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TOKEN_RE)) out.add(match[1]);
    if (key && FIELD_KEY_RE.test(key) && !NON_FIELD_KEYS.has(key)) {
      const ident = value.trim().match(IDENT_RE);
      if (ident) out.add(ident[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldRefs(item, key, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (childKey === 'children' || childKey === 'id') continue;
      collectFieldRefs(child, childKey, out);
    }
  }
}

/** 元件引用的欄位名（{欄位}、${欄位}、xxxField／xxxVarKey 屬性） */
export function widgetFieldRefs(widget: ChildWidget): string[] {
  const out = new Set<string>();
  collectFieldRefs(widget, null, out);
  return [...out].sort();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 元件自己存的綁定 */
export function ownBindingSources(binding: {
  dataSourceId?: string;
  sqlQuery?: string;
  dataUrl?: string;
  mqttDataSourceId?: string;
  mqttTopic?: string;
  mqttValuePath?: string;
  mqttProgressPath?: string;
  label?: string;
  postProcessId?: string;
}): LineageSource[] {
  const out: LineageSource[] = [];
  const label = str(binding.label) || undefined;
  if (str(binding.dataUrl)) {
    out.push({ kind: 'rest', target: str(binding.dataUrl), label, postProcessId: binding.postProcessId });
  } else if (str(binding.sqlQuery)) {
    out.push({
      kind: 'sql',
      dataSourceId: str(binding.dataSourceId) || undefined,
      target: str(binding.sqlQuery),
      label,
      postProcessId: binding.postProcessId,
    });
  }
  if (str(binding.mqttTopic)) {
    out.push({
      kind: 'mqtt',
      dataSourceId: str(binding.mqttDataSourceId) || undefined,
      target: str(binding.mqttTopic),
      path: str(binding.mqttValuePath) || str(binding.mqttProgressPath) || undefined,
      label,
      postProcessId: binding.postProcessId,
    });
  }
  return out;
}

/** 群組每一列從哪裡來 */
export function groupRowSources(group: CanvasElementProps): LineageSource[] {
  if (group.genericGroup?.enabled) {
    return (group.genericGroup.sources ?? []).flatMap((source: GroupDataSource) => ownBindingSources(source));
  }
  return ownBindingSources(group);
}

/**
 * 某個群組列欄位若會被前端依即時資料覆寫，說明覆寫規則。
 *
 * 正線班次列套 mainline-mqtt-merge 後處理（泛用群組）或舊群組名稱就是「正線班次」時，
 * 執行畫面會用車端 MQTT operation/update 覆寫部分欄位；整備班表同理。
 */
function derivedFieldNote(group: CanvasElementProps, field: string): string | undefined {
  const sources = group.genericGroup?.enabled ? group.genericGroup.sources ?? [] : [];
  const mainline = sources.some((source) => source.postProcessId === 'mainline-mqtt-merge')
    || (!group.genericGroup?.enabled && group.label === '正線班次');
  if (mainline && MAINLINE_ROW_FIELD_ORIGINS[field]) return MAINLINE_ROW_FIELD_ORIGINS[field];
  const maintenance = !group.genericGroup?.enabled && group.label === '整備班表';
  if (maintenance && MAINTENANCE_ROW_FIELD_ORIGINS[field]) return MAINTENANCE_ROW_FIELD_ORIGINS[field];
  return undefined;
}

function staticTextOf(widget: ChildWidget): string | undefined {
  const w = widget as unknown as Record<string, unknown>;
  for (const key of ['content', 'defaultLabel', 'label', 'title']) {
    const value = str(w[key]);
    if (value) return value;
  }
  return undefined;
}

/**
 * 元件的資料來源。
 *
 * @param group 元件所在的群組（子畫布／樣板裡的元件）；一般畫布上的元件傳 null。
 */
export function describeWidgetDataLineage(
  widget: ChildWidget,
  group: CanvasElementProps | null,
): WidgetDataLineage {
  const own = ownBindingSources(widget as unknown as Parameters<typeof ownBindingSources>[0]);
  const refs = widgetFieldRefs(widget);
  const problems: string[] = [];

  for (const source of own) {
    if (source.kind !== 'rest' && !source.dataSourceId) {
      problems.push(source.kind === 'sql' ? '寫了 SQL 但沒有選資料來源' : '寫了 MQTT 主題但沒有選 MQTT 資料來源');
    }
  }

  const fields: LineageField[] = group
    ? refs.map((name) => ({ name, derivedFrom: derivedFieldNote(group, name) }))
    : [];
  const readsGroupRow = !!group && refs.length > 0;

  if (group && readsGroupRow) {
    const sources = groupRowSources(group);
    if (sources.length === 0) problems.push(`群組「${group.label}」沒有設定資料來源，{欄位} 不會有值`);
    return {
      status: own.length > 0 ? 'own+group-row' : 'group-row',
      own,
      group: { id: group.id, label: group.label, sources },
      fields,
      problems,
    };
  }

  if (own.length > 0) {
    return { status: 'own', own, fields: refs.map((name) => ({ name })), problems };
  }

  if (DECORATIVE_TYPES.has(widget.type)) {
    return { status: 'decorative', own, fields: [], problems };
  }

  const staticText = staticTextOf(widget);
  // 只有圖示、沒有字也沒有欄位的文字元件，跟色塊一樣只是樣式
  if (!staticText && refs.length === 0) {
    return { status: 'decorative', own, fields: [], problems };
  }
  if (refs.length === 0 && widget.type === 'text' && staticText && !/\d/.test(staticText)) {
    return { status: 'label', own, fields: [], staticText, problems };
  }
  if (!group && refs.length > 0) {
    problems.push(`引用了 ${refs.map((name) => `{${name}}`).join('、')}，但不在群組裡也沒有自己的資料來源，不會有值`);
  }
  return { status: 'static', own, fields: refs.map((name) => ({ name })), staticText, problems };
}
