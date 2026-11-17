import { useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  TASK_TYPE_COLORS,
  TASK_TYPE_DESCRIPTIONS,
  type TaskTypeKey,
} from '../types/editor';

type HoverCardPos = {
  top: number;
  left: number;
};

function TaskTypeHelpHoverCard({
  taskKey,
  pos,
}: {
  taskKey: TaskTypeKey;
  pos: HoverCardPos;
}) {
  const description = TASK_TYPE_DESCRIPTIONS[taskKey];
  const colors = TASK_TYPE_COLORS[taskKey];

  return createPortal(
    <div
      className="pointer-events-none fixed z-[10050] w-max max-w-[248px] -translate-x-1/2 -translate-y-full rounded-lg border border-border-quaternary bg-surface-sub-background px-3 py-2.5 shadow-2xl shadow-black-50"
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: colors.bar }}
          aria-hidden
        />
        <span className="text-body-xs-bold text-text-primary">
          {description.title}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5 pl-4 text-caption-2 leading-[15px] text-text-secondary">
        {description.bullets.map((bullet) => (
          <li key={bullet} className="list-disc marker:text-text-quaternary">
            {bullet}
          </li>
        ))}
      </ul>
      <div
        className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-border-quaternary"
        aria-hidden
      />
    </div>,
    document.body,
  );
}

type TaskTypeHelpAnchorProps = {
  taskKey: TaskTypeKey;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
};

export function TaskTypeHelpAnchor({
  taskKey,
  children,
  className,
  style,
  draggable,
  onDragStart,
}: TaskTypeHelpAnchorProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<HoverCardPos | null>(null);

  useLayoutEffect(() => {
    if (!hovered) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [hovered]);

  return (
    <div
      ref={anchorRef}
      draggable={draggable}
      onDragStart={onDragStart}
      className={className}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && pos ? <TaskTypeHelpHoverCard taskKey={taskKey} pos={pos} /> : null}
    </div>
  );
}
