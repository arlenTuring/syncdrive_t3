/**
 * 時間模板「建議車輛數」：理論下限 vs 實務建議。
 *
 * 理論：N ≥ ceil(完整交路週期 / 班距)。週期須為一整輪（各方向占用＋換線／恢復），
 * 不是單線行駛時間；填短了會低估車數、排班後班距／PPHPD 撐不住。
 *
 * 時段屬性長短：時段太短（小於週期＋一班距）時，延遲與整輪收尾更難消化，
 * 建議在理論下限上再多 1 列備援。
 */

export type FleetRowRecommend = {
  /** ceil(cycle / headway)，穩態理論下限 */
  theoreticalMin: number;
  /** 對時間線列數的建議值（理論＋短時段備援） */
  recommended: number;
  tips: string[];
};

export function recommendFleetRowCount(args: {
  /** 完整交路一輪秒數（去＋回＋…，含折返空檔近似即可） */
  cycleSeconds: number;
  headwaySeconds: number;
  /** 該時間屬性覆蓋長度（秒）；可省略 */
  intervalDurationSeconds?: number | null;
}): FleetRowRecommend | null {
  const cycle = args.cycleSeconds;
  const headway = args.headwaySeconds;
  if (!(cycle > 0) || !(headway > 0)) return null;

  const theoreticalMin = Math.max(1, Math.ceil(cycle / headway));
  const tips: string[] = [
    `理論下限　ceil(交路週期 ${Math.round(cycle)}s ÷ 班距 ${Math.round(headway)}s)＝${theoreticalMin} 列`,
    '交路週期請填完整一輪，勿只填單線；否則建議車數會偏低。',
  ];

  let recommended = theoreticalMin;
  const intervalSec = args.intervalDurationSeconds;
  if (intervalSec != null && intervalSec > 0) {
    const shortThreshold = cycle + headway;
    if (intervalSec < shortThreshold) {
      recommended = theoreticalMin + 1;
      tips.push(
        `此時段約 ${Math.round(intervalSec)}s，短於週期＋班距（${Math.round(shortThreshold)}s）：`
          + `建議至少 ${recommended} 列，較好吸收延遲與整輪收尾。`,
      );
    } else {
      tips.push(
        `此時段約 ${Math.round(intervalSec)}s，長度足以跑完一輪；列數仍須 ≥ ${theoreticalMin}，`
          + '整備占窗時實際可用載客列會更少，可再加列備援。',
      );
    }
  } else {
    tips.push('整備／行前占窗會讓「可用載客列」少於總列數，尖峰可多排 1～2 列。');
  }

  return { theoreticalMin, recommended, tips };
}
