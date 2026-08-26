'use strict';

const { externalApiBase, internalApiBase } = require('./targets');

/**
 * 對伺服器的 HTTP 通道。
 *
 * <strong>刻意分成兩個方法而不是一個。</strong>外部呼叫走 3100 埠帶 x-api-key，
 * 內部呼叫走 80 埠帶 Basic Auth。混用會讓「哪些資料廠商真的拿得到」這件事變模糊
 * ——而這正是這個模擬器要驗證的其中一件事：對外埠只看得到七支端點，其餘 404。
 */

const TIMEOUT_MS = 15_000;

class ApiError extends Error {
  constructor(message, status, channel) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.channel = channel;
  }
}

async function request(url, { headers = {}, method = 'GET', body, channel }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(`連不上 ${url}：${reason}`, 0, channel);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      `${method} ${url} 回 ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`,
      res.status,
      channel,
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createApiClient(target, credentials) {
  const externalHeaders = () => ({ 'x-api-key': credentials.apiKey });
  const internalHeaders = () => {
    const raw = `${credentials.internalUser}:${credentials.internalPassword}`;
    return { Authorization: `Basic ${Buffer.from(raw).toString('base64')}` };
  };

  const ext = (path, init = {}) =>
    request(`${externalApiBase(target)}${path}`, {
      ...init,
      headers: { ...externalHeaders(), ...(init.headers ?? {}) },
      channel: 'external',
    });

  const int = (path, init = {}) =>
    request(`${internalApiBase(target)}${path}`, {
      ...init,
      headers: { ...internalHeaders(), ...(init.headers ?? {}) },
      channel: 'internal',
    });

  return {
    target,

    // ── 對外通道（3100 埠，x-api-key）───────────────────────────

    /** 協議 §四：車端拉任務內容 */
    queryOrder(orderId) {
      return ext(`/order/queryById?id=${encodeURIComponent(orderId)}`);
    },

    /** 協議 §五：回報訂單狀態（processing / end / faulted） */
    updateOrderProgress(orderId, status) {
      return ext(
        `/order/updateOrderProgress/${encodeURIComponent(orderId)}?status=${encodeURIComponent(status)}`,
        { method: 'PUT' },
      );
    },

    /** 協議 §五：回報站點動作完成 */
    reportAction(actionId, body) {
      return ext(`/order/action/${encodeURIComponent(actionId)}`, {
        method: 'PUT',
        body,
      });
    },

    /** 對外班表：拿來與收到的訂單對照，驗證計畫時刻一致 */
    timetableTrips() {
      return ext('/operation-shift/timetable/trips');
    },

    /** 對外即時 ETA：驗證我們送出去的遙測有沒有反映到對外介面 */
    etaByVehicle() {
      return ext('/vehicles/eta/by-vehicle');
    },

    // ── 內部通道（80 埠，Basic Auth）────────────────────────────

    /** 圖資本體。設施與停靠點的座標在這裡。 */
    activeMap() {
      return int('/map/library/active');
    },

    /**
     * 站點別名 → 座標。
     *
     * 訂單站序用的是 <code>station_2</code> 這種別名，不是設施數字 id，
     * 所以光有圖資本體查不到。
     */
    operationNodes(mapId) {
      return int(`/map/${encodeURIComponent(mapId)}/operation-nodes`);
    },

    /** 渡線途經點（xo_1_a…）。正線班次的站序會經過。 */
    waypoints(mapId) {
      return int(`/map/${encodeURIComponent(mapId)}/waypoints`);
    },

    /** 調度引擎狀態，UI 用來顯示「伺服器那邊在等什麼」 */
    dispatchStatus() {
      return int('/dispatch/status');
    },

    /** 調度引擎開關。模擬器上線後才需要開，所以放在這一頁最順手。 */
    setDispatchEnabled(enabled) {
      return int('/dispatch/enable', { method: 'POST', body: { enabled } });
    },
  };
}

module.exports = { createApiClient, ApiError };
