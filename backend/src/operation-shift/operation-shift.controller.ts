import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  OperationShiftPublishStatus,
  OperationShiftUsageStatus,
} from '../database/entities/operation-shift.entity';
import { OperationShiftService } from './operation-shift.service';

@ApiTags('Operation Shifts')
@Controller('syncdrive-api/operation-shift')
export class OperationShiftController {
  constructor(private readonly operationShiftService: OperationShiftService) {}

  @Get('list')
  @ApiOperation({ summary: '正線班表列表（分頁、篩選）' })
  async listShifts(
    @Query('keyword') keyword?: string,
    @Query('usage_status') usage_status?: string,
    @Query('publish_status') publish_status?: string,
    @Query('page') page?: string,
    @Query('page_size') page_size?: string,
  ) {
    const us =
      usage_status === OperationShiftUsageStatus.IDLE
        || usage_status === OperationShiftUsageStatus.IN_USE
        ? usage_status
        : 'all';

    const ps =
      publish_status === OperationShiftPublishStatus.DRAFT
        || publish_status === OperationShiftPublishStatus.PUBLISHED
        ? publish_status
        : 'all';

    return this.operationShiftService.listShifts({
      keyword,
      usage_status: us,
      publish_status: ps,
      page: page ? Number(page) : undefined,
      page_size: page_size ? Number(page_size) : undefined,
    });
  }

  @Get('check-name')
  @ApiOperation({ summary: '檢查班表名稱是否唯一' })
  async checkName(
    @Query('name') name?: string,
    @Query('exclude_id') exclude_id?: string,
  ) {
    return {
      unique: await this.operationShiftService.isShiftNameUnique(name ?? '', exclude_id),
    };
  }

  @Get('timetable/trips')
  @ApiOperation({
    summary: '取得班表班次清單（含各站時刻）',
    description:
      '讀取最新「已發布」且有 plan 的班表；若無已發布則 fallback 最新草稿。'
      + '回傳全部任務類型（正線／保養／行檢／充電／待命／調度等，略過 transition）。'
      + '可用 from/to 過濾卡時間重疊區間。',
  })
  @ApiQuery({ name: 'from', required: false, description: 'HH:MM:SS 或秒，預設 00:00:00' })
  @ApiQuery({ name: 'to', required: false, description: 'HH:MM:SS 或秒，預設 24:00:00' })
  async getTimetableTrips(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.operationShiftService.getTimetableTrips({ from, to });
  }

  @Get('timetable/station-etas')
  @ApiOperation({
    summary: '取得各站計畫 ETA（抵達／離站）',
    description:
      '由班表推算之站點事件流；vehicle_id 暫為 null。可用 from/to、station_id 濾波。',
  })
  @ApiQuery({ name: 'from', required: false, description: 'HH:MM:SS 或秒，預設 00:00:00' })
  @ApiQuery({ name: 'to', required: false, description: 'HH:MM:SS 或秒，預設 24:00:00' })
  @ApiQuery({ name: 'station_id', required: false, description: '只取單一站' })
  async getStationEtas(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('station_id') station_id?: string,
  ) {
    return this.operationShiftService.getStationEtas({
      from,
      to,
      station_id,
    });
  }

  @Get('detail/:id')
  @ApiOperation({ summary: '取得班表詳情（含 body）' })
  async getShiftDetail(@Param('id') id: string) {
    return this.operationShiftService.getShiftDetail(id);
  }

  @Post('draft')
  @ApiOperation({ summary: '建立班表草稿' })
  async createDraft(@Body() body: { name?: string; body?: Record<string, unknown> }) {
    return this.operationShiftService.createDraft({
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Post('detail/:id/publish')
  @ApiOperation({ summary: '發布班表（供 timetable API 優先讀取）' })
  async publishShift(@Param('id') id: string) {
    return this.operationShiftService.publishShift(id);
  }

  @Post('detail/:id/duplicate')
  @ApiOperation({ summary: '以此複製新版班表草稿' })
  async duplicateDraft(@Param('id') id: string) {
    return this.operationShiftService.duplicateAsNewDraft(id);
  }

  @Post('detail/:id/duplicate-as-manual')
  @ApiOperation({ summary: '參數生成班表複製成手動製作草稿' })
  async duplicateAsManualDraft(@Param('id') id: string) {
    return this.operationShiftService.duplicateAsManualDraft(id);
  }

  @Patch('detail/:id')
  @ApiOperation({ summary: '更新班表草稿' })
  async updateDraft(
    @Param('id') id: string,
    @Body() body: { name?: string; body?: Record<string, unknown> },
  ) {
    return this.operationShiftService.updateDraft(id, {
      name: body?.name ?? '',
      body: body?.body ?? {},
    });
  }

  @Delete('detail/:id')
  @ApiOperation({ summary: '刪除班表' })
  async deleteShift(@Param('id') id: string) {
    await this.operationShiftService.deleteShift(id);
    return { ok: true };
  }
}
