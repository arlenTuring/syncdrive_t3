import type { SignalState } from '../types/facility'

/**
 * Figma Direction=Bottom：32×38（column：24 + 10 + 6，段與段 −1px 重疊）。
 * 內層 light：長方形、置中於 24×24 圓殼（稿中 16×5.33 的水平條，改為垂直條置中，等同 rotate 90° 後的視覺）。
 */
const INNER_BY_STATE: Record<SignalState, string> = {
  Normal: '#22C55E',
  Warning: '#FACC15',
  Fault: '#E7000B',
  Offline: '#6B7280',
}

const LAMP = 24
/** 稿：left/right/top/bottom% 換算之水平向寬高 */
const LIGHT_W = LAMP * (1 - 0.3889 + 0.0556)
const LIGHT_H = LAMP * (1 - 0.1667 - 0.6111)

type SignalLightGraphicProps = {
  state: string
}

function innerGlow(color: string): string {
  return `0 0 4px ${color}, 0 0 10px ${color}99, 0 0 16px ${color}44`
}

export function SignalLightGraphic({ state }: SignalLightGraphicProps) {
  const inner =
    state in INNER_BY_STATE
      ? INNER_BY_STATE[state as SignalState]
      : '#E7000B'
  const pulse = state === 'Warning'

  return (
    <div
      className="flex w-8 shrink-0 flex-col items-start p-0"
      style={{ width: 32, height: 38 }}
      aria-hidden
    >
      {/* order 0：32×24，padding 0 4px */}
      <div
        className="flex w-8 shrink-0 flex-row items-start self-stretch px-1"
        style={{ height: 24 }}
      >
        <div
          className="relative shrink-0 overflow-hidden rounded-full bg-[#4A5565]"
          style={{ width: LAMP, height: LAMP }}
        >
          {/* 垂直長條置中：寬 = LIGHT_H、高 = LIGHT_W */}
          <div
            className={`absolute left-1/2 top-1/2 ${pulse ? 'animate-pulse' : ''}`}
            style={{
              width: LIGHT_H,
              height: LIGHT_W,
              marginLeft: -(LIGHT_H / 2),
              marginTop: -(LIGHT_W / 2),
              backgroundColor: inner,
              borderRadius: 0,
              boxShadow: innerGlow(inner),
            }}
          />
        </div>
      </div>

      {/* order 1：32×10，padding 0 14px；方角 4×10 */}
      <div
        className="flex w-8 shrink-0 flex-row items-start self-stretch"
        style={{ height: 10, paddingLeft: 14, paddingRight: 14, margin: '-1px 0 0 0' }}
      >
        <div
          className="shrink-0 bg-[#4A5565]"
          style={{ width: 4, height: 10, borderRadius: 0 }}
        />
      </div>

      {/* order 2：32×6 橫桿 */}
      <div
        className="w-8 shrink-0 self-stretch rounded-[1px] bg-[#4A5565]"
        style={{ height: 6, margin: '-1px 0 0 0' }}
      />
    </div>
  )
}
