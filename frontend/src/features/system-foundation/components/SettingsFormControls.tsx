import { SiteDateTimeInput } from '../../../components/SiteDateTimeInput';
import { SiteSelect } from '../../../components/SiteSelect';
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, UserRound, X } from 'lucide-react'
import { Button, Checkbox, CheckboxIndicator, cn, MENU_PANEL_CLASS, menuItemClass, Switch, TextInput } from '../../../components/ui'

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-body-xs text-text-tertiary">{children}</span>
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
      <SiteSelect value={value} onChange={(e) => onChange(e.target.value)} size="md" className="w-full">
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </SiteSelect>
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
      <TextInput
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === 'password' ? 'new-password' : undefined}
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
      <div className="flex h-[34px] items-stretch overflow-hidden rounded-lg border border-border-quaternary bg-surface-secondary focus-within:border-border-theme">
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
          className="min-w-0 flex-1 bg-transparent px-3 text-body-s text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unit ? (
          <span className="flex items-center pr-2 text-body-xs text-text-quaternary">
            {unit}
          </span>
        ) : null}
        <div className="flex w-7 flex-col border-l border-border-quaternary">
          <button
            type="button"
            className="flex flex-1 items-center justify-center text-text-tertiary hover:bg-link-standard-hover"
            onClick={() => onChange(clamp(value + step))}
            aria-label="增加"
          >
            <span className="text-caption-2">▴</span>
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center border-t border-border-quaternary text-text-tertiary hover:bg-link-standard-hover"
            onClick={() => onChange(clamp(value - step))}
            aria-label="減少"
          >
            <span className="text-caption-2">▾</span>
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
      <SiteDateTimeInput type="time" value={value} onChange={(e) => onChange(e.target.value)} size="md" className="w-full" />
    </label>
  )
}

/** 設定開關列：左邊文字、右邊 Switch（T3 UI Kit，basic）。文字同時是開關的可及名稱 */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className={disabled ? 'text-body-s text-text-disabled' : 'text-body-s text-text-primary'}>{label}</span>
      <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />
    </label>
  )
}

/** 勾選項：Checkbox（T3 UI Kit）＋可見標籤 */
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
    <Checkbox
      className="py-1"
      label={label}
      labelClassName="text-body-s text-text-primary"
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
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
          className="flex min-h-[34px] w-full items-center gap-2 rounded-lg border border-border-quaternary bg-surface-secondary px-3 py-1 text-left transition hover:border-border-tertiary"
        >
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selected.length === 0 ? (
              <span className="text-body-s text-text-quaternary">{placeholder}</span>
            ) : (
              selected.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-1 text-body-xs text-text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <UserRound className="size-3.5 text-text-tertiary" />
                  {item.name}
                  <button
                    type="button"
                    className="ml-0.5 rounded p-0.5 text-text-quaternary hover:bg-link-standard-hover hover:text-text-primary"
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
          <ChevronDown className="size-4 shrink-0 text-text-quaternary" />
        </button>

        {open ? (
          <div className={cn(MENU_PANEL_CLASS, 'absolute left-0 right-0 top-[calc(100%+4px)] z-20')}>
            {options.map((item) => {
              const checked = selectedIds.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={menuItemClass(checked)}
                  onClick={() => {
                    onChange(
                      checked
                        ? selectedIds.filter((id) => id !== item.id)
                        : [...selectedIds, item.id],
                    )
                  }}
                >
                  <CheckboxIndicator checked={checked} />
                  <UserRound className="size-3.5 text-text-quaternary" />
                  {item.name}
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
    <div className="mt-auto flex items-center justify-end gap-3 border-t border-border-quaternary pt-4">
      {error ? (
        <p className="mr-auto max-w-[50%] truncate text-body-xs text-status-error-emphasis">
          {error}
        </p>
      ) : null}
      <Button hierarchy="subordinate" variant="tonal" onPress={onCancel} disabled={saving}>
        {t('common.cancel')}
      </Button>
      <Button onPress={onSave} disabled={saving}>
        {saving ? t('common.saving') : t('common.save')}
      </Button>
    </div>
  )
}
