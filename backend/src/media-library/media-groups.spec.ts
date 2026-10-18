import { REQUIRE_PERMISSION } from '../access-control/access.guard';
import { ACCESS_PERMISSIONS } from '../access-control/access.constants';
import { MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { groupPlayability, mediaUnavailableReason, memberSummary } from './media-availability';
import { MediaGroupsController } from './media-groups.controller';

const media = (id: string, body: Record<string, unknown>) => ({ id, name: id, kind: MediaLibraryKind.MEDIA, body, createdAt: '1', updatedAt: '1', version: 1 });
const ready = { storageKey: '00000000-0000-0000-0000-000000000000.mp3', originalName: 'a.mp3', status: 'ready' };

describe('media availability', () => {
  it('judges text by its content and files by their stored status', () => {
    expect(mediaUnavailableReason(media('T', { mediaType: 'text', textContent: '  ' }))).toBe('empty_text');
    expect(mediaUnavailableReason(media('T', { mediaType: 'text', textContent: '到站' }))).toBeNull();
    expect(mediaUnavailableReason(media('A', { mediaType: 'audio' }))).toBe('missing_file');
    expect(mediaUnavailableReason(media('A', { mediaType: 'audio', file: { ...ready, status: 'processing' } }))).toBe('file_not_ready');
    expect(mediaUnavailableReason(media('A', { mediaType: 'audio', file: ready }))).toBeNull();
    expect(mediaUnavailableReason(media('S', {}))).toBe('missing_type');
  });

  it('does not treat a group as playable just because it has members', () => {
    const rows = new Map([
      ['OK', media('OK', { mediaType: 'audio', file: ready })],
      ['BAD', media('BAD', { mediaType: 'audio' })],
    ]);
    expect(groupPlayability([], rows)).toMatchObject({ playable: false, reason: 'empty' });
    expect(groupPlayability(['OK', 'GONE'], rows)).toMatchObject({ playable: false, reason: 'missing_member', missing_ids: ['GONE'] });
    expect(groupPlayability(['OK', 'BAD'], rows)).toMatchObject({ playable: false, reason: 'member_unavailable' });
    expect(groupPlayability(['OK'], rows)).toMatchObject({ playable: true });
  });

  it('summarises a member without file content', () => {
    const summary = memberSummary(media('T', { mediaType: 'text', description: '跑馬燈', textContent: '字'.repeat(80) }) as never);
    expect(summary.text_excerpt).toHaveLength(61);
    expect(summary).not.toHaveProperty('text_content');
  });
});

describe('MediaGroupsController permissions', () => {
  const handler = (name: string) => (MediaGroupsController.prototype as unknown as Record<string, object>)[name];
  it('views with media.groups.view and edits membership with media.groups.edit only', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, MediaGroupsController)).toEqual(['media.groups.view']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('create'))).toEqual(['media.groups.create']);
    for (const name of ['rename', 'addMembers', 'reorder', 'removeMember', 'candidates']) expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler(name))).toEqual(['media.groups.edit']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('remove'))).toEqual(['media.groups.delete']);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION, handler('deleteImpact'))).toEqual(['media.groups.delete']);
  });

  it('marks the group permissions as connected', () => {
    const codes = ACCESS_PERMISSIONS.filter((item) => item.pageKey === 'groups' && item.moduleKey === 'media');
    expect(codes.map((item) => item.code)).toEqual(['media.groups.view', 'media.groups.create', 'media.groups.edit', 'media.groups.delete']);
    expect(codes.every((item) => item.connected)).toBe(true);
  });
});
