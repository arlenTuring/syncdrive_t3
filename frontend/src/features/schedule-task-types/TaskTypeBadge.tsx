import {
  resolveTaskTypeLabel,
  TASK_TYPE_COLORS,
  type TaskTypeKey,
} from '../time-templates/types/editor';

type TaskTypeBadgeProps = {
  taskType: TaskTypeKey | null | undefined;
  className?: string;
};

export function TaskTypeBadge({ taskType, className = '' }: TaskTypeBadgeProps) {
  const label = resolveTaskTypeLabel(taskType);
  const colors = taskType ? TASK_TYPE_COLORS[taskType] : null;

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
        className,
      ].join(' ')}
      style={
        colors
          ? { backgroundColor: colors.bg, color: colors.text }
          : { backgroundColor: 'rgba(63,66,78,0.6)', color: '#a1a1aa' }
      }
    >
      {label}
    </span>
  );
}
