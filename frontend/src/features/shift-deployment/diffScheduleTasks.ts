import type { StatusTagStyle } from '../../components/StatusTag';
import type {
  GeneratedScheduleBlock,
  GeneratedSchedulePlan,
  ScheduleBlockSource,
} from '../shift-list/utils/schedule-engine/types';
import type { ScheduleEngineTaskType } from '../time-templates/types/editor';
import { formatMinutesToTime } from '../time-templates/types/editor';

export type ScheduleDiffKind = 'create' | 'delete';

export type ScheduleDiffTaskType = ScheduleEngineTaskType;

export type ScheduleDiffRow = {
  id: string;
  kind: ScheduleDiffKind;
  taskType: ScheduleDiffTaskType;
  taskLabel: string;
  tagStyle: StatusTagStyle;
  newDepartLabel: string;
  originalDepartLabel: string;
  reason: string;
  sortMinute: number;
};

const SKIP_SOURCES = new Set<ScheduleBlockSource>([
  'transition',
  'yard_exit_move',
  'yard_entry_move',
  'relief_loop',
]);

const TASK_LABEL: Partial<Record<ScheduleEngineTaskType, string>> = {
  passenger: '載客',
  charging: '充電',
  inspection: '行前檢查',
  servicing: '保養',
  washing: '洗車',
  standby: '待命',
  dispatch: '調度',
};

const TASK_TAG_STYLE: Partial<Record<ScheduleEngineTaskType, StatusTagStyle>> = {
  passenger: { container: 'bg-[rgba(43,127,255,0.2)]', dot: 'bg-[#2B7FFF]' },
  charging: { container: 'bg-[rgba(0,201,81,0.2)]', dot: 'bg-[#00C951]' },
  inspection: { container: 'bg-[rgba(239,177,0,0.2)]', dot: 'bg-[#EFB100]' },
  servicing: { container: 'bg-[rgba(173,70,255,0.2)]', dot: 'bg-[#AD46FF]' },
  washing: { container: 'bg-[rgba(0,184,219,0.2)]', dot: 'bg-[#00B8DB]' },
  standby: { container: 'bg-zinc-800/80', dot: 'bg-[#D4D4D8]' },
  dispatch: { container: 'bg-[rgba(56,189,248,0.2)]', dot: 'bg-[#38BDF8]' },
  idle: { container: 'bg-zinc-800/80', dot: 'bg-zinc-500' },
};

function diffReason(kind: ScheduleDiffKind, taskType: ScheduleEngineTaskType): string {
  if (kind === 'delete') {
    return taskType === 'passenger'
      ? '因班距拉寬，此任務位被取消'
      : '因更換班表，此任務位被取消';
  }
  return taskType === 'passenger' ? '因運量提升，增加班次' : '該為模板任務內容';
}

function isComparableBlock(block: GeneratedScheduleBlock): boolean {
  if (SKIP_SOURCES.has(block.source)) return false;
  if (block.taskType === 'idle') return false;
  return true;
}

function fingerprint(block: GeneratedScheduleBlock): string {
  const startSec = Math.round(block.plannedStartMinute * 60);
  const endSec = Math.round(block.plannedEndMinute * 60);
  return [
    block.taskType,
    startSec,
    endSec,
    block.routeId ?? '',
    block.routeCode ?? '',
  ].join('|');
}

function collectBlocks(plan: GeneratedSchedulePlan | null | undefined): GeneratedScheduleBlock[] {
  if (!plan) return [];
  const blocks: GeneratedScheduleBlock[] = [];
  for (const timeline of plan.timelines ?? []) {
    for (const block of timeline.blocks ?? []) {
      if (isComparableBlock(block)) blocks.push(block);
    }
  }
  return blocks;
}

export function formatDiffDepartLabel(minutes: number): string {
  const label = formatMinutesToTime(minutes);
  return label.length >= 5 ? label.slice(0, 5) : label;
}

export function taskTypeLabel(taskType: ScheduleEngineTaskType): string {
  return TASK_LABEL[taskType] ?? taskType;
}

export function taskTypeTagStyle(taskType: ScheduleEngineTaskType): StatusTagStyle {
  return TASK_TAG_STYLE[taskType] ?? { container: 'bg-zinc-800/80', dot: 'bg-zinc-500' };
}

export function diffSchedulePlans(
  currentPlan: GeneratedSchedulePlan | null | undefined,
  nextPlan: GeneratedSchedulePlan | null | undefined,
): ScheduleDiffRow[] {
  const currentBlocks = collectBlocks(currentPlan);
  const nextBlocks = collectBlocks(nextPlan);

  const currentUsed = new Array(currentBlocks.length).fill(false);
  const nextUsed = new Array(nextBlocks.length).fill(false);
  const currentFp = currentBlocks.map(fingerprint);
  const nextFp = nextBlocks.map(fingerprint);

  for (let i = 0; i < nextBlocks.length; i += 1) {
    const match = currentFp.findIndex((fp, j) => !currentUsed[j] && fp === nextFp[i]);
    if (match >= 0) {
      currentUsed[match] = true;
      nextUsed[i] = true;
    }
  }

  const rows: ScheduleDiffRow[] = [];

  currentBlocks.forEach((block, index) => {
    if (currentUsed[index]) return;
    rows.push({
      id: `delete:${block.id}:${index}`,
      kind: 'delete',
      taskType: block.taskType,
      taskLabel: taskTypeLabel(block.taskType),
      tagStyle: taskTypeTagStyle(block.taskType),
      newDepartLabel: '',
      originalDepartLabel: formatDiffDepartLabel(block.plannedStartMinute),
      reason: diffReason('delete', block.taskType),
      sortMinute: block.plannedStartMinute,
    });
  });

  nextBlocks.forEach((block, index) => {
    if (nextUsed[index]) return;
    rows.push({
      id: `create:${block.id}:${index}`,
      kind: 'create',
      taskType: block.taskType,
      taskLabel: taskTypeLabel(block.taskType),
      tagStyle: taskTypeTagStyle(block.taskType),
      newDepartLabel: formatDiffDepartLabel(block.plannedStartMinute),
      originalDepartLabel: '',
      reason: diffReason('create', block.taskType),
      sortMinute: block.plannedStartMinute,
    });
  });

  rows.sort((a, b) => {
    if (a.sortMinute !== b.sortMinute) return a.sortMinute - b.sortMinute;
    if (a.kind !== b.kind) return a.kind === 'delete' ? -1 : 1;
    return a.taskLabel.localeCompare(b.taskLabel, 'zh-Hant');
  });

  return rows;
}
