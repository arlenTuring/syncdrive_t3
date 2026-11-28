import { useTranslation } from 'react-i18next';
import type { MaintenanceTaskManeuverDraft, MaintenanceTaskMobileDraft } from '../types/create';
import { StepStationDurationParams } from './StepStationDurationParams';

type StepMobileParamsProps = {
  draft: MaintenanceTaskMobileDraft;
  onChange: (next: MaintenanceTaskMobileDraft) => void;
};

export function StepMobileParams({ draft, onChange }: StepMobileParamsProps) {
  const { t } = useTranslation();
  return (
    <StepStationDurationParams
      preferredFacilityPurpose="調度格"
      // 只有待命可以停在正線停靠站候用，其他整備任務一定要進實體設施格
      includeStations
      title={t('maintenanceTasks.mobile.title')}
      draft={draft}
      onChange={onChange}
      showFollowTemplateCheckbox={true}
    />
  );
}

type StepManeuverParamsProps = {
  draft: MaintenanceTaskManeuverDraft;
  onChange: (next: MaintenanceTaskManeuverDraft) => void;
};

/** 機動：備用車的專用停車格。規則跟待命相同（可停正線停靠站），只是設施分開；時長一律照時間模板 */
export function StepManeuverParams({ draft, onChange }: StepManeuverParamsProps) {
  const { t } = useTranslation();
  return (
    <StepStationDurationParams
      preferredFacilityPurpose="調度格"
      includeStations
      title={t('maintenanceTasks.maneuver.title')}
      draft={draft}
      onChange={onChange}
      durationAlwaysFollowsTemplate
    />
  );
}
