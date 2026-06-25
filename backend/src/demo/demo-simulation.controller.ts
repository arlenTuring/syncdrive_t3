import { Body, Controller, Get, HttpException, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoSimulationService } from './demo-simulation.service';

class UpdateTransportDto {
  transportPaused?: boolean;
  speedMultiplier?: number;
}

class AckTransportTickDto {
  virtualElapsedMs!: number;
  simulatedEvent?: {
    vehicleCode: string;
    eventCode: string;
    severity: string;
    message: string;
    timestamp: number;
    commandId?: string;
  };
}

class TriggerVehicleFaultDto {
  vehicleCode!: string;
}

class TriggerVehicleSimulatorActionDto {
  vehicleCode!: string;
}

class StepTransportDto {
  direction?: 'next' | 'prev';
}

@ApiTags('Demo Simulation')
@Controller('syncdrive-api/demo/simulation')
export class DemoSimulationController {
  constructor(private readonly demoSimulation: DemoSimulationService) {}

  @Get('status')
  @ApiOperation({ summary: '取得儀表板示範模擬狀態' })
  async status() {
    try {
      return await this.demoSimulation.getStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('transport')
  @ApiOperation({ summary: '取得模擬資料傳輸控制狀態（供模擬器輪詢）' })
  transport() {
    return this.demoSimulation.getTransport();
  }

  @Patch('transport')
  @ApiOperation({ summary: '調整傳輸暫停與發送速度' })
  updateTransport(@Body() body: UpdateTransportDto) {
    try {
      return this.demoSimulation.updateTransport(body);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('transport/update')
  @ApiOperation({ summary: '調整傳輸暫停與發送速度（POST 相容）' })
  updateTransportPost(@Body() body: UpdateTransportDto) {
    return this.updateTransport(body);
  }

  @Post('transport/step')
  @ApiOperation({ summary: '傳輸暫停時逐幀（next / prev）' })
  stepTransport(@Body() body?: StepTransportDto) {
    try {
      const direction = body?.direction === 'prev' ? 'prev' : 'next';
      return this.demoSimulation.stepTransportFrame(direction);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('transport/tick')
  @ApiOperation({ summary: '模擬器回報虛擬時間（每幀發送後）' })
  ackTransportTick(@Body() body: AckTransportTickDto) {
    return this.demoSimulation.ackTransportTick(
      body.virtualElapsedMs,
      body.simulatedEvent ?? null,
    );
  }

  @Post('trigger-fault')
  @ApiOperation({ summary: '模擬器工具列：對指定車輛下發 EMERGENCY_STOP（command/execute → command/ack + event/report）' })
  async triggerVehicleFault(@Body() body: TriggerVehicleFaultDto) {
    try {
      return await this.demoSimulation.triggerVehicleEmergencyStop(body.vehicleCode);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('clear-fault')
  @ApiOperation({ summary: '模擬器工具列：清除車輛故障狀態並復歸訂單' })
  async clearVehicleFault(@Body() body: TriggerVehicleSimulatorActionDto) {
    try {
      return await this.demoSimulation.clearVehicleFault(body.vehicleCode);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('simulate-obstacle')
  @ApiOperation({ summary: '模擬器工具列：觸發 OBSTACLE_DETECTED 事件' })
  async simulateObstacle(@Body() body: TriggerVehicleSimulatorActionDto) {
    try {
      return await this.demoSimulation.simulateVehicleObstacle(body.vehicleCode);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('start')
  @ApiOperation({ summary: '開始儀表板示範（MQTT 車輛班次 + SQL 示範資料更新）' })
  async start() {
    try {
      return await this.demoSimulation.start();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(msg, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('pause')
  @ApiOperation({ summary: '暫停儀表板示範（停止 MQTT 發送與 SQL 更新）' })
  async pause() {
    return this.demoSimulation.pause();
  }
}
