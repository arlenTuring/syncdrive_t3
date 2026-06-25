import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FacilitySlot,
  FacilityType,
} from '../database/entities/facility-slot.entity';

@Injectable()
export class FacilityService implements OnModuleInit {
  constructor(
    @InjectRepository(FacilitySlot)
    private readonly slotRepo: Repository<FacilitySlot>,
  ) {}

  async onModuleInit() {
    // 初始化一些測試資料
    const count = await this.slotRepo.count();
    if (count === 0) {
      const slots: Partial<FacilitySlot>[] = [];
      for (let i = 1; i <= 10; i++) {
        slots.push({
          slotId: `E${i}`,
          facilityType:
            i <= 5 ? FacilityType.CHARGING_STATION : FacilityType.PARKING,
          zone: 'Zone-A',
          displayName: `${i <= 5 ? '充電格' : '停車格'} ${i}`,
          isActive: true,
          createdAt: Date.now().toString(),
          updatedAt: Date.now().toString(),
        });
      }
      await this.slotRepo.save(slots);
    }
  }

  async findAllSlots() {
    return this.slotRepo.find({
      where: { isActive: true },
      order: { slotId: 'ASC' },
    });
  }

  async findSlotsByZone(zone: string) {
    return this.slotRepo.find({
      where: { zone, isActive: true },
      order: { slotId: 'ASC' },
    });
  }
}
