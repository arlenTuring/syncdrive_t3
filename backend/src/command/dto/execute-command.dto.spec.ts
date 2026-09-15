import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ExecuteCommandDto } from './execute-command.dto';

const validate = (obj: unknown) =>
  validateSync(plainToInstance(ExecuteCommandDto, obj), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('ExecuteCommandDto 驗證', () => {
  it('接受合法的指定車輛指令', () => {
    expect(validate({ vehicle_code: 'PMS05', action: 'EMERGENCY_STOP' })).toHaveLength(0);
  });

  it('接受 all 廣播指令', () => {
    expect(validate({ vehicle_code: 'all', action: 'SET_SPEED_LIMIT', params: { limit_mps: 2.78 } })).toHaveLength(0);
  });

  it('拒絕非法 vehicle_code', () => {
    expect(validate({ vehicle_code: 'PMS99', action: 'EMERGENCY_STOP' }).length).toBeGreaterThan(0);
    expect(validate({ vehicle_code: 'pms-05', action: 'EMERGENCY_STOP' }).length).toBeGreaterThan(0);
  });

  it('拒絕不在白名單的 action', () => {
    expect(validate({ vehicle_code: 'PMS05', action: 'SELF_DESTRUCT' }).length).toBeGreaterThan(0);
  });

  it('拒絕多餘欄位（forbidNonWhitelisted）', () => {
    expect(validate({ vehicle_code: 'PMS05', action: 'EMERGENCY_STOP', evil: 1 }).length).toBeGreaterThan(0);
  });
});
