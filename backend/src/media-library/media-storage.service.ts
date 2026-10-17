import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const MIN_FREE_BYTES = 50 * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;

export type MediaType = 'audio' | 'text' | 'image' | 'video';
export type UploadedMediaFile = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};
export type StoredMediaFile = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  status: 'ready';
};

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
};

@Injectable()
export class MediaStorageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly root: string;
  private readonly objectsDir: string;
  private readonly tempDir: string;
  private activeUploads = 0;

  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>('MEDIA_STORAGE_DIR') ?? join(process.cwd(), 'data', 'media'),
    );
    this.objectsDir = join(this.root, 'objects');
    this.tempDir = join(this.root, '.tmp');
  }

  async onApplicationBootstrap() {
    await this.ensureDirectories();
    await this.removeOldFiles(this.tempDir);
  }

  async store(file: UploadedMediaFile, mediaType: Exclude<MediaType, 'text'>) {
    if (this.activeUploads >= 4) {
      throw new ServiceUnavailableException('同時上傳數量已達上限，請稍後再試');
    }
    this.activeUploads += 1;
    let tempPath = '';
    try {
      this.validateBasic(file);
      await this.ensureDirectories();
      const stat = await fs.statfs(this.root);
      const freeBytes = Number(stat.bavail) * Number(stat.bsize);
      if (freeBytes < file.size + MIN_FREE_BYTES) {
        throw new ServiceUnavailableException('媒體儲存空間不足');
      }
      const uploadId = randomUUID();
      tempPath = join(this.tempDir, uploadId);
      await fs.writeFile(tempPath, file.buffer, { flag: 'wx', mode: 0o600 });
      const declared = (file.mimetype ?? '').toLowerCase();
      const declaredMatches = !declared || declared === 'application/octet-stream'
        || (mediaType === 'image' && declared.startsWith('image/'))
        || (mediaType === 'video' && declared === 'video/mp4')
        || (mediaType === 'audio' && (declared.startsWith('audio/') || declared === 'video/mp4'));
      if (!declaredMatches) throw new BadRequestException('宣告的 MIME 與媒體類型不符');
      const inspected = await this.inspect(tempPath, file.originalname, mediaType);
      const storageKey = `${randomUUID()}${inspected.extension}`;
      const finalPath = this.pathForKey(storageKey);
      await fs.rename(tempPath, finalPath);
      tempPath = '';
      return {
        storageKey,
        originalName: basename(file.originalname),
        mimeType: inspected.mimeType,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        durationSeconds: inspected.durationSeconds,
        width: inspected.width,
        height: inspected.height,
        status: 'ready' as const,
      } satisfies StoredMediaFile;
    } finally {
      this.activeUploads -= 1;
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  pathForKey(storageKey: string) {
    if (!/^[0-9a-f-]{36}\.(mp3|wav|m4a|mp4|png|jpe?g|webp)$/i.test(storageKey)) {
      throw new BadRequestException('媒體儲存鍵無效');
    }
    const path = resolve(this.objectsDir, storageKey);
    if (!path.startsWith(`${this.objectsDir}${sep}`)) {
      throw new BadRequestException('媒體儲存鍵無效');
    }
    return path;
  }

  async remove(storageKey?: string) {
    if (!storageKey) return true;
    try {
      await fs.rm(this.pathForKey(storageKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      this.logger.warn(`Media file cleanup pending for ${storageKey}`);
      return false;
    }
  }

  /** 只回收超過 24 小時且資料庫已無引用的正式檔案，避免碰到進行中提交。 */
  async removeOrphans(referencedKeys: Set<string>) {
    await this.ensureDirectories();
    const files = await fs.readdir(this.objectsDir, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const file of files) {
      if (!file.isFile() || referencedKeys.has(file.name)) continue;
      const path = join(this.objectsDir, file.name);
      const stat = await fs.stat(path).catch(() => null);
      if (stat && now - stat.mtimeMs > STALE_MS) await fs.rm(path, { force: true }).catch(() => undefined);
    }
  }

  async assertReadable(storageKey: string) {
    const path = this.pathForKey(storageKey);
    await fs.access(path, constants.R_OK);
    return { path, stat: await fs.stat(path) };
  }

  private validateBasic(file: UploadedMediaFile) {
    if (!file?.buffer || file.size <= 0) throw new BadRequestException('檔案不可為空');
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException('檔案超過 20 MiB 上限');
    if (file.originalname.length > 255) throw new BadRequestException('原始檔名過長');
  }

  private async inspect(path: string, originalName: string, mediaType: Exclude<MediaType, 'text'>) {
    const extension = extname(originalName).toLowerCase();
    const allowed: Record<typeof mediaType, string[]> = {
      audio: ['.mp3', '.wav', '.m4a', '.mp4'],
      image: ['.png', '.jpg', '.jpeg', '.webp'],
      video: ['.mp4'],
    };
    if (!allowed[mediaType].includes(extension)) throw new BadRequestException('檔案無效或格式不符，請更換類型或重新上傳');

    const header = await fs.readFile(path).then((buffer) => buffer.subarray(0, 32));
    const signatureOk =
      (extension === '.mp3' && (header.subarray(0, 3).toString() === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0))) ||
      (extension === '.wav' && header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE') ||
      (['.m4a', '.mp4'].includes(extension) && header.subarray(4, 8).toString() === 'ftyp') ||
      (extension === '.png' && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (['.jpg', '.jpeg'].includes(extension) && header[0] === 0xff && header[1] === 0xd8) ||
      (extension === '.webp' && header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP');
    if (!signatureOk) throw new BadRequestException('檔案無效或格式不符，請更換類型或重新上傳');

    let streams: ProbeStream[];
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', path,
      ], { timeout: 10_000, maxBuffer: 256 * 1024 });
      streams = (JSON.parse(stdout) as { streams?: ProbeStream[] }).streams ?? [];
    } catch {
      throw new ServiceUnavailableException('媒體格式檢測服務無法使用');
    }
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const video = streams.find((stream) => stream.codec_type === 'video');
    if (mediaType === 'audio' && (!audio || video)) throw new BadRequestException('檔案無效或格式不符，請更換類型或重新上傳');
    if (mediaType === 'video' && !video) throw new BadRequestException('檔案無效或格式不符，請更換類型或重新上傳');
    if (mediaType === 'image' && (!video || !video.width || !video.height || video.width * video.height > 50_000_000 || video.width > 12_000 || video.height > 12_000)) {
      throw new BadRequestException('圖片損壞或尺寸超過限制');
    }
    const mimeType = extension === '.mp3' ? 'audio/mpeg' : extension === '.wav' ? 'audio/wav' : extension === '.m4a' ? 'audio/mp4' : extension === '.mp4' ? (mediaType === 'video' ? 'video/mp4' : 'audio/mp4') : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    const duration = Number(audio?.duration ?? video?.duration);
    return { extension: extension === '.jpeg' ? '.jpg' : extension, mimeType, durationSeconds: Number.isFinite(duration) ? duration : undefined, width: video?.width, height: video?.height };
  }

  private async ensureDirectories() {
    await fs.mkdir(this.objectsDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(this.tempDir, { recursive: true, mode: 0o750 });
  }

  private async removeOldFiles(directory: string) {
    const files = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const file of files) {
      if (!file.isFile()) continue;
      const path = join(directory, file.name);
      const stat = await fs.stat(path).catch(() => null);
      if (stat && now - stat.mtimeMs > STALE_MS) await fs.rm(path, { force: true }).catch(() => undefined);
    }
  }
}
