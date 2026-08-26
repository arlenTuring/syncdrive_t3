/**
 * 即時調度引擎的部署參數。
 *
 * 全部讀環境變數，理由與車輛即時 ETA 那一組相同：這些是現場會想調的東西，
 * 硬寫在程式裡的話調一個數字就要改版重佈。
 */
function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

export const dispatchConfig = {
  /** 引擎總開關。關閉時完全不下訂單，其餘功能（查詢狀態）仍可用。 */
  get enabled(): boolean {
    return (
      (process.env.DISPATCH_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
    );
  },

  /** 多久檢查一次有沒有該發的班次（秒） */
  get tickSeconds(): number {
    return envInt('DISPATCH_TICK_SECONDS', 5);
  },

  /**
   * 提前多久下訂單（秒）。
   *
   * 車端收到訂單之後要拉任務內容、規劃路徑、開到起點，這些都需要時間。發車前
   * 才下訂單，車一定來不及——所以提早給。太早也不好：計畫可能還會變，而且車端
   * 同時握有太多未來的訂單反而難處理。90 秒是「來得及準備、又還沒久到計畫會變」
   * 的量級，現場可依實際車輛反應時間調整。
   */
  get leadSeconds(): number {
    return envInt('DISPATCH_LEAD_SECONDS', 90);
  },

  /**
   * 補發窗口（秒）。
   *
   * 引擎剛啟動、或當掉一陣子重啟時，會遇到「發車時刻已經過了但訂單沒下」的班次。
   * 在這個窗口內的仍然補發（車輛晚一點出發總比整班消失好）；超過就跳過並記錄，
   * 因為那已經不是「晚一點」而是「這班不用跑了」。
   */
  get catchUpSeconds(): number {
    return envInt('DISPATCH_CATCH_UP_SECONDS', 300);
  },

  /**
   * 要下訂單的任務類型。
   *
   * 預設是<strong>載客班次與空車移動</strong>。空車移動（整備出廠、入廠、讓站）
   * 一定要一起發：車輛沒有出廠訂單就會一直停在場區，正線班次到點也開不出來。
   *
   * 沒有列進來的是充電、行檢、保養、待命、暫停——那些是<strong>停著不動</strong>
   * 的作業，車輛已經被空車移動送到定位了，不需要營運訂單這一層。
   */
  get taskTypes(): string[] {
    const raw = (
      process.env.DISPATCH_TASK_TYPES ?? 'passenger,dispatch'
    ).trim();
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  },
};
