/**
 * T1-C 修復：Socket.IO 全域單例管理器
 *
 * 問題背景：
 *   每個 MQTT Widget 的 useMqttData hook 若各自呼叫 io(url)，
 *   就會建立獨立的 WebSocket 連線（N 個 Widget = N 條連線）。
 *
 * 解決方案：
 *   以後端 URL 為 key 快取 Socket 實例。相同 URL 的所有 Widget
 *   共用同一條連線，僅透過各自的 event listener 分流資料。
 *
 * 連線生命週期：
 *   - 第一個訂閱者建立連線
 *   - 所有訂閱者移除 listener 後，連線保持存在（預留 1 分鐘空閒後斷線）
 *   - 應用重新整理時自然銷毀
 */

import { io, Socket } from 'socket.io-client';

interface ManagedSocket {
  socket: Socket;
  refCount: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const socketPool = new Map<string, ManagedSocket>();

const IDLE_DISCONNECT_MS = 60_000; // 1 分鐘無訂閱者後斷線

/**
 * 取得（或建立）指定 URL 的共用 Socket 實例
 */
export function acquireSocket(url: string): Socket {
  if (socketPool.has(url)) {
    const entry = socketPool.get(url)!;
    // 取消預定的空閒斷線
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.refCount++;
    return entry.socket;
  }

  // 建立新連線（socket.io-client 已有 URL 層級的複用，但這裡明確管理）
  const socket = io(url, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socketPool.set(url, { socket, refCount: 1 });
  return socket;
}

/**
 * 釋放對指定 URL Socket 的引用
 * 當 refCount 降至 0 時，啟動空閒計時器，到期後自動斷線並清除快取
 */
export function releaseSocket(url: string): void {
  const entry = socketPool.get(url);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);

  if (entry.refCount === 0) {
    entry.idleTimer = setTimeout(() => {
      const current = socketPool.get(url);
      if (current && current.refCount === 0) {
        current.socket.disconnect();
        socketPool.delete(url);
      }
    }, IDLE_DISCONNECT_MS);
  }
}
