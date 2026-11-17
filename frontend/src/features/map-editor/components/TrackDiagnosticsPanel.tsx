import { X } from 'lucide-react'
import type { TrackDiagnostics, TrackIssue } from '../utils/trackDiagnostics'
import { IconButton } from '../../../components/ui';

type Props = {
  diagnostics: TrackDiagnostics
  onLocate: (areaId: string, facilityId: string) => void
  onClose: () => void
}

const SEVERITY_STYLE: Record<TrackIssue['severity'], { dot: string; label: string }> = {
  error: { dot: 'bg-status-error', label: '嚴重' },
  warn: { dot: 'bg-status-warning', label: '注意' },
}

/**
 * 軌道檢查清單：整張圖裡圖面位置與現場座標對不上的軌道。
 *
 * 平常不需要看——載入時能自動修的都修掉了。這裡只列修完之後還對不上、機器又看不出誰對誰錯的，
 * 每一筆寫清楚差多少、為什麼、該怎麼處理，點一下就定位到那塊軌道。
 */
export function TrackDiagnosticsPanel({ diagnostics, onLocate, onClose }: Props) {
  const { issues } = diagnostics
  return (
    <div
      role="dialog"
      aria-label="軌道檢查"
      data-testid="track-diagnostics-panel"
      className="absolute right-4 top-2 z-40 w-[min(26rem,calc(100%-2rem))] max-h-[70%] overflow-y-auto rounded-lg border border-border-quaternary bg-zinc-900/95 shadow-2xl backdrop-blur"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-border-quaternary bg-surface-primary px-3 py-2">
        <div className="text-body-xs-bold text-text-primary">
          軌道檢查
          <span className="ml-2 font-normal text-text-tertiary">
            {issues.length === 0 ? '全部正常' : `${issues.length} 項需要處理`}
          </span>
        </div>
        <IconButton size="small" hierarchy="subordinate" variant="standard" onPress={onClose} label="關閉" icon={<X />} />
      </div>
      {issues.length === 0 ? (
        <p className="px-3 py-4 text-body-xs text-text-tertiary">
          每一塊軌道的兩端，現場座標都和圖上貼著它的鄰居接得上。複製來的軌道、分岔比路口短這類
          常見問題載入時已自動修好。
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800">
          {issues.map((issue) => (
            <li key={issue.key}>
              <button
                type="button"
                onClick={() => onLocate(issue.areaId, issue.facilityId)}
                className="block w-full px-3 py-2.5 text-left hover:bg-zinc-800/70"
              >
                <div className="flex items-center gap-2">
                  <span className={`size-2 shrink-0 rounded-full ${SEVERITY_STYLE[issue.severity].dot}`} />
                  <span className="text-body-xs-bold text-text-primary">{issue.title}</span>
                </div>
                <p className="mt-1 text-body-xs text-text-tertiary">{issue.detail}</p>
                <p className="mt-1 text-body-xs text-sky-300/80">{issue.suggestion}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
