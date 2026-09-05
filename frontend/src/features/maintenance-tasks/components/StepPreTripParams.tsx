import { useTranslation } from 'react-i18next';
import type { MaintenanceTaskPreTripDraft } from '../types/create';
import { StepStationDurationParams } from './StepStationDurationParams';

type StepPreTripParamsProps = {
  draft: MaintenanceTaskPreTripDraft;
  onChange: (next: MaintenanceTaskPreTripDraft) => void;
};

export function StepPreTripParams({ draft, onChange }: StepPreTripParamsProps) {
  const { t } = useTranslation();
  return (
    <StepStationDurationParams
      preferredFacilityPurpose="保養格"
      title={t('maintenanceTasks.preTrip.title')}
      draft={draft}
      onChange={onChange}
    />
  );
}
