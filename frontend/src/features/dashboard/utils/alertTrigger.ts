import type { AlertBannerWidget, AlertRule, AlertTriggerCondition, AlertTriggerMode } from '../types';
import type { VariableMap } from '../VariableContext';
import { interpolateVariables } from '../VariableContext';
import { resolveMqttFieldValue } from './mqttFieldResolve';

const DEFAULT_RULE_COLORS = {
  textColor: '#fafafa',
  backgroundColor: 'rgba(194,65,12,0.55)',
  borderColor: 'rgba(251,146,60,0.45)',
};

export function createEmptyAlertRule(): AlertRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: '',
    textColor: DEFAULT_RULE_COLORS.textColor,
    backgroundColor: DEFAULT_RULE_COLORS.backgroundColor,
    borderColor: DEFAULT_RULE_COLORS.borderColor,
    displayMode: 'blink',
    startField: '',
    startMode: 'non-empty',
    endEnabled: false,
  };
}

export function coerceAlertRule(raw: AlertTriggerCondition | AlertRule, index: number): AlertRule {
  const legacy = raw as AlertTriggerCondition;
  const startField = (raw as AlertRule).startField?.trim()
    || legacy.field?.trim()
    || '';
  const startMode = (raw as AlertRule).startMode ?? legacy.mode ?? 'non-empty';
  const startValue = (raw as AlertRule).startValue ?? legacy.value;
  const content = raw.content?.trim() || (startField ? `{${startField}}` : '');

  return {
    id: (raw as AlertRule).id || raw.id || `rule-${index}-${startField || 'new'}`,
    content,
    textColor: (raw as AlertRule).textColor ?? raw.textColor ?? DEFAULT_RULE_COLORS.textColor,
    backgroundColor: (raw as AlertRule).backgroundColor ?? raw.backgroundColor ?? DEFAULT_RULE_COLORS.backgroundColor,
    borderColor: (raw as AlertRule).borderColor ?? raw.borderColor ?? DEFAULT_RULE_COLORS.borderColor,
    displayMode: (raw as AlertRule).displayMode ?? raw.displayMode ?? 'blink',
    startField,
    startMode,
    startValue,
    endEnabled: (raw as AlertRule).endEnabled ?? raw.endEnabled ?? false,
    endField: (raw as AlertRule).endField ?? raw.endField,
    endMode: (raw as AlertRule).endMode ?? raw.endMode,
    endValue: (raw as AlertRule).endValue ?? raw.endValue,
  };
}

/** 屬性面板用：保留空列，不過濾 */
export function getEditorAlertRules(
  widget: Pick<AlertBannerWidget, 'triggerConditions' | 'triggerField' | 'triggerMode' | 'triggerValue' | 'content'>,
): AlertRule[] {
  if (widget.triggerConditions?.length) {
    return widget.triggerConditions.map((r, i) => coerceAlertRule(r, i));
  }

  const field = widget.triggerField?.trim();
  if (field) {
    return [coerceAlertRule({
      id: 'rule-legacy',
      content: widget.content?.trim() || `{${field}}`,
      startField: field,
      startMode: widget.triggerMode ?? 'non-empty',
      startValue: widget.triggerValue,
    }, 0)];
  }

  return [];
}

const LIVE_HEALTH_FIELDS = new Set([
  'overall_health',
  'alert_message',
  'status_computing',
  'status_sensing',
  'status_communication',
  'status_chassis',
]);

export function resolveFieldValue(
  field: string,
  variables: VariableMap,
  sqlRow: Record<string, unknown> | null,
  mqttRaw: unknown,
): unknown {
  const key = field.trim();
  if (!key) return null;

  // 健康／警示欄位：有即時 MQTT 心跳時以遠端為準，避免 DB 殘留示範異常
  if (mqttRaw !== null && mqttRaw !== undefined && LIVE_HEALTH_FIELDS.has(key)) {
    const fromMqtt = resolveMqttFieldValue(mqttRaw, key);
    if (fromMqtt !== null && fromMqtt !== undefined) return fromMqtt;
  }

  if (variables[key] !== undefined && variables[key] !== null && String(variables[key]).trim() !== '') {
    return variables[key];
  }
  if (sqlRow && sqlRow[key] !== undefined && sqlRow[key] !== null && String(sqlRow[key]).trim() !== '') {
    return sqlRow[key];
  }

  if (mqttRaw !== null && mqttRaw !== undefined) {
    const fromMqtt = resolveMqttFieldValue(mqttRaw, key);
    if (fromMqtt !== null && fromMqtt !== undefined) return fromMqtt;
  }

  if (variables[key] !== undefined) return variables[key];
  if (sqlRow && sqlRow[key] !== undefined) return sqlRow[key];
  const interpolated = interpolateVariables(`{${key}}`, variables);
  if (interpolated !== `{${key}}`) return interpolated;
  return null;
}

export function modeMatches(mode: AlertTriggerMode, value: string | undefined, raw: unknown): boolean {
  const str = raw === null || raw === undefined ? '' : String(raw).trim();
  switch (mode) {
    case 'equals':
      return str === String(value ?? '');
    case 'not-equals':
      return str !== String(value ?? '');
    case 'non-empty':
    default:
      return str.length > 0;
  }
}

export interface ResolvedAlertRule extends AlertRule {
  displayText: string;
  isActive: boolean;
}

export function evaluateActiveAlertRules(
  widget: AlertBannerWidget,
  variables: VariableMap,
  sqlRow: Record<string, unknown> | null,
  mqttRaw: unknown,
): ResolvedAlertRule[] {
  const rules = getEditorAlertRules(widget).filter(r => r.startField.trim());
  const active: ResolvedAlertRule[] = [];

  for (const rule of rules) {
    const startRaw = resolveFieldValue(rule.startField, variables, sqlRow, mqttRaw);
    if (!modeMatches(rule.startMode, rule.startValue, startRaw)) continue;

    if (rule.endEnabled && rule.endField?.trim()) {
      const endRaw = resolveFieldValue(rule.endField, variables, sqlRow, mqttRaw);
      if (modeMatches(rule.endMode ?? 'non-empty', rule.endValue, endRaw)) continue;
    }

    active.push({
      ...rule,
      displayText: rule.content,
      isActive: true,
    });
  }

  return active;
}

/** 多規則命中時只顯示優先度最高的一則（每車一種異常） */
const ALERT_RULE_PRIORITY = [
  'rule-alert-msg',
  'rule-health-error',
  'rule-health-warning',
  'rule-sensing-warning',
  'rule-offline',
];

export function pickPrimaryAlertRules(rules: ResolvedAlertRule[]): ResolvedAlertRule[] {
  if (rules.length <= 1) return rules;
  const sorted = [...rules].sort((a, b) => {
    const ai = ALERT_RULE_PRIORITY.indexOf(a.id);
    const bi = ALERT_RULE_PRIORITY.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return [sorted[0]];
}

export function normalizeAlertTriggerConditions(
  widget: Pick<AlertBannerWidget, 'triggerConditions' | 'triggerField' | 'triggerMode' | 'triggerValue' | 'content'>,
) {
  return getEditorAlertRules(widget).filter(r => r.startField.trim());
}
