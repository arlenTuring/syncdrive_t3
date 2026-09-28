#!/usr/bin/env -S npx tsx
/**
 * 把前端的發布前安全檢查打包給後端用：同一套規則，不維護兩份。
 *
 * 來源：src/features/shift-list/utils/schedulePublishCheck.ts（以及它用到的驗證器）
 * 產物：backend/src/operation-shift/safety/schedule-safety.generated.ts（請勿手改）
 *
 * 用法：
 *   npx tsx scripts/build-schedule-safety-bundle.mts          # 重新產生
 *   npx tsx scripts/build-schedule-safety-bundle.mts --check  # 產物跟來源不一致就失敗
 *
 * 驗證規則改了卻沒重新產生，後端就會用舊規則放行——所以有測試會跑 --check 的同一段比對
 * （schedulePublishCheck.backendBundle.spec.ts）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
export const BUNDLE_OUT = resolve(frontendRoot, '../backend/src/operation-shift/safety/schedule-safety.generated.ts');

const HEADER = [
  '// @ts-nocheck',
  '/* eslint-disable */',
  '// 由 frontend/scripts/build-schedule-safety-bundle.mts 產生，請勿手改。',
  '// 來源：frontend/src/features/shift-list/utils/schedulePublishCheck.ts',
  '',
].join('\n');

/**
 * 驗證器用不到的介面文字（路線規劃的提示）會把 i18n／React 一起拉進來；
 * 後端只需要安全檢查本身，換成回傳鍵值的替身。
 */
const stubI18n: Plugin = {
  name: 'stub-i18n',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /(^|\/)i18n$/ }, (args) => {
      if (!args.importer.includes('/src/')) return undefined;
      return { path: 'i18n-stub', namespace: 'stub' };
    });
    pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const i18n = { t: (key) => key }; export default i18n;',
      loader: 'js',
    }));
  },
};

/**
 * 專案內的模組都沒有載入時副作用（只宣告函式與常數）：標成 sideEffects: false，
 * 沒用到的（例如型別檔順帶引入的 API、資料來源 store）整個丟掉，不會把 React 帶進後端。
 */
const projectModulesSideEffectFree: Plugin = {
  name: 'project-side-effect-free',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\./ }, async (args) => {
      if (args.pluginData?.skipSideEffectFree) return undefined;
      if (!args.resolveDir.includes('/frontend/src') && !args.importer.includes('schedule-safety-entry')) return undefined;
      const resolved = await pluginBuild.resolve(args.path, {
        resolveDir: args.resolveDir,
        kind: args.kind,
        importer: args.importer,
        pluginData: { skipSideEffectFree: true },
      });
      if (resolved.errors.length > 0 || !resolved.path.includes('/frontend/src/')) return undefined;
      return { path: resolved.path, sideEffects: false };
    });
  },
};

export async function buildScheduleSafetyBundle(): Promise<string> {
  const result = await build({
    stdin: {
      contents: `export {
  runSchedulePublishCheck,
  buildPlanFingerprint,
  buildSafetySettingsFingerprint,
  buildTopologyFingerprint,
  resolveSchedulePublishState,
} from './src/features/shift-list/utils/schedulePublishCheck';
export { PUBLISH_BLOCKING_CODES } from './src/features/shift-list/utils/scheduleAcceptance';
`,
      resolveDir: frontendRoot,
      sourcefile: 'schedule-safety-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    plugins: [stubI18n, projectModulesSideEffectFree],
    logLevel: 'silent',
  });
  const code = result.outputFiles[0]!.text;
  if (/node_modules\/(react|i18next|react-i18next|zustand)\b|from ['"]react/.test(code)) {
    throw new Error('安全檢查打包結果含有前端介面套件，後端不能用');
  }
  return HEADER + code;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const code = await buildScheduleSafetyBundle();
  if (process.argv.includes('--check')) {
    const current = readFileSync(BUNDLE_OUT, 'utf-8');
    if (current !== code) {
      console.error('後端的安全檢查產物跟前端規則不一致，請執行：npx tsx scripts/build-schedule-safety-bundle.mts');
      process.exit(1);
    }
    console.error('一致');
  } else {
    writeFileSync(BUNDLE_OUT, code);
    console.error(`已產生 ${BUNDLE_OUT}（${Math.round(code.length / 1024)} KB）`);
  }
}
