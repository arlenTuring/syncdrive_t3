import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback: unknown) => fallback),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setHealth：車端誤傳格式時不應拋例外中斷處理程序', () => {
    let client: { get: jest.Mock; set: jest.Mock };

    beforeEach(() => {
      client = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
      (service as unknown as { client: typeof client }).client = client;
    });

    it('子系統值為 null（非物件）時不拋例外，視為非 ERROR', async () => {
      const payload = {
        overall_health: 'OK',
        subsystems: {
          COMPUTING: null,
          SENSING: { status: 'OK' },
          COMMUNICATION: { status: 'OK' },
          CHASSIS: { status: 'OK' },
        },
      };
      await expect(service.setHealth('PMS-01', payload)).resolves.toEqual({
        degraded: false,
        previousHealth: 'OK',
      });
    });

    it('任一子系統為 ERROR 物件時正常判定為劣化', async () => {
      const payload = {
        overall_health: 'ERROR',
        subsystems: {
          COMPUTING: { status: 'ERROR' },
          SENSING: { status: 'OK' },
          COMMUNICATION: { status: 'OK' },
          CHASSIS: { status: 'OK' },
        },
      };
      const result = await service.setHealth('PMS-01', payload);
      expect(result.degraded).toBe(true);
    });
  });
});
