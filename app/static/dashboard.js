const byId = (id) => document.getElementById(id);
const resources = {
  cpu: { name: 'CPU', color: '#79a9d7', description: 'A higher line means your server is working harder.' },
  memory: { name: 'Memory', color: '#a091c3', description: 'This is the space being used by apps running now.' },
  disk: { name: 'Storage', color: '#73a89e', description: 'This is the space being used by saved files.' },
};
const clock = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const percent = (value) => value == null ? 'Not reported' : `${value.toFixed(1)}%`;
let readings = [];
let alerts = [];
let selectedMetric = 'cpu';
let refreshing = false;
let paused = false;
let connected = false;

async function get(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not load readings');
  return response.json();
}

function svgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function drawChart() {
  const chart = byId('chart');
  const resource = resources[selectedMetric];
  const rows = readings.slice(-Number(byId('range').value));
  const width = Math.max(320, chart.clientWidth);
  const bottom = 180;
  chart.setAttribute('viewBox', `0 0 ${width} 200`);
  chart.setAttribute('aria-label', `${resource.name} usage over time, from zero to one hundred percent`);
  chart.replaceChildren();
  for (const value of [0, 25, 50, 75, 100]) {
    const y = bottom - value * 1.6;
    chart.append(svgElement('line', { x1: 35, x2: width - 12, y1: y, y2: y, stroke: '#e9eff5', 'stroke-dasharray': '3 4' }));
    const label = svgElement('text', { x: 0, y: y + 3, fill: '#8b9cae', 'font-size': 9 });
    label.textContent = `${value}%`;
    chart.append(label);
  }
  const start = rows.length ? Date.parse(rows[0].created_at) : 0;
  const end = rows.length ? Date.parse(rows.at(-1).created_at) : 0;
  let points = [];
  const flush = () => {
    if (points.length) chart.append(svgElement('polyline', { points: points.join(' '), fill: 'none', stroke: resource.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    points = [];
  };
  rows.forEach((row) => {
    if (row[selectedMetric] == null) { flush(); return; }
    const x = start === end ? width / 2 : 35 + (Date.parse(row.created_at) - start) / (end - start) * (width - 47);
    const y = bottom - row[selectedMetric] * 1.6;
    points.push(`${x},${y}`);
    const dot = svgElement('circle', { cx: x, cy: y, r: row.anomaly ? 3.5 : 2, fill: resource.color });
    const title = svgElement('title', {});
    title.textContent = `${resource.name}: ${percent(row[selectedMetric])} at ${new Date(row.created_at).toLocaleString()}${row.anomaly ? ' · This reading has an alert' : ''}`;
    dot.append(title);
    chart.append(dot);
  });
  flush();
  const available = rows.filter((row) => row[selectedMetric] != null).length;
  byId('empty').hidden = available > 0;
  byId('empty').textContent = rows.length ? `${resource.name} isn’t being reported by this server.` : 'No readings yet. They’ll appear here when your server checks in.';
  byId('chart-title').textContent = `${resource.name} over time`;
  byId('chart-description').textContent = resource.description;
  byId('chart-legend').textContent = `${resource.name} usage`;
  document.querySelector('.chart-dot').style.background = resource.color;
  byId('chart-count').textContent = `${available} readings`;
  byId('chart-start').textContent = rows.length ? clock(rows[0].created_at) : 'Waiting for readings';
  byId('chart-end').textContent = rows.length ? clock(rows.at(-1).created_at) : '';
}

function healthMessage() {
  const latest = readings.at(-1);
  if (!connected) return { title: 'Let’s reconnect.', detail: 'We can’t reach your server’s readings. We’ll try again shortly.', label: 'CONNECTION LOST' };
  if (!latest) return { title: 'A fresh start.', detail: 'Choose a server when it appears. Its readings will show up here.', label: 'WAITING FOR READINGS' };
  if (Date.now() - Date.parse(latest.created_at) > 600000) return { title: 'It’s been a little quiet.', detail: 'No new readings in over 10 minutes. Check that your collector is running.', label: 'NO RECENT DATA' };
  if (latest.anomaly) return { title: 'Something needs a look.', detail: 'The latest reading is unusual. Open an alert to see what changed.', label: 'A QUICK HEADS-UP' };
  return { title: 'Everything looks calm.', detail: 'The latest reading is within range. Your recent activity is right below.', label: 'LATEST READING LOOKS GOOD' };
}

function showSummary() {
  const latest = readings.at(-1);
  for (const field of Object.keys(resources)) {
    byId(field).textContent = latest?.[field] == null ? '—' : percent(latest[field]);
    byId(`${field}-bar`).style.width = `${latest?.[field] ?? 0}%`;
  }
  const health = healthMessage();
  byId('status-label').classList.toggle('attention', Boolean(latest?.anomaly || !connected || (latest && Date.now() - Date.parse(latest.created_at) > 600000)));
  byId('health').textContent = health.title;
  byId('health-detail').textContent = health.detail;
  byId('status-label').replaceChildren(document.createElement('span'), document.createTextNode(health.label));
}

function showAlerts(target, items) {
  const container = byId(target);
  // Keep an open alert open when fresh readings arrive.
  const opened = new Set([...container.querySelectorAll('details[open]')].map((item) => item.dataset.id));
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-alert';
    empty.textContent = readings.length ? 'All quiet here. No alerts for this server.' : 'Your alerts will appear here once readings arrive.';
    container.append(empty);
  }
  for (const alert of items) {
    const item = document.createElement('details');
    item.className = 'alert-item';
    item.dataset.id = String(alert.id);
    item.open = opened.has(String(alert.id));
    const summary = document.createElement('summary');
    const symbol = document.createElement('span');
    symbol.className = 'alert-symbol';
    symbol.textContent = '!';
    const text = document.createElement('span');
    text.className = 'alert-text';
    const title = document.createElement('strong');
    title.textContent = alert.reason?.startsWith('Unusual') ? 'This reading looks different from usual' : alert.reason?.replace('Cpu', 'CPU') || 'A reading needs attention';
    const time = document.createElement('small');
    time.textContent = `${alert.server} · ${new Date(alert.created_at).toLocaleString()}`;
    text.append(title, time);
    const chevron = document.createElement('span');
    chevron.className = 'alert-chevron';
    chevron.textContent = '›';
    summary.append(symbol, text, chevron);
    const detail = document.createElement('div');
    detail.className = 'alert-detail';
    detail.textContent = `CPU: ${percent(alert.cpu)} · Memory: ${percent(alert.memory)} · Storage: ${percent(alert.disk)}. ${alert.reason}. Check what was running around this time.`;
    item.append(summary, detail);
    container.append(item);
  }
}

function switchView(view) {
  byId('overview-view').hidden = view !== 'overview';
  byId('alerts-view').hidden = view !== 'alerts';
  byId('page-name').textContent = view === 'alerts' ? 'Alerts' : 'Overview';
  byId('page-title').textContent = view === 'alerts' ? 'A little heads-up.' : 'Your cloud, made clear.';
  byId('page-subtitle').textContent = view === 'alerts' ? 'See what changed, one reading at a time.' : 'A comfortable place to keep an eye on things.';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (view === 'overview') drawChart();
}

function answer(question) {
  const text = question.toLowerCase();
  if (/chart|graph/.test(text)) return `${resources[selectedMetric].description} The bottom shows when readings arrived. Tap a resource card to change the chart, or choose fewer readings for a closer look.`;
  if (/what.*alert|explain.*alert/.test(text)) return 'An alert appears when usage reaches 90%, or a reading looks different from that server’s recent activity. It’s a reason to check, not proof that something is broken.';
  if (!connected) return 'I can’t get fresh readings right now. Try Refresh, or wait a moment for the connection to return.';
  if (!readings.length) return 'There aren’t any readings for this server yet. Choose a server from the menu when one appears.';
  const latest = readings.at(-1);
  const prefix = `${latest.server}, last received ${new Date(latest.created_at).toLocaleString()}: `;
  if (/alert|issue|problem/.test(text)) return prefix + (alerts.length ? `There are ${alerts.length} recent alerts shown, including “${alerts[0].reason}”. Open Alerts to see the readings.` : 'No saved alerts for this server.');
  if (/cpu|processor|power/.test(text)) return prefix + `CPU is ${percent(latest.cpu)}. Think of it as how busy the server’s brain is. Higher numbers mean it’s doing more work.`;
  if (/memory|ram/.test(text)) return prefix + (latest.memory == null ? 'Memory isn’t being reported. That doesn’t mean it’s zero.' : `Memory is ${percent(latest.memory)}. It’s the desk space your running apps use. More apps usually need more space.`);
  if (/disk|storage|files/.test(text)) return prefix + (latest.disk == null ? 'Storage isn’t being reported. That doesn’t mean it’s empty.' : `Storage is ${percent(latest.disk)} full. This is the space your saved files use.`);
  if (/server|status|okay|ok|health|doing/.test(text)) return prefix + healthMessage().detail;
  return 'I can explain your readings. Try “CPU”, “memory”, “storage”, “any alerts?” or “how is my server?”.';
}

function ask(question) {
  if (!question.trim()) return;
  const messages = byId('messages');
  for (const [text, className] of [[question.trim(), 'user-message'], [answer(question), 'guide-message']]) {
    const message = document.createElement('div');
    message.className = `message ${className}`;
    message.textContent = text;
    messages.append(message);
  }
  while (messages.children.length > 22) messages.firstElementChild.remove();
  messages.scrollTop = messages.scrollHeight;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const select = byId('server');
  const previous = select.value;
  select.disabled = true;
  byId('refresh').disabled = true;
  try {
    const servers = await get('/api/servers');
    if (JSON.stringify(servers) !== JSON.stringify([...select.options].map((option) => option.value))) {
      select.replaceChildren();
      for (const server of servers) select.add(new Option(server, server));
      if (!servers.length) select.add(new Option('Waiting for data', ''));
      if (servers.includes(previous)) select.value = previous;
    }
    const query = select.value ? `?server=${encodeURIComponent(select.value)}` : '';
    [readings, alerts] = await Promise.all([get(`/api/metrics${query}`), get(`/api/alerts${query}`)]);
    connected = true;
    showSummary();
    drawChart();
    showAlerts('recent-alerts', alerts.slice(0, 2));
    showAlerts('alerts', alerts);
    byId('nav-count').textContent = alerts.length;
    byId('alert-count').textContent = alerts.length;
    byId('connection').textContent = paused ? 'Updates paused' : 'Connected';
    byId('connection').classList.add('live');
    byId('updated').textContent = `Updated ${clock(Date.now())}`;
  } catch {
    connected = false;
    showSummary();
    byId('connection').textContent = 'Connection lost';
    byId('connection').classList.remove('live');
    byId('updated').textContent = 'Couldn’t refresh. Showing last received data.';
  } finally {
    select.disabled = false;
    byId('refresh').disabled = false;
    refreshing = false;
  }
}

byId('today').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
byId('server').addEventListener('change', refresh);
byId('range').addEventListener('change', drawChart);
byId('refresh').addEventListener('click', refresh);
byId('pause').addEventListener('click', () => {
  paused = !paused;
  byId('pause').textContent = paused ? 'Resume updates' : 'Pause updates';
  byId('pause').setAttribute('aria-pressed', String(paused));
  if (paused) byId('connection').textContent = 'Updates paused';
  else refresh();
});
document.querySelectorAll('[data-metric]').forEach((button) => button.addEventListener('click', () => {
  selectedMetric = button.dataset.metric;
  document.querySelectorAll('[data-metric]').forEach((card) => {
    card.classList.toggle('selected', card === button);
    card.setAttribute('aria-pressed', String(card === button));
  });
  drawChart();
}));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
byId('view-alerts').addEventListener('click', () => switchView('alerts'));
byId('all-alerts').addEventListener('click', () => switchView('alerts'));
document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => ask(button.dataset.question)));
byId('guide-form').addEventListener('submit', (event) => {
  event.preventDefault();
  ask(byId('question').value);
  byId('question').value = '';
});
byId('tour-button').addEventListener('click', () => byId('tour').showModal());
byId('quick-help').addEventListener('click', () => byId('tour').showModal());
byId('close-tour').addEventListener('click', () => byId('tour').close());
byId('finish-tour').addEventListener('click', () => byId('tour').close());
window.addEventListener('resize', drawChart);
refresh();
setInterval(() => { if (!paused) refresh(); }, 5000);
