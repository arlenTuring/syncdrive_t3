import type { PointTopology } from '../../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../../map-editor/types/area';
import type { ShiftScheduleCreateDraft } from '../../types/create';
import type { MaintenanceFirstTripOrigin } from '../maintenanceFirstTripOrigins';
import { insertMaintenanceEntryServiceTrips } from '../insertMaintenanceEntryServiceTrips';
import { insertMaintenanceTransferCards } from '../insertMaintenanceTransferCards';
import { computeScheduleGateOk } from '../scheduleAcceptance';
import type {
  FeasibilityIssue,
  FeasibilityViolationCode,
  GeneratedSchedulePlan,
  GeneratedScheduleTimeline,
  GenerateShiftScheduleResult,
  ScheduleServiceMetrics,
  SchedulingContext,
} from './types';
import {
  normalizeEngineInput,
  type PassengerTimetableMode,
} from './normalizeInput';
import {
  expandRowBlocks,
  groupTasksByRow,
  resolveTemplateTasks,
} from './expand';
import {
  routeAssignmentAlgorithmId,
  resolveLockedRotationMinSeconds,
} from './routeSuccessorPolicy';
import {
  validatePassengerHeadway,
  validateRouteSwitchBuffers,
  validateTimelineCapacity,
  validateTimelineOverlaps,
  validateTurnaroundLimits,
  validateRotationCyclesComplete,
  validateStationTimingsWithinBlocks,
  validateStationBerthCollisions,
  validateYardExitContinuity,
  validateFacilityOccupancy,
} from './validate';
import {
  enforceStationBerthConstraints,
  STATION_BERTH_WAIT_MAX_DELAY_SECONDS,
  type BerthDelayRecord,
} from '../stationBerthConstraint';
import { densifyRouteHeadwaysAfterBerth } from '../densifyRouteHeadwaysAfterBerth';
import { repairRouteHeadwaysBelowTarget } from '../repairRouteHeadwaysBelowTarget';
import { alignRouteWithVehicleLocation } from '../alignRouteWithVehicleLocation';
import { alignRouteWithMaintenanceEntry } from '../alignRouteWithMaintenanceEntry';
import { yieldIdleBlockArrival } from '../yieldIdleBlockArrival';
import { evenOutRouteHeadwayPhase } from '../evenOutRouteHeadwayPhase';
import { relievePlatformIdleWithSecondaryEdge } from '../relievePlatformIdleWithSecondaryEdge';
import { relievePlatformIdleWithFacilityPark } from '../relievePlatformIdleWithFacilityPark';
import { closeYardHeadGaps } from '../closeYardHeadGaps';
import { fillYardHoldGaps } from '../fillYardHoldGaps';
import { trimIncompleteRotationCyclesOnTimelines } from '../trimIncompleteRotationCycles';

import {
  applyMainlineMaintenanceEntryYield,
  pushPassengerPastPrecedingYard,
} from '../mainlineMaintenanceEntryYield';
import { tagYardDispatchTrips, scrubMidMainlineDispatchArtifacts } from './tagYardDispatchTrips';
import { pushIssue } from './feasibilityIssueMeta';
import {
  comparePlanScores,
  formatPlanScore,
  scoreSchedulePlan,
  type PlanScore,
} from './scorePlan';

export type GenerateShiftScheduleInput = {
  shiftId?: string;
  draft: ShiftScheduleCreateDraft;
  templateBody: Record<string, unknown>;
  maintenanceTaskBody?: Record<string, unknown> | null;
  /** 1.6 車輛折返時限（秒）；與 Step 4 同源，由 adapter 自模板推導 */
  turnaroundLimitSeconds?: number | null;
  /**
   * template：沿用模板正線錨點（預設，相容既有模板任務）
   * headway：依班距自動生成正線時刻並掛時間線（§4.2；建立班表 adapter 使用）
   */
  passengerTimetableMode?: PassengerTimetableMode;
  /** 目前啟用地圖拓樸抽出的首班起點站；未傳則不插調度 */
  firstTripOrigins?: MaintenanceFirstTripOrigin[];
  /** 完整路網拓樸；整備／調度入廠卡尋路用 */
  pointTopology?: PointTopology | null;
  /** 地圖場域管理模組的 Area 容器清單；整備間轉場判斷「兩座設施是不是同一區域」用 */
  areas?: MapAreaObject[] | null;
};

/**
 * 幾何後處理收斂迴圈的輪數上限。
 * 正常 2–3 輪就不動了；上限只是防呆，避免互相破壞的處理無限來回。
 */
const GEOMETRY_CONVERGENCE_MAX_ROUNDS = 14;

/** 站位延後成因最多逐則列出幾個擋路點，其餘收成一則匯總 */
const BERTH_DELAY_SOURCE_REPORT_LIMIT = 10;

/**
 * 版面指紋：把每個區塊的「身分＋起迄」壓成字串，用來判斷這一輪有沒有任何變化。
 * 只看時間與存在與否——這正是幾何後處理會改動的東西。
 */
function fingerprintTimelines(
  timelines: GeneratedSchedulePlan['timelines'],
): string {
  const parts: string[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      // 指紋要含<strong>路線</strong>，不能只有時刻。
      //
      // 迴圈裡有兩道會「只換路線、不動時刻」的處理（改停別的站位、
      // 配合車輛停放位置改派）。換路線＝換停靠站＝站位佔用整個變了，
      // 但時刻沒動——指紋只看時刻的話，迴圈會判定「這輪沒變化」直接收工，
      // 那些新產生的站位衝突<strong>永遠不會被求解</strong>。
      //
      // 同理也要含<strong>格位／站位</strong>：closeYardHeadGaps 改整備開始時刻
      // 會被時刻抓到，但改派到另一格設施、或改成另一個進出廠停靠站，若時刻與路線
      // 剛好都沒動，只看前面那幾項一樣看不出這輪有變化——換過去的那一格會不會撞人
      // 因此永遠不會被下一輪重新驗證。
      parts.push(
        `${timeline.row}|${block.id}|${block.plannedStartMinute}|${block.plannedEndMinute}`
        + `|${block.routeInstanceId ?? block.routeId ?? ''}`
        + `|${block.yardFacilityNodeId ?? ''}|${block.yardFacilityStationId ?? ''}`
        + `|${block.yardExitFacilityNodeId ?? ''}|${block.yardExitStationId ?? ''}`,
      );
    }
  }
  parts.sort();
  return parts.join('\n');
}

