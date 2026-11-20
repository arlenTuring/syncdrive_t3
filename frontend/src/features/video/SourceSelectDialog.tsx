import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, cn, Dialog, TextInput } from '../../components/ui';
import type { SourceOption } from './api';
import { groupSources } from './layout';
import { OPTION_STATE_LABEL } from './status';

const STATE_TONE: Partial<Record<SourceOption['state'], string>> = {
  online: 'text-status-success',
  offline: 'text-status-error-emphasis',
  error: 'text-status-error-emphasis',
  disabled: 'text-text-quaternary',
};

/** 來源的副標：載具・位置（沒有就用標籤） */
function sourceSubtitle(o: SourceOption): string {
  const parts = [o.vehicleCode, o.location].filter((v): v is string => Boolean(v));
  return (parts.length ? parts : o.tags).join('・');
}

/**
 * 選擇／切換影像來源（設計稿 2026-11-20）：搜尋＋來源清單，選一個再按「確定」。
 * 只列安全摘要，不含連線資訊；停用、已刪除的來源不能選，離線但啟用的可以選（畫面會等它恢復）。
 * 已綁定的視窗（給了 onClear）：標題「切換影像來源」、左下「清除綁定」、確認鍵「套用」。取消沒有任何副作用。
 */
export function SourceSelectDialog({
  options,
  value,
  onClose,
  onPick,
  onClear,
}: {
  options: SourceOption[];
  value: string | null;
  onClose: () => void;
  onPick: (sourceId: string) => void;
  /** 給了就顯示「清除綁定」 */
  onClear?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(value);
  const items = useMemo(() => groupSources(options.filter((o) => !o.deleted), query).flatMap((g) => g.items), [options, query]);
  const empty = options.every((o) => o.deleted);

  return (
    <Dialog
      title={onClear ? '切換影像來源' : '選擇影像來源'}
      onClose={onClose}
      padded={false}
      footer={
        <>
          {onClear ? <Button variant="outlined" className="mr-auto" onPress={onClear}>清除綁定</Button> : null}
          <Button hierarchy="subordinate" variant="standard" onPress={onClose}>取消</Button>
          <Button disabled={!picked} onPress={() => (picked && picked !== value ? onPick(picked) : onClose())}>{onClear ? '套用' : '確定'}</Button>
        </>
      }
    >
      <div className="shrink-0 px-6 pb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-quaternary" aria-hidden />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="請輸入關鍵字" aria-label="搜尋影像來源" className="pl-10" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5" role="listbox" aria-label="影像來源">
        {items.map((o) => {
          const active = o.id === picked;
          const blocked = !o.enabled;
          const sub = sourceSubtitle(o);
          return (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={blocked || undefined}
              disabled={blocked}
              onClick={() => setPicked(o.id)}
              onDoubleClick={() => !blocked && (o.id !== value ? onPick(o.id) : onClose())}
              className={cn(
                'flex w-full shrink-0 items-center gap-3 rounded-lg border px-5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'border-border-theme bg-surface-secondary' : 'border-transparent bg-surface-secondary hover:bg-link-standard',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-m text-text-primary">{o.name}</span>
                {sub ? <span className="mt-0.5 block truncate text-body-s text-text-tertiary">{sub}</span> : null}
              </span>
              <span className={cn('shrink-0 text-body-s', STATE_TONE[o.state] ?? 'text-text-tertiary')}>{OPTION_STATE_LABEL[o.state]}</span>
            </button>
          );
        })}
        {items.length === 0 ? (
          <p className="py-6 text-center text-body-s text-text-quaternary">{empty ? '還沒有影像來源，請先到「影像來源管理」新增' : '找不到符合的來源'}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
