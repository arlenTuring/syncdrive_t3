import type { SVGProps } from 'react'

/**
 * 設計稿用的 Material Symbols（Outlined，24 格線）。
 *
 * 專案圖示庫是 lucide，但設計稿的側欄與元件庫圖示是 Material Symbols，兩者筆畫不同，
 * 混用看起來就是「圖示不對」。這裡只收用到的幾個，路徑取自 google/material-design-icons
 *（Apache-2.0），顏色吃 currentColor。
 */
type SymbolProps = SVGProps<SVGSVGElement> & { className?: string }

function symbol(d: string) {
  return function MaterialSymbol({ className, ...rest }: SymbolProps) {
    return (
      <svg viewBox="0 -960 960 960" fill="currentColor" className={className} aria-hidden {...rest}>
        <path d={d} />
      </svg>
    )
  }
}

export const KeyboardArrowRight = symbol('M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z')
export const KeyboardArrowLeft = symbol('M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z')
export const HorizontalRule = symbol('M160-440v-80h640v80H160Z')
export const TurnSlightRight = symbol('M360-160v-303q0-16 6-30.5t17-25.5l201-201h-90v-80h226v226h-80v-90L440-464v304h-80Z')
export const Login = symbol('M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z')
export const VerticalSplit = symbol('M120-360v-80h320v80H120Zm0 160v-80h320v80H120Zm0-320v-80h320v80H120Zm0-160v-80h320v80H120Zm480 480q-33 0-56.5-23.5T520-280v-400q0-33 23.5-56.5T600-760h160q33 0 56.5 23.5T840-680v400q0 33-23.5 56.5T760-200H600Zm0-80h160v-400H600v400Zm80-200Z')
export const AddRoad = symbol('M720-40v-120H600v-80h120v-120h80v120h120v80H800v120h-80Zm0-400v-360h80v360h-80ZM160-160v-640h80v640h-80Zm280-480v-160h80v160h-80Zm0 240v-160h80v160h-80Zm0 240v-160h80v160h-80Z')
