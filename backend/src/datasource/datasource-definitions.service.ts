import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSource_, DataSourceType } from '../database/entities/data-source.entity';

export type DataSourceDefinitionPayload = {
  name: string;
  type: DataSourceType;
  backendUrl?: string;
  mqttTopic?: string;
  description?: string;
};

export type PublicDataSourceDefinition = DataSourceDefinitionPayload & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

const BUILT_INS: Array<{ key: string; value: DataSourceDefinitionPayload }> = [
  {
    key: 'default-internal',
    value: {
      name: 'SyncDrive 本機資料庫',
      type: DataSourceType.INTERNAL,
      backendUrl: '',
      description: 'SyncDrive-T3 後端 PostgreSQL（TimescaleDB）',
    },
  },
  {
    key: 'default-mqtt',
    value: {
      name: 'VTMS MQTT (Socket.IO)',
      type: DataSourceType.MQTT,
      backendUrl: '',
      mqttTopic: 'v1/vtms/+/telemetry/update',
      description: 'v1/vtms/{vehicle_code}/telemetry|operation|health',
    },
  },
];

function normalizeKey(value: string): string {
  const key = value?.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(key)) {
    throw new BadRequestException('資料來源 ID 只能包含英數字、點、底線與連字號');
  }
  return key;
}

function publicView(row: DataSource_): PublicDataSourceDefinition {
  return {
    id: row.sourceKey,
    name: row.name,
    type: row.type,
    backendUrl: typeof row.config?.backendUrl === 'string' ? row.config.backendUrl : '',
    mqttTopic: typeof row.config?.mqttTopic === 'string' ? row.config.mqttTopic : undefined,
    description: row.description ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DatasourceDefinitionsService {
  constructor(
    @InjectRepository(DataSource_)
    private readonly definitions: Repository<DataSource_>,
  ) {}

  private async ensureBuiltIns(): Promise<void> {
    const existing = new Set((await this.definitions.find()).map((row) => row.sourceKey));
    const now = Date.now();
    for (const item of BUILT_INS) {
      if (existing.has(item.key)) continue;
      await this.definitions.save(this.definitions.create({
        sourceKey: item.key,
        name: item.value.name,
        type: item.value.type,
        config: { backendUrl: item.value.backendUrl ?? '', mqttTopic: item.value.mqttTopic },
        description: item.value.description ?? '',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }));
    }
  }

  async list(): Promise<PublicDataSourceDefinition[]> {
    await this.ensureBuiltIns();
    const rows = await this.definitions.find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map(publicView);
  }

  async save(sourceKey: string, body: DataSourceDefinitionPayload): Promise<PublicDataSourceDefinition> {
    const key = normalizeKey(sourceKey);
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('資料來源名稱不可空白');
    if (!Object.values(DataSourceType).includes(body.type)) {
      throw new BadRequestException('不支援的資料來源類型');
    }
    const now = Date.now();
    const prior = await this.definitions.findOne({ where: { sourceKey: key } });
    const row = prior ?? this.definitions.create({ sourceKey: key, createdAt: now });
    row.name = name;
    row.type = body.type;
    // 只接受可公開連線資訊。密碼、token、headers 等不屬於這份 API，也不會回到畫布或匯出檔。
    row.config = {
      backendUrl: body.backendUrl?.trim() ?? '',
      ...(body.type === DataSourceType.MQTT && body.mqttTopic?.trim()
        ? { mqttTopic: body.mqttTopic.trim() }
        : {}),
    };
    row.description = body.description?.trim() ?? '';
    row.isActive = true;
    row.updatedAt = now;
    return publicView(await this.definitions.save(row));
  }

  async remove(sourceKey: string): Promise<void> {
    const key = normalizeKey(sourceKey);
    if (BUILT_INS.some((item) => item.key === key)) {
      throw new BadRequestException('內建資料來源不可刪除');
    }
    const row = await this.definitions.findOne({ where: { sourceKey: key } });
    if (!row) throw new NotFoundException(`找不到資料來源：${key}`);
    row.isActive = false;
    row.updatedAt = Date.now();
    await this.definitions.save(row);
  }
}
