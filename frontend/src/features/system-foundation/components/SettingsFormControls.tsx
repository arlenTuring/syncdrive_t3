import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Clock, UserRound, X } from 'lucide-react'

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[12px] text-zinc-400">{children}</span>
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full appearance-none rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 pr-9 text-[13px] text-zinc-100 outline-none focus:border-sky-500/70"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      </div>
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        className="h-11 w-full rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/70"
      />
    </label>
  )
}

export function NumberStepperField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  unit?: string
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  const clamp = (n: number) => {
    let next = n
    if (min != null) next = Math.max(min, next)
    if (max != null) next = Math.min(max, next)
    return next
  }
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex h-11 items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-[#1c1c1f]">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? clamp(n) : 0)
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-[13px] text-zinc-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unit ? (
          <span className="flex items-center pr-2 text-[12px] text-zinc-500">
            {unit}
          </span>
        ) : null}
        <div className="flex w-7 flex-col border-l border-zinc-700">
          <button
            type="button"
            className="flex flex-1 items-center justify-center text-zinc-400 hover:bg-zinc-800"
            onClick={() => onChange(clamp(value + step))}
            aria-label="增加"
          >
            <span className="text-[10px] leading-none">▴</span>
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center border-t border-zinc-700 text-zinc-400 hover:bg-zinc-800"
            onClick={() => onChange(clamp(value - step))}
            aria-label="減少"
          >
            <span className="text-[10px] leading-none">▾</span>
          </button>
        </div>
      </div>
    </label>
  )
}

export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <input
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 pr-10 text-[13px] text-zinc-100 outline-none focus:border-sky-500/70 [color-scheme:dark]"
        />
        <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      </div>
    </label>
  )
}

export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px] text-zinc-200">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-[#2B7FFF]' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export function CheckboxOption({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-left text-[13px] transition ${
        disabled
          ? 'cursor-not-allowed text-zinc-500'
          : 'text-zinc-200 hover:text-white'
      }`}
    >
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
          checked && !disabled
            ? 'border-[#2B7FFF] bg-[#2B7FFF] text-white'
            : 'border-zinc-600 bg-transparent'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      {label}
    </button>
  )
}

export function ChipMultiSelectField({
  label,
  selectedIds,
  options,
  placeholder = '請選擇',
  onChange,
}: {
  label: string
  selectedIds: string[]
  options: Array<{ id: string; name: string }>
  placeholder?: string
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = options.filter((o) => selectedIds.includes(o.id))

  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 py-2 text-left transition hover:border-zinc-600"
        >
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selected.length === 0 ? (
              <span className="text-[13px] text-zinc-500">{placeholder}</span>
            ) : (
              selected.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[12px] text-zinc-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <UserRound className="size-3.5 text-zinc-400" />
                  {item.name}
                  <button
                    type="button"
                    className="ml-0.5 rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                    aria-label={`移除 ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onChange(selectedIds.filter((id) => id !== item.id))
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))
            )}
          </div>
          <ChevronDown className="size-4 shrink-0 text-zinc-500" />
        </button>

        {open ? (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-lg border border-zinc-700 bg-[#1a1a1d] py-1 shadow-xl">
            {options.map((item) => {
              const checked = selectedIds.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-white/5 ${
                    checked ? 'text-sky-300' : 'text-zinc-200'
                  }`}
                  onClick={() => {
                    onChange(
                      checked
                        ? selectedIds.filter((id) => id !== item.id)
                        : [...selectedIds, item.id],
                    )
                  }}
                >
                  <UserRound className="size-3.5 text-zinc-500" />
                  {item.name}
                  {checked ? (
                    <span className="ml-auto text-[11px] text-sky-400">
                      已選
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </label>
  )
}

export function SettingsFooter({
  saving,
  error,
  onCancel,
  onSave,
}: {
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-auto flex items-center justify-end gap-3 border-t border-zinc-800/80 pt-4">
      {error ? (
        <p className="mr-auto max-w-[50%] truncate text-[12px] text-rose-300">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-lg px-4 py-2 text-[13px] text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-[#2B7FFF] px-5 py-2 text-[13px] font-medium text-white transition hover:bg-[#1f6fe0] disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}
