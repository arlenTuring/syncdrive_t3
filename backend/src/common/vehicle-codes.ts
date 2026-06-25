/** VTMS 車隊 vehicle_code：PMS-01 ~ PMS-11 */
export const VTMS_VEHICLE_CODES = Array.from(
  { length: 11 },
  (_, i) => `PMS-${String(i + 1).padStart(2, '0')}`,
) as readonly string[];

export const VTMS_VEHICLE_CODE_PATTERN = /^PMS-(0[1-9]|1[0-1])$/;

export const VTMS_VEHICLE_CODE_OR_ALL_PATTERN = /^(all|PMS-(0[1-9]|1[0-1]))$/;
