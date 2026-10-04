#!/usr/bin/env node
/**
 * 舊版模擬器重播單的分類修正（受控、可預覽）。
 *
 * 舊版模擬器把所有重播單寫成 line_kind='TEST'、卡片標籤「模擬整日重播」，整備名冊只收
 * line_kind='MAINTENANCE'，於是整備卡全部消失。這支只處理：
 *   - payload.source = 'plan_replay'，而且
 *   - line_kind = 'TEST'
 * 其他訂單（PMS99 人工測試、正式調度、別的來源）一律不碰。
 *
 * 分類的依據不是猜：依單上記錄的班表 ID（payload.plan_shift_id）重新向後端要那份班表的執行計畫
 * （GET /dispatch/plan/shift/:id?full=1，與正式調度同一套分類），用任務代號找到同一個任務，
 * 而且 kind 與整備子類型都要跟單上記錄的一致，才採用計畫給的業務欄位（line_kind、整備徽章與格位、
 * task_type、card_label、路線）。對不上的列出原因、不改。
 *
 * 用法（backend 目錄）：
 *   node scripts/reclassify-plan-replay-orders.js            只預覽（預設）
 *   node scripts/reclassify-plan-replay-orders.js --apply    寫入
 * 後端位址預設 http://127.0.0.1:3000，可用 BACKEND_URL 指定；資料庫連線讀 .env。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');

const BASE = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const APPLY = process.argv.includes('--apply');

async function fetchPlan(shiftId) {
  const res = await fetch(`${BASE}/syncdrive-api/dispatch/plan/shift/${encodeURIComponent(shiftId)}?full=1`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.message ?? ''}`.trim());
  return body;
}

/** 單上記錄的整備子類型（舊單只有 maintenance_task_type） */
function recordedTaskType(payload) {
  return payload.task_type || payload.maintenance_task_type || null;
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT order_id, trip_code, vehicle_code, status, payload
      FROM operation_orders
      WHERE line_kind = 'TEST' AND payload->>'source' = 'plan_replay'
      ORDER BY planned_start
    `);
    console.log(`舊版重播單（line_kind=TEST、source=plan_replay）：${rows.length} 筆${APPLY ? '' : '（預覽，不寫入）'}`);
    const plans = new Map();
    const fixes = [];
    const unresolved = [];
    for (const row of rows) {
      const payload = row.payload ?? {};
      const shiftId = payload.plan_shift_id;
      const tripCode = payload.plan_trip_code || row.trip_code;
      if (!shiftId) {
        unresolved.push({ row, reason: '單上沒有記錄班表 ID（plan_shift_id），無法確認是哪一份班表的任務' });
        continue;
      }
      if (!plans.has(shiftId)) {
        try {
          plans.set(shiftId, await fetchPlan(shiftId));
        } catch (error) {
          plans.set(shiftId, { error: error.message });
        }
      }
      const plan = plans.get(shiftId);
      if (plan.error) {
        unresolved.push({ row, reason: `取不到班表 ${shiftId} 的執行計畫：${plan.error}` });
        continue;
      }
      const trip = (plan.trips ?? []).find((item) => item.trip_code === tripCode);
      if (!trip?.order_fields) {
        unresolved.push({ row, reason: `班表 ${shiftId} 目前的計畫裡找不到任務 ${tripCode}（班表可能已改過）` });
        continue;
      }
      const planTaskType = trip.order_fields.payload?.maintenance_task_type ?? null;
      if (trip.kind !== payload.kind || (payload.maintenance_task_type ?? null) !== planTaskType) {
        unresolved.push({
          row,
          reason: `任務 ${tripCode} 的種類與單上記錄不一致（單：${payload.kind}/${recordedTaskType(payload) ?? '-'}，`
            + `計畫：${trip.kind}/${planTaskType ?? '-'}），班表可能已改過`,
        });
        continue;
      }
      if (String(payload.plan_shift_updated_at ?? '') !== String(plan.shift?.updated_at_ms ?? '')) {
        // 班表重存過但同一個任務的種類一致：分類可確認，仍照實標註
        trip.__note = '班表在下單後重新儲存過，任務種類一致';
      }
      fixes.push({ row, trip, fields: trip.order_fields });
    }

    for (const { row, trip, fields } of fixes) {
      console.log(
        `  ${row.order_id}｜${row.vehicle_code}｜${row.status}｜${row.payload.kind}/${recordedTaskType(row.payload) ?? '-'}`
        + ` → ${fields.line_kind}${fields.maint_type_label ? `（${fields.maint_type_label}，格位 ${fields.maint_station}）` : ''}`
        + `，卡片標籤「${fields.payload.card_label ?? ''}」${trip.__note ? `；${trip.__note}` : ''}`,
      );
    }
    if (unresolved.length > 0) {
      console.log(`\n無法確認、不修改：${unresolved.length} 筆`);
      for (const { row, reason } of unresolved) console.log(`  ${row.order_id}｜${row.vehicle_code}｜${row.status}：${reason}`);
    }

    if (!APPLY) {
      console.log(`\n可修正 ${fixes.length} 筆；確認後加 --apply 寫入（只改這些列的分類、徽章與卡片欄位，狀態與時間不動）`);
      return;
    }
    await client.query('BEGIN');
    for (const { row, fields } of fixes) {
      const patch = {
        task_type: fields.payload.task_type ?? null,
        card_label: fields.payload.card_label ?? null,
        route_code: fields.payload.route_code ?? null,
        route_name: fields.payload.route_name ?? null,
        timeline_row: fields.payload.timeline_row ?? null,
        legacy_card_label: row.payload.card_label ?? null,
        legacy_line_kind: 'TEST',
        reclassified_at: Date.now(),
      };
      // 只改仍是舊分類的列；同時有人改過（不再是 TEST）就跳過
      await client.query(
        `UPDATE operation_orders
         SET line_kind = $2,
             maint_type_label = COALESCE(maint_type_label, $3),
             maint_type_bg = COALESCE(maint_type_bg, $4),
             maint_type_color = COALESCE(maint_type_color, $5),
             maint_station = COALESCE(maint_station, $6),
             payload = payload || $7::jsonb
         WHERE order_id = $1 AND line_kind = 'TEST' AND payload->>'source' = 'plan_replay'`,
        [
          row.order_id,
          fields.line_kind,
          fields.maint_type_label ?? null,
          fields.maint_type_bg ?? null,
          fields.maint_type_color ?? null,
          fields.maint_station ?? null,
          JSON.stringify(patch),
        ],
      );
    }
    await client.query('COMMIT');
    console.log(`\n已修正 ${fixes.length} 筆`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
