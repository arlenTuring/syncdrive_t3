import { ChevronLeft, Save } from 'lucide-react'

export type RouteGroupDraft = {
  groupId: string | null
  displayName: string
}

type Props = {
  draft: RouteGroupDraft
  editMode: boolean
  onBack: () => void
  onSave: () => void
  onNameChange: (name: string) => void
}

export function RouteGroupEditorView({
  draft,
  editMode,
  onBack,
  onSave,
  onNameChange,
}: Props) {
  const canSave = draft.displayName.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-600/80 bg-zinc-950/60 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-300 hover:bg-zinc-800/80"
      >
        <ChevronLeft className="size-4 shrink-0" />
        回到路線清單
      </button>

      <p className="text-[11px] font-semibold text-zinc-200">
        {draft.groupId ? '編輯路線群組' : '新增路線群組'}
      </p>

      <div>
        <label className="mb-1 block text-[10px] font-medium text-zinc-400">
          群組名稱 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={draft.displayName}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={!editMode}
          placeholder="例如：T3接駁路線"
          className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/60 focus:outline-none disabled:opacity-60"
        />
      </div>

      {editMode ? (
        <div className="mt-auto flex shrink-0 flex-wrap gap-1.5 border-t border-zinc-700/80 pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-emerald-600/50 bg-emerald-950/40 px-2 py-1.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
          >
            <Save className="size-3.5" />
            儲存群組
          </button>
        </div>
      ) : null}
    </div>
  )
}
