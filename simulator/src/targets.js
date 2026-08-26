'use strict';

/**
 * 連線目標。
 *
 * 一個目標就是「要跟哪一台伺服器講話」的全部資訊。切換 GCP 與本地<strong>只有
 * 位址不同</strong>——通道、路徑、認證方式完全一樣，這是刻意的：如果本地測得過、
 * GCP 測不過，差異一定出在伺服器，不會是模擬器對兩邊做了不同的事。
 *
 * <h3>三條通道，兩種憑證</h3>
 *
 * <pre>
 *   MQTT      車輛帳密（帳號＝車輛代號）        1883
 *   對外 API  x-api-key                        3100   訂單生命週期
 *   內部 API  Basic Auth                       80     圖資、調度引擎狀態
 * </pre>
 *
 * 對外 API 走 3100 是為了驗證真正的廠商路徑：那個埠只看得到七支對外端點，
 * 其餘一律 404。圖資與調度狀態拿不到就沒得跑，那些走內部埠——模擬器是我方的
 * 測試工具，不是真的廠商，這一點在介面上會標示清楚。
 */

/** 內建目標。UI 可以直接改欄位，改完就是自訂目標。 */
const PRESETS = {
  gcp: {
    id: 'gcp',
    label: 'GCP 測試機',
    host: '34.80.84.224',
    mqttPort: 1883,
    externalApiPort: 3100,
    internalApiPort: 80,
  },
  local: {
    id: 'local',
    label: '本地開發機',
    host: '127.0.0.1',
    // 本地開發時後端直接跑在 3000／3100，前面沒有 nginx
    mqttPort: 1883,
    externalApiPort: 3100,
    internalApiPort: 3000,
  },
};

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

/**
 * 把使用者輸入整理成一個完整目標。
 *
 * 只給 host 就沿用該預設的埠——現場最常見的操作是「同一套系統換一台機器」，
 * 那只有位址會變。
 */
function resolveTarget(input = {}) {
  const base = PRESETS[input.id] ?? PRESETS.gcp;
  const host = String(input.host ?? base.host).trim() || base.host;
  return {
    id: PRESETS[input.id] ? input.id : 'custom',
    label: input.label ?? (host === base.host ? base.label : `自訂（${host}）`),
    host,
    mqttPort: normalizePort(input.mqttPort, base.mqttPort),
    externalApiPort: normalizePort(input.externalApiPort, base.externalApiPort),
    internalApiPort: normalizePort(input.internalApiPort, base.internalApiPort),
  };
}

function mqttUrl(target, vehicleCode, password) {
  const auth = `${encodeURIComponent(vehicleCode)}:${encodeURIComponent(password)}`;
  return `mqtt://${auth}@${target.host}:${target.mqttPort}`;
}

function externalApiBase(target) {
  return `http://${target.host}:${target.externalApiPort}/syncdrive-api`;
}

function internalApiBase(target) {
  const port = target.internalApiPort === 80 ? '' : `:${target.internalApiPort}`;
  return `http://${target.host}${port}/syncdrive-api`;
}

module.exports = {
  PRESETS,
  resolveTarget,
  mqttUrl,
  externalApiBase,
  internalApiBase,
};
