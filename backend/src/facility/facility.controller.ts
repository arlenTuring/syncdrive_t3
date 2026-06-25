import { Controller, Get, Query } from '@nestjs/common';
import { FacilityService } from './facility.service';

@Controller('facility')
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
