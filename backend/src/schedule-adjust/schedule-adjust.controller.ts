import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScheduleAdjustStatus } from '../database/entities/schedule-adjust-request.entity';
import {
  ScheduleAdjustService,
  type CreateScheduleAdjustInput,
} from './schedule-adjust.service';

function toStatus(value?: string): ScheduleAdjustStatus | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (Object.values(ScheduleAdjustStatus) as string[]).includes(upper)
    ? (upper as ScheduleAdjustStatus)
    : undefined;
}

@ApiTags('Schedule Adjust Requests')
@Controller('syncdrive-api/schedule-adjust')
export class ScheduleAdjustController {
  constructor(private readonly service: ScheduleAdjustService) {}

  @Get('pending')
  @ApiOperation({ summary: '目前待核准的班表調整請求（沒有則為 null）' })
  async pending() {
    return this.service.findPending();
  }

  @Get()
  @ApiOperation({ summary: '班表調整請求清單（可依狀態過濾）' })
  async list(@Query('status') status?: string) {
    return this.service.list(toStatus(status));
  }

  @Post()
  @ApiOperation({ summary: '送出班表調整申請（進入待核准）' })
  async create(@Body() body: CreateScheduleAdjustInput) {
    return this.service.create(body);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: '核准／駁回／套用／取消一筆請求' })
  async review(
    @Param('id') id: string,
    @Body() body: { status?: string; reviewedBy?: string; reviewNote?: string },
  ) {
    return this.service.review(id, {
      status: toStatus(body?.status) ?? ScheduleAdjustStatus.CANCELLED,
      reviewedBy: body?.reviewedBy,
      reviewNote: body?.reviewNote,
    });
  }

  @Patch('pending/resolve')
  @ApiOperation({ summary: '把目前待核准的那一筆結案（不指定狀態時記為取消）' })
  async resolvePending(
    @Body() body: { status?: string; reviewedBy?: string; reviewNote?: string },
  ) {
    return this.service.resolvePending(
      toStatus(body?.status),
      body?.reviewedBy,
      body?.reviewNote,
    );
  }
}
