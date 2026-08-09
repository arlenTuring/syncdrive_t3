import type { MaintenanceTaskMobileDraft } from '../types/create';
import { StepStationDurationParams } from './StepStationDurationParams';

type StepMobileParamsProps = {
  draft: MaintenanceTaskMobileDraft;
  onChange: (next: MaintenanceTaskMobileDraft) => void;
};

export function StepMobileParams({ draft, onChange }: StepMobileParamsProps) {
  return (
    <StepStationDurationParams
      preferredFacilityPurpose="調度格"
      title="填入待命任務"
      draft={draft}
      onChange={onChange}
      showFollowTemplateCheckbox={true}
    />
  );
}
