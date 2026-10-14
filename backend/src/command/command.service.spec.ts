import { NotFoundException } from '@nestjs/common';
import { CommandType } from '../database/entities/command-log.entity';
import { CommandService } from './command.service';

describe('CommandService', () => {
  it('does not save or publish a command for a removed vehicle identity', async () => {
    const commandRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const vehicleRepository = {
      exist: jest.fn().mockResolvedValue(false),
    };
    const service = new CommandService(
      commandRepository as never,
      vehicleRepository as never,
      { get: jest.fn() } as never,
    );

    await expect(service.executeCommand({
      vehicle_code: 'REMOVED_TEST',
      action: CommandType.EMERGENCY_STOP,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(commandRepository.save).not.toHaveBeenCalled();
  });
});
