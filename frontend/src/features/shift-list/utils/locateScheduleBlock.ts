import { scrollScheduleGridToMinute } from '../../../components/scheduleGridDayCycle';

/**
 * 把班表格線捲到某一張卡片（用確切的 blockId，不靠解析班次名稱）。
 *
 * 先<strong>用時刻算出橫向位置</strong>捲過去，再靠 DOM 做垂直對齊：格線有視窗裁切，
 * 畫面外的卡片根本不在 DOM 裡，只用 getElementById 會找不到、按了沒反應
 * （2026-08-11 使用者回報）。橫向到位之後裁切才會把那張卡畫出來，這時再拿元素做
 * 垂直置中。橫向座標從捲動容器自己量（列號欄＋三份日拷貝，目標落在中間那份）。
 *
 * 垂直只調 scrollTop，橫向<strong>絕對不要碰</strong>：scrollIntoView 就算給
 * inline: 'nearest'，元素橫向不在畫面內時照樣會捲，會把畫面拉去另一份日拷貝。
 */
export function scrollScheduleGridToBlock(
  block: { id: string; plannedStartMinute: number },
  options: { delayMs?: number } = {},
): void {
  const grid = document.querySelector('[data-schedule-grid-scroll]');
  if (grid instanceof HTMLElement) {
    scrollScheduleGridToMinute(grid, block.plannedStartMinute, 48);
  }
  setTimeout(() => {
    const scroller = document.querySelector('[data-schedule-grid-scroll]');
    const el = document.getElementById(`block-card-${block.id}`);
    if (!el || !(scroller instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    const gridRect = scroller.getBoundingClientRect();
    scroller.scrollBy({
      top: rect.top - gridRect.top - scroller.clientHeight / 2 + rect.height / 2,
      behavior: 'smooth',
    });
  }, options.delayMs ?? 120);
}
