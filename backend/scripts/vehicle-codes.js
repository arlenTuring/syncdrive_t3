/** VTMS 車隊 vehicle_code：PMS-01 ~ PMS-11 */
const VTMS_VEHICLE_CODES = Array.from(
  { length: 11 },
  (_, i) => `PMS-${String(i + 1).padStart(2, '0')}`,
);

const VTMS_VEHICLE_CODE_PATTERN = /^PMS-(0[1-9]|1[0-1])$/;

const VTMS_VEHICLE_CODE_OR_ALL_PATTERN = /^(all|PMS-(0[1-9]|1[0-1]))$/;

module.exports = {
  VTMS_VEHICLE_CODES,
  VTMS_VEHICLE_CODE_PATTERN,
  VTMS_VEHICLE_CODE_OR_ALL_PATTERN,
};
