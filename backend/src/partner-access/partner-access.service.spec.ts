import { PartnerAccessService } from './partner-access.service';

describe('PartnerAccessService', () => {
  it('preserves an exact registered identity containing a hyphen when issuing credentials', async () => {
    const keys = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      delete: jest.fn(),
    };
    const vehicles = {
      find: jest.fn().mockResolvedValue([{ vehicleCode: 'PMS-20' }]),
    };
    const config = {
      get: jest.fn((key: string, fallback: string) => ({
        EXTERNAL_AUTH_USER: 'partner',
        EXTERNAL_AUTH_PASSWORD: 'secret',
        MQTT_VEHICLE_CODES: '',
      }[key] ?? fallback)),
    };
    const certificates = {
      rootCertificate: jest.fn().mockReturnValue('root'),
      intermediateCertificate: jest.fn().mockReturnValue('intermediate'),
      issue: jest.fn((vehicleCode: string) => ({ vehicle_code: vehicleCode })),
    };
    const service = new PartnerAccessService(
      config as never,
      keys as never,
      vehicles as never,
      certificates as never,
    );

    const result = await service.issue({
      username: 'partner',
      password: 'secret',
      vehicleCodes: ['PMS-20'],
      ttlMinutes: 1,
    });

    expect(result.mqtt.clients[0].vehicle_code).toBe('PMS-20');
    expect(certificates.issue).toHaveBeenCalledWith('PMS-20', expect.any(Number));
  });
});
