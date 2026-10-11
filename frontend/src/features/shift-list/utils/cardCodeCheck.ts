import type { GeneratedSchedulePlan } from './schedule-engine/types';
import type { MaintenanceSectionCodeBySection, MaintenanceSectionCodeKey } from './maintenanceSectionCode';
import { resolveGeneratedBlockTripCode } from './maintenanceSectionCode';
import {
  cardCodeKind,
  describeCardCodeConflict,
  findCardCodeConfigIssues,
  findCardCodeConflicts,
  type CardCodeConflict,
  type CardCodeIssue,
  type TransitionCardCodes,
} from './cardCode';

/**
 * 發布前的班次代號檢查（後端 operation-shift/card-code.ts checkShiftCardCodes 是同一套，
 * 發布／部署時後端會再跑一次）：
 * 1. 設定：格式、必填、不同用途共用代號、跟正線路線代號相同；
 * 2. 完整展開後：同一份班表裡最終代號（正線＋整備＋過渡卡）重複。
 * 不同日期允許重複。衝突就擋發布，不自動加列號、秒數或亂數，也不改營運時間。
 * 舊班表（沒有過渡卡代號設定）照舊代號，不在這裡檢查。
 */
export type CardCodeCheck = {
  configIssues: CardCodeIssue[];
  conflicts: CardCodeConflict[];
  /** 給畫面與錯誤訊息：每一筆一行 */
  lines: string[];
};

export function checkPlanCardCodes(args: {
  plan: GeneratedSchedulePlan | null | undefined;
  transitionCodes: TransitionCardCodes | null | undefined;
  sectionCodes: MaintenanceSectionCodeBySection | null | undefined;
  sectionEnabled: Partial<Record<MaintenanceSectionCodeKey, boolean>>;
  maintenanceSkipped: boolean;
  routeCodes: ReadonlyArray<string | null | undefined>;
}): CardCodeCheck {
  const { plan, transitionCodes, sectionCodes } = args;
  if (!transitionCodes) return { configIssues: [], conflicts: [], lines: [] };
  const configIssues = findCardCodeConfigIssues({
    sectionCodes,
    sectionEnabled: args.sectionEnabled,
    transitionCodes,
    maintenanceSkipped: args.maintenanceSkipped,
    routeCodes: args.routeCodes,
  });
  const entries = (plan?.timelines ?? []).flatMap((timeline) =>
    timeline.blocks.map((block, index) => ({
      code: resolveGeneratedBlockTripCode(block, index, sectionCodes ?? null, transitionCodes),
      kind: cardCodeKind(block)?.label ?? (block.taskType === 'passenger' ? '正線' : block.label ?? block.taskType),
      blockId: block.id,
      timelineRow: block.timelineRow,
      plannedStartMinute: block.plannedStartMinute,
    })),
  );
  const conflicts = findCardCodeConflicts(entries);
  return {
    configIssues,
    conflicts,
    lines: [
      ...configIssues.map((issue) => issue.message),
      ...conflicts.map((conflict) => `代號重複 ${describeCardCodeConflict(conflict)}`),
    ],
  };
}

/** 代號設定的指紋：併進發布檢查的設定指紋，改代號後舊的檢查結果作廢 */
export function cardCodeSettingsFingerprint(transitionCodes: TransitionCardCodes | null | undefined): string {
  return transitionCodes ? `card:${transitionCodes.entry}|${transitionCodes.exit}|${transitionCodes.hold}` : 'card:legacy';
}
