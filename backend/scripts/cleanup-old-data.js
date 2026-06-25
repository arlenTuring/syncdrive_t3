/**
 * 清除 Postgres 內過舊的 log / 遙測資料，釋放磁碟空間。
 * 用法：node scripts/cleanup-old-data.js [--days 3] [--dry-run]
 * 需 Postgres 可連線（docker compose up -d postgres）。
 */
const { Client } = require('pg');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysIdx = args.indexOf('--days');
const keepDays = daysIdx >= 0 ? Math.max(1, parseInt(args[daysIdx + 1] || '3', 10)) : 3;

const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'syncdrive_user',
  password: process.env.DB_PASSWORD || 'syncdrive_password',
  database: process.env.DB_NAME || 'syncdrive_t3',
});

async function tableSize(table) {
  const { rows } = await client.query(
    `SELECT pg_size_pretty(pg_total_relation_size($1::regclass)) AS size`,
    [table],
  );
  return rows[0]?.size ?? '?';
}

async function countOlder(table, whereSql) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::bigint AS n FROM ${table} WHERE ${whereSql}`,
  );
  return rows[0].n;
}

async function run() {
  await client.connect();
  const cutoffMs = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  console.log(`Keep last ${keepDays} day(s); cutoff ${cutoffIso}${dryRun ? ' (dry-run)' : ''}`);
  console.log('--- sizes before ---');
  for (const t of [
    'telemetry_logs',
    'command_logs',
    'operator_action_logs',
    'junction_interlock_logs',
    'security_event_logs',
  ]) {
    try {
      console.log(`${t}: ${await tableSize(t)}`);
    } catch {
      /* table may not exist */
    }
  }

  const plans = [];

  const isHypertable = await client.query(`
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'telemetry_logs' LIMIT 1;
  `);
  if (isHypertable.rowCount > 0) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM telemetry_logs WHERE "timestamp" < $1::timestamptz`,
      [cutoffIso],
    );
    plans.push({
      label: 'telemetry_logs (drop_chunks)',
      count: rows[0].n,
      run: async () => {
        await client.query(
          `SELECT drop_chunks('telemetry_logs', older_than => $1::timestamptz)`,
          [cutoffIso],
        );
      },
    });
  } else {
    plans.push({
      label: 'telemetry_logs (delete)',
      count: await countOlder('telemetry_logs', `"timestamp" < '${cutoffIso}'::timestamptz`),
      run: async () => {
        await client.query(
          `DELETE FROM telemetry_logs WHERE "timestamp" < $1::timestamptz`,
          [cutoffIso],
        );
      },
    });
  }

  plans.push(
    {
      label: 'command_logs',
      count: await countOlder('command_logs', `sent_at < ${cutoffMs}`),
      run: () => client.query(`DELETE FROM command_logs WHERE sent_at < $1`, [String(cutoffMs)]),
    },
    {
      label: 'operator_action_logs',
      count: await countOlder('operator_action_logs', `created_at < ${cutoffMs}`),
      run: () =>
        client.query(`DELETE FROM operator_action_logs WHERE created_at < $1`, [
          String(cutoffMs),
        ]),
    },
    {
      label: 'junction_interlock_logs',
      count: await countOlder('junction_interlock_logs', `requested_at < ${cutoffMs}`),
      run: () =>
        client.query(`DELETE FROM junction_interlock_logs WHERE requested_at < $1`, [
          String(cutoffMs),
        ]),
    },
    {
      label: 'security_event_logs',
      count: await countOlder('security_event_logs', `created_at < ${cutoffMs}`).catch(
        () => '0',
      ),
      run: () =>
        client.query(`DELETE FROM security_event_logs WHERE created_at < $1`, [
          String(cutoffMs),
        ]),
    },
  );

  console.log('--- rows to remove ---');
  for (const p of plans) {
    console.log(`${p.label}: ${p.count}`);
  }

  if (!dryRun) {
    for (const p of plans) {
      if (String(p.count) === '0') continue;
      await p.run();
      console.log(`✓ cleaned ${p.label}`);
    }
    try {
      await client.query('VACUUM ANALYZE telemetry_logs');
      await client.query('VACUUM ANALYZE command_logs');
    } catch {
      /* best effort */
    }
    console.log('--- sizes after ---');
    for (const t of ['telemetry_logs', 'command_logs']) {
      try {
        console.log(`${t}: ${await tableSize(t)}`);
      } catch {
        /* ignore */
      }
    }
  }

  await client.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
