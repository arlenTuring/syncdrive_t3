import {
  resolveTaskTypeLabel,
  TASK_TYPE_COLORS,
  type TaskTypeKey,
} from '../time-templates/types/editor';
import { tokenVar } from '../../styles/tokens';

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
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-caption-2',
        className,
      ].join(' ')}
      style={
        colors
          ? { backgroundColor: colors.bg, color: colors.text }
          : { backgroundColor: tokenVar('link-standard-hover'), color: tokenVar('text-tertiary') }
      }
    >
      {label}
    </span>
  );
}
