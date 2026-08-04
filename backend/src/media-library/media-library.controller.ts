import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MediaLibraryKind } from '../database/entities/media-library-item.entity';
import { MediaLibraryService } from './media-library.service';

@ApiTags('Media Library')
@Controller('syncdrive-api/media-library')
export class MediaLibraryController {
  constructor(private readonly mediaLibraryService: MediaLibraryService) {}

  @Get('options')
  @ApiOperation({ summary: '媒體／媒體群組下拉選項（行動設定資源用）' })
  async listOptions() {
    return this.mediaLibraryService.listOptions();
  }

  @Get('list')
  @ApiOperation({ summary: '媒體資料庫列表' })
  async listItems(
    @Query('keyword') keyword?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    const resolvedKind =
      kind === MediaLibraryKind.MEDIA || kind === MediaLibraryKind.GROUP
        ? kind
        : 'all';
    return this.mediaLibraryService.listItems({
      keyword,
      kind: resolvedKind,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }
}
