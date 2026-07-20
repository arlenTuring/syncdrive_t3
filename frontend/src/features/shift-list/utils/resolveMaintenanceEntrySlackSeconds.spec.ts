import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
  DEFAULT_EMPTY_INTERVAL_MAINLINE_SLACK_SECONDS,
  emptyMaintenanceEntrySlackBySectionInput,
  normalizeMaintenanceEntrySlackSecondsInput,
  parseMaintenanceEntrySlackBySection,
  parseMaintenanceEntrySlackSeconds,
  resolveMaintenanceEntrySlackSeconds,
} from './resolveMaintenanceEntrySlackSeconds';
import {
  listEmptyAttributeMinuteRanges,
  templateHasEmptyAttributePeriods,
} from './emptyAttributeIntervals';

describe('maintenanceEntrySlackSeconds (shift draft)', () => {
  it('defaults to 600 for empty / missing values', () => {
    assert.equal(normalizeMaintenanceEntrySlackSecondsInput(''), '600');
    assert.equal(normalizeMaintenanceEntrySlackSecondsInput(undefined), '600');
    assert.equal(parseMaintenanceEntrySlackSeconds(null), 600);
    assert.equal(DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS, 600);
    assert.equal(DEFAULT_EMPTY_INTERVAL_MAINLINE_SLACK_SECONDS, 600);
  });

  it('resolves slack by template task type from shift section overrides', () => {
    const slack = parseMaintenanceEntrySlackBySection({
      ...emptyMaintenanceEntrySlackBySectionInput(),
      charging: '900',
      preTrip: '120',
      carWash: '200',
      maintenance: '400',
    });

    assert.equal(resolveMaintenanceEntrySlackSeconds('charging', slack), 900);
    assert.equal(resolveMaintenanceEntrySlackSeconds('inspection', slack), 120);
    assert.equal(resolveMaintenanceEntrySlackSeconds('servicing', slack), 400);
    assert.equal(
      resolveMaintenanceEntrySlackSeconds('passenger', null),
      DEFAULT_MAINTENANCE_ENTRY_SLACK_SECONDS,
    );
  });
});

describe('emptyAttributeIntervals', () => {
  it('detects uncovered day segments as empty attribute periods', () => {
    const intervals = [
      {
        id: 'a',
        attributeId: 'attr',
        name: '早',
        startTime: '06:00',
        endTime: '10:00',
        isDraft: false,
      },
      {
        id: 'b',
        attributeId: 'attr',
        name: '晚',
        startTime: '16:00',
        endTime: '22:00',
        isDraft: false,
      },
    ];
    assert.equal(templateHasEmptyAttributePeriods(intervals), true);
    const empty = listEmptyAttributeMinuteRanges(intervals);
    assert.deepEqual(empty, [
      { start: 0, end: 360 },
      { start: 600, end: 960 },
      { start: 1320, end: 1440 },
    ]);
  });

  it('reports no empty periods when the full day is covered', () => {
    const intervals = [
      {
        id: 'all',
        attributeId: 'attr',
        name: '全日',
        startTime: '00:00',
        endTime: '24:00',
        isDraft: false,
      },
    ];
    assert.equal(templateHasEmptyAttributePeriods(intervals), false);
    assert.deepEqual(listEmptyAttributeMinuteRanges(intervals), []);
  });
});
