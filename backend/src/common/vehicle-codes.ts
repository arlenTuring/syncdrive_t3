/**
 * VTMS 車隊 vehicle_code：PMS01 ~ PMS11。
 *
 * <h3>為什麼沒有連字號</h3>
 * 舊版《MQTT 通訊架構與 Topic 命名規範》寫 PMS01，中間一版誤植為 01，本系統照
 * 誤植的那版實作。車端廠商逐項比對時問出來，確認連字號是誤勘，代號一律無分隔符號。
 *
 * 這件事不是外觀問題：MQTT 的 topic 與 ACL 都是字串比對。broker 以憑證 CN 當 username，
 * ACL 規則是 `pattern write v1/vtms/%u/#`，CN 與車端發布的路徑差一個字元就整個被拒。
 */
export const VTMS_VEHICLE_CODES = Array.from(
  { length: 11 },
  (_, i) => `PMS${String(i + 1).padStart(2, '0')}`,
) as readonly string[];

export const VTMS_VEHICLE_CODE_PATTERN = /^PMS(0[1-9]|1[0-1])$/;

export const VTMS_VEHICLE_CODE_OR_ALL_PATTERN = /^(all|PMS(0[1-9]|1[0-1]))$/;

/** 改名前的寫法，只在入口用來辨認舊訊息 */
const LEGACY_VEHICLE_CODE_PATTERN = /^PMS-(0[1-9]|1[0-1])$/;

/**
 * 入口正規化：把舊寫法 `01` 收斂成 `PMS01`。
 *
 * 改名當下車端、模擬器、既存的 retain 訊息不會同時換完，舊格式若原樣落進資料庫，
 * 就會生出一批對不上車隊清單的孤兒列——而且不會報錯，只是查不到。入口收掉，
 * 資料庫裡就只會有一種寫法。
 *
 * 認不出來的字串原樣回傳：場域設施（月台門等）也走同一批 topic，不該被改。
 */
export function normalizeVehicleCode(raw: string): string {
  const code = raw.trim();
  if (LEGACY_VEHICLE_CODE_PATTERN.test(code)) return code.replace('-', '');
  return code;
}

/** 顯示與介面都用 PMS01；此函式僅供尚未遷移的舊資料比對用 */
export function isLegacyVehicleCode(raw: string): boolean {
  return LEGACY_VEHICLE_CODE_PATTERN.test(raw.trim());
}
