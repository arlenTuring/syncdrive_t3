'use strict';

/**
 * 路線路徑編輯器。
 *
 * <h3>這一頁只能做一件事</h3>
 * 調整每條路線<strong>怎麼從這一站開到下一站</strong>。地圖、軌道方塊、站點都是
 * 從伺服器讀來的，不能新增也不能刪除——那些是圖資，屬於場域管理，不屬於模擬器。
 *
 * <h3>座標系</h3>
 * 畫面用場域公尺（原點左下、y 向上），與車輛回報的位置同一套。SVG 的 y 是向下
 * 長的，所以只在最後轉換一次；<strong>所有計算都留在公尺</strong>，不要在像素與
 * 公尺之間來回換算——那是折角會慢慢跑掉的來源。
 */

(() => {
  const svg = document.getElementById('routeMap');
  const select = document.getElementById('routeSelect');
  const saveBtn = document.getElementById('routeSaveBtn');
  const resetBtn = document.getElementById('routeResetBtn');
  const statusEl = document.getElementById('routeStatus');
  const tracksEl = document.getElementById('routeTracks');
  const samplesEl = document.getElementById('routeSamples');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg';
  /** ＋ 鈕半徑（像素）。使用者明確要求「不要太小」。 */
  const PLUS_RADIUS = 13;
  const HANDLE_RADIUS = 8;

  let geometry = null;
  let routes = [];
  let current = null;
  /** 目前編輯中的折線頂點（公尺）。站點那幾個帶 stationId，不可移動。 */
  let waypoints = [];
  let dirty = false;
  let dragging = null;

  const api = async (path, options) => {
    const res = await fetch(path, {
      method: options?.method ?? (options?.body ? 'POST' : 'GET'),
      headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  };

  function setStatus(text, tone = '') {
    statusEl.textContent = text;
    statusEl.style.color = tone === 'error' ? 'var(--danger)'
      : tone === 'ok' ? 'var(--ok)' : 'var(--muted)';
  }

  // ── 公尺 ↔ 畫面 ────────────────────────────────────────────

  function view() {
    const b = geometry.bounds;
    const width = b.xMax - b.xMin;
    const height = b.yMax - b.yMin;
    const rect = svg.getBoundingClientRect();
    // 等比縮放：兩軸用同一個比例，否則折線在畫面上的角度會騙人
    const scale = Math.min(rect.width / width, rect.height / height);
    return { b, scale, offsetX: (rect.width - width * scale) / 2, offsetY: (rect.height - height * scale) / 2, rect };
  }

  function toScreen(xM, yM) {
    const v = view();
    return {
      x: v.offsetX + (xM - v.b.xMin) * v.scale,
      // 公尺是 y 向上、SVG 是 y 向下，只在這裡翻一次
      y: v.offsetY + (v.b.yMax - yM) * v.scale,
    };
  }

  function toMeters(screenX, screenY) {
    const v = view();
    return {
      x: v.b.xMin + (screenX - v.offsetX) / v.scale,
      y: v.b.yMax - (screenY - v.offsetY) / v.scale,
    };
  }

  function pointerMeters(event) {
    const rect = svg.getBoundingClientRect();
    return toMeters(event.clientX - rect.left, event.clientY - rect.top);
  }

  // ── 繪製 ───────────────────────────────────────────────────

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (parent) parent.appendChild(node);
    return node;
  }

  function render() {
    svg.innerHTML = '';
    if (!geometry) return;

    // 軌道方塊：底圖，只是讓人看得出路徑有沒有壓在軌道上
    const base = el('g', { class: 'tracks' }, svg);
    for (const track of geometry.tracks) {
      const a = toScreen(track.xMin, track.yMax);
      const b = toScreen(track.xMax, track.yMin);
      el('rect', {
        x: a.x, y: a.y,
        width: Math.max(1, b.x - a.x),
        height: Math.max(1, b.y - a.y),
        fill: 'rgba(56,189,248,0.10)',
        stroke: 'rgba(56,189,248,0.35)',
        'stroke-width': 0.5,
      }, base);
    }

    if (!current || waypoints.length < 2) return;

    // 線段
    const lines = el('g', {}, svg);
    for (let i = 0; i < waypoints.length - 1; i += 1) {
      const a = toScreen(waypoints[i].x, waypoints[i].y);
      const b = toScreen(waypoints[i + 1].x, waypoints[i + 1].y);
      el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: '#38bdf8', 'stroke-width': 2.5, 'stroke-linecap': 'round',
      }, lines);
    }

    // 每段中央的 ＋：點下去在該處長出折線點
    const plus = el('g', {}, svg);
    for (let i = 0; i < waypoints.length - 1; i += 1) {
      const a = toScreen(waypoints[i].x, waypoints[i].y);
      const b = toScreen(waypoints[i + 1].x, waypoints[i + 1].y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const group = el('g', { class: 'plus', style: 'cursor:pointer' }, plus);
      el('circle', {
        cx, cy, r: PLUS_RADIUS,
        fill: '#0f1115', stroke: '#38bdf8', 'stroke-width': 2,
      }, group);
      el('line', {
        x1: cx - 6, y1: cy, x2: cx + 6, y2: cy,
        stroke: '#38bdf8', 'stroke-width': 2.5, 'stroke-linecap': 'round',
      }, group);
      el('line', {
        x1: cx, y1: cy - 6, x2: cx, y2: cy + 6,
        stroke: '#38bdf8', 'stroke-width': 2.5, 'stroke-linecap': 'round',
      }, group);
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        insertBend(i);
      });
    }

    // 頂點：站點是方形錨點（固定），折線點是圓形把手（可拖、可右鍵刪）
    const handles = el('g', {}, svg);
    waypoints.forEach((point, index) => {
      const p = toScreen(point.x, point.y);
      if (point.stationId) {
        el('rect', {
          x: p.x - 7, y: p.y - 7, width: 14, height: 14, rx: 3,
          fill: '#34d399', stroke: '#0f1115', 'stroke-width': 2,
        }, handles);
        const label = geometry.stationNames?.[point.stationId] ?? point.stationId;
        el('text', {
          x: p.x + 11, y: p.y - 10,
          fill: '#e6e9ef', 'font-size': 11,
        }, handles).textContent = label;
      } else {
        const handle = el('circle', {
          cx: p.x, cy: p.y, r: HANDLE_RADIUS,
          fill: '#fbbf24', stroke: '#0f1115', 'stroke-width': 2,
          style: 'cursor:grab',
        }, handles);
        handle.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          dragging = { index, pointerId: event.pointerId, node: handle };
        });
        handle.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          removeBend(index);
        });
      }
    });
  }

  // ── 編輯 ───────────────────────────────────────────────────

  function insertBend(segmentIndex) {
    const a = waypoints[segmentIndex];
    const b = waypoints[segmentIndex + 1];
    waypoints.splice(segmentIndex + 1, 0, {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    dirty = true;
    setStatus('已新增折線點，尚未儲存');
    render();
  }

  function removeBend(index) {
    // 站點不能刪：那是班表定的停靠順序
    if (waypoints[index]?.stationId) return;
    waypoints.splice(index, 1);
    dirty = true;
    setStatus('已刪除折線點，尚未儲存');
    render();
  }

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const m = pointerMeters(event);
    waypoints[dragging.index] = {
      x: Math.round(m.x * 100) / 100,
      y: Math.round(m.y * 100) / 100,
    };
    dirty = true;
    render();
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = null;
    setStatus('折線點已移動，尚未儲存');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointerleave', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ── 資料 ───────────────────────────────────────────────────

  function describe(route) {
    if (!route) {
      tracksEl.textContent = '尚未選擇路線';
      samplesEl.textContent = '尚未選擇路線';
      return;
    }
    tracksEl.textContent = route.tracks.length === 0
      ? '（這條路徑沒有壓在任何軌道方塊上）'
      : route.tracks.map((t) =>
        `${t.code}  x ${t.refField.xMinM}–${t.refField.xMaxM}`
        + `  y ${t.refField.yMinM}–${t.refField.yMaxM}`).join('\n');
    const head = route.samples.slice(0, 6)
      .map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).join('  ');
    samplesEl.textContent =
      `共 ${route.samples.length} 點，總長 ${route.lengthM} 公尺\n`
      + `前幾點：${head}${route.samples.length > 6 ? '  …' : ''}`;
  }

  function selectRoute(routeId) {
    current = routes.find((r) => r.routeId === routeId) ?? null;
    waypoints = current ? current.waypoints.map((p) => ({ ...p })) : [];
    dirty = false;
    if (current && !current.editable) {
      setStatus(`站點在圖資裡查不到：${current.missing.join('、')}`, 'error');
    } else {
      setStatus(current?.customised ? '已存過自訂路徑' : '目前是站點直線');
    }
    describe(current);
    render();
  }

  async function reload(keepRouteId) {
    const [geo, list] = await Promise.all([
      api('/api/map/geometry'),
      api('/api/routes'),
    ]);
    geometry = geo;
    routes = list.routes;
    geometry.stationNames = {};
    for (const route of routes) {
      for (const station of route.stations) geometry.stationNames[station.id] = station.name;
    }
    select.innerHTML = routes.map((r) =>
      `<option value="${r.routeId}">${r.displayName}${r.customised ? '　✓已自訂' : ''}</option>`,
    ).join('');
    const target = keepRouteId ?? routes[0]?.routeId;
    if (target) select.value = target;
    selectRoute(target);
  }

  select.addEventListener('change', () => selectRoute(select.value));

  saveBtn.addEventListener('click', async () => {
    if (!current) return;
    try {
      setStatus('儲存中…');
      const saved = await api('/api/routes', {
        method: 'PUT',
        body: { routeId: current.routeId, waypoints },
      });
      Object.assign(current, saved);
      dirty = false;
      describe(current);
      await reload(current.routeId);
      setStatus(
        `已儲存：${saved.waypoints.length} 個頂點、經過 ${saved.tracks.length} 個方塊、`
        + `${saved.samples.length} 個路徑點`,
        'ok',
      );
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  resetBtn.addEventListener('click', async () => {
    if (!current) return;
    try {
      await api('/api/routes/reset', { body: { routeId: current.routeId } });
      await reload(current.routeId);
      setStatus('已還原成站點直線', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  // ── 分頁切換 ───────────────────────────────────────────────

  let loaded = false;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', async () => {
      for (const other of document.querySelectorAll('.tab')) {
        other.classList.toggle('active', other === tab);
      }
      for (const panel of document.querySelectorAll('[data-panel]')) {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      }
      if (tab.dataset.tab === 'routes' && !loaded) {
        loaded = true;
        try {
          await reload();
        } catch (error) {
          loaded = false;
          setStatus(`載入圖資失敗：${error.message}`, 'error');
        }
      } else if (tab.dataset.tab === 'routes') {
        render();
      }
    });
  }

  window.addEventListener('resize', () => {
    if (!svg.closest('[data-panel]')?.hidden) render();
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
