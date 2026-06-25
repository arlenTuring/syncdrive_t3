import { createUserRestoredVtmsVehicle } from './userRestoredVtmsVehicle';

/** @deprecated 請改用 createUserRestoredVtmsVehicle；保留別名以相容舊程式 */
export function createSampleVtmsVehicle() {
  return createUserRestoredVtmsVehicle();
}

export { createUserRestoredVtmsVehicle, USER_RESTORED_VEHICLE_ID } from './userRestoredVtmsVehicle';
