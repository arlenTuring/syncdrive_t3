export {
  VEHICLE_OPERATION_ACTION_CATALOG,
  VEHICLE_OPERATION_ACTION_ICONS_BASE,
  operationActionIconUrl,
  routeProgressIconUrl,
  type VehicleOperationActionDef,
} from './actionCatalog';
export {
  DEFAULT_VEHICLE_OPERATION_ACTION_RULES,
  DEFAULT_VEHICLE_OPERATION_ACTION_RULES as DEFAULT_ROUTE_ACTION_ICON_RULES,
  buildCatalogActionRules,
} from './defaultActionRules';
export {
  DEFAULT_VEHICLE_ICON_FILE,
  isVehicleIconImage,
  isVehicleBodyIcon,
  resolveVehicleIconImageUrl,
} from './resolveVehicleIcon';
export { VehicleBodySvg } from './VehicleBodySvg';
export {
  VEHICLE_ICON_BG_BY_HEALTH,
  resolveVehicleIconBgColor,
} from './resolveVehicleIconBg';
