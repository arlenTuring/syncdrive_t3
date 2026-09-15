import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Vehicle } from '../database/entities/vehicle.entity';

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
  ) {}

  async listActive(): Promise<Vehicle[]> {
    return this.vehicles.find({
      where: { isActive: true, vehicleCode: Like('PMS%') },
      order: { vehicleCode: 'ASC' },
    });
  }
}
