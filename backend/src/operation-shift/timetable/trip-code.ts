import { formatMinuteToHmCompact } from './clock';
import type { TimetableBlock } from './build-station-stops';
import { cardCodeKind, cardDisplayCode, type CardCodeSettings } from '../card-code';

/** 與前端班次卡代號一致（正線／進場載客／整備類） */
export function resolveTimetableTripCode(
  block: TimetableBlock,
  index = 0,
  /** 班表的代號設定；新班表（有過渡卡代號）的整備／過渡卡照「代號＋列號＋HHMM」，跟整備訂單同一個代號 */
  codeSettings?: CardCodeSettings,
): string {
  if (codeSettings?.version === 2 && cardCodeKind(block)) {
    return cardDisplayCode(block, codeSettings) ?? '----';
  }

  if (block.source === 'entry_service') {
    const prefix = `${block.entryServiceSectionCode ?? ''}${block.routeCode ?? ''}`.trim().toUpperCase();
    if (!prefix) return '----';
    return `${prefix}${formatMinuteToHmCompact(block.plannedStartMinute)}`;
  }

  if (block.taskType === 'passenger') {
    const prefix = block.routeCode?.trim().toUpperCase() ?? '';
    if (!prefix) return '----';
    return `${prefix}${formatMinuteToHmCompact(block.plannedStartMinute)}`;
  }

  if (block.taskType === 'dispatch' || block.source === 'dispatch') {
    return `D${formatMinuteToHmCompact(block.plannedStartMinute)}`;
  }

  const servicingPrefix: Record<string, string> = {
    servicing: 'SV',
    inspection: 'IN',
    charging: 'CH',
    standby: 'SB',
    idle: 'ID',
  };
  const code = servicingPrefix[block.taskType];
  if (code) {
    return `${code}${formatMinuteToHmCompact(block.plannedStartMinute)}`;
  }

  if (block.routeId) {
    const compact = block.routeId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (compact.length >= 4) return compact.slice(0, 5);
  }
  return `T${String(index + 1).padStart(4, '0')}`;
}
