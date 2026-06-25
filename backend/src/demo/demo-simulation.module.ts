import { Module } from '@nestjs/common';
import { DemoSimulationController } from './demo-simulation.controller';
import { DemoSimulationService } from './demo-simulation.service';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';
import { OrderModule } from '../order/order.module';
import { CommandModule } from '../command/command.module';

@Module({
  imports: [OrderModule, CommandModule],
  controllers: [DemoSimulationController],
  providers: [DemoSimulationService, DashboardDemoSeedService],
  exports: [DemoSimulationService],
})
export class DemoSimulationModule {}
