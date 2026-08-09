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
      // 只有待命可以停在正線停靠站候用，其他整備任務一定要進實體設施格
      includeStations
      title="填入待命任務"
      draft={draft}
      onChange={onChange}
      showFollowTemplateCheckbox={true}
    />
  );
}
