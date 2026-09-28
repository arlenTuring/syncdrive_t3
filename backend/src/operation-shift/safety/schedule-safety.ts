/**
 * 發布／部署前的班表安全重驗（後端）
 * ================================
 *
 * 規則跟前端「發布前檢查」是同一份程式：schedule-safety.generated.ts 由
 * frontend/scripts/build-schedule-safety-bundle.mts 從前端的 schedulePublishCheck.ts 打包而來，
 * 不在後端另寫一套（兩套規則遲早對不起來）。
 *
 * 後端不相信前端存的「可發布」：發布與部署前，用資料庫裡實際儲存的班表、路線停靠設定、
 * 碰撞保護時間與地圖路網重算一次。缺任何一項資料就不給過，並講出缺什麼。
 */
import {
  buildSafetySettingsFingerprint as buildSafetySettingsFingerprintUntyped,
  buildTopologyFingerprint as buildTopologyFingerprintUntyped,
  runSchedulePublishCheck as runSchedulePublishCheckUntyped,
} from './schedule-safety.generated';

export type SafetyIssue = {
  code: string;
  severity?: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type StoredShiftSafetyResult = {
  publishSafe: boolean;
  /** 缺資料（無法完成檢查）時的說明；有值就一定不安全 */
  missing: string[];
  blockingIssues: SafetyIssue[];
  planFingerprint: string;
  settingsFingerprint: string;
  topologyFingerprint: string;
};

type Topology = { nodes: unknown[]; edges: unknown[] };

const runSchedulePublishCheck = runSchedulePublishCheckUntyped as (args: {
  plan: unknown;
  selectedRoutes: unknown[];
  collisionProtectionSeconds: number;
  sectionCodes?: unknown;
  topology?: Topology | null;
}) => {
  planFingerprint: string;
  settingsFingerprint: string;
  topologyFingerprint: string;
  publishSafe: boolean;
  publishBlockingCount: number;
  blockingIssues: SafetyIssue[];
};
export const buildSafetySettingsFingerprint =
  buildSafetySettingsFingerprintUntyped as (args: {
    selectedRoutes: unknown[];
    collisionProtectionSeconds: number | null | undefined;
    sectionCodes?: unknown;
  }) => string;
export const buildTopologyFingerprint = buildTopologyFingerprintUntyped as (
  topology: Topology | null | undefined,
) => string;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 用實際儲存的班表內容重算安全檢查。
 * @param topology 班表綁定地圖的路網（mapDocument.pointTopology）；拿不到傳 null
 */
export function runStoredShiftSafetyCheck(
  body: Record<string, unknown>,
  topology: Topology | null,
): StoredShiftSafetyResult {
  const missing: string[] = [];
  const output = asRecord(body.scheduleOutput);
  const plan = asRecord(output?.plan);
  const timelines = plan?.timelines;
  if (!plan || !Array.isArray(timelines))
    missing.push('班表產出（scheduleOutput.plan）');
  const selectedRoutes = Array.isArray(body.selectedRoutes)
    ? body.selectedRoutes
    : null;
  if (!selectedRoutes || selectedRoutes.length === 0)
    missing.push('路線停靠設定（selectedRoutes）');
  const protection = body.collisionProtectionSeconds;
  const collisionProtectionSeconds =
    typeof protection === 'number' &&
    Number.isFinite(protection) &&
    protection >= 0
      ? protection
      : null;
  if (collisionProtectionSeconds === null)
    missing.push('碰撞保護時間（collisionProtectionSeconds）');
  const hasMoves =
    Array.isArray(timelines) &&
    timelines.some((timeline) => {
      const blocks = asRecord(timeline)?.blocks;
      return (
        Array.isArray(blocks) &&
        blocks.some((block) => asRecord(block)?.taskType === 'dispatch')
      );
    });
  const usableTopology =
    topology && Array.isArray(topology.nodes) && topology.nodes.length > 0
      ? topology
      : null;
  if (hasMoves && !usableTopology)
    missing.push('地圖路網（pointTopology），移動卡的路徑無法檢查');

  const sectionCodes = asRecord(body.maintenanceSectionCodeBySection);
  if (
    missing.length > 0 ||
    !plan ||
    !selectedRoutes ||
    collisionProtectionSeconds === null
  ) {
    return {
      publishSafe: false,
      missing,
      blockingIssues: [],
      planFingerprint: '',
      settingsFingerprint: '',
      topologyFingerprint: '',
    };
  }
  const result = runSchedulePublishCheck({
    plan,
    selectedRoutes,
    collisionProtectionSeconds,
    sectionCodes,
    topology: usableTopology,
  });
  return {
    publishSafe: result.publishSafe && result.publishBlockingCount === 0,
    missing,
    blockingIssues: result.blockingIssues,
    planFingerprint: result.planFingerprint,
    settingsFingerprint: result.settingsFingerprint,
    topologyFingerprint: result.topologyFingerprint,
  };
}

/** 給錯誤訊息用：前幾筆問題的摘要 */
export function describeSafetyFailure(result: StoredShiftSafetyResult): string {
  if (result.missing.length > 0) {
    return `資料不完整，無法完成安全檢查：缺少${result.missing.join('、')}。`;
  }
  const byCode = new Map<string, number>();
  for (const issue of result.blockingIssues)
    byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
  const summary = [...byCode.entries()]
    .map(([code, count]) => `${code} ×${count}`)
    .join('、');
  const first = result.blockingIssues[0]?.message?.split('\n')[0] ?? '';
  return `班表有 ${result.blockingIssues.length} 筆安全問題（${summary}），禁止發布或部署。${first ? `例：${first}` : ''}`;
}
