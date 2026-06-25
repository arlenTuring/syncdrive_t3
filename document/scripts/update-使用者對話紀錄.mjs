#!/usr/bin/env node
/**
 * 從 Cursor agent transcript 擷取使用者訊息，寫入 document/使用者對話紀錄.md
 * 最新一則在最上方。
 *
 * 用法（專案根目錄）：
 *   node document/scripts/update-使用者對話紀錄.mjs
 *   node document/scripts/update-使用者對話紀錄.mjs --transcript /path/to/session.jsonl
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_PATH = path.join(ROOT, 'document/使用者對話紀錄.md');

const DEFAULT_TRANSCRIPT = path.join(
  process.env.HOME ?? '',
  '.cursor/projects/Users-arlen-Desktop-development-syncdrive-t3/agent-transcripts/e594f315-9b99-4dc5-bb9b-b6c94fd6410e/e594f315-9b99-4dc5-bb9b-b6c94fd6410e.jsonl',
);

function parseArgs() {
  const args = process.argv.slice(2);
  let transcript = DEFAULT_TRANSCRIPT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--transcript' && args[i + 1]) {
      transcript = path.resolve(args[i + 1]);
      i += 1;
    }
  }
  return { transcript };
}

function extractUserText(raw) {
  const m = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  let body = (m ? m[1] : raw).trim();
  body = body
    .replace(/\[Image\][\s\S]*?<\/image_files>\s*/g, '[附圖] ')
    .replace(/<image_files>[\s\S]*?<\/image_files>\s*/g, '')
    .trim();
  return body;
}

function shouldSkip(body) {
  if (!body) return true;
  if (body.startsWith('Briefly inform the user')) return true;
  return false;
}

function loadMessages(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    console.error(`找不到 transcript：${transcriptPath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  const users = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o.role !== 'user') continue;
      const parts = o.message?.content ?? [];
      let text = '';
      for (const p of parts) {
        if (p.type === 'text') text += p.text;
      }
      const body = extractUserText(text);
      if (shouldSkip(body)) continue;
      users.push(body);
    } catch {
      /* ignore malformed line */
    }
  }
  const deduped = [];
  for (const u of users) {
    if (deduped.length && deduped[deduped.length - 1] === u) continue;
    deduped.push(u);
  }
  return deduped.reverse();
}

function renderMarkdown(messages) {
  const updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let out = `# 使用者對話紀錄\n\n`;
  out += `> 最新訊息在最上方。最後更新：${updatedAt}（UTC）\n`;
  out += `> 重新整理：\`node document/scripts/update-使用者對話紀錄.mjs\`\n\n`;
  messages.forEach((text, i) => {
    const n = messages.length - i;
    out += `---\n\n## ${n}\n\n${text}\n\n`;
  });
  return out;
}

const { transcript } = parseArgs();
const messages = loadMessages(transcript);
fs.writeFileSync(OUT_PATH, renderMarkdown(messages), 'utf8');
console.log(`已寫入 ${messages.length} 則訊息 → ${OUT_PATH}`);
