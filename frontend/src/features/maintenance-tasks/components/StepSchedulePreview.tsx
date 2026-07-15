import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { CreateMaintenanceTaskStep, MaintenanceTaskCreateDraft } from '../types/create';
import { MaintenanceTaskPreviewContent } from './MaintenanceTaskPreviewContent';

type StepSchedulePreviewProps = {
  draft: MaintenanceTaskCreateDraft;
  scrollRootRef?: RefObject<HTMLElement | null>;
  onReachedBottom?: (reached: boolean) => void;
  onEditStep?: (step: CreateMaintenanceTaskStep) => void;
};

export function StepSchedulePreview({
  draft,
  scrollRootRef,
  onReachedBottom,
  onEditStep,
}: StepSchedulePreviewProps) {
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRootRef?.current;
    const sentinel = bottomSentinelRef.current;
    if (!root || !sentinel || !onReachedBottom) return;

    const observer = new IntersectionObserver(
      ([entry]) => onReachedBottom(entry.isIntersecting),
      { root, threshold: 0, rootMargin: '0px 0px 32px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRootRef, onReachedBottom]);

  return (
    <div className="w-full">
      <h2 className="mb-2 text-base font-medium text-zinc-100">任務檢視</h2>
      <p className="mb-6 text-sm text-zinc-500">
        以下為步驟 1 至 6 的完整設定摘要，僅供檢視確認。請捲動至底部後按「完成」儲存。
      </p>

      <MaintenanceTaskPreviewContent draft={draft} onEditStep={onEditStep} />

      <div ref={bottomSentinelRef} className="h-px w-full shrink-0" aria-hidden />
    </div>
  );
}
