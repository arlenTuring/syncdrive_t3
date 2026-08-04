import { describe, expect, it } from 'vitest';
import {
  buildScheduleBlockTripCode,
  findMaintenanceSectionCodeIssues,
  isMaintenanceSectionCodesComplete,
  isValidMaintenanceSectionCode,
  sanitizeMaintenanceSectionCodeInput,
  timelineRowToColumnCode,
} from './maintenanceSectionCode';

describe('maintenanceSectionCode', () => {
  it('sanitizes to 1–2 uppercase letters', () => {
    expect(sanitizeMaintenanceSectionCodeInput('m')).toBe('M');
    expect(sanitizeMaintenanceSectionCodeInput('mc1')).toBe('MC');
    expect(sanitizeMaintenanceSectionCodeInput('')).toBe('');
    expect(isValidMaintenanceSectionCode('M')).toBe(true);
    expect(isValidMaintenanceSectionCode('MC')).toBe(true);
    expect(isValidMaintenanceSectionCode('')).toBe(false);
    expect(isValidMaintenanceSectionCode('1')).toBe(false);
  });

  it('rejects duplicate codes among enabled sections', () => {
    const issues = findMaintenanceSectionCodeIssues(
      {
        charging: 'C',
        carWash: '',
        maintenance: 'C',
        preTrip: 'P',
        mobile: '',
      },
      { charging: true, maintenance: true, preTrip: true, carWash: false, mobile: false },
    );
    expect(issues.some((i) => i.key === 'maintenance')).toBe(true);
    expect(
      isMaintenanceSectionCodesComplete(
        {
          charging: 'C',
          carWash: '',
          maintenance: 'M',
          preTrip: 'P',
          mobile: '',
        },
        { charging: true, maintenance: true, preTrip: true, carWash: false, mobile: false },
      ),
    ).toBe(true);
  });

  it('maps timeline row to column letter and builds trip codes', () => {
    expect(timelineRowToColumnCode(1)).toBe('A');
    expect(timelineRowToColumnCode(3)).toBe('C');
    expect(timelineRowToColumnCode(4)).toBe('D');
    expect(
      buildScheduleBlockTripCode({
        prefixCode: 'M',
        timelineRow: 3,
        startMinute: 13 * 60 + 30,
      }),
    ).toBe('MC1330');
    expect(
      buildScheduleBlockTripCode({
        prefixCode: 'D',
        timelineRow: 1,
        startMinute: 13 * 60 + 30,
        includeColumnCode: false,
      }),
    ).toBe('D1330');
    expect(
      buildScheduleBlockTripCode({
        prefixCode: null,
        timelineRow: 1,
        startMinute: 0,
      }),
    ).toBe('----');
    // 01:09:40 → ST0109（秒數不進位到下一分）
    expect(
      buildScheduleBlockTripCode({
        prefixCode: 'ST',
        timelineRow: 1,
        startMinute: 1 * 60 + 9 + 40 / 60,
        includeColumnCode: false,
      }),
    ).toBe('ST0109');
  });
});
