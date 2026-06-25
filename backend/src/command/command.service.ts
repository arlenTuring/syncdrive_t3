import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';
import { CommandLog } from '../database/entities/command-log.entity';
import { ExecuteCommandDto } from './dto/execute-command.dto';

@Injectable()
export class CommandService implements OnModuleInit {
  private readonly logger = new Logger(CommandService.name);
  private mqttClient: mqtt.MqttClient;

  constructor(
    @InjectRepository(CommandLog)
    private commandLogRepository: Repository<CommandLog>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    const url = this.configService.get<string>('MQTT_URL', 'mqtt://127.0.0.1:1883');
    // 獨立的 Publisher Client，與 NestJS Microservice 的訂閱端分開
    this.mqttClient = mqtt.connect(url, { clientId: `vtms-center-publisher` });
    this.mqttClient.on('error', (err) => this.logger.error('CommandService MQTT error', err));
  }

  async executeCommand(dto: ExecuteCommandDto): Promise<CommandLog> {
    const { vehicle_code, action, params } = dto;
    const now = new Date().getTime();

    // 生成符合規格書格式的 command_id
    // 使用 crypto.randomBytes(3) = 16^6 = 16,777,216 種可能，防止高頻碰撞
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = randomBytes(3).toString('hex').toUpperCase();
    const commandId = `CMD-${dateStr}-${seq}`;

    // 1. 先存入 PostgreSQL (確保有稽核紀錄)
    const commandLog = this.commandLogRepository.create({
      commandId,
      vehicleCode: vehicle_code,
      action,
      params: params || {},
      isAcked: false,
      sentAt: now.toString(),
    });
    await this.commandLogRepository.save(commandLog);

    // 2. 組裝符合規格書格式的 MQTT Payload
    const mqttPayload = JSON.stringify({
      command_id: commandId,
      vehicle_code,
      timestamp: now,       // 13-bit Epoch (ms)，符合規範 §四-2
      action,               // SCREAMING_SNAKE_CASE，符合規範 §四-3
      params: params || {},
    });

    // 3. Publish 到正確 Topic，retain: false (符合規範 §二)，QoS 1 確保指令送達
    const topic = `v1/vtms/${vehicle_code}/command/execute`;
    this.mqttClient.publish(topic, mqttPayload, { retain: false, qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`[Command Publish Failed] ${commandId} to ${topic}`, err);
      }
    });

    return commandLog;
  }
}
