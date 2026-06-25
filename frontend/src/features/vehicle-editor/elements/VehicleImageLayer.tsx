import { resolveDashboardIconUrl } from '../../dashboard/constants/iconLibrary';
import { isVehicleBodyAsset, resolveVehicleAssetUrl } from '../constants/assetLibrary';
import { isVehicleLightImage } from '../constants/palette';
import type { IconContentMetrics } from '../utils/fitIconBounds';
import { VehicleBodyPillSvg } from './VehicleBodyPillSvg';
import { VehicleContainedIcon } from './VehicleContainedIcon';

export function VehicleImageLayer({
  imageFile,
  tintColor,
  width,
  height,
  onContentMetrics,
}: {
  imageFile: string;
  tintColor?: string;
  width: number;
  height: number;
  onContentMetrics?: (metrics: IconContentMetrics | null) => void;
}) {
  if (isVehicleBodyAsset(imageFile)) {
    return (
      <VehicleBodyPillSvg
        baseColor={tintColor ?? '#3B67AC'}
        boxWidth={width}
        boxHeight={height}
        onMetrics={onContentMetrics}
      />
    );
  }

  const vehicleSrc = resolveVehicleAssetUrl(imageFile);
  const src =
    vehicleSrc && !imageFile.includes('dashboard-icons')
      ? vehicleSrc
      : resolveDashboardIconUrl(imageFile);
  const fitVisibleAlpha = isVehicleLightImage(imageFile);
  return (
    <VehicleContainedIcon
      src={src}
      boxWidth={width}
      boxHeight={height}
      fitVisibleAlpha={fitVisibleAlpha}
      onMetrics={onContentMetrics}
    />
  );
}
