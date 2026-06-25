/**
 * 在地圖編輯器頁面（同源）開啟 DevTools Console，貼上執行，
 * 會下載目前 localStorage 中的「T3測試版本」地圖 JSON。
 *
 * 下載後存為：frontend/public/maps-seed/T3測試版本.json
 * 再執行：node scripts/shrink-t3-track-facilities.mjs
 */
;(function exportT3TestMap() {
  const key = 'syncdrive-map-library-v1'
  const raw = localStorage.getItem(key)
  if (!raw) {
    console.error('找不到地圖庫')
    return
  }
  const entries = JSON.parse(raw)
  const names = ['T3測試版本', 'T3軌道測試版本']
  const entry = entries.find((e) => names.includes(e.displayName))
  if (!entry) {
    console.error('找不到地圖，目前名稱：', entries.map((e) => e.displayName))
    return
  }
  const blob = new Blob([JSON.stringify(entry.mapDocument, null, 2)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'T3測試版本.json'
  a.click()
  URL.revokeObjectURL(a.href)
  console.log('已下載', entry.displayName)
})()
