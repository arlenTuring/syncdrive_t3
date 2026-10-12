import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { DatasourceInvalidationService } from './datasource-invalidation.service';
import { AccessControlModule } from '../access-control/access-control.module';

@Global()
@Module({
  imports: [AccessControlModule],
  providers: [EventsGateway, DatasourceInvalidationService],
  exports: [EventsGateway, DatasourceInvalidationService],
})
export class EventsModule {}
