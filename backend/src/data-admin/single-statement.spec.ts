import { requireSingleStatement } from './single-statement';

describe('requireSingleStatement', () => {
  it.each([
    ["SELECT ';' AS value;", "SELECT ';' AS value"],
    ['SELECT $$a;b$$ AS value;', 'SELECT $$a;b$$ AS value'],
    ['SELECT 1 /* ; */;', 'SELECT 1 /* ; */'],
    ['SELECT 1; -- trailing ; comment', 'SELECT 1'],
  ])('accepts one PostgreSQL statement', (input, expected) => {
    expect(requireSingleStatement(input)).toBe(expected);
  });

  it.each(['SELECT 1; SELECT 2', 'DELETE FROM a; UPDATE b SET x = 1'])('rejects multiple statements', (sql) => {
    expect(() => requireSingleStatement(sql)).toThrow('一次只能執行一個 SQL statement');
  });
});
