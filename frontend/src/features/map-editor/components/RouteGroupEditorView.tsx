import { ChevronLeft, Save } from 'lucide-react'
import { Button } from '../../../components/ui';

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
      <Button hierarchy="subordinate" variant="outlined" className="shrink-0" leadingIcon={<ChevronLeft />} onPress={onBack}>回到路線清單</Button>

      <p className="text-body-xs-bold text-text-primary">
        {draft.groupId ? '編輯路線群組' : '新增路線群組'}
      </p>

      <div>
        <label className="mb-1 block text-caption-2 text-text-tertiary">
          群組名稱 <span className="text-status-error-emphasis">*</span>
        </label>
        <input
          type="text"
          value={draft.displayName}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={!editMode}
          placeholder="例如：T3接駁路線"
          className="w-full rounded-md border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-body-xs text-text-primary placeholder:text-text-quaternary focus:border-border-theme-light focus:outline-none disabled:opacity-60"
        />
      </div>

      {editMode ? (
        <div className="mt-auto flex shrink-0 flex-wrap gap-1.5 border-t border-border-quaternary pt-2">
          <Button hierarchy="subordinate" variant="outlined" className="w-full" leadingIcon={<Save />} onPress={onSave} disabled={!canSave}>儲存群組</Button>
        </div>
      ) : null}
    </div>
  )
}
