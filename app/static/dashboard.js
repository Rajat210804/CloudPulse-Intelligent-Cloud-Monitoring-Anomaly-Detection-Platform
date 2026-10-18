const byId = (id) => document.getElementById(id);
const colors = { cpu: '#aa94ff', memory: '#6cb6fa', disk: '#59cbb0' };
const timeLabel = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
let refreshing = false;

async function get(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Unable to load readings');
  return response.json();
}

function svgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function drawChart(rows) {
  const chart = byId('chart');
  chart.replaceChildren();
  for (const value of [0, 25, 50, 75, 100]) {
    const y = 220 - value * 2;
    chart.append(svgElement('line', { x1: 45, x2: 980, y1: y, y2: y, stroke: '#252b3c', 'stroke-dasharray': '3 5' }));
    const label = svgElement('text', { x: 2, y: y + 4, fill: '#78829b', 'font-size': 11 });
    label.textContent = `${value}%`;
    chart.append(label);
  }
  const start = rows.length ? Date.parse(rows[0].created_at) : 0;
  const end = rows.length ? Date.parse(rows.at(-1).created_at) : 0;
  for (const [field, color] of Object.entries(colors)) {
    let points = [];
    const flush = () => {
      if (points.length) chart.append(svgElement('polyline', { points: points.join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      points = [];
    };
    rows.forEach((row) => {
      if (row[field] === null) { flush(); return; }
      const x = start === end ? 510 : 45 + (Date.parse(row.created_at) - start) / (end - start) * 935;
      const y = 220 - row[field] * 2;
      points.push(`${x},${y}`);
      const dot = svgElement('circle', { cx: x, cy: y, r: row.anomaly ? 4 : 2, fill: color });
      const title = svgElement('title', {});
      title.textContent = `${field}: ${row[field].toFixed(1)}% at ${new Date(row.created_at).toLocaleString()}${row.anomaly ? ' · Alert' : ''}`;
      dot.append(title);
      chart.append(dot);
    });
    flush();
  }
  byId('empty').hidden = rows.length > 0;
  byId('chart-count').textContent = `${rows.length} readings`;
  byId('chart-start').textContent = rows.length ? timeLabel(rows[0].created_at) : 'No history yet';
  byId('chart-end').textContent = rows.length ? timeLabel(rows.at(-1).created_at) : 'Now';
}

function showSummary(latest) {
  for (const field of Object.keys(colors)) {
    const value = latest?.[field];
    byId(field).textContent = value == null ? '—' : `${value.toFixed(1)}%`;
    byId(`${field}-bar`).style.width = `${value ?? 0}%`;
  }
  const stale = latest && Date.now() - Date.parse(latest.created_at) > 600000;
  byId('health').textContent = !latest ? 'Waiting' : stale ? 'No recent data' : latest.anomaly ? 'Needs attention' : 'Within range';
  byId('health').classList.toggle('warning', Boolean(latest?.anomaly || stale));
  byId('health-detail').textContent = !latest ? 'No readings received yet' : stale ? 'Last reading over 10 minutes ago' : `Received at ${timeLabel(latest.created_at)}`;
}

function showAlerts(alerts) {
  byId('alert-count').textContent = alerts.length;
  const table = byId('alerts');
  table.replaceChildren();
  if (!alerts.length) {
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-alert';
    cell.textContent = 'Looking quiet. No alerts for this server yet.';
    const row = document.createElement('tr');
    row.append(cell);
    table.append(row);
  }
  for (const alert of alerts) {
    const row = document.createElement('tr');
    for (const value of [alert.server, alert.reason, `${alert.cpu.toFixed(1)}%`, new Date(alert.created_at).toLocaleString()]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    table.append(row);
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const select = byId('server');
  const previous = select.value;
  select.disabled = true;
  try {
    const servers = await get('/api/servers');
    select.replaceChildren();
    for (const server of servers) select.add(new Option(server, server));
    if (!servers.length) select.add(new Option('Waiting for data', ''));
    if (servers.includes(previous)) select.value = previous;
    const query = select.value ? `?server=${encodeURIComponent(select.value)}` : '';
    const [rows, alerts] = await Promise.all([get(`/api/metrics${query}`), get(`/api/alerts${query}`)]);
    showSummary(rows.at(-1));
    drawChart(rows);
    showAlerts(alerts);
    byId('connection').textContent = '● Connected';
    byId('connection').classList.add('live');
    byId('updated').textContent = `Updated ${new Date().toLocaleTimeString()} · Every 5 seconds`;
  } catch {
    byId('connection').textContent = 'Connection lost';
    byId('connection').classList.remove('live');
    byId('health').textContent = 'Unavailable';
    byId('health').classList.add('warning');
    byId('health-detail').textContent = 'Cannot refresh readings';
    byId('updated').textContent = 'Showing last received data. Retrying shortly.';
  } finally {
    select.disabled = false;
    refreshing = false;
  }
}

byId('server').addEventListener('change', refresh);
refresh();
setInterval(refresh, 5000);
