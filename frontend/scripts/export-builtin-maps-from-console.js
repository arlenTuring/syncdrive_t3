/**
 * 在地圖編輯器（http://localhost:5173）DevTools Console 貼上執行，
 * 會下載「主要版本」「解析度不太正確版本」至下載資料夾。
 *
 * 將檔案移到 frontend/public/maps-seed/ 後執行：
 *   node scripts/sync-builtin-example-maps.mjs
 */
;(function exportBuiltinExampleMaps() {
  const key = 'syncdrive-map-library-v1'
  const raw = localStorage.getItem(key)
  if (!raw) {
    console.error('找不到地圖庫')
    return
  }
  const entries = JSON.parse(raw)
  const targets = [
    { name: '完成版本', file: '完成版本.json' },
    { name: '解析度加大版本', file: '解析度加大版本.json' },
    { name: '主要版本', file: '主要版本.json' },
    { name: '解析度不太正確版本', file: '解析度不太正確版本.json' },
  ]

  for (const t of targets) {
    const entry = entries.find((e) => e.displayName === t.name)
    if (!entry) {
      console.warn('找不到：', t.name, '；目前：', entries.map((e) => e.displayName))
      continue
    }
    const blob = new Blob([JSON.stringify(entry.mapDocument, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = t.file
    a.click()
    URL.revokeObjectURL(a.href)
    console.log('已下載', t.name)
  }
})()
