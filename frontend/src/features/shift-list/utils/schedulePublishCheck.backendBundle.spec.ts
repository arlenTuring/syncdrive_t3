import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { BUNDLE_OUT, buildScheduleSafetyBundle } from '../../../../scripts/build-schedule-safety-bundle.mts';

/**
 * 後端發布／部署前的安全重驗用的是這份前端規則打包出來的檔案。規則改了卻沒重新產生，
 * 後端就會照舊規則放行——這個測試擋住那種情形。
 * 修正方式：cd frontend && npx tsx scripts/build-schedule-safety-bundle.mts
 */
it('後端的安全檢查打包檔與前端規則一致', async () => {
  const expected = await buildScheduleSafetyBundle();
  const actual = readFileSync(BUNDLE_OUT, 'utf-8');
  assert.ok(actual === expected, '後端 schedule-safety.generated.ts 過期，請重新產生');
});
