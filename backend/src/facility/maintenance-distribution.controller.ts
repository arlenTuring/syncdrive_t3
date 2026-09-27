import { Controller, Get } from '@nestjs/common';
import { MaintenanceDistributionService } from './maintenance-distribution.service';

@Controller('syncdrive-api/facility')
export class MaintenanceDistributionController {
  constructor(private readonly maintenanceDistributionService: MaintenanceDistributionService) {}

  /**
   * 儀表板「整備分佈」：部署中班表的整備區塊、各區塊的格位，以及哪幾格現在有車。
   * 車進出格位、整備訂單狀態改變時會發 domain:maintenance_slots／table:operation_orders
   * 失效通知，前端據此重查。
   */
  @Get('maintenance-distribution')
  async getMaintenanceDistribution() {
    return this.maintenanceDistributionService.getDistribution();
  }

  /**
   * 儀表板「車輛分佈」：營運中／整備中／待命中的比例與車數（每列一種狀態）。
   * 跟整備分佈同一套判斷；失效通知同上。
   */
  @Get('vehicle-distribution')
  async getVehicleDistribution() {
    return this.maintenanceDistributionService.getVehicleDistribution();
  }
}
