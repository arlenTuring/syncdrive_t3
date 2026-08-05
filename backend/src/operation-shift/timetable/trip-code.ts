import { formatMinuteToHmCompact } from './clock';
import type { TimetableBlock } from './build-station-stops';

/** 與前端班次卡代號一致（正線／進場載客／整備類） */
export function resolveTimetableTripCode(block: TimetableBlock, index = 0): string {
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
