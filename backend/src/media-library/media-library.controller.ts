import { Controller, Delete, Get, Param, Patch, Post, Query, Body, UploadedFile, UseInterceptors, Req, Res, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { Request, Response } from 'express';
import { MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { RequirePermission } from '../access-control/access.guard';
import { MediaLibraryService } from './media-library.service';
import { MEDIA_MAX_BYTES } from './media-storage.service';
import type { UploadedMediaFile } from './media-storage.service';

const upload = FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 12 } });

@ApiTags('Media Library')
@Controller('syncdrive-api/media-library')
@RequirePermission('media.content.view')
export class MediaLibraryController {
  constructor(private readonly service: MediaLibraryService) {}

  @Get('options')
  @RequirePermission('media.content.view', 'schedule.time-template.view', 'schedule.shift-list.view')
  @ApiOperation({ summary: '媒體／媒體群組下拉選項（行動設定資源用）' })
  listOptions() { return this.service.listOptions(); }

  @Get('list')
  @ApiOperation({ summary: '媒體資料庫列表' })
  listItems(@Query('keyword') keyword?: string, @Query('kind') kind?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string, @Query('sort_by') sortBy?: string, @Query('sort_direction') sortDirection?: string) {
    const resolvedKind = kind === MediaLibraryKind.MEDIA || kind === MediaLibraryKind.GROUP ? kind : 'all';
    return this.service.listItems({ keyword, kind: resolvedKind, page: page ? Number(page) : undefined, page_size: pageSize ? Number(pageSize) : undefined, sort_by: sortBy, sort_direction: sortDirection });
  }

  @Post()
  @RequirePermission('media.content.create')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  create(@Body() body: Record<string, string>, @UploadedFile() file?: UploadedMediaFile) { return this.service.create(body, file); }

  @Get(':id/delete-impact')
  @RequirePermission('media.content.delete')
  deleteImpact(@Param('id') id: string) { return this.service.deleteImpact(id); }

  @Get(':id/content')
  async content(@Param('id') id: string, @Req() request: Request, @Res() response: Response) {
    const { path, stat, metadata } = await this.service.file(id);
    const range = request.headers.range;
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', metadata.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(metadata.originalName)}`);
    if (!range) {
      response.setHeader('Content-Length', stat.size);
      createReadStream(path).pipe(response);
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).end();
    const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
    const start = suffixLength !== null ? Math.max(0, stat.size - suffixLength) : Number(match[1] || 0);
    const end = suffixLength !== null ? stat.size - 1 : (match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      response.setHeader('Content-Range', `bytes */${stat.size}`);
      return response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).end();
    }
    response.status(HttpStatus.PARTIAL_CONTENT);
    response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(path, { start, end }).pipe(response);
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.service.get(id); }

  @Patch(':id')
  @RequirePermission('media.content.edit')
  @UseInterceptors(upload)
  @ApiConsumes('multipart/form-data')
  update(@Param('id') id: string, @Body() body: Record<string, string>, @UploadedFile() file?: UploadedMediaFile) { return this.service.update(id, body, file); }

  @Delete(':id')
  @RequirePermission('media.content.delete')
  remove(@Param('id') id: string, @Query('expected_updated_at') expectedUpdatedAt?: string) { return this.service.remove(id, expectedUpdatedAt); }
}
