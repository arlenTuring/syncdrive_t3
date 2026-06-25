import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { DatasourceInvalidationService } from './datasource-invalidation.service';

@Global()
@Module({
  providers: [EventsGateway, DatasourceInvalidationService],
  exports: [EventsGateway, DatasourceInvalidationService],
})
export class EventsModule {}
