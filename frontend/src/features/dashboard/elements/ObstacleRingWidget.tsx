import { OBSTACLE_DIRECTIONS, type ObstacleRingWidget as ObstacleRingWidgetType } from '../types';
import { useMqttData } from './useMqttData';
import { useIsEditMode } from '../utils/widgetEditPreview';
import {
  evaluateObstacleDirection,
  OBSTACLE_DIRECTION_CELL,
  OBSTACLE_DIRECTION_LABELS,
  OBSTACLE_UNKNOWN_REASON,
} from '../utils/obstacleDirection';

/**
 * 八方向障礙指示：八個點圍成一圈、中央透明，疊在車輛俯視圖周圍。
 *
 * 方向固定以卡片上的車頭（朝上）為準，不跟地圖 heading 轉。八個方向共用這一個 MQTT 訂閱
 * （經車隊共用資料流，不另開連線），每個方向讀自己的 JSON 路徑：
 * - 明確偵測到 → 紅；明確沒有 → 灰
 * - 沒設定、沒資料、斷線、過期、值看不懂 → 灰色半透明＋提示，不畫紅、也不當成確認安全
 */
export function ObstacleRingWidget({ widget }: { widget: ObstacleRingWidgetType }) {
  const isEditMode = useIsEditMode();
  const mqtt = useMqttData({
    mqttDataSourceId: widget.mqttDataSourceId,
    mqttTopic: widget.mqttTopic,
  });
  const payload = mqtt.data && typeof mqtt.data === 'object' ? mqtt.data : null;
  const size = Math.max(2, widget.dotSize ?? 8);

  return (
    <div className="relative h-full w-full" style={{ pointerEvents: 'none' }}>
      {OBSTACLE_DIRECTIONS.map((direction) => {
        const result = evaluateObstacleDirection(payload, widget.directions?.[direction]);
        const cell = OBSTACLE_DIRECTION_CELL[direction];
        const color = result.state === 'detected' ? widget.alertColor : widget.idleColor;
        const title =
          result.state === 'unknown'
            ? `${OBSTACLE_DIRECTION_LABELS[direction]}：未知（${OBSTACLE_UNKNOWN_REASON[result.reason]}）`
            : `${OBSTACLE_DIRECTION_LABELS[direction]}：${result.state === 'detected' ? '偵測到障礙' : '未偵測到'}`;
        return (
          <span
            key={direction}
            data-direction={direction}
            data-state={result.state}
            title={title}
            style={{
              position: 'absolute',
              left: `calc(${cell.col * 50}% - ${(cell.col * size) / 2}px)`,
              top: `calc(${cell.row * 50}% - ${(cell.row * size) / 2}px)`,
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              // 未知：降透明度表示「不知道」，編輯時仍看得到位置
              opacity: result.state === 'unknown' ? (isEditMode ? 0.6 : 0.35) : 1,
              pointerEvents: 'auto',
            }}
          />
        );
      })}
    </div>
  );
}
