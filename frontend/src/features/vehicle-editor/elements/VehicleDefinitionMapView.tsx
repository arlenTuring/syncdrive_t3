import { VariableProvider } from '../../dashboard/VariableContext';
import type { VehicleDefinition } from '../types';
import {
  computeVehicleMapRenderBounds,
  isLandscapeVehicleDefinition,
  mapDisplayContentSize,
} from '../utils/vehicleContentBounds';
import { mapVehiclePivotRotateDeg } from '../../map-editor/vehicles/readVehicleHeading';
import { computeVehicleRearAxleAnchorPx } from '../utils/vehicleRearAxleAnchor';
import { VehicleElementRenderer } from './VehicleElementRenderer';

export type VehicleMapLayoutMode = 'fill-container' | 'rear-axle-pivot';

/**
 * 圖台上的車體文字一律轉回正立。
 *
 * 這裡原本只在車接近水平（rotate≈0°/180°）時才把文字轉回來，縱向行駛時讓文字跟著
 * 車體轉。結果是車一轉直，車號就變成直式的，要歪著頭看——而車號正是圖台上最常要
 * 讀的東西。
 *
 * 車體轉是為了表達行進方向，文字轉沒有表達任何東西。所以文字一律抵消外層的旋轉。
 */
function shouldCounterRotateMapText(): boolean {
  return true;
}

function VehicleElementsLayer({
  vehicle,
  definition,
  renderBounds,
  livePayloadOnly,
  textCounterRotateDeg = null,
}: {
  vehicle: VehicleDefinition;
  definition: VehicleDefinition;
  renderBounds: { x: number; y: number; width: number; height: number };
  livePayloadOnly: boolean;
  /** 圖台 rear-axle-pivot：橫向時抵消外層 heading，文字保持正立 */
  textCounterRotateDeg?: number | null;
}) {
  return (
    <div
      className="relative overflow-visible"
      style={{
        width: definition.width,
        height: definition.height,
        left: -renderBounds.x,
        top: -renderBounds.y,
      }}
    >
      {vehicle.elements.map((el) => {
        const counterText =
          textCounterRotateDeg != null &&
          Number.isFinite(textCounterRotateDeg) &&
          el.type === 'text' &&
          shouldCounterRotateMapText();

        const parts: string[] = [];
        if (el.rotationDeg) parts.push(`rotate(${el.rotationDeg}deg)`);
        if (counterText) parts.push(`rotate(${-textCounterRotateDeg}deg)`);

        return (
          <div
            key={el.id}
            className="absolute overflow-visible"
            style={{
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              zIndex: el.type === 'text' ? 20 : 10,
            }}
          >
            <div
              className="relative h-full w-full"
              style={{
                transform: parts.length > 0 ? parts.join(' ') : undefined,
                transformOrigin: 'center center',
              }}
            >
              <VehicleElementRenderer
                element={el}
                vehicle={vehicle}
                isEditMode={false}
                livePayloadOnly={livePayloadOnly}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 載具樣板顯示。
 * - fill-container：儀表板載具容器／校準框，車體填滿外框
 * - rear-axle-pivot：圖台即時車輛，後軸對齊外層錨點並繞後軸旋轉
 */
export function VehicleDefinitionMapView({
  definition,
  liveData,
  displayWidth,
  displayHeight,
  fitMode = 'contain',
  layoutMode = 'fill-container',
  livePayloadOnly = false,
  mapHeadingRad,
  mapSteeringRad,
  mapRotateDeg,
}: {
  definition: VehicleDefinition;
  liveData?: Record<string, unknown>;
  displayWidth: number;
  displayHeight: number;
  fitMode?: 'contain' | 'stretch';
  layoutMode?: VehicleMapLayoutMode;
  livePayloadOnly?: boolean;
  mapHeadingRad?: number | null;
  mapSteeringRad?: number | null;
  /**
   * 圖台指定的車體旋轉角（度，順時針）。
   *
   * 圖台是示意圖：同一段路在現場是南北向，圖上卻可能畫成橫的帶子，所以車該轉幾度要由
   * 呼叫端照「那一塊畫出來的方向」算，不能在這裡拿 heading 自己轉。有給就用這個值。
   */
  mapRotateDeg?: number | null;
}) {
  const renderBounds = computeVehicleMapRenderBounds(definition);
  const display = mapDisplayContentSize(definition, renderBounds);
  const scaleX = displayWidth / Math.max(1, display.width);
  const scaleY = displayHeight / Math.max(1, display.height);
  const uniformScale = Math.min(scaleX, scaleY);
  const landscape = isLandscapeVehicleDefinition(definition);

  const vehicle: VehicleDefinition = {
    ...definition,
    previewData: {
      ...(definition.previewData ?? {}),
      ...(liveData ?? {}),
    },
  };

  const sx = fitMode === 'stretch' ? scaleX : uniformScale;
  const sy = fitMode === 'stretch' ? scaleY : uniformScale;
  const scalePart = fitMode === 'stretch' ? `scale(${sx}, ${sy})` : `scale(${sx})`;

  if (layoutMode === 'rear-axle-pivot') {
    const pivot = computeVehicleRearAxleAnchorPx(
      definition,
      displayWidth,
      displayHeight,
      fitMode,
    );
    const pivotRotateDeg = mapVehiclePivotRotateDeg(
      mapHeadingRad,
      landscape,
      mapSteeringRad,
    );
    const rotateDeg =
      mapRotateDeg != null && Number.isFinite(mapRotateDeg)
        ? mapRotateDeg
        : pivotRotateDeg != null
          ? pivotRotateDeg
          : landscape
            ? 0
            : -90;
    const transform = `rotate(${rotateDeg}deg) ${scalePart}`;

    return (
      <div
        className="pointer-events-none relative"
        style={{ width: displayWidth, height: displayHeight, overflow: 'visible' }}
      >
        <VariableProvider variables={{}}>
          {/*
            外層 MapAreaVehicleOverlay 已把顯示框後軸對齊 MQTT 錨點（粉色十字）。
            此層在框內擺放載具，使後軸落在 pivot，並繞後軸旋轉。
          */}
          <div
            className="absolute"
            style={{
              // transform-origin 為內容未縮放 px；左上角須使後軸落在 pivot（顯示 px）
              left: pivot.x - pivot.contentX,
              top: pivot.y - pivot.contentY,
              width: display.width,
              height: display.height,
              transform,
              transformOrigin: `${pivot.contentX}px ${pivot.contentY}px`,
            }}
          >
            <VehicleElementsLayer
              vehicle={vehicle}
              definition={definition}
              renderBounds={renderBounds}
              livePayloadOnly={livePayloadOnly}
              textCounterRotateDeg={rotateDeg}
            />
          </div>
        </VariableProvider>
      </div>
    );
  }

  const rotateDeg = landscape ? 0 : -90;
  const transform = `translate(-50%, -50%) rotate(${rotateDeg}deg) ${scalePart}`;

  return (
    <div
      className="pointer-events-none relative"
      style={{ width: displayWidth, height: displayHeight, overflow: 'visible' }}
    >
      <VariableProvider variables={{}}>
        <div
          className="absolute"
          style={{
            left: displayWidth / 2,
            top: displayHeight / 2,
            width: renderBounds.width,
            height: renderBounds.height,
            transform,
            transformOrigin: 'center center',
          }}
        >
          <VehicleElementsLayer
            vehicle={vehicle}
            definition={definition}
            renderBounds={renderBounds}
            livePayloadOnly={livePayloadOnly}
          />
        </div>
      </VariableProvider>
    </div>
  );
}
