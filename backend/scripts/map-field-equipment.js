/**
 * 從 MapFileV2 擷取場域設備（充電樁、號誌、智慧桿等）
 */
const fs = require('fs');
const path = require('path');

const { resolveMapJsonPath } = require('./map-operation-nodes');

const EQUIPMENT_KIND = {
  CHARGING: 'charging',
  SIGNAL: 'signal',
  SMART_POLE: 'smart_pole',
  CAR_WASH: 'car_wash',
  MAINTENANCE: 'maintenance',
  YARD_SLOT: 'yard_slot',
  OTHER: 'other',
};

function normalizeCode(raw) {
  return String(raw ?? '').trim();
}

function classifyEquipmentKind(entry) {
  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();
  const type = String(entry.type ?? '').trim();
  const name = String(entry.name ?? '').trim();

  if (type === 'Signal' && name === 'Light') return EQUIPMENT_KIND.SIGNAL;
  if (/^S\d+/i.test(code)) return EQUIPMENT_KIND.SIGNAL;

  if (purpose === '智慧桿' || /^R\d+/i.test(code)) return EQUIPMENT_KIND.SMART_POLE;

  if (purpose === '充電格' || /^E\d+/i.test(code)) return EQUIPMENT_KIND.CHARGING;

  if (purpose === '洗車格' || /^W\d+/i.test(code)) return EQUIPMENT_KIND.CAR_WASH;

  if (purpose === '保養格' || /^M\d+/i.test(code)) return EQUIPMENT_KIND.MAINTENANCE;

  const yardPurposes = ['臨停格', '調度格'];
  if (yardPurposes.includes(purpose) || /^[PHMW]\d+/i.test(code)) {
    return EQUIPMENT_KIND.YARD_SLOT;
  }

  return EQUIPMENT_KIND.OTHER;
}

function equipmentLabel(entry, kind) {
  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();
  if (code && purpose) return `${code}（${purpose}）`;
  if (code) return code;
  return purpose || entry.id || '設備';
}

function matchesKindFilter(entry, equipmentKind, kindFilter) {
  if (kindFilter === 'all') return true;
  if (equipmentKind === kindFilter) return true;

  const code = normalizeCode(entry.customName);
  const purpose = String(entry.parameters?.purpose ?? '').trim();

  if (kindFilter === EQUIPMENT_KIND.CAR_WASH) {
    return purpose === '洗車格' || /^W\d+/i.test(code);
  }

  if (kindFilter === EQUIPMENT_KIND.MAINTENANCE) {
    return purpose === '保養格' || /^M\d+/i.test(code);
  }

  return false;
}

function loadFieldEquipmentFromMapFile(mapPath, kindFilter = 'all') {
  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);
  const areas = Array.isArray(map.areas) ? map.areas : [];
  const items = [];

  for (const area of areas) {
    const facilities = Array.isArray(area.facilities) ? area.facilities : [];
    for (const entry of facilities) {
      const equipmentKind = classifyEquipmentKind(entry);
      if (!matchesKindFilter(entry, equipmentKind, kindFilter)) continue;

      const mapCode = normalizeCode(entry.customName);
      if (!mapCode) continue;

      items.push({
        equipmentId: String(entry.id ?? ''),
        mapCode,
        equipmentKind,
        label: equipmentLabel(entry, equipmentKind),
        purpose: String(entry.parameters?.purpose ?? '').trim() || undefined,
        mqttInstanceId: entry.parameters?.mqttInstanceId
          ? String(entry.parameters.mqttInstanceId)
          : undefined,
        areaId: String(area.id ?? ''),
        areaName: String(area.customName ?? area.id ?? ''),
      });
    }
  }

  items.sort((a, b) => a.mapCode.localeCompare(b.mapCode, undefined, { numeric: true }));

  return {
    mapId: map.mapId ?? path.basename(mapPath, '.json'),
    items,
  };
}

function loadFieldEquipment(mapId, kindFilter = 'all') {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  return loadFieldEquipmentFromMapFile(mapPath, kindFilter);
}

module.exports = {
  EQUIPMENT_KIND,
  classifyEquipmentKind,
  loadFieldEquipment,
  loadFieldEquipmentFromMapFile,
};
