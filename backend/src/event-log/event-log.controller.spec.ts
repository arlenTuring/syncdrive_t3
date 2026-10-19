import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION } from '../access-control/access.guard';
import { ACCESS_PERMISSIONS } from '../access-control/access.constants';
import { EventsController } from './events.controller';
import { VideoController } from '../video/video.controller';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { csvCell, toCsv } from './csv';

const reflector = new Reflector();
const perms = (cls: any, method?: string) =>
  reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION, [method ? cls.prototype[method] : cls, cls]);

describe('事件／日誌權限', () => {
  it('事件：檢視、確認、匯出各自的權限', () => {
    expect(perms(EventsController)).toEqual(['events.events.view']);
    expect(perms(EventsController, 'list')).toEqual(['events.events.view']);
    expect(perms(EventsController, 'acknowledge')).toEqual(['events.events.manage']);
    expect(perms(EventsController, 'export')).toEqual(['events.events.export']);
    expect(perms(VideoController)).toEqual(['events.video.view']);
    expect(perms(VideoController, 'createSource')).toEqual(['events.video.configure']);
    expect(perms(VideoController, 'saveTiles')).toEqual(['events.video.configure']);
  });

  it('權限代碼都已登錄且接上（不是未接入口）', () => {
    const codes = ['events.events.view', 'events.events.manage', 'events.events.export', 'events.video.view', 'events.video.configure', 'events.video.recording-manage',
      'events.video-history.view', 'events.video-history.export', 'events.video-history.delete',
      ...['system', 'permissions', 'operations', 'authentication'].flatMap((c) => [`logs.${c}.view`, `logs.${c}.export`])];
    for (const code of codes) {
      const item = ACCESS_PERMISSIONS.find((p) => p.code === code);
      expect(item?.connected).toBe(true);
    }
  });

  it('日誌：每一類各自檢查 view／export，能看 A 類不代表能看 B 類', () => {
    const controller = new LogsController(new LogsService({} as never), {} as never);
    const req = (permissions: string[]) => ({ authUser: { id: 'u', display_name: 'u', roles: [], permissions } }) as never;
    const check = (controller as any).require.bind(controller);
    expect(check(req(['logs.system.view']), 'system', 'view')).toBe('system');
    expect(() => check(req(['logs.system.view']), 'permissions', 'view')).toThrow(ForbiddenException);
    expect(() => check(req(['logs.system.view']), 'system', 'export')).toThrow(ForbiddenException);
    expect(() => check(req(['logs.system.view']), 'secret', 'view')).toThrow();
  });
});

describe('CSV', () => {
  it('BOM、引號、換行與公式注入', () => {
    const csv = toCsv([{ a: '=1+1', b: '含"引號"\n換行', c: '-5' }], [
      { header: 'A', value: (r) => r.a },
      { header: 'B', value: (r) => r.b },
      { header: 'C', value: (r) => r.c, raw: true },
    ]);
    expect(csv.startsWith('﻿A,B,C\r\n')).toBe(true);
    expect(csv).toContain(`'=1+1,"含""引號""\n換行",-5`);
    expect(csvCell(null)).toBe('');
  });
});
