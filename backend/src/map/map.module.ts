import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { MapEntity } from '../database/entities/map.entity';
import { MapVersion } from '../database/entities/map-version.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MapEntity, MapVersion])],
  controllers: [MapController],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule {}
