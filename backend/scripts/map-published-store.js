/**
 * 後端「已發佈地圖庫」：由地圖編輯器 PUT 寫入，模擬器／Map API GET 讀取。
 * 優先於 frontend/public/maps 內建檔。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MAP_ID = 't3-main-version';

const BUILTIN_MAP_PATHS = {
  't3-main-version': path.join(
    __dirname,
    '../../frontend/public/maps/t3-main-version.json',
  ),
};

function resolvePublishedDir() {
  return path.join(__dirname, '../data/published-maps');
}

function safeMapId(mapId) {
  return String(mapId ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function publishedDocumentPath(mapId) {
  const id = safeMapId(mapId);
  if (!id) return null;
  return path.join(resolvePublishedDir(), `${id}.json`);
}

function publishedMetaPath(mapId) {
  const id = safeMapId(mapId);
  if (!id) return null;
  return path.join(resolvePublishedDir(), `${id}.meta.json`);
}

function ensurePublishedDir() {
  const dir = resolvePublishedDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPublishedMeta(mapId) {
  const metaPath = publishedMetaPath(mapId);
  if (!metaPath || !fs.existsSync(metaPath)) return null;
  try {
    return readJsonFile(metaPath);
  } catch {
    return null;
  }
}

function readPublishedMapDocument(mapId) {
  const docPath = publishedDocumentPath(mapId);
  if (!docPath || !fs.existsSync(docPath)) return null;
  try {
    return readJsonFile(docPath);
  } catch {
    return null;
  }
}

function readPublishedEntry(mapId) {
  const mapDocument = readPublishedMapDocument(mapId);
  if (!mapDocument) return null;
  const meta = readPublishedMeta(mapId) ?? {};
  return {
    mapId: meta.mapId ?? mapDocument.mapId ?? mapId,
    libraryId: meta.libraryId ?? mapId,
    displayName: meta.displayName ?? mapDocument.displayName ?? mapId,
    version: meta.version ?? mapDocument.version ?? '',
    updatedAt: meta.updatedAt ?? mapDocument.updatedAt ?? null,
    source: 'published-library',
    mapDocument,
  };
}

function writePublishedEntry(mapId, payload) {
  const id = safeMapId(mapId);
  if (!id) throw new Error('Invalid mapId');
  const mapDocument = payload.mapDocument;
  if (!mapDocument || typeof mapDocument !== 'object') {
    throw new Error('mapDocument required');
  }
  ensurePublishedDir();
  const now = payload.updatedAt ?? new Date().toISOString();
  const meta = {
    mapId: id,
    libraryId: String(payload.libraryId ?? id),
    displayName: String(payload.displayName ?? mapDocument.displayName ?? id),
    version: String(payload.version ?? mapDocument.version ?? ''),
    updatedAt: now,
    publishedAt: now,
  };
  const docPath = publishedDocumentPath(id);
  const metaPath = publishedMetaPath(id);
  fs.writeFileSync(docPath, `${JSON.stringify(mapDocument, null, 2)}\n`, 'utf8');
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return { ...meta, source: 'published-library', mapDocument };
}

function listPublishedEntries() {
  const dir = resolvePublishedDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.meta.json')) continue;
    const mapId = name.slice(0, -'.meta.json'.length);
    const entry = readPublishedEntry(mapId);
    if (!entry) continue;
    out.push({
      mapId: entry.mapId,
      libraryId: entry.libraryId,
      displayName: entry.displayName,
      version: entry.version,
      updatedAt: entry.updatedAt,
      source: entry.source,
      routeCount: Array.isArray(entry.mapDocument?.routes)
        ? entry.mapDocument.routes.length
        : 0,
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

function resolveBuiltinMapPath(mapId) {
  const key = String(mapId ?? '').trim();
  if (!key) return null;
  if (BUILTIN_MAP_PATHS[key] && fs.existsSync(BUILTIN_MAP_PATHS[key])) {
    return BUILTIN_MAP_PATHS[key];
  }
  const candidate = path.join(
    __dirname,
    '../../frontend/public/maps',
    `${key}.json`,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/** 模擬器／operation-nodes：已發佈庫 → 內建 public/maps */
function resolveMapJsonPath(mapId) {
  const id = String(mapId ?? '').trim();
  if (!id) return null;
  const published = publishedDocumentPath(id);
  if (published && fs.existsSync(published)) return published;
  return resolveBuiltinMapPath(id);
}

function seedPublishedFromBuiltinIfMissing(mapId = DEFAULT_MAP_ID) {
  if (readPublishedMapDocument(mapId)) return false;
  const builtin = resolveBuiltinMapPath(mapId);
  if (!builtin) return false;
  const mapDocument = readJsonFile(builtin);
  writePublishedEntry(mapId, {
    libraryId: mapId,
    displayName: mapDocument.displayName ?? mapId,
    version: mapDocument.version ?? '',
    mapDocument,
    updatedAt: mapDocument.updatedAt ?? new Date().toISOString(),
  });
  if (!readActiveMapConfig()) {
    writeActiveMapConfig({
      activeMapId: mapId,
      libraryId: mapId,
      displayName: mapDocument.displayName ?? mapId,
    });
  }
  return true;
}

function activeMapConfigPath() {
  return path.join(resolvePublishedDir(), 'active-map.json');
}

function readActiveMapConfig() {
  const configPath = activeMapConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = readJsonFile(configPath);
    const activeMapId = safeMapId(raw.activeMapId);
    if (!activeMapId) return null;
    return {
      activeMapId,
      libraryId: String(raw.libraryId ?? activeMapId),
      displayName: raw.displayName ? String(raw.displayName) : undefined,
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    };
  } catch {
    return null;
  }
}

function writeActiveMapConfig(config) {
  const activeMapId = safeMapId(config.activeMapId);
  if (!activeMapId) throw new Error('activeMapId required');
  ensurePublishedDir();
  const payload = {
    activeMapId,
    libraryId: String(config.libraryId ?? activeMapId),
    ...(config.displayName ? { displayName: String(config.displayName) } : {}),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    activeMapConfigPath(),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  return payload;
}

function getActiveMapId() {
  const cfg = readActiveMapConfig();
  if (cfg?.activeMapId) return cfg.activeMapId;
  return DEFAULT_MAP_ID;
}

module.exports = {
  DEFAULT_MAP_ID,
  resolvePublishedDir,
  publishedDocumentPath,
  readPublishedEntry,
  writePublishedEntry,
  listPublishedEntries,
  resolveMapJsonPath,
  resolveBuiltinMapPath,
  seedPublishedFromBuiltinIfMissing,
  readActiveMapConfig,
  writeActiveMapConfig,
  getActiveMapId,
};
