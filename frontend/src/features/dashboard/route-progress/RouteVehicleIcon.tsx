import * as LucideIcons from 'lucide-react';
import { Bus } from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';
import {
  VehicleBodySvg,
  isVehicleBodyIcon,
  resolveVehicleIconImageUrl,
} from '../vehicle-operation-actions';

export function RouteVehicleIcon({
  vehicleIcon,
  iconColor,
  iconBgColor,
  size,
  className,
  style,
}: {
  vehicleIcon: string;
  iconColor: string;
  iconBgColor: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  if (isVehicleBodyIcon(vehicleIcon)) {
    return (
      <VehicleBodySvg
        bgColor={iconBgColor}
        size={size}
        className={className}
        style={style}
      />
    );
  }

  const imageUrl = resolveVehicleIconImageUrl(vehicleIcon);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={className}
        style={{
          display: 'block',
          width: Math.max(size, Math.round(size * 1.7)),
          height: Math.max(size, Math.round(size * 1.5)),
          objectFit: 'contain',
          ...style,
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  const IconCmp =
    (LucideIcons as unknown as Record<string, ComponentType<{ size?: number; color?: string }>>)[
      vehicleIcon
    ] ?? Bus;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: iconBgColor,
        ...style,
      }}
    >
      <IconCmp size={size} color={iconColor} />
    </div>
  );
}
