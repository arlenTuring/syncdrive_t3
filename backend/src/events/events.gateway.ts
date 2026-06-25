import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/** 與 REST 共用 CORS_ORIGIN 設定；留空或 '*' 代表全部放行（僅開發用）。 */
function resolveSocketCorsOrigin(): string | string[] | boolean {
  const raw = (process.env.CORS_ORIGIN ?? '*').trim();
  if (raw === '' || raw === '*') return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

@WebSocketGateway({
  cors: {
    origin: resolveSocketCorsOrigin(),
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(_client: Socket) {
    /* 連線數變動不記錄，避免 HMR／多頁籤洗版 */
  }

  handleDisconnect(_client: Socket) {
    /* 見 handleConnection */
  }

  // 供其他 Service 呼叫以推播資料給前端
  broadcastTelemetry(vehicleCode: string, payload: any) {
    this.server.emit(`telemetry/${vehicleCode}`, payload);
  }

  broadcastHealth(vehicleCode: string, payload: any) {
    this.server.emit(`health/${vehicleCode}`, payload);
  }

  broadcastOperation(vehicleCode: string, payload: any) {
    this.server.emit(`operation/${vehicleCode}`, payload);
  }

  broadcastEvent(payload: any) {
    this.server.emit('security_event', payload);
  }

  /**
   * 通用 MQTT 主題轉發
   * 前端 Widget 透過 Socket.IO 監聽 `mqtt/${topic}` 事件
   * 即可訂閱任意 MQTT 主題的即時資料
   *
   * 例：topic = 'slot/status/E1'
   *   前端 socket.on('mqtt/slot/status/E1', handler)
   */
  broadcastMqttMessage(topic: string, payload: any) {
    this.server.emit(`mqtt/${topic}`, payload);
  }
}
