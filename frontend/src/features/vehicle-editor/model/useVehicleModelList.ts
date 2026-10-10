import { useCallback, useEffect, useState } from 'react';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { fetchVehicleDefinitions } from '../api/vehicleDefinitionsApi';
import type { VehicleDefinition } from '../types';
import { VEHICLE_MODEL_TAG } from './useMapVehicleModel';

/** 後端的模型清單（選擇器用）；模型新增、修改、刪除時自動重抓 */
export function useVehicleModelList() {
  const [models, setModels] = useState<VehicleDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void fetchVehicleDefinitions()
      .then((list) => {
        setModels(list);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => {
    reload();
    return subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.includes(VEHICLE_MODEL_TAG)) reload();
    });
  }, [reload]);
  return { models, error, reload };
}
