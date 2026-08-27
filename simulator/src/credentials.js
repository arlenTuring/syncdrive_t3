'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 憑證讀取。
 *
 * 全部來自 <code>simulator/.env</code>，那個檔在 .gitignore 裡。憑證不進版控，
 * 也不從網頁輸入——網頁只顯示「哪幾組已設定」，不顯示值，也不接受修改。
 * 要換憑證就改檔案再重開，這比讓一個開在本機的網頁能改動連線密碼安全。
 *
 * 車輛密碼支援兩種寫法：
 *
 * <pre>
 *   MQTT_PMS_01=xxxx     逐台指定
 *   MQTT_PASSWORD_ALL=y  全部共用一組（本地測試用，GCP 上每台不同）
 * </pre>
 */

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function load(rootDir) {
  // 環境變數優先於檔案：CI 或臨時測試不必動到檔案
  const fromFile = parseEnvFile(path.join(rootDir, '.env'));
  const get = (key) => (process.env[key] ?? fromFile[key] ?? '').trim();

  const vehiclePasswords = new Map();
  const shared = get('MQTT_PASSWORD_ALL');
  for (let i = 1; i <= 11; i += 1) {
    const code = `PMS-${String(i).padStart(2, '0')}`;
    const specific = get(`MQTT_${code.replace('-', '_')}`);
    const password = specific || shared;
    if (password) vehiclePasswords.set(code, password);
  }

  return {
    apiKey: get('API_KEY'),
    vehiclePasswords,

    /** 給網頁看的摘要：只說有沒有，不說是什麼 */
    summary() {
      return {
        apiKey: Boolean(this.apiKey),
        vehicleCount: this.vehiclePasswords.size,
        vehicles: [...this.vehiclePasswords.keys()],
      };
    },

    /** 缺哪些必要憑證。有缺就不該讓使用者按下開始然後看一堆連線錯誤。 */
    missing() {
      const missing = [];
      // 模擬器是外部單位，只需要這兩樣：一組對外金鑰、每台車一組 MQTT 密碼。
      // 內部帳密刻意不收——收了就代表這支程式能碰它不該碰的東西。
      if (!this.apiKey) missing.push('API_KEY（對外 API 的 x-api-key）');
      if (this.vehiclePasswords.size === 0) {
        missing.push('車輛 MQTT 密碼（MQTT_PMS_01… 或 MQTT_PASSWORD_ALL）');
      }
      return missing;
    },
  };
}

module.exports = { load };
