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
   * 要下訂單的任務類型。預設三種全開：
   *
   * <pre>
   *   passenger    載客班次
   *   dispatch     空車移動（整備出廠、入廠、讓站）
   *   maintenance  整備班次（充電、行檢、保養、洗車、臨停、待命）
   * </pre>
   *
   * 三種都要發。空車移動不發，車就一直停在場區，正線班次到點也開不出來；
   * 整備不發，整備格位的佔用狀況、車輛卡片的徽章、班次運行紀錄的整備分頁
   * 全部是空的——整備在這套系統裡是<strong>有訂單的班次</strong>，不是
   * 「停著不動就不用管」。
   */
  get taskTypes(): string[] {
    const raw = (
      process.env.DISPATCH_TASK_TYPES ?? 'passenger,dispatch,maintenance'
    ).trim();
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  },
};
