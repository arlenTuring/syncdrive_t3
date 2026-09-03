import { useCallback, useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from 'react'

/**
 * 數字輸入框：打字時不搶著把值改回來。
 *
 * <h3>為什麼需要這個</h3>
 * 直覺寫法是 `onChange={(e) => set(clamp(Number(e.target.value)))}`。這樣寫的欄位
 * <strong>刪不乾淨</strong>：把內容全選刪掉的瞬間 `Number('')` 是 0，夾回下限就變成
 * 最小值，畫面上永遠卡著一個「1」，使用者只能在它前後補字再回頭刪。下限是 0 的欄位
 * 也一樣卡著 0。想從 50 改成 200 的人得先想辦法把舊的弄掉，很煩。
 *
 * <h3>做法</h3>
 * 打字期間欄位顯示使用者<strong>自己打的字</strong>（草稿），空字串就讓它空著；只有
 * 解析得出來、而且落在範圍內的數字才往外送。離開欄位時草稿丟掉，夾到範圍內、回到
 * 由外部的值決定顯示——所以中途打出範圍外的數字也不會被吃掉，放開才夾。
 *
 * 其餘的屬性（className、min、max、step、disabled、placeholder…）原樣傳給 input，
 * 所以它可以直接換掉原本的 `<input type="number">`，外觀不變。
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let v = n
  if (typeof min === 'number' && v < min) v = min
  if (typeof max === 'number' && v > max) v = max
  return v
}

export function NumberInput({ value, onChange, min, max, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      setDraft(raw)
      if (raw.trim() === '') return
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      // 半途打出來的數字先不送，離開欄位時才夾
      if (typeof min === 'number' && n < min) return
      if (typeof max === 'number' && n > max) return
      onChange(n)
    },
    [max, min, onChange],
  )

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      const raw = draft
      setDraft(null)
      if (raw !== null && raw.trim() !== '') {
        const n = Number(raw)
        if (Number.isFinite(n)) {
          const c = clamp(n, min, max)
          if (c !== value) onChange(c)
        }
      }
      onBlur?.(e)
    },
    [draft, max, min, onBlur, onChange, value],
  )

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}
