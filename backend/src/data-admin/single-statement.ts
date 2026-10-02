import { BadRequestException } from '@nestjs/common';

/**
 * PostgreSQL-aware single statement guard. Semicolons in quoted strings,
 * identifiers, dollar strings and comments are ignored; a second statement is
 * rejected before anything is sent to EXPLAIN or executed.
 */
export function requireSingleStatement(input: string): string {
  const sql = input.trim();
  if (!sql) throw new BadRequestException('SQL 不可為空');

  let state: 'code' | 'single' | 'double' | 'line' | 'block' | 'dollar' = 'code';
  let blockDepth = 0;
  let dollarTag = '';
  let terminal = -1;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (state === 'single') {
      if (ch === "'" && next === "'") i += 1;
      else if (ch === "'") state = 'code';
      continue;
    }
    if (state === 'double') {
      if (ch === '"' && next === '"') i += 1;
      else if (ch === '"') state = 'code';
      continue;
    }
    if (state === 'line') {
      if (ch === '\n' || ch === '\r') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (ch === '/' && next === '*') { blockDepth += 1; i += 1; }
      else if (ch === '*' && next === '/') {
        blockDepth -= 1; i += 1;
        if (blockDepth === 0) state = 'code';
      }
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        state = 'code';
      }
      continue;
    }

    if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
    else if (ch === '-' && next === '-') { state = 'line'; i += 1; }
    else if (ch === '/' && next === '*') { state = 'block'; blockDepth = 1; i += 1; }
    else if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; state = 'dollar'; i += dollarTag.length - 1; }
    } else if (ch === ';') {
      if (terminal >= 0) throw new BadRequestException('一次只能執行一個 SQL statement');
      terminal = i;
    } else if (terminal >= 0 && !/\s/.test(ch)) {
      throw new BadRequestException('一次只能執行一個 SQL statement');
    }
  }

  if (state === 'single' || state === 'double' || state === 'block' || state === 'dollar') {
    throw new BadRequestException('SQL 的字串、識別字或註解尚未結束');
  }
  return (terminal >= 0 ? sql.slice(0, terminal) : sql).trim();
}
