import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  SCHEDULE_DAY_MINUTES,
  wrapScheduleMinute,
} from '../features/shift-list/utils/scheduleDayCycle';

/**
 * 甘特格線的「日循環無限捲動」共用機制
 * ====================================
 *
 * 班表調整（ShiftSchedulePlanGrid）與時間模板任務排班（StepTaskScheduling）
 * 是同一種格線：橫軸一天、縱軸列、卡片絕對定位。兩邊都需要
 *
 * <ol>
 *   <li>往左滑過 00:00 會接到前一天的 23:xx，往右滑過 23:50 會接回 00:00，
 *       而且可以一直滑；</li>
 *   <li>跨午夜的卡片看起來是連續的一張，不是被日界切成兩段；</li>
 *   <li>卡面文字捲到哪跟到哪，貼齊可視左緣直到卡片捲完。</li>
 * </ol>
 *
 * 這些先在班表那側做出來，抽到這裡共用——同一件事寫兩份是這個專案反覆出問題
 * 的來源（班次代號、設施佔用表、站位佔用都各踩過一次），格線這種到處都有
 * 座標運算的東西尤其不能再來一次。
 *
 * <strong>做法：左右各接一份完全一樣的一天，共三份。</strong>
 * 捲到側邊那份就把 <code>scrollLeft</code> 平移一天回到中間；三份內容相同，
 * 平移的瞬間畫面沒有任何變化，使用者只覺得可以一直往同一個方向滑。
 * 兩份不夠——原生捲動在 <code>scrollLeft = 0</code> 就停住，偵測不到
 * 「還想再往左」，左右都要留一份。
 */
export const DAY_COPY_COUNT = 3;

/** 中間那一份的索引；DOM id、鍵盤焦點這種「整份文件只能有一個」的東西掛在它身上 */
export const PRIMARY_DAY_COPY_INDEX = 1;

/**
 * 視窗裁切：只畫捲動視窗附近的卡片。
 *
 * 三份拷貝等於三倍 DOM。但日寬遠大於視窗寬，一次只看得到一天的一小部分，
 * 照視窗裁切之後<strong>比原本只畫一份還少</strong>——原本是整天全畫。
 *
 * 兩個參數是為了「不卡頓」：
 * <ul>
 *   <li>BUCKET：視窗量化到整點格，捲動時只有跨過格界才重新 render，
 *       不是每一幀都重算 React 樹。</li>
 *   <li>OVERSCAN：多畫視窗外的一段。餘量比量化格大，所以下一格的內容
 *       在跨界之前就已經在 DOM 裡，不會捲到才長出來。</li>
 * </ul>
 */
export const CULL_BUCKET_MINUTES = 60;
export const CULL_OVERSCAN_MINUTES = 180;

/** 目前要畫的虛擬分鐘區間；虛擬分鐘＝第幾份拷貝 × 1440 ＋ 鐘面分鐘 */
export type DayCycleViewWindow = {
  startMinute: number;
  endMinute: number;
};

/**
 * 一段時間是否落在裁切視窗內。
 *
 * @param copyIndex 第幾份日拷貝（0、1、2）
 * @param spans 這張卡在鐘面上實際佔用的區間；跨午夜會有兩段
 */
export function isWithinDayCycleWindow(
  window: DayCycleViewWindow,
  copyIndex: number,
  spans: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  const copyStartMinute = copyIndex * SCHEDULE_DAY_MINUTES;
  return spans.some(
    (span) =>
      copyStartMinute + span.end > window.startMinute
      && copyStartMinute + span.start < window.endMinute,
  );
}

/**
 * 掛在捲動容器上的無限捲動機制。
 *
 * @param slotWidthPx  一格的寬度
 * @param slotMinutes  一格代表幾分鐘
 * @param rowLabelWidth 左側常駐列號欄的寬度（它會蓋住格線左緣）
 */
