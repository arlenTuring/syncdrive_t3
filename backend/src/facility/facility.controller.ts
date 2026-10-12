import { Controller, Get, Query } from '@nestjs/common';
import { FacilityService } from './facility.service';
import { RequirePermission } from '../access-control/access.guard';

@Controller('facility')
@RequirePermission('schedule.shift-list.view', 'schedule.maintenance.view', 'site.station.view', 'site.equipment.view')
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Get('slots')
  async getSlots(@Query('zone') zone?: string) {
    if (zone) {
      return this.facilityService.findSlotsByZone(zone);
    }
    return this.facilityService.findAllSlots();
  }
}
