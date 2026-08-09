import type { MaintenanceTaskPreTripDraft } from '../types/create';
import { StepStationDurationParams } from './StepStationDurationParams';

type StepPreTripParamsProps = {
  draft: MaintenanceTaskPreTripDraft;
  onChange: (next: MaintenanceTaskPreTripDraft) => void;
};

export function StepPreTripParams({ draft, onChange }: StepPreTripParamsProps) {
  return (
    <StepStationDurationParams
      preferredFacilityPurpose="保養格"
      title="填入行檢任務"
      draft={draft}
      onChange={onChange}
    />
  );
}