/**
 * 排班引擎主入口：依策略文件 1.1–1.8、S1–S4 與優化算法展開班表。
 */
export function generateShiftSchedule(
  input: GenerateShiftScheduleInput,
): GenerateShiftScheduleResult {
  const errors: FeasibilityIssue[] = [];
  const warnings: FeasibilityIssue[] = [];

  const engineInput = normalizeEngineInput(
    {
      shiftId: input.shiftId,
      draft: input.draft,
      templateBody: input.templateBody,
      maintenanceTaskBody: input.maintenanceTaskBody,
      turnaroundLimitSeconds: input.turnaroundLimitSeconds,
      passengerTimetableMode: input.passengerTimetableMode ?? 'template',
      firstTripOrigins: input.firstTripOrigins,
      pointTopology: input.pointTopology,
      areas: input.areas,
    },
    errors,
    warnings,
  );

  if (!engineInput) {
    return { plan: null, report: { ok: false, errors, warnings } };
  }

  const ctx: SchedulingContext = {
    shiftId: engineInput.shiftId,
    scheduleRowCount: engineInput.scheduleRowCount,
    passengerRoutes: engineInput.passengerRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    successorPolicy: engineInput.successorPolicy,
  };

  validateTurnaroundLimits(
    engineInput.selectedRoutes,
    engineInput.minimumRecoveryTimeSeconds,
    engineInput.turnaroundLimitSeconds,
    errors,
    warnings,
    resolveLockedRotationMinSeconds(engineInput.successorPolicy),
  );

  const resolvedByTaskId = resolveTemplateTasks(
    engineInput.confirmedTasks,
    ctx,
    engineInput.maintenanceBody,
    errors,
    warnings,
    engineInput.firstTripOrigins,
  );

  const tasksByRow = groupTasksByRow(engineInput.confirmedTasks);
  let timelines: GeneratedSchedulePlan['timelines'] = [];

  for (let row = 1; row <= engineInput.scheduleRowCount; row += 1) {
    const rowTasks = tasksByRow.get(row) ?? [];
    const blocks = expandRowBlocks(
      rowTasks,
      resolvedByTaskId,
      errors,
      engineInput.minimumRecoveryTimeSeconds,
      engineInput.passengerRoutes,
    );
    if (blocks.length > 0) {
      timelines.push({ row, blocks });
    }
  }

  timelines = insertMaintenanceEntryServiceTrips({
    timelines,
    selectedRoutes: [
      ...engineInput.selectedRoutes,
      ...engineInput.backupRoutes,
    ],
    firstTripOrigins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  });

  // 站位約束需要全選路線（含草稿相容 backupFor*）；輪替仍只用主路線
  const routesForBerth = [
    ...engineInput.selectedRoutes,
    ...engineInput.backupRoutes,
  ];

  // 待命要停在哪，必須在站位求解<strong>之前</strong>就決定。
  //
  // 待命停在正線停靠站等於把那一格佔住整段時間，站位求解器要有機會閃避
  // （延後發車、改派備用路線、讓渡）。但插卡必須等時刻定案後才能做——卡要貼齊
  // 下一段發車。所以拆成兩趟：這裡只決定地點寫進區塊，迴圈跑完再插卡。
  //
  // 只決定一次、不在迴圈裡每輪重算：地點若跟著求解結果一直變，會跟求解器互相
  // 追著跑，而收斂判定看的是時刻指紋、抓不到這種來回。時刻在迴圈裡的漂移
  // 由最後的站位驗證負責回報。
  insertMaintenanceTransferCards({
    timelines,
    topology: engineInput.pointTopology,
    areas: engineInput.areas,
    maintenanceBody: engineInput.maintenanceBody,
    selectedRoutes: engineInput.selectedRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    decideOnly: true,
  });

  // ── 幾何後處理：收斂迴圈 ────────────────────────────────────────────────
  //
  // 這幾道處理彼此會互相破壞：站位延後把班距擠亂、補班距又把班次推進整備、
  // 讓渡與推移再把站位擠回衝突、撤掉不成輪尾巴又釋放出新的空檔。
  //
  // 舊版是一段手工排定的固定序列（讓渡×3、站位×2、推移×3、班距修復×1），
  // 順序全靠試出來，且必然漏接——最典型的是：trim 撤掉不成輪尾巴所釋放的站位，
  // 班距修復早就跑完了看不到，那些落差就一路留到 validate 變成 HEADWAY_BELOW_TARGET。
  //
  // 改為跑到不動點：每輪跑完整組處理，版面沒有任何變化就結束。
  // 這樣「某一步釋放的空間，下一輪其他步驟就能用到」，不必人工推演順序。
  /**
   * 站位延後的成因紀錄簿，<strong>跨輪</strong>累積。
   *
   * warnings 只在第 0 輪傳給各道處理（後面幾輪傳 undefined，否則同一件事會被
   * 重複報十幾次）。副作用是<strong>第 1 輪以後的延後完全不會出現在報告上</strong>：
   * 實測有一筆班次在第 1 輪被站位求解往後推了 520 秒，報告裡卻只查得到第 0 輪
   * 那幾筆「延後 10 秒」，使用者只看得到班次莫名其妙晚發，無從判斷成因。
   *
   * 這本紀錄簿每一輪都收，迴圈跑完再依「擋路的那一張卡」歸戶匯總成
   * STATION_BERTH_DELAY_SOURCE，指名是誰把誰推晚的。
   */
  const berthDelayLog: BerthDelayRecord[] = [];

  /**
   * <strong>迴圈回傳「最好的那一輪」，不是「最後一輪」。</strong>
   *
   * 這十二道處理彼此會互相推翻，實測（2026-08-20，把每一輪的變動卡數印出來）
   * 這個迴圈<strong>從來沒有收斂過</strong>：
   *
   *   好的輸入   round 0 變動 1013 張 → round 13 仍在動 82 張
   *   壞的輸入   round 0 變動 1070 張 → round 5 降到 435 → round 9 反彈 765（發散）
   *
   * 所以先前回傳的不是一個解，是震盪過程中第 14 輪剛好停下來的那一格快照。輸入
   * 動一點點就落到軌跡上另一個點——使用者在地圖上多開 7 條「站→設施」的邊，班表
   * 就從硬錯誤 0／班次 1096 變成硬錯誤 4／班次 972，而那 7 條邊本身完全合理。
   *
   * 真正的修法是讓這十二道不再互相推翻（見 scorePlan 的說明，那是後面幾步）。
   * 這一步先止血：每一輪按{@link scoreSchedulePlan 全域評分}打分，留下最好的一版，
   * 迴圈結束用它。輸出因此<strong>永遠不會比這十四輪裡最好的那一輪差</strong>——
   * 震盪還在，但不再由「剛好停在哪」決定結果。
   */
  // 評分用的路線索引與最終驗證同一份，避免兩邊定義漂移
  const routeById = new Map(
    routesForBerth.map((route) => [route.routeId, route] as const),
  );
  const scoreOf = (candidate: GeneratedSchedulePlan['timelines']): PlanScore =>
    scoreSchedulePlan({
      timelines: candidate,
      selectedRoutes: routesForBerth,
      intervals: engineInput.intervals,
      attributes: engineInput.attributes,
      routeById,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      scheduleRowCount: engineInput.scheduleRowCount,
    });
  const snapshotOf = (
    candidate: GeneratedSchedulePlan['timelines'],
  ): GeneratedSchedulePlan['timelines'] =>
    candidate.map((timeline) => ({
      ...timeline,
      blocks: timeline.blocks.map((block) => ({ ...block })),
    }));
  /**
   * <strong>每一道處理跑完立刻用同一把尺打分，變差就整道撤回。</strong>
   *
   * 先前十二道各有各的自我驗證，但量的是不同東西——站位讓渡只看碰撞對數、班距
   * 修復只看班距。於是會出現「讓渡把碰撞少掉一對、卻順手砍掉 124 個班次還自認
   * 成功」這種事。改成統一閘門之後，任何一道只要讓<strong>整張班表</strong>依
   * 使用者優先序（不碰撞 > 班距 > 班次穩定）變差，就當作沒發生過。
   *
   * 撤回時連同它寫進報告的訊息一起收回——一道被撤銷的處理不該留下「我做了什麼」
   * 的警告，否則使用者會看到根本不存在於班表上的動作。
   *
   * <strong>試過更細的粒度，實測更差，所以維持整道撤回。</strong>
   *
   * 直覺上「一道處理做了三十個修改，五個好、二十五個壞，全撤等於連那五個一起丟」，
   * 所以 2026-08-20 實作過逐列挑選：整道被判定變差時退回原版，再依序試著換上
   * 各列的新版本，只保留讓分數不變差的列。以「列」為單位是因為同一列的修改彼此
   * 相依（同一台車的連續行程，拆開會產生重疊），列與列之間只透過站位互相影響。
   *
   * 它確實有效——{@link yieldIdleBlockArrival} 每一輪都被挑出一列、保護不足各減
   * 一對。但<strong>下游反而變差</strong>：
   *
   *   整道撤回   yieldIdleBlockArrival 全退 → 讓渡把保護不足 34 → 11 → 6
   *   逐列保留   保留一列（34 → 33）      → 讓渡只能 33 → 15 → 8
   *
   * 那一列被挪走的空等餘裕，正是後面兩道讓渡要用的資源。局部 +1、全域 −2，最終
   * 站位碰撞從 1 對變成 3 對、班距不足 1.18% → 1.27%。也就是說「那五個好的修改」
   * 並不獨立——它們花掉的是別人更會用的東西。貪婪地保留局部改善，在這條管線上
   * 會毒害後面的處理。
   *
   * 真正要解的是「哪一道該做這件事」，不是「怎麼把壞處理的好部分撿回來」。
   *
   * <code>trimIncompleteRotationCycles</code> 不納入閘門：它刪的是不成輪的尾巴，
   * 屬於正確性收尾而不是最佳化，本來就會讓班次數下降（評分第四位），套上閘門會
   * 被系統性地擋掉，留下輪替不完整的班表。
   */
  const rejectedPasses = new Map<string, number>();
  let currentRound = -1;
  const traceEnabled =
    typeof globalThis !== 'undefined'
    && (globalThis as { __TRACE_PASS__?: boolean }).__TRACE_PASS__ === true;
  const runGuarded = (
    name: string,
    apply: () => GeneratedSchedulePlan['timelines'] | void,
  ): void => {
    const beforeTimelines = snapshotOf(timelines);
    const beforeScore = scoreOf(timelines);
    const warningMark = warnings.length;
    const delayLogMark = berthDelayLog.length;
    const produced = apply();
    if (produced) timelines = produced;
    const afterScore = scoreOf(timelines);
    if (traceEnabled) {
      const cmp = comparePlanScores(afterScore, beforeScore);
      const same = JSON.stringify(afterScore.vector) === JSON.stringify(beforeScore.vector);
       
      console.error(
        `r${currentRound} ${name.padEnd(38)} ${cmp > 0 ? '撤回' : same ? '無變化' : '採用'}`
        + `  ${JSON.stringify(beforeScore.vector)} → ${JSON.stringify(afterScore.vector)}`,
      );
    }
    if (comparePlanScores(afterScore, beforeScore) > 0) {
      timelines = beforeTimelines;
      warnings.length = warningMark;
      berthDelayLog.length = delayLogMark;
      rejectedPasses.set(name, (rejectedPasses.get(name) ?? 0) + 1);
    }
  };

  let bestScore: PlanScore | null = null;
  let bestTimelines: GeneratedSchedulePlan['timelines'] | null = null;
  let bestRound = -1;

  let converged = false;
  for (let round = 0; round < GEOMETRY_CONVERGENCE_MAX_ROUNDS; round += 1) {
    currentRound = round;
    const before = fingerprintTimelines(timelines);

    // 車停在哪，下一班就從那裡發——待命的地點是被站位限制夾出來的、常常沒得選，
    // 而路線在主線與備用之間本來就可選，該讓的是有選擇的那一方。
    //
    // 擺在站位求解<strong>之前</strong>：換路線＝換停靠站＝站位佔用整個變了，
    // 擺在後面的話那一輪的求解已經跑完，新衝突要等下一輪才處理；
    // 最後一輪換的更是完全沒人收拾。擺在前面，同一輪就能反應。
    runGuarded('alignRouteWithVehicleLocation', () => {
      alignRouteWithVehicleLocation({
        timelines,
        selectedRoutes: routesForBerth,
        successorPolicy: engineInput.successorPolicy,
        topology: engineInput.pointTopology,
        firstTripOrigins: engineInput.firstTripOrigins,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 要進廠卻停在到不了設施的站：把進廠前那一趟改開到進得了廠的那一站。
    // 放在站位求解之前——換終點＝換停靠站，要讓求解器有機會反應。
    runGuarded('alignRouteWithMaintenanceEntry', () => {
      alignRouteWithMaintenanceEntry({
        timelines,
        selectedRoutes: routesForBerth,
        topology: engineInput.pointTopology,
        successorPolicy: engineInput.successorPolicy,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 站位延後把發車相位推歪了，這裡推回等間隔。
    //
    // 移動之前<strong>自己逐站驗證</strong>，撞得到就整筆放棄——不能移完丟給站位求解
    // 收拾：兩者調整方向相反（這裡往前移、求解器只往後延），收拾不掉的就變成硬碰撞
    // （2026-08-13 第一版實測 STATION_BERTH_COLLISION 0 → 4，因此撤掉重做）。
    // 仍排在站位求解之前，讓求解器永遠是最後拍板的那一個。
    runGuarded('evenOutRouteHeadwayPhase', () => {
      evenOutRouteHeadwayPhase({
        timelines,
        selectedRoutes: routesForBerth,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        warnings: round === 0 ? warnings : undefined,
      });
    });

    // 站位占用：拓撲候選中選局部無衝突解（可延後／可改線／可等）
    // 第一輪保守並收集警告；之後放寬延後上限，處理連鎖擠回來的殘餘衝突。
    runGuarded('enforceStationBerthConstraints', () =>
  enforceStationBerthConstraints({
        timelines,
        selectedRoutes: routesForBerth,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        successorPolicy: engineInput.successorPolicy,
        warnings: round === 0 ? warnings : undefined,
        delayLog: berthDelayLog,
        ...(round === 0
          ? {}
          : { maxDelaySeconds: STATION_BERTH_WAIT_MAX_DELAY_SECONDS }),
      }).timelines);

    // 「滯留的那台晚一點進站」已經移出迴圈，改在所有處理跑完之後才做——
    // 它動用的空等餘裕正是下面兩道讓渡解衝突的資源，在這裡先用掉會害它們沒東西
    // 可用（見迴圈後的說明）。

    // 跑完一輪在共用站位空等下一個脈衝時撞到別列車 → 有次要邊就先繞去別站等
    runGuarded('relievePlatformIdleWithSecondaryEdge', () =>
  relievePlatformIdleWithSecondaryEdge({
        timelines,
        selectedRoutes: routesForBerth,
        successorPolicy: engineInput.successorPolicy,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
        warnings: round === 0 ? warnings : [],
      }));

    /**
     * 繞不去別站 → 開進附近設施格暫停放。這一支<strong>呼叫兩次</strong>：
     * 這裡（迴圈內）讓站位求解器在同一輪看得到讓出來的站格；整備轉場卡插完之後
     * 再呼叫一次，把跟轉場卡撞到的那幾筆丟掉。它會先清掉自己上一次插的卡再重算，
     * 重複呼叫不會疊加。
     *
     * 只放後面不行——求解器的延後與改派備用線在迴圈裡就定案了，站格再讓也沒人
     * 受益（2026-08-17 實測：只放後面，指標與不做完全相同）。
     */
    runGuarded('relievePlatformIdleWithFacilityPark', () =>
  relievePlatformIdleWithFacilityPark({
        timelines,
        selectedRoutes: routesForBerth,
        topology: engineInput.pointTopology,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      }).timelines);

    // 班距太疏 → 把後車往前拉回目標
    runGuarded('densifyRouteHeadwaysAfterBerth', () =>
  densifyRouteHeadwaysAfterBerth({
        timelines,
        selectedRoutes: routesForBerth,
        intervals: engineInput.intervals,
        attributes: engineInput.attributes,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      }));

    // 班距太擠 → 把後車往後推；推不夠再借前車的既有餘裕
    runGuarded('repairRouteHeadwaysBelowTarget', () =>
  repairRouteHeadwaysBelowTarget({
        timelines,
        selectedRoutes: routesForBerth,
        intervals: engineInput.intervals,
        attributes: engineInput.attributes,
        minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
        collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      }));

    // 正線可吃接下來那段整備的開頭（有重疊才讓）
    runGuarded('applyMainlineMaintenanceEntryYield', () =>
      applyMainlineMaintenanceEntryYield(timelines));

    // 不准佔用整備尾巴：壓到前一段整備的正線，整趟推到整備結束之後
    runGuarded('pushPassengerPastPrecedingYard', () =>
      pushPassengerPastPrecedingYard(timelines));

    /**
     * 撤掉不成輪的尾巴。<strong>留在迴圈內</strong>——它是破壞性算子（刪班次），
     * 照理不該待在不動點迴圈裡，2026-08-20 也實測搬到迴圈外過：班次 +1，但多出
     * 一筆 ROTATION_CYCLE_INCOMPLETE（某段 21 趟、須為 4 的整數倍），連跑到不動點
     * 也清不掉——它清的是列尾，而驗證器是逐段檢查「每一段整備之前」。搬出去等於
     * 讓後續處理再也沒有機會把那一段補齊。
     *
     * 它原本會讓班次一路流失（1096 → 972）的問題，已經由每一道的全域評分閘門
     * 解決（其他處理不會再為了自己的指標把版面弄亂、逼出新的不成輪）。
     */
    timelines = trimIncompleteRotationCyclesOnTimelines({
      timelines,
      routeCount: engineInput.passengerRoutes.length,
    }).timelines;

    const roundScore = scoreOf(timelines);
    if (bestScore === null || comparePlanScores(roundScore, bestScore) < 0) {
      bestScore = roundScore;
      bestTimelines = snapshotOf(timelines);
      bestRound = round;
    }

    if (fingerprintTimelines(timelines) === before) {
      converged = true;
      break;
    }
  }

  if (rejectedPasses.size > 0) {
    const ranked = [...rejectedPasses.entries()].sort((a, b) => b[1] - a[1]);
    pushIssue(warnings, {
      code: 'GEOMETRY_PASS_REVERTED',
      severity: 'warning',
      kind: 'limit',
      message:
        '幾何後處理有處理被整道撤回——它讓整張班表依優先序（不碰撞 > 班距 > '
        + `班次穩定）變差了：${ranked.map(([name, count]) => `${name} ${count} 次`).join('、')}。`
        + '班表本身不受影響（那些動作等於沒發生），但撤回次數高的處理代表它的策略'
        + '與其他處理衝突，值得回頭檢討。',
      detail: { rejectedPasses: Object.fromEntries(ranked) },
    });
  }

  if (bestTimelines && bestScore) {
    const finalScore = scoreOf(timelines);
    if (comparePlanScores(bestScore, finalScore) < 0) {
      timelines = bestTimelines;
      pushIssue(warnings, {
        code: 'GEOMETRY_BEST_ROUND_USED',
        severity: 'warning',
        kind: 'limit',
        message:
          `幾何後處理沒有收斂到不動點，改用過程中最好的第 ${bestRound + 1} 輪：`
          + `${formatPlanScore(bestScore)}`
          + `（最後一輪是 ${formatPlanScore(finalScore)}）。`
          + `這代表迴圈裡的處理仍在互相推翻，班表雖然可用，但還沒有穩定解。`,
        detail: {
          bestRound: bestRound + 1,
          bestScore: bestScore.detail,
          lastScore: finalScore.detail,
        },
      });
    }
  }
  /**
   * 誰把別人推晚的：把整個迴圈累積的站位延後依「擋路的那一張卡」歸戶。
   *
   * 逐筆列出沒有用——同一張卡會在十幾輪裡反覆把同一批班次往後推，逐筆是雜訊。
   * 依擋路者歸戶才看得出結構：某一台車佔著某一站不走，一整天累計害了多少班次、
   * 總共推遲多少秒。要消掉延後就是去處理那張卡，不是去調延後上限。
   */
  if (berthDelayLog.length > 0) {
    type Source = {
      stationId: string;
      stationName: string;
      blockerRow?: number;
      /** 擋路的是同一列自己的前一趟（折返銜接），不是別台車 */
      selfBlocked: boolean;
      victims: Set<string>;
      totalSeconds: number;
      worstSeconds: number;
      worstVictimRow: number;
    };
    const sources = new Map<string, Source>();
    let unattributedSeconds = 0;
    for (const record of berthDelayLog) {
      if (!record.binding?.stationId) {
        unattributedSeconds += record.delaySeconds;
        continue;
      }
      const key = `${record.binding.blockerBlockId ?? '?'}@${record.binding.stationId}`;
      const selfBlocked = record.binding.blockerRow === record.timelineRow;
      const entry = sources.get(key) ?? {
        stationId: record.binding.stationId,
        stationName: record.binding.stationName,
        blockerRow: record.binding.blockerRow,
        selfBlocked,
        victims: new Set<string>(),
        totalSeconds: 0,
        worstSeconds: 0,
        worstVictimRow: record.timelineRow,
      };
      entry.victims.add(record.blockId);
      entry.totalSeconds += record.delaySeconds;
      if (record.delaySeconds > entry.worstSeconds) {
        entry.worstSeconds = record.delaySeconds;
        entry.worstVictimRow = record.timelineRow;
      }
      sources.set(key, entry);
    }
    const ranked = [...sources.values()].sort((a, b) => b.totalSeconds - a.totalSeconds);
    const shown = ranked.slice(0, BERTH_DELAY_SOURCE_REPORT_LIMIT);
    for (const source of shown) {
      pushIssue(warnings, {
        code: 'STATION_BERTH_DELAY_SOURCE',
        severity: 'warning',
        kind: 'actionable',
        message:
          (source.selfBlocked
            ? `時間線 ${source.blockerRow ?? '?'} 自己的前一趟還沒離開「${source.stationName}」，`
              + `後面那幾趟只能等——`
            : `「${source.stationName}」被時間線 ${source.blockerRow ?? '?'} 的車佔著，`
              + `站位求解為了讓路，`)
          + `整個收斂過程共把 ${source.victims.size} 個班次往後推、`
          + `累計 ${Math.round(source.totalSeconds)} 秒；`
          + `單筆最久的一次是時間線 ${source.worstVictimRow} 被推 `
          + `${Math.round(source.worstSeconds)} 秒。`
          + `\n延後會沿著同一列往後傳：一趟被推遲，該列後面每一趟都跟著整體平移`
          + `（pushSameRowNextAfterPrevious），所以這裡的累計秒數是連鎖後的總量。`,
        detail: {
          stationId: source.stationId,
          stationName: source.stationName,
          blockerTimelineRow: source.blockerRow,
          delayedTripCount: source.victims.size,
          totalDelaySeconds: Math.round(source.totalSeconds),
          worstDelaySeconds: Math.round(source.worstSeconds),
          worstTimelineRow: source.worstVictimRow,
          selfBlocked: source.selfBlocked,
        },
      });
    }
    if (ranked.length > shown.length || unattributedSeconds > 0) {
      const rest = ranked.slice(shown.length);
      pushIssue(warnings, {
        code: 'STATION_BERTH_DELAY_SOURCE',
        severity: 'warning',
        kind: 'actionable',
        message:
          `另有 ${rest.length} 個擋路點沒有逐則列出（累計 `
          + `${Math.round(rest.reduce((sum, item) => sum + item.totalSeconds, 0))} 秒）`
          + (unattributedSeconds > 0
            ? `；還有 ${Math.round(unattributedSeconds)} 秒的延後找不到明確擋路者`
            : ''),
        detail: {
          omittedSourceCount: rest.length,
          omittedDelaySeconds: Math.round(
            rest.reduce((sum, item) => sum + item.totalSeconds, 0),
          ),
          unattributedDelaySeconds: Math.round(unattributedSeconds),
        },
      });
    }
  }

  if (!converged) {
    /**
     * 跑完上限輪數版面還在變＝這一輪的結果<strong>不是不動點</strong>。
     *
     * 先前這裡是直接離開，沒有任何回報——「收斂完成」跟「跑完 8 輪還在動」
     * 在輸出上完全一樣。差別很大：後者的站位錯誤可能只是輪數不夠，不是設定
     * 有問題，但使用者分辨不出來，只會去改設定（2026-08-11 複查時發現）。
     */
    pushIssue(warnings, {
      code: 'GEOMETRY_NOT_CONVERGED',
      severity: 'warning',
      kind: 'limit',
      message:
        `幾何後處理跑滿 ${GEOMETRY_CONVERGENCE_MAX_ROUNDS} 輪仍未收斂——`
        + `下面的站位與班距問題有一部分可能只是還沒處理完，不一定是設定有問題。`,
      detail: { rounds: GEOMETRY_CONVERGENCE_MAX_ROUNDS },
    });
  }

  // 整備後首班代號：所有幾何後處理完成後再標記，避免站位／讓渡弄丟前綴。
  // 規則：整備（保養／行檢／充電／待命）後第一個正線一律掛「整備代號+路線代號」。
  timelines = tagYardDispatchTrips({
    timelines,
    origins: engineInput.firstTripOrigins,
    maintenanceBody: engineInput.maintenanceBody,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    selectedRoutes: engineInput.selectedRoutes,
  });
  timelines = scrubMidMainlineDispatchArtifacts(timelines);

  // 整備轉場卡（入廠 MI／出廠 MO／整備間轉場）：每一種整備任務共用同一套
  // 機制，依「這一段整備的左右鄰居是什麼」自己判斷該補入廠、出廠，還是
  // 兩者成對的轉場——不是三張各自寫死的卡。入廠：串首補，開始提前、結束
  // 不動；出廠：串尾補，往前貼齊下一段發車、空間不夠可吃整備尾巴；轉場：
  // 串內部兩段不同類型整備直接銜接，前一段跑滿全長，後一段開始被推遲、
  // 結束不動。三段共用同一份設施佔用表，見 insertMaintenanceTransferCards.ts。
  const maintenanceTransfer = insertMaintenanceTransferCards({
    timelines,
    topology: engineInput.pointTopology,
    areas: engineInput.areas,
    maintenanceBody: engineInput.maintenanceBody,
    selectedRoutes: engineInput.selectedRoutes,
    minimumRecoveryTimeSeconds: engineInput.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
  });
  timelines = maintenanceTransfer.timelines;

  /**
   * 繞不去別站（關聯圖上沒有回得來的路線）→ 開進附近設施格暫停放，時間到再回來。
   *
   * 放在<strong>整備轉場卡之後</strong>，不在幾何收斂迴圈裡。原因是轉場卡是迴圈
   * 跑完才真正插進去的（迴圈裡只先決定地點），在迴圈裡看到的空檔其實已被預定；
   * 2026-08-17 第一版擺在迴圈內，硬塞的結果是 391 則 TIMELINE_OVERLAP。
   *
   * 擺在這裡的代價是站位求解器不會針對讓出來的站格再跑一次，收益因此保守；
   * 但這一支只移動「已經確定在空等」的車、且不改任何發車時刻，本來就不需要
   * 求解器重新介入。
   */
  timelines = relievePlatformIdleWithFacilityPark({
    timelines,
    selectedRoutes: routesForBerth,
    topology: engineInput.pointTopology,
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  }).timelines;

  // 整備前面不留空白：車已經在格子裡了，整備就從那一刻開始（結束不動）。
  // 放在讓渡之後——讓渡會把入廠卡往前挪，挪完才知道車實際幾點到格子。
  timelines = closeYardHeadGaps({ timelines }).timelines;


  /**
   * 收尾微調：早到幾秒卡進別人碰撞保護窗的，往後挪剛好差的那幾秒。
   *
   * <strong>這一支必須放在最後面。</strong>它挪的是「到站後反正要空等」的車，
   * 對那台車本身零代價；但那段空等同時也是站位讓渡（繞去別站等、開進設施格暫停放）
   * 拿來解衝突的資源。放在收斂迴圈裡先把它用掉，讓渡就沒東西可用——2026-08-20
   * 兩種寫法都實測過，結果一致：迴圈內動手，最終站位碰撞從 1 對變成 3 對。
   * 放到所有處理跑完之後，沒有下游會被影響，省下來的就是純賺。
   *
   * 每挪一趟都用同一把全域尺驗證一次，沒變好就還原那一次——整趟往後挪連帶影響
   * 起點站的發車，不能盲挪（盲挪實測第一輪就從 3 筆硬錯誤變成 27 筆）。
   */
  {
    let reference = scoreOf(timelines);
    yieldIdleBlockArrival({
      timelines,
      selectedRoutes: routesForBerth,
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      warnings,
      accept: () => {
        const next = scoreOf(timelines);
        if (comparePlanScores(next, reference) >= 0) return false;
        reference = next;
        return true;
      },
    });
  }

  /**
   * 補上「暫停」卡：整備做完、車還在格子裡的那段。
   *
   * 放在<strong>所有會動時刻的處理跑完之後、驗證之前</strong>：這幾張卡是事實的載體，不是新
   * 規則——它們讓「車在哪裡」在時間軸上變成完整且明示的事實，任何偵測器都不必再自己
   * 推論一次。放在迴圈裡會改變各道處理看到的前後相鄰關係，那是另一回事，也是先前
   * 踩過的雷。
   */
  timelines = fillYardHoldGaps({ timelines, selectedRoutes: routesForBerth }).timelines;

  /**
   * 「不需要轉場」跟「必要轉場失敗」分開分類，不是全部套同一句策略說明。
   *
   * 這一列整天沒有前／後載客任務（`necessity==='not_needed'`）：車沒有要去的
   * 地方，出廠／入廠卡本來就不需要，多半是刻意保留的備援車，歸 policy——
   * 正常情況、收合顯示，需要時使用者自己展開檢查。
   *
   * 後續<strong>有</strong>載客任務、卻排不出合法移動（沒填欄位、拓樸沒接、候選
   * 都被擋⋯）：車實際上到不了它該去的地方，是必要銜接失敗，歸 actionable——
   * 使用者該實際去看，不能跟前者一起被摺疊。訊息維持 `skip.reason`（已經是
   * insertMaintenanceTransferCards 算出來的實際原因，不是套用通用說明）。
   */
  for (const skip of maintenanceTransfer.skipped) {
    const label = skip.fromTaskType && skip.toTaskType
      ? `「${skip.fromTaskType}」轉「${skip.toTaskType}」`
      : `「${skip.taskType}」`;
    const notNeeded = skip.necessity === 'not_needed';
    pushIssue(warnings, {
      code: 'MAINTENANCE_TRANSFER_UNRESOLVED',
      severity: 'warning',
      kind: notNeeded ? 'policy' : 'actionable',
      message: notNeeded
        ? `時間線 ${skip.timelineRow}：${label}不需要整備轉場卡——${skip.reason}`
        : `時間線 ${skip.timelineRow}：${label}排不出必要的整備轉場卡——${skip.reason}`,
      detail: {
        timelineRow: skip.timelineRow,
        blockId: skip.blockId,
        taskType: skip.taskType,
        fromTaskType: skip.fromTaskType,
        toTaskType: skip.toTaskType,
        reason: skip.reason,
        necessity: skip.necessity ?? 'required',
      },
    });
  }
  // 決策樹第三層：請別列車換一台設施，把位子讓出來。只換格子不動時間，
  // 沒有代價，但要講出來——使用者會發現某列的整備跑到別台設施上了。
  for (const item of maintenanceTransfer.facilityYields) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_FACILITY_YIELDED',
      severity: 'warning',
      kind: 'policy',
      message:
        `時間線 ${item.timelineRow}：「${item.taskType}」原本沒地方停——`
        + `已請時間線 ${item.movedRows.join('、')} 的整備改停別台設施，`
        + `讓出 ${item.facilityLabel}。雙方時間都沒有動。`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityLabel: item.facilityLabel,
        movedRows: item.movedRows,
      },
    });
  }
  // 提早進廠被別列車擋下：代價會落到站位上，必須講出來，否則就是把
  // 「設施不足」無聲換成「站位碰撞」——使用者最頭痛的兩件事互相搬家。
  for (const item of maintenanceTransfer.entryEarlyBlocked) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_ENTRY_EARLY_BLOCKED',
      severity: 'warning',
      kind: 'limit',
      message:
        `時間線 ${item.timelineRow}：「${item.taskType}」本來可以提早`
        + ` ${item.blockedMinutes.toFixed(1)} 分鐘進廠，但 ${item.facilityLabel}`
        + ` 那段時間被別列車佔著——車只好在「${item.waitStationName}」多等這段時間，`
        + `期間佔著那個站位。`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityLabel: item.facilityLabel,
        blockedMinutes: item.blockedMinutes,
        waitStationName: item.waitStationName,
      },
    });
  }
  // 整備設施不足：車根本沒地方停。跟上面「移動卡排不出來」分開回報——
  // 那是路徑問題（補拓樸的邊），這是產能問題（加設施／錯開整備時段）。
  for (const item of maintenanceTransfer.facilityUnavailable) {
    pushIssue(warnings, {
      code: 'MAINTENANCE_FACILITY_UNAVAILABLE',
      severity: 'warning',
      kind: 'limit',
      message: `時間線 ${item.timelineRow}：「${item.taskType}」沒有可用設施——${item.reason}`,
      detail: {
        timelineRow: item.timelineRow,
        blockId: item.blockId,
        taskType: item.taskType,
        facilityCount: item.facilityCount,
        reason: item.reason,
      },
    });
  }


  const allBlocks = timelines.flatMap((timeline) => timeline.blocks);
  validateTimelineOverlaps(timelines, errors);
  validateStationTimingsWithinBlocks(
    timelines,
    routesForBerth,
    errors,
  );
  /**
   * 設施格佔用：同一格同一時刻只能有一台車。
   *
   * 以「車實際還在裡面」為準——整備做完到出場移動開始之間車仍佔著那一格。這一支
   * 內部呼叫 stationBerthOccupancy.ts 的 collectFacilityOccupancies／
   * findFacilityOccupancyCollisions：沒補過「暫停」卡（見 fillYardHoldGaps）時用
   * 跟站位同一套空檔推論分析出實際離開時刻，補過卡就直接採用卡上的時刻——答案
   * 一致，所以<strong>不再依賴排在補卡之後才對</strong>；closeYardHeadGaps 的候選
   * 空位檢查（求解階段，跑在補卡之前）用的是同一份定義，求解跟這裡的最終驗證不會
   * 看到不同的佔用。重疊記硬錯誤（物理上做不到），交接不足 2 × 碰撞保護記警告
   * （營運規則）。
   */
  validateFacilityOccupancy(timelines, errors, {
    collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
    warnings,
  });

  validateStationBerthCollisions(
    timelines,
    routesForBerth,
    errors,
    {
      collisionProtectionSeconds: engineInput.collisionProtectionSeconds,
      // 碰撞保護不足是「該拉開但沒拉開」，不是物理上兩台車疊在一起：走警告不擋生成
      warnings,
      sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    },
  );
  // 整備做完車就停在出場站，接著那一段一定要從那一站發車——不是的話車不在，開不了
  validateYardExitContinuity({
    timelines,
    selectedRoutes: routesForBerth,
    // 驗證問的是「車實際停在哪」，跟輪的相位無關，所以用 validate 版（含保養／行檢）
    yardExitStationOptionsByTaskType: engineInput.yardExitStationOptionsByTaskType,
    sectionCodes: input.draft.maintenanceTask.sectionCodeBySection,
    errors,
  });
  validateRotationCyclesComplete(timelines, engineInput.passengerRoutes.length, errors);
  validateRouteSwitchBuffers(
    timelines,
    routeById,
    errors,
    engineInput.minimumRecoveryTimeSeconds,
    engineInput.passengerRoutes,
    engineInput.successorPolicy,
  );
  validatePassengerHeadway(
    allBlocks,
    engineInput.intervals,
    engineInput.attributes,
    routeById,
    errors,
    warnings,
    engineInput.scheduleRowCount,
  );
  validateTimelineCapacity(
    allBlocks.filter((block) => block.taskType === 'passenger' && block.source === 'template_bar'),
    engineInput.scheduleRowCount,
    engineInput.intervals,
    engineInput.attributes,
    routeById,
    warnings,
  );

  const plan: GeneratedSchedulePlan = {
    shiftId: engineInput.shiftId,
    generatedAt: new Date().toISOString(),
    scheduleRowCount: engineInput.scheduleRowCount,
    timelines,
    routeAssignmentAlgorithm: routeAssignmentAlgorithmId(engineInput.successorPolicy),
    ...(engineInput.timetableGenerationAlgorithm
      ? { timetableGenerationAlgorithm: engineInput.timetableGenerationAlgorithm }
      : {}),
  };

  const ok =
    computeScheduleGateOk(errors)
    && resolvedByTaskId.size === engineInput.confirmedTasks.length;
  return {
    plan: plan,
    report: { ok, errors, warnings, metrics: buildServiceMetrics(timelines, warnings, engineInput.servicePulseDemand) },
  };
}

