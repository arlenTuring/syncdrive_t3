import { BadRequestException } from '@nestjs/common';
import type { DataSource, QueryRunner, Repository } from 'typeorm';
import { DataAdminAudit } from '../database/entities/data-admin-audit.entity';
import { DataAdminService, planContainsWrite, stripTerminalSemicolon } from './data-admin.service';

const invalidation = { emit: jest.fn(), emitOrderLifecycle: jest.fn() };

describe('DataAdminService SQL safeguards', () => {
  it('detects a modifying plan even when it is nested below a CTE', () => {
    expect(planContainsWrite({ Plan: { Plans: [{ 'Node Type': 'ModifyTable' }] } })).toBe(true);
    expect(planContainsWrite({ 'Node Type': 'Seq Scan' })).toBe(false);
  });

  it('only removes one terminal semicolon and leaves multiple statements for PostgreSQL to reject', () => {
    expect(stripTerminalSemicolon('SELECT 1;')).toBe('SELECT 1');
    expect(stripTerminalSemicolon('SELECT 1; DELETE FROM orders;')).toBe('SELECT 1; DELETE FROM orders');
  });

  it('rolls back when EXPLAIN rejects multiple statements', async () => {
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ pid: 123 }])
        .mockRejectedValueOnce(new Error('cannot insert multiple commands into a prepared statement')),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
    } as unknown as QueryRunner;
    const dataSource = { createQueryRunner: () => runner } as unknown as DataSource;
    const audits = {
      create: (value: DataAdminAudit) => value,
      save: jest.fn(),
    } as unknown as Repository<DataAdminAudit>;
    const service = new DataAdminService(dataSource, audits, invalidation as never);

    await expect(service.execute(
      { sql: 'SELECT 1; DELETE FROM operation_orders', mode: 'read' },
      { operatorId: 'supervisor' },
    )).rejects.toThrow('multiple commands');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
  });

  it('rejects server-side file functions before opening a transaction', async () => {
    const service = new DataAdminService(
      { createQueryRunner: jest.fn() } as unknown as DataSource,
      {} as Repository<DataAdminAudit>,
      invalidation as never,
    );
    await expect(service.execute(
      { sql: "SELECT pg_read_file('/etc/passwd')", mode: 'read' },
      { operatorId: 'supervisor' },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
