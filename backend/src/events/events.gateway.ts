import { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../access-control/auth.service';
import { readCookie } from '../access-control/access.guard';

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
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private revalidateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly auth: AuthService) {}

  /**
   * 依權限決定可加入的房間。'invalidate' 只送無敏感內容的失效訊號（實際資料仍走有權限的 REST）；
   * 有內容的推播（事件、即時車況）各有專屬權限房間。
   */
  private roomsFor(permissions: Set<string>) {
    const rooms: string[] = [];
    if ([...permissions].some((code) => code.endsWith('.view'))) rooms.push('invalidate');
    if (['dashboard.monitor.view','dashboard.dashboard.view','vehicle.realtime.view','vehicle.trajectory.view','operations.psd-control.view','site.map.view'].some((code) => permissions.has(code))) rooms.push('live');
    if (permissions.has('vehicle.realtime.view')) rooms.push('vehicle-realtime');
    if (permissions.has('events.events.view')) rooms.push('events');
    return rooms;
  }

  async handleConnection(client: Socket) {
    const request = client.request as any;
    const session = await this.auth.authenticate(readCookie(request));
    if (!session) return client.disconnect(true);
    for (const room of this.roomsFor(new Set(session.user.permissions))) client.join(room);
    this.ensureRevalidation();
  }

  handleDisconnect(_client: Socket) {
    /* 見 handleConnection */
  }

  onModuleDestroy() {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
  }

  /**
   * 連線不是只在建立時驗證一次：每 30 秒重新檢查 Session 與權限。
   * 登出、Session 到期、帳號停用 → 斷線；權限被撤銷 → 退出對應房間。
   */
  private ensureRevalidation() {
    if (this.revalidateTimer || process.env.NODE_ENV === 'test') return;
    this.revalidateTimer = setInterval(() => void this.revalidateAll(), 30_000);
    this.revalidateTimer.unref?.();
  }

  async revalidateAll() {
    const sockets = await this.server?.fetchSockets?.();
    for (const socket of sockets ?? []) {
      try {
        const session = await this.auth.authenticate(readCookie({ headers: socket.handshake.headers } as any));
        if (!session) {
          socket.disconnect(true);
          continue;
        }
        const allowed = new Set(this.roomsFor(new Set(session.user.permissions)));
        for (const room of ['invalidate', 'live', 'vehicle-realtime', 'events']) {
          if (allowed.has(room)) socket.join(room);
          else socket.leave(room);
        }
      } catch {
        socket.disconnect(true);
      }
    }
  }

  // 供其他 Service 呼叫以推播資料給前端
  broadcastTelemetry(vehicleCode: string, payload: any) {
    this.server.to('live').emit(`telemetry/${vehicleCode}`, payload);
  }

  broadcastHealth(vehicleCode: string, payload: any) {
    this.server.to('live').emit(`health/${vehicleCode}`, payload);
  }

  broadcastOperation(vehicleCode: string, payload: any) {
    this.server.to('live').emit(`operation/${vehicleCode}`, payload);
  }

  /**
   * 載具即時清單專用的中心端 envelope。payload 保持車端原樣；時間與持久化結果是
   * 中心端 metadata，不回寫 MQTT，也不要求協力廠商新增欄位。
   */
  broadcastVehicleState(payload: {
    vehicleCode: string;
    stream: 'telemetry' | 'operation' | 'health';
    dataAt: number;
    receivedAt: number;
    persisted: boolean;
    payload: Record<string, unknown>;
    derivedLocation?: { label: string | null; kind: string | null; objectId: string | null };
  }) {
    this.server.to('vehicle-realtime').emit('vehicle/state', payload);
  }

  broadcastEvent(payload: any) {
    this.server.to('events').emit('security_event', payload);
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
    this.server.to('live').emit(`mqtt/${topic}`, payload);
  }

  /** SQL 元件：後端寫庫後推送失效標籤，前端訂閱者重查（取代輪詢） */
  broadcastDatasourceInvalidate(payload: { tags: string[]; at: number; reason?: string }) {
    this.server.to('invalidate').emit('datasource/invalidate', payload);
  }

  broadcastLiveStateReset(payload: { vehicleCodes: string[]; at: number }) {
    this.server.to('live').emit('live-state/reset', payload);
  }
}
