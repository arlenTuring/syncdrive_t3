'use strict';

/**
 * 控制頁。所有對外連線都在本機的 Node 程序裡，這一頁只下指令與看狀態——
 * 憑證從不進到瀏覽器。
 */

const $ = (id) => document.getElementById(id);

const el = {
  targetBadge: $('targetBadge'),
  preset: $('presetSelect'),
  host: $('hostInput'),
  mqttPort: $('mqttPortInput'),
  externalPort: $('externalPortInput'),
  applyTarget: $('applyTargetBtn'),
  probe: $('probeBtn'),
  probeResults: $('probeResults'),
  credWarn: $('credWarn'),
  start: $('startBtn'),
  stop: $('stopBtn'),
  speed: $('speedSelect'),
  fleetInfo: $('fleetInfo'),
  fleetBody: $('fleetBody'),
  onlyOrders: $('onlyOrders'),
  clearLog: $('clearLogBtn'),
  log: $('log'),
};

let presets = [];

async function api(path, options) {
  const res = await fetch(path, {
    method: options?.body ? 'POST' : (options?.method ?? 'GET'),
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status}`);
  return json;
}

function fillTarget(target) {
  el.host.value = target.host;
  el.mqttPort.value = target.mqttPort;
  el.externalPort.value = target.externalApiPort;
  el.targetBadge.textContent = `${target.label} · ${target.host}`;
}

function renderCredentials(state) {
  if (state.missing.length === 0) {
    el.credWarn.hidden = true;
    return;
  }
  el.credWarn.hidden = false;
  el.credWarn.textContent =
    `尚缺憑證，車隊無法上線：\n${state.missing.map((m) => `· ${m}`).join('\n')}\n`
    + '複製 simulator/.env.example 為 simulator/.env 填入後重開此服務。';
}

function renderFleet(fleet) {
  el.start.disabled = fleet.running;
  el.stop.disabled = !fleet.running;
  el.speed.value = String(fleet.speedMultiplier);

  el.fleetInfo.textContent = fleet.map
    ? `圖資：${fleet.map.name ?? fleet.map.id}（${fleet.map.points} 個點位）`
    : '';

  if (!fleet.vehicles.length) {
    el.fleetBody.innerHTML = '<tr><td colspan="7" class="empty">車隊未上線</td></tr>';
    return;
  }

  el.fleetBody.innerHTML = fleet.vehicles.map((vehicle) => {
    const dot = vehicle.faulted ? 'bad' : (vehicle.connected ? 'on' : 'off');
    const connLabel = vehicle.faulted ? '故障' : (vehicle.connected ? '已連線' : '未連線');
    const order = vehicle.order;
    const progress = order ? order.progress : 0;
    return `
      <tr>
        <td>${vehicle.code}</td>
        <td><span class="dot ${dot}"></span>${connLabel}</td>
        <td>${order ? `${order.id}<br><span class="t">${order.kind === 'passenger' ? '載客' : '空車移動'}</span>` : '<span class="t">待命</span>'}</td>
        <td>${order ? `${order.from ?? '?'} → ${order.to ?? '?'}` : '—'}</td>
        <td><div class="bar"><span style="width:${progress}%"></span></div> ${progress}%</td>
        <td>${vehicle.battery}%</td>
        <td>
          <button class="btn tiny" data-fault="emergency" data-code="${vehicle.code}">緊急停止</button>
          <button class="btn tiny" data-fault="obstacle" data-code="${vehicle.code}">障礙物</button>
          <button class="btn tiny" data-fault="clear" data-code="${vehicle.code}">清除</button>
        </td>
      </tr>`;
  }).join('');
}

function renderState(state) {
  if (presets.length === 0) {
    presets = state.presets;
    el.preset.innerHTML = presets
      .map((preset) => `<option value="${preset.id}">${preset.label}</option>`)
      .join('') + '<option value="custom">自訂</option>';
  }
  el.preset.value = state.target.id;
  fillTarget(state.target);
  renderCredentials(state);
  renderFleet(state.fleet);
}

async function refresh() {
  try {
    renderState(await api('/api/state'));
  } catch (error) {
    console.error(error);
  }
}

// ── 事件串流 ───────────────────────────────────────────────────

const LEVEL_LABEL = { error: '錯誤', warn: '注意', order: '訂單', command: '指令', info: '資訊' };

function appendLog(event) {
  if (el.onlyOrders.checked && !['order', 'error', 'warn', 'command'].includes(event.level)) return;
  const line = document.createElement('div');
  const time = new Date(event.at).toLocaleTimeString('zh-TW', { hour12: false });
  line.className = `lv-${event.level}`;
  line.innerHTML =
    `<span class="t">${time}</span> `
    + `[${LEVEL_LABEL[event.level] ?? event.level}] `
    + `<span class="s">${event.source}</span> ${event.message}`;
  const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 40;
  el.log.appendChild(line);
  if (atBottom) el.log.scrollTop = el.log.scrollHeight;
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    appendLog(event);
    // 訂單與連線變化會改變表格內容，這時候才刷新，不必固定輪詢
    if (['order', 'error', 'info'].includes(event.level)) void refresh();
  };
  source.onerror = () => {
    // EventSource 會自己重連，這裡只提示一次
  };
}

// ── 操作 ───────────────────────────────────────────────────────

el.preset.addEventListener('change', () => {
  const preset = presets.find((item) => item.id === el.preset.value);
  if (preset) fillTarget(preset);
});

el.applyTarget.addEventListener('click', async () => {
  try {
    renderState(await api('/api/target', {
      body: {
        id: el.preset.value,
        host: el.host.value,
        mqttPort: Number(el.mqttPort.value),
        externalApiPort: Number(el.externalPort.value),
      },
    }));
  } catch (error) {
    alert(error.message);
  }
});

el.probe.addEventListener('click', async () => {
  el.probe.disabled = true;
  el.probeResults.innerHTML = '<li>測試中…</li>';
  try {
    const { results } = await api('/api/probe', { body: {} });
    el.probeResults.innerHTML = results.map((result) => `
      <li>
        <span class="tag">${result.channel === 'external' ? '對外' : '內部'}</span>
        <span class="${result.ok ? 'ok' : 'bad'}">${result.ok ? '通' : '不通'}</span>
        <span>${result.name}</span>
        <span class="tag">${result.ms} ms</span>
        <span class="t">${result.detail}</span>
      </li>`).join('');
  } catch (error) {
    el.probeResults.innerHTML = `<li class="bad">${error.message}</li>`;
  } finally {
    el.probe.disabled = false;
  }
});

el.start.addEventListener('click', async () => {
  el.start.disabled = true;
  try {
    renderFleet(await api('/api/fleet/start', { body: {} }));
  } catch (error) {
    alert(error.message);
    el.start.disabled = false;
  }
});

el.stop.addEventListener('click', async () => {
  try {
    renderFleet(await api('/api/fleet/stop', { body: {} }));
  } catch (error) {
    alert(error.message);
  }
});

el.speed.addEventListener('change', async () => {
  await api('/api/fleet/speed', { body: { multiplier: Number(el.speed.value) } })
    .catch((error) => alert(error.message));
});

el.fleetBody.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-fault]');
  if (!button) return;
  try {
    await api('/api/vehicle/fault', {
      body: { code: button.dataset.code, kind: button.dataset.fault },
    });
    void refresh();
  } catch (error) {
    alert(error.message);
  }
});

el.clearLog.addEventListener('click', () => { el.log.innerHTML = ''; });

void refresh();
connectEvents();
setInterval(refresh, 2000);
