import assert from 'node:assert/strict';
import { it } from 'node:test';
import { paginationEntries } from './Pagination';

const view = (current: number, pages: number) =>
  paginationEntries(current, pages).map((e) => (e.kind === 'page' ? String(e.page) : e.direction === 'back' ? '«' : '»')).join(' ');

it('頁碼規則照 Pagination 規格 §4', () => {
  assert.equal(view(1, 7), '1 2 3 4 5 6 7');
  assert.equal(view(1, 25), '1 2 3 4 5 » 25');
  assert.equal(view(13, 25), '1 « 11 12 13 14 15 » 25');
  assert.equal(view(25, 25), '1 « 21 22 23 24 25');
  // 只略過 1 頁時直接補上那一頁
  assert.equal(view(5, 10), '1 2 3 4 5 6 7 » 10');
});
