import type { FacilityObject } from '../types/facility'
import { parseTrackColorRules } from '../utils/trackFacility'
import { FillColorRulesSection } from './FillColorRulesSection'
import { FrameInspectorSection } from './FrameInspectorSection'
import { TrackCornerRadiusSection } from './TrackCornerRadiusSection'

type Props = {
  facility: FacilityObject
  sizeMeters: { w: number; h: number }
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function TrackInspectorSection({
  facility,
  sizeMeters,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Track') return null
  const params = facility.parameters ?? {}
  const rules = parseTrackColorRules(params.colorRules)
  const defaultFill =
    typeof params.defaultFillColor === 'string' ? params.defaultFillColor : '#52525b'

  return (
    <>
      <TrackCornerRadiusSection
        facility={facility}
        sizeMeters={sizeMeters}
        readOnly={readOnly}
        onPatchParameters={onPatchParameters}
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />

      <FillColorRulesSection
        title="軌道填色規則"
        entityId={facility.id}
        readOnly={readOnly}
        defaultFill={defaultFill}
        rules={rules}
        onDefaultFillChange={(color) => onPatchParameters({ defaultFillColor: color })}
        onRulesChange={(next) =>
          onPatchParameters({
            colorRules: next.length > 0 ? next : undefined,
          })
        }
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />

      <FrameInspectorSection
        facility={facility}
        readOnly={readOnly}
        onPatchParameters={onPatchParameters}
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />
    </>
  )
}
