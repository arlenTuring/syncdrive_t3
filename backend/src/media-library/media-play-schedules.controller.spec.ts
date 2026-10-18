import { REQUIRE_PERMISSION } from '../access-control/access.guard';
import { ACCESS_PERMISSIONS } from '../access-control/access.constants';
import { MediaPlaySchedulesController } from './media-play-schedules.controller';

describe('MediaPlaySchedulesController permissions', () => {
  const handler = (name: string) => (MediaPlaySchedulesController.prototype as unknown as Record<string, object>)[name];
  it('guards every endpoint with the media schedule permissions only', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, MediaPlaySchedulesController)).toEqual(['media.schedule.view']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('create'))).toEqual(['media.schedule.create']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('update'))).toEqual(['media.schedule.edit']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('remove'))).toEqual(['media.schedule.delete']);
    // 選擇器：建立或編輯者可讀摘要，不需要媒體／分組的修改權限
    for (const name of ['vehicleOptions', 'groupOptions', 'mediaOptions']) expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler(name))).toEqual(['media.schedule.create', 'media.schedule.edit']);
    for (const name of ['list', 'get', 'results', 'settings']) expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler(name))).toBeUndefined();
  });

  it('marks the schedule permissions as connected', () => {
    const items = ACCESS_PERMISSIONS.filter((item) => item.moduleKey === 'media' && item.pageKey === 'schedule');
    expect(items.map((item) => item.code)).toEqual(['media.schedule.view', 'media.schedule.create', 'media.schedule.edit', 'media.schedule.delete']);
    expect(items.every((item) => item.connected)).toBe(true);
  });
});
