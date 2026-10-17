import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorageService } from './media-storage.service';

describe('MediaStorageService', () => {
  let root: string;
  let service: MediaStorageService;
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'syncdrive-media-'));
    service = new MediaStorageService({ get: () => root } as any);
    await service.onApplicationBootstrap();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('blocks path traversal and arbitrary storage keys', () => {
    expect(() => service.pathForKey('../../etc/passwd')).toThrow(BadRequestException);
    expect(() => service.pathForKey('https://example.com/a.mp3')).toThrow(BadRequestException);
  });

  it('rejects a renamed non-media file without leaving a formal object', async () => {
    await expect(service.store({ originalname: 'fake.mp3', mimetype: 'audio/mpeg', size: 12, buffer: Buffer.from('not an audio') }, 'audio')).rejects.toBeInstanceOf(BadRequestException);
    expect(await fs.readdir(join(root, 'objects'))).toEqual([]);
  });

  it('rejects an empty file', async () => {
    await expect(service.store({ originalname: 'empty.png', mimetype: 'image/png', size: 0, buffer: Buffer.alloc(0) }, 'image')).rejects.toBeInstanceOf(BadRequestException);
  });
});
