import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import * as path from 'path';

function sanitizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return 'run';
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  return cleaned || 'run';
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * 開發輔助：前端排班引擎每次生成時把完整報告寫成 log 檔，
 * 存於 backend/logs/schedule-engine/，方便離線分析報錯。
 */
@ApiTags('Dev Log')
@Controller('syncdrive-api/dev-log')
export class DevLogController {
  @Post('schedule-engine')
  @HttpCode(200)
  @ApiOperation({ summary: '寫入一次排班引擎生成 log（開發用）' })
  async writeScheduleEngineLog(
    @Body() body: { label?: string; payload?: unknown },
  ) {
    const dir = path.resolve(process.cwd(), 'logs', 'schedule-engine');
    await fs.mkdir(dir, { recursive: true });

    const fileName = `${timestampSlug(new Date())}-${sanitizeLabel(body?.label)}.json`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(
      filePath,
      JSON.stringify(body?.payload ?? body ?? {}, null, 2),
      'utf8',
    );

    return { ok: true, file: path.relative(process.cwd(), filePath) };
  }
}
