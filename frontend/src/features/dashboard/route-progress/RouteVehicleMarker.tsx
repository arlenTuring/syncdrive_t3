import type { CSSProperties } from 'react';
import { RouteVehicleIcon } from './RouteVehicleIcon';

/** 車體錨點對齊路線條垂直中心；作動圖示在車體正上方（設計稿） */
export function RouteVehicleMarker({
  vehicleIcon,
  iconColor,
  iconBgColor,
  vehicleSize,
  actionIconUrl,
  actionSize,
  stationLabel,
  labelColor,
  labelFontSize = 10,
  showGlow = true,
  className,
  vehicleStyle,
}: {
  vehicleIcon: string;
  iconColor: string;
  iconBgColor: string;
  vehicleSize: number;
  actionIconUrl?: string | null;
  actionSize?: number;
  /** 車體下方站名（如 E2），不參與路線垂直置中計算 */
  stationLabel?: string;
  labelColor?: string;
  labelFontSize?: number;
  showGlow?: boolean;
  className?: string;
  vehicleStyle?: CSSProperties;
}) {
  const actSize = actionSize ?? Math.max(14, Math.round(vehicleSize * 0.82));

  return (
    <div className={`relative ${className ?? ''}`}>
      {actionIconUrl && (
        <img
          src={actionIconUrl}
          alt=""
          className="absolute left-1/2 z-10 object-contain pointer-events-none"
          style={{
            bottom: '100%',
            transform: 'translateX(-50%)',
            marginBottom: 2,
            width: actSize,
            height: actSize,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="relative flex items-center justify-center">
        {showGlow && (
          <div
            aria-hidden
            className="absolute rounded-full pointer-events-none"
            style={{
              width: vehicleSize * 2.2,
              height: vehicleSize * 2.2,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background:
                'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, transparent 70%)',
            }}
          />
        )}
        <RouteVehicleIcon
          vehicleIcon={vehicleIcon}
          iconColor={iconColor}
          iconBgColor={iconBgColor}
          size={vehicleSize}
          className="relative z-[1] shadow-md transition-all duration-300"
          style={vehicleStyle}
        />
      </div>
      {stationLabel && (
        <span
          className="absolute left-1/2 z-[1] mt-0 max-w-[56px] -translate-x-1/2 truncate whitespace-nowrap font-bold leading-none"
          style={{
            top: '100%',
            marginTop: 2,
            fontSize: labelFontSize,
            color: labelColor ?? '#f8fafc',
          }}
          title={stationLabel}
        >
          {stationLabel}
        </span>
      )}
    </div>
  );
}
