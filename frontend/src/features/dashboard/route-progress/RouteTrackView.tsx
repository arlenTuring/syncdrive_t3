import type { RouteProgressWidget, RouteStation } from '../types';
import { RouteVehicleMarker } from './RouteVehicleMarker';

const LINE_H = 2;
const VEHICLE_SIZE = 10;
const STATION_LABEL_FS = 14;

function stationLabelFontSize(widget: RouteProgressWidget): number {
  return widget.fontSize ?? STATION_LABEL_FS;
}

function currentStationIndex(
  stations: RouteStation[],
  minVal: number,
  range: number,
  progressPercent: number,
): number {
  if (stations.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  stations.forEach((station, i) => {
    const stationPercent = ((station.value - minVal) / range) * 100;
    const dist = Math.abs(stationPercent - progressPercent);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export function RouteTrackView({
  widget,
  stations,
  progressPercent,
  vehicleIconBg,
  actionIconUrl,
  isPending = false,
}: {
  widget: RouteProgressWidget;
  stations: RouteStation[];
  progressPercent: number;
  vehicleIconBg: string;
  actionIconUrl: string | null;
  isPending?: boolean;
  /** @deprecated 站名僅顯示於站點圓點下方 */
  vehicleStationLabel?: string;
}) {
  const minVal = stations.length > 0 ? stations[0].value : 0;
  const maxVal = stations.length > 0 ? stations[stations.length - 1].value : 100;
  const range = maxVal - minVal || 1;
  const trackStyle = widget.trackStyle ?? 'mainline';
  const currentIdx = isPending ? 0 : currentStationIndex(stations, minVal, range, progressPercent);
  const lineFillPercent = isPending ? 0 : progressPercent;
  const vehiclePercent = isPending ? 0 : progressPercent;

  return (
    <div className="relative w-full h-full flex flex-col justify-center" style={{ padding: '0 28px' }}>
      <div className="relative w-full" style={{ height: LINE_H, marginTop: 8, marginBottom: 28 }}>
        <div
          className="absolute inset-0"
          style={{ backgroundColor: widget.inactiveColor, height: LINE_H }}
        />
        <div
          className="absolute left-0 top-0"
          style={{
            width: `${lineFillPercent}%`,
            height: LINE_H,
            backgroundColor: widget.activeColor,
          }}
        />

        {stations.map((station, index) => {
          const stationPercent = ((station.value - minVal) / range) * 100;
          const isStart = index === 0;
          const isEnd = index === stations.length - 1;
          const isCurrent = index === currentIdx;

          let dotSize = 6;
          let dotColor = '#51A2FF';
          let labelColor = '#51A2FF';
          let labelOpacity = 1;
          let glow: string | undefined;

          if (isPending && trackStyle === 'mainline') {
            if (isStart) {
              dotSize = 10;
              dotColor = '#fafafa';
              labelColor = '#F3F4F6';
              glow = '0 0 20px rgba(255,255,255,0.45)';
            } else {
              dotSize = 6;
              dotColor = '#99A1AF';
              labelColor = '#99A1AF';
              labelOpacity = 0.55;
            }
          } else if (trackStyle === 'maintenance') {
            if (isCurrent) {
              dotSize = 10;
              dotColor = '#99A1AF';
              labelColor = '#F3F4F6';
            } else if (isEnd) {
              dotColor = '#99A1AF';
              labelColor = '#99A1AF';
            } else if (isStart) {
              dotColor = '#51A2FF';
              labelColor = '#51A2FF';
            }
          } else if (isStart) {
            dotSize = 10;
            dotColor = '#99A1AF';
            labelColor = '#F3F4F6';
            glow = '0 0 20px #F3F4F6';
          }

          return (
            <div
              key={station.id}
              className="absolute z-10 flex flex-col items-center"
              style={{
                left: `${stationPercent}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  boxShadow: glow,
                }}
              />
              <div
                className="absolute top-full mt-1 max-w-[80px] truncate whitespace-nowrap"
                style={{
                  fontSize: stationLabelFontSize(widget),
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  color: labelColor,
                  opacity: labelOpacity,
                }}
                title={station.name}
              >
                {station.name}
              </div>
            </div>
          );
        })}

        <div
          className="absolute z-20"
          style={{
            left: `${vehiclePercent}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <RouteVehicleMarker
            vehicleIcon={widget.vehicleIcon}
            iconColor={widget.iconColor}
            iconBgColor={vehicleIconBg}
            vehicleSize={VEHICLE_SIZE}
            actionIconUrl={actionIconUrl}
            labelColor={isPending ? '#99A1AF' : widget.activeColor}
            labelFontSize={stationLabelFontSize(widget)}
            showGlow={false}
            vehicleStyle={{ borderRadius: 4, opacity: isPending ? 0.85 : 1 }}
          />
        </div>
      </div>
    </div>
  );
}
