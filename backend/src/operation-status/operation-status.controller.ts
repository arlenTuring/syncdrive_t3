import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access-control/access.guard';
import { OperationStatusService } from './operation-status.service';

@ApiTags('Operation Status')
@Controller('syncdrive-api/operation-status')
@RequirePermission('dashboard.monitor.view', 'schedule.records.view')
export class OperationStatusController {
  constructor(private readonly service: OperationStatusService) {}

  /**
   * 儀表板「營運狀態」：正常營運／降級運轉中／未部署班表／調度暫停中／營運狀態未知（取最嚴重的一種）。
   * 降級啟用或解除、調度開關、部署班表時發 domain:operation_status 失效通知，前端據此重查。
   */
  @Get()
  @ApiOperation({ summary: '目前場域營運狀態（儀表板用）' })
  async getStatus() {
    return [await this.service.getStatus()];
  }
}