export function useDayCycleGridScroll<T extends HTMLElement>(args: {
  slotWidthPx: number;
  slotMinutes: number;
  rowLabelWidth: number;
}): {
  scrollRef: React.RefObject<T | null>;
  /** 一天的像素寬 */
  dayWidthPx: number;
  /** 整條軌道（三份）的像素寬，不含列號欄 */
  totalTrackWidthPx: number;
  /** [0, 1, 2]，給 map 用 */
  dayCopies: number[];
  viewWindow: DayCycleViewWindow;
} {
  const { slotWidthPx, slotMinutes, rowLabelWidth } = args;
  const slotsPerDay = SCHEDULE_DAY_MINUTES / slotMinutes;
  const dayWidthPx = slotsPerDay * slotWidthPx;

  const scrollRef = useRef<T | null>(null);
  /** 畫面正中央是幾點（鐘面分鐘）；縮放後拿它把視角放回原處 */
  const centerMinuteRef = useRef(0);
  const positionedRef = useRef(false);
  const [viewWindow, setViewWindow] = useState<DayCycleViewWindow>({
    startMinute: SCHEDULE_DAY_MINUTES - CULL_OVERSCAN_MINUTES,
    endMinute: SCHEDULE_DAY_MINUTES + CULL_OVERSCAN_MINUTES * 2,
  });

  const syncViewWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el || slotWidthPx <= 0) return;
    const minutesPerPx = slotMinutes / slotWidthPx;
    // 軌道從 rowLabelWidth 開始（左側列號欄佔掉的那一段）
    const rawStart = (el.scrollLeft - rowLabelWidth) * minutesPerPx;
    const rawEnd = rawStart + el.clientWidth * minutesPerPx;
    centerMinuteRef.current = wrapScheduleMinute((rawStart + rawEnd) / 2);
    const startMinute =
      Math.floor((rawStart - CULL_OVERSCAN_MINUTES) / CULL_BUCKET_MINUTES)
      * CULL_BUCKET_MINUTES;
    const endMinute =
      Math.ceil((rawEnd + CULL_OVERSCAN_MINUTES) / CULL_BUCKET_MINUTES)
      * CULL_BUCKET_MINUTES;
    setViewWindow((prev) =>
      prev.startMinute === startMinute && prev.endMinute === endMinute
        ? prev
        : { startMinute, endMinute },
    );
  }, [rowLabelWidth, slotMinutes, slotWidthPx]);

  /**
   * 捲到側邊那一份就平移一天回到中間。三份內容一樣，平移的瞬間畫面沒有變化。
   *
   * 門檻抓在半天：進到側邊拷貝的一半才跳，離視窗邊緣還很遠，
   * 觸控板慣性甩動時不會一直在門檻上來回觸發。
   * 日寬小於視窗寬時不繞——那表示整天都看得完，繞了也沒意義。
   */
  const recentreScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || dayWidthPx <= 0 || dayWidthPx <= el.clientWidth) return;
    const x = el.scrollLeft;
    if (x < dayWidthPx * 0.5) el.scrollLeft = x + dayWidthPx;
    else if (x > dayWidthPx * 1.5) el.scrollLeft = x - dayWidthPx;
  }, [dayWidthPx]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      // 一幀最多算一次：捲動事件的頻率遠高於畫面更新，逐事件重算是白費的
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        recentreScroll();
        syncViewWindow();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => syncViewWindow());
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [recentreScroll, syncViewWindow]);

  // 首次進場停在中間那份的 00:00；之後格寬改變（縮放）時保留原本看的時刻，
  // 不然按一次 ＋ 畫面就跳到別的時段去了。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!positionedRef.current) {
      positionedRef.current = true;
      el.scrollLeft = dayWidthPx;
    } else {
      const centerPx = (centerMinuteRef.current / slotMinutes) * slotWidthPx;
      el.scrollLeft = Math.max(
        0,
        dayWidthPx + centerPx + rowLabelWidth - el.clientWidth / 2,
      );
    }
    syncViewWindow();
  }, [dayWidthPx, rowLabelWidth, slotMinutes, slotWidthPx, syncViewWindow]);

  const dayCopies = useMemo(
    () => Array.from({ length: DAY_COPY_COUNT }, (_, index) => index),
    [],
  );

  return {
    scrollRef,
    dayWidthPx,
    totalTrackWidthPx: dayWidthPx * DAY_COPY_COUNT,
    dayCopies,
    viewWindow,
  };
}