/**
 * 算出可跨班表比較的服務量指標。
 *
 * 兩份班表要比好壞，不能比問題代號的原始則數——則數會隨班次數縮放，
 * 少跑車就自動變好看。詳見 {@link ScheduleServiceMetrics} 的說明。
 */
function buildServiceMetrics(
  timelines: GeneratedScheduleTimeline[],
  warnings: FeasibilityIssue[],
  servicePulseDemand: number,
): ScheduleServiceMetrics {
  let passengerTripCount = 0;
  let passengerOccupancySeconds = 0;
  const tripsByRow: Record<number, number> = {};
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.taskType !== 'passenger') continue;
      passengerTripCount += 1;
      tripsByRow[timeline.row] = (tripsByRow[timeline.row] ?? 0) + 1;
      passengerOccupancySeconds += Math.max(
        0,
        Math.round((block.plannedEndMinute - block.plannedStartMinute) * 60),
      );
    }
  }

  const countCode = (code: FeasibilityViolationCode): number =>
    warnings.reduce((sum, issue) => (issue.code === code ? sum + 1 : sum), 0);
  const servicePulseUnserved = countCode('UNSERVED_SERVICE_PULSE');

  const rowCounts = Object.values(tripsByRow);
  const rowAverage = rowCounts.length > 0
    ? rowCounts.reduce((sum, value) => sum + value, 0) / rowCounts.length
    : 0;

  return {
    passengerTripCount,
    passengerOccupancySeconds,
    servicePulseDemand,
    servicePulseUnserved,
    servicePulseServedRatio:
      servicePulseDemand > 0
        ? (servicePulseDemand - servicePulseUnserved) / servicePulseDemand
        : null,
    backupBerthPerTrip:
      passengerTripCount > 0
        ? countCode('STATION_BERTH_BACKUP_USED') / passengerTripCount
        : null,
    headwayBelowTargetPerTrip:
      passengerTripCount > 0
        ? countCode('HEADWAY_BELOW_TARGET') / passengerTripCount
        : null,
    tripsByRow,
    tripsByRowSpread:
      rowAverage > 0
        ? (Math.max(...rowCounts) - Math.min(...rowCounts)) / rowAverage
        : null,
  };
}
