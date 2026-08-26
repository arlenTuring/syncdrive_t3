'use strict';

/**
 * 路線路徑編輯器。
 *
 * <h3>這一頁只能做一件事</h3>
 * 調整每條路線<strong>怎麼從這一站開到下一站</strong>。地圖、軌道方塊、站點都是
 * 從伺服器讀來的，不能新增也不能刪除——那些是圖資，屬於場域管理，不屬於模擬器。
 *
 * <h3>兩套座標</h3>
 * <pre>
 *   圖面像素  照圖資本來的版面畫，看起來與圖台一致
 *   場域公尺  存檔與餵給車輛用的，車輛回報的 local_pose 就是這一套
 * </pre>
 *
 * 兩者<strong>不是單一線性關係</strong>：每個方塊各自對應自己那一段現場。所以
 * 換算一律逐方塊做——找出點落在哪個方塊裡，再依比例映射。這正是圖台判讀車輛
 * 位置的反向操作，因此這裡量到的數字，車輛拿去用會落在同一個地方。
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
  /** ＋ 鈕半徑（圖面像素）。使用者明確要求「不要太小」。 */
  const PLUS_RADIUS = 16;
  const HANDLE_RADIUS = 10;

  /** 沒有自訂填色時的型別配色，取自圖台的視覺 */
  const TYPE_FILL = {
    Track: '#1a2233',
    Facility: '#3b2f63',
    PSD: '#1e3a5f',
    Signal: 'none',
    DockingPoint: '#2563eb',
    Pole: '#3f3a24',
    TrackCrossover: 'none',
  };

  let geometry = null;
  let routes = [];
  let current = null;
  /** 折線頂點，存的是<strong>場域公尺</strong> */
  let waypoints = [];
  let dirty = false;
  let dragging = null;
  /** 檢視框（圖面像素）。滾輪縮放、拖底圖平移都只改這個。 */
  let viewport = null;
  let panning = null;

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

  // ── 逐方塊換算 ─────────────────────────────────────────────

  function pixelToField(px, py) {
    for (const f of geometry.facilities) {
      if (!f.field) continue;
      if (px < f.x || px > f.x + f.w || py < f.y || py > f.y + f.h) continue;
      const tx = f.w > 0 ? (px - f.x) / f.w : 0.5;
      const ty = f.h > 0 ? (py - f.y) / f.h : 0.5;
      return {
        x: f.field.xMinM + (f.field.xMaxM - f.field.xMinM) * tx,
        // 像素 y 向下、場域 y 向上
        y: f.field.yMaxM - (f.field.yMaxM - f.field.yMinM) * ty,
        code: f.code,
      };
    }
    return null;
  }

  function fieldToPixel(xM, yM) {
    for (const f of geometry.facilities) {
      if (!f.field) continue;
      const { xMinM, xMaxM, yMinM, yMaxM } = f.field;
      if (xM < xMinM || xM > xMaxM || yM < yMinM || yM > yMaxM) continue;
      const tx = xMaxM > xMinM ? (xM - xMinM) / (xMaxM - xMinM) : 0.5;
      const ty = yMaxM > yMinM ? (yMaxM - yM) / (yMaxM - yMinM) : 0.5;
      return { x: f.x + f.w * tx, y: f.y + f.h * ty };
    }
    return null;
  }

  /**
   * 指標位置吸附到最近的軌道方塊。
   *
   * 折線點落在方塊外時沒有場域座標可用——那裡不是軌道。與其編一個數字出來，
   * 不如吸到最近的方塊上：路徑本來就該壓在軌道上，這也讓拖動不必拉得很準。
   */
  function snapToTrack(px, py) {
    const inside = pixelToField(px, py);
    if (inside) return inside;
    let best = null;
    let bestDistance = Infinity;
    for (const f of geometry.facilities) {
      if (!f.field || f.type !== 'Track') continue;
      const cx = Math.max(f.x, Math.min(px, f.x + f.w));
      const cy = Math.max(f.y, Math.min(py, f.y + f.h));
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestDistance) {
        bestDistance = d;
        best = { px: cx, py: cy };
      }
    }
    return best ? pixelToField(best.px, best.py) : null;
  }

  /** 螢幕座標 → 圖面像素。viewBox 是等比縮放（xMidYMid meet），只有一個比例。 */
  function pointerPixel(event) {
    const rect = svg.getBoundingClientRect();
    const vb = viewport;
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const offsetX = (rect.width - vb.w * scale) / 2;
    const offsetY = (rect.height - vb.h * scale) / 2;
    return {
      x: vb.x + (event.clientX - rect.left - offsetX) / scale,
      y: vb.y + (event.clientY - rect.top - offsetY) / scale,
    };
  }

  function resetViewport() {
    viewport = {
      x: 0, y: 0,
      w: geometry.pixelSize.width,
      h: geometry.pixelSize.height,
    };
  }

  /**
   * 滾輪縮放，以指標為中心。
   *
   * 以畫布中心縮放的話，使用者得先把想看的地方拖到中間才放得大——寬幅圖上那會
   * 反覆很多次。以指標為中心就是「放大我正在看的這裡」。
   */
  svg.addEventListener('wheel', (event) => {
    if (!geometry) return;
    event.preventDefault();
    const at = pointerPixel(event);
    const factor = event.deltaY < 0 ? 0.85 : 1 / 0.85;
    const full = geometry.pixelSize;
    const w = Math.min(full.width, Math.max(full.width / 12, viewport.w * factor));
    const h = w * (full.height / full.width);
    viewport = {
      w, h,
      x: at.x - (at.x - viewport.x) * (w / viewport.w),
      y: at.y - (at.y - viewport.y) * (h / viewport.h),
    };
    render();
  }, { passive: false });

  /** 在底圖上拖曳＝平移。折線點與 ＋ 會自己吃掉事件，不會誤觸。 */
  svg.addEventListener('pointerdown', (event) => {
    if (dragging || !geometry) return;
    panning = { startX: event.clientX, startY: event.clientY, view: { ...viewport } };
    svg.classList.add('panning');
  });

  svg.addEventListener('pointermove', (event) => {
    if (!panning) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / panning.view.w, rect.height / panning.view.h);
    viewport = {
      ...panning.view,
      x: panning.view.x - (event.clientX - panning.startX) / scale,
      y: panning.view.y - (event.clientY - panning.startY) / scale,
    };
    render();
  });

  const endPan = () => {
    panning = null;
    svg.classList.remove('panning');
  };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointerleave', endPan);
  svg.addEventListener('pointercancel', endPan);

  // ── 繪製 ───────────────────────────────────────────────────

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (parent) parent.appendChild(node);
    return node;
  }

  /** 底圖：照圖資本來的版面畫，與圖台看到的一致 */
  function renderBase(root) {
    for (const area of geometry.areas) {
      el('rect', {
        x: area.x, y: area.y, width: area.w, height: area.h,
        fill: 'rgba(255,255,255,0.02)',
        stroke: 'rgba(148,163,184,0.18)', 'stroke-width': 1,
      }, root);
    }

    for (const f of geometry.facilities) {
      const fill = f.fill ?? TYPE_FILL[f.type] ?? '#1a2233';
      const transform = f.rotationDeg
        ? `rotate(${f.rotationDeg} ${f.x + f.w / 2} ${f.y + f.h / 2})`
        : null;
      if (fill !== 'none') {
        el('rect', {
          x: f.x, y: f.y, width: f.w, height: f.h,
          rx: f.type === 'Track' ? 2 : 4,
          fill,
          stroke: f.type === 'Track' ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.35)',
          'stroke-width': 1,
          ...(transform ? { transform } : {}),
        }, root);
      }
      // 標籤只給看得下的方塊，太小的字疊在一起反而看不懂
      if (f.code && f.w >= 40 && f.h >= 16) {
        el('text', {
          x: f.x + f.w / 2, y: f.y + f.h / 2 + 4,
          fill: 'rgba(226,232,240,0.75)',
          'font-size': Math.min(13, Math.max(9, f.h * 0.4)),
          'text-anchor': 'middle',
        }, root).textContent = f.code;
      }
    }
  }

  function render() {
    svg.innerHTML = '';
    if (!geometry) return;
    if (!viewport) resetViewport();
    svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    renderBase(el('g', {}, svg));

    if (!current || waypoints.length < 2) return;

    const screen = waypoints.map((point) => {
      const px = fieldToPixel(point.x, point.y);
      return px ?? { x: 0, y: 0, off: true };
    });

    // 放大時線與把手要跟著變細，不然近看整片都是色塊
    const k = viewport.w / geometry.pixelSize.width;
    const lines = el('g', {}, svg);
    for (let i = 0; i < screen.length - 1; i += 1) {
      el('line', {
        x1: screen[i].x, y1: screen[i].y, x2: screen[i + 1].x, y2: screen[i + 1].y,
        stroke: '#38bdf8', 'stroke-width': 5 * k, 'stroke-linecap': 'round',
        opacity: 0.9,
      }, lines);
    }

    const plus = el('g', {}, svg);
    for (let i = 0; i < screen.length - 1; i += 1) {
      const cx = (screen[i].x + screen[i + 1].x) / 2;
      const cy = (screen[i].y + screen[i + 1].y) / 2;
      const group = el('g', { style: 'cursor:pointer', class: 'plus' }, plus);
      el('circle', {
        cx, cy, r: PLUS_RADIUS,
        fill: '#0f1115', stroke: '#38bdf8', 'stroke-width': 3,
      }, group);
      el('line', {
        x1: cx - 8 * k, y1: cy, x2: cx + 8 * k, y2: cy,
        stroke: '#38bdf8', 'stroke-width': 3 * k, 'stroke-linecap': 'round',
      }, group);
      el('line', {
        x1: cx, y1: cy - 8 * k, x2: cx, y2: cy + 8 * k,
        stroke: '#38bdf8', 'stroke-width': 3 * k, 'stroke-linecap': 'round',
      }, group);
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        insertBend(i);
      });
    }

    const handles = el('g', {}, svg);
    waypoints.forEach((point, index) => {
      const p = screen[index];
      if (point.stationId) {
        el('rect', {
          x: p.x - 9 * k, y: p.y - 9 * k, width: 18 * k, height: 18 * k, rx: 4 * k,
          fill: '#34d399', stroke: '#0f1115', 'stroke-width': 2.5 * k,
        }, handles);
        const station = current.stations.find((s) => s.id === point.stationId);
        el('text', {
          x: p.x + 14 * k, y: p.y - 12 * k,
          fill: '#e6e9ef', 'font-size': 15 * k, 'font-weight': 600,
        }, handles).textContent = station?.name ?? point.stationId;
      } else {
        const handle = el('circle', {
          cx: p.x, cy: p.y, r: HANDLE_RADIUS * k,
          fill: '#fbbf24', stroke: '#0f1115', 'stroke-width': 2.5 * k,
          style: 'cursor:grab',
        }, handles);
        handle.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          dragging = { index, pointerId: event.pointerId };
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
    // 中點取<strong>圖面</strong>中點再換回公尺：兩個方塊的比例尺不同，
    // 直接平均公尺座標會讓新點跑到線外
    const pa = fieldToPixel(a.x, a.y);
    const pb = fieldToPixel(b.x, b.y);
    const mid = pa && pb
      ? snapToTrack((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
      : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!mid) {
      setStatus('這一段的中點不在任何軌道方塊上，無法加折線點', 'error');
      return;
    }
    waypoints.splice(segmentIndex + 1, 0, {
      x: Math.round(mid.x * 100) / 100,
      y: Math.round(mid.y * 100) / 100,
    });
    dirty = true;
    setStatus(`已在 ${mid.code ?? '軌道'} 上新增折線點，尚未儲存`);
    render();
  }

  function removeBend(index) {
    if (waypoints[index]?.stationId) return;
    waypoints.splice(index, 1);
    dirty = true;
    setStatus('已刪除折線點，尚未儲存');
    render();
  }

  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const px = pointerPixel(event);
    const field = snapToTrack(px.x, px.y);
    if (!field) return;
    waypoints[dragging.index] = {
      x: Math.round(field.x * 100) / 100,
      y: Math.round(field.y * 100) / 100,
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
        `${String(t.code).padEnd(5)} x ${t.refField.xMinM}–${t.refField.xMaxM}`
        + `　y ${t.refField.yMinM}–${t.refField.yMaxM}`).join('\n');
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
      }
    });
  }

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
