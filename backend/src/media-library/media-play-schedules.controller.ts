import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, type AuthenticatedRequest } from '../access-control/access.guard';
import { MediaPlaySchedulesService, type ScheduleInput } from './media-play-schedules.service';

/**
 * 媒體排程設定 API（預約播放、定時播放）。固定路由放在 :id 之前。
 * 選項端點只給建立／編輯所需的摘要，不需要媒體或分組的修改權限。
 */
@ApiTags('Media Play Schedules')
@Controller('syncdrive-api/media-play-schedules')
@RequirePermission('media.schedule.view')
export class MediaPlaySchedulesController {
  constructor(private readonly schedules: MediaPlaySchedulesService) {}

  @Get()
  @ApiOperation({ summary: '排程列表（搜尋名稱、排序、分頁）' })
  list(@Query('keyword') keyword?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string, @Query('sort_by') sortBy?: string, @Query('sort_direction') direction?: string) {
    return this.schedules.list({ keyword, page: Number(page), page_size: Number(pageSize), sort_by: sortBy, sort_direction: direction });
  }

  @Get('settings')
  @ApiOperation({ summary: '預設時區（系統設定；未設定為 Asia/Taipei）' })
  async settings() {
    return { time_zone: await this.schedules.defaultTimeZone() };
  }

  @Get('options/vehicles')
  @RequirePermission('media.schedule.create', 'media.schedule.edit')
  vehicleOptions() {
    return this.schedules.vehicleOptions();
  }

  @Get('options/groups')
  @RequirePermission('media.schedule.create', 'media.schedule.edit')
  groupOptions(@Query('keyword') keyword?: string, @Query('page') page?: string) {
    return this.schedules.groupOptions({ keyword, page: Number(page) });
  }

  @Get('options/media')
  @RequirePermission('media.schedule.create', 'media.schedule.edit')
  mediaOptions(@Query('keyword') keyword?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return this.schedules.mediaOptions({ keyword, page: Number(page), page_size: Number(pageSize) });
  }

  @Post()
  @RequirePermission('media.schedule.create')
  create(@Body() body: ScheduleInput, @Req() request: AuthenticatedRequest) {
    return this.schedules.create(body ?? {}, request.authUser?.account_name);
  }

  @Get(':id/results')
  @ApiOperation({ summary: '最近的到期結果（批次與各載具處理結果）' })
  results(@Param('id') id: string) {
    return this.schedules.results(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.schedules.get(id);
  }

  @Put(':id')
  @RequirePermission('media.schedule.edit')
  update(@Param('id') id: string, @Body() body: ScheduleInput) {
    return this.schedules.update(id, body ?? {});
  }

  @Delete(':id')
  @RequirePermission('media.schedule.delete')
  remove(@Param('id') id: string, @Query('expected_version') expectedVersion?: string) {
    return this.schedules.remove(id, expectedVersion);
  }
}
