import { BadRequestException, ConflictException } from '@nestjs/common';
import { MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { MediaLibraryService } from './media-library.service';

function service(overrides: Record<string, unknown> = {}) {
  const repo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    ...overrides,
  };
  const storage: any = { store: jest.fn(), remove: jest.fn().mockResolvedValue(true), removeOrphans: jest.fn() };
  return { repo, storage, subject: new MediaLibraryService(repo, { find: jest.fn().mockResolvedValue([]) } as any, {} as any, storage) };
}

describe('MediaLibraryService', () => {
  it('creates Unicode text media without creating a file', async () => {
    const { subject, repo, storage } = service();
    const result = await subject.create({ name: '到站文字', description: '月台提示', mediaType: 'text', textContent: '第一行\n第二行' });
    expect(storage.store).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalled();
    expect(result.text_content).toBe('第一行\n第二行');
  });

  it('rejects whitespace-only text', async () => {
    const { subject } = service();
    await expect(subject.create({ name: '文字', description: '說明', mediaType: 'text', textContent: '  \n ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects stale edits before storing a replacement file', async () => {
    const row = { id: 'MED-1', name: '舊名稱', kind: MediaLibraryKind.MEDIA, body: { mediaType: 'audio', description: '舊說明', file: { storageKey: '00000000-0000-0000-0000-000000000000.mp3' } }, createdAt: '1', updatedAt: '2' };
    const { subject, storage } = service({ findOne: jest.fn().mockResolvedValue(row) });
    await expect(subject.update('MED-1', { name: '新名稱', description: '新說明', mediaType: 'audio', expectedUpdatedAt: '1' }, { originalname: 'new.mp3', size: 3, buffer: Buffer.from('ID3') })).rejects.toBeInstanceOf(ConflictException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('hides empty media groups from consumer options', async () => {
    const rows = [
      { id: 'MED-1', name: '媒體', kind: MediaLibraryKind.MEDIA, body: {} },
      { id: 'GROUP-EMPTY', name: '空群組', kind: MediaLibraryKind.GROUP, body: { mediaIds: [] } },
      { id: 'GROUP-OK', name: '可播放群組', kind: MediaLibraryKind.GROUP, body: { mediaIds: ['MED-1'] } },
    ];
    const { subject } = service({ find: jest.fn().mockResolvedValue(rows) });
    expect((await subject.listOptions()).items.map((item) => item.id)).toEqual(['MED-1', 'GROUP-OK']);
  });
});
