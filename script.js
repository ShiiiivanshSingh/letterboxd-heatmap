const state = {
  records: [],
  byDate: new Map(),
  username: '',
  range: '365',
  customStart: null,
  customEnd: null,
  theme: 'dark'
};

const uploadScreen = document.getElementById('upload-screen');
const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const uploadStatus = document.getElementById('upload-status');
const changeFileBtn = document.getElementById('change-file-btn');
const rangePills = document.getElementById('range-pills');
const customRangeWrap = document.getElementById('custom-range-wrap');
const rangeStart = document.getElementById('range-start');
const rangeEnd = document.getElementById('range-end');
const themeToggle = document.getElementById('theme-toggle');
const exportBtn = document.getElementById('export-btn');
const exportWatermark = document.getElementById('export-watermark');
const tooltip = document.getElementById('tooltip');
const heatmapTitle = document.getElementById('heatmap-title');
const monthRow = document.getElementById('month-row');
const dayLabels = document.getElementById('day-labels');
const weeksEl = document.getElementById('weeks');
const brandUser = document.getElementById('brand-user');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function toDateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseDateKey(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function readZipEntry(zip, name) {
  const entry = zip.file(name);
  if (!entry) return Promise.resolve(null);
  return entry.async('string');
}

async function handleZipFile(file) {
  uploadStatus.textContent = 'reading zip…';
  uploadStatus.classList.remove('error');
  try {
    const zip = await JSZip.loadAsync(file);
    const diaryText = await readZipEntry(zip, 'diary.csv');
    const watchedText = await readZipEntry(zip, 'watched.csv');
    const profileText = await readZipEntry(zip, 'profile.csv');

    if (!diaryText && !watchedText) {
      throw new Error('no diary.csv or watched.csv found in this export');
    }

    uploadStatus.textContent = 'parsing entries…';

    const seen = new Set();
    const records = [];

    if (diaryText) {
      const diary = Papa.parse(diaryText, { header: true, skipEmptyLines: true }).data;
      diary.forEach(row => {
        const dateStr = (row['Watched Date'] || row['Date'] || '').trim();
        if (!dateStr) return;
        const key = (row['Name'] || '') + '::' + (row['Year'] || '');
        seen.add(key);
        records.push({ date: dateStr, name: row['Name'] || 'untitled', year: row['Year'] || '' });
      });
    }

    if (watchedText) {
      const watched = Papa.parse(watchedText, { header: true, skipEmptyLines: true }).data;
      watched.forEach(row => {
        const key = (row['Name'] || '') + '::' + (row['Year'] || '');
        if (seen.has(key)) return;
        const dateStr = (row['Date'] || '').trim();
        if (!dateStr) return;
        seen.add(key);
        records.push({ date: dateStr, name: row['Name'] || 'untitled', year: row['Year'] || '' });
      });
    }

    if (profileText) {
      const profile = Papa.parse(profileText, { header: true, skipEmptyLines: true }).data;
      if (profile.length && profile[0]['Username']) {
        state.username = profile[0]['Username'];
      }
    }

    if (!records.length) throw new Error('no watched entries found in this export');

    state.records = records;
    indexRecords();
    uploadStatus.textContent = '';
    showApp();
  } catch (err) {
    uploadStatus.textContent = 'error: ' + err.message;
    uploadStatus.classList.add('error');
  }
}

function indexRecords() {
  const map = new Map();
  state.records.forEach(r => {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r.name + (r.year ? ' (' + r.year + ')' : ''));
  });
  state.byDate = map;
}

function showApp() {
  uploadScreen.classList.add('hidden');
  app.classList.remove('hidden');
  brandUser.textContent = state.username ? '@' + state.username : '';
  render();
}

function getRangeBounds() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start, end;

  switch (state.range) {
    case '90':
      end = new Date(today); start = new Date(today); start.setDate(start.getDate() - 89);
      break;
    case '365':
      end = new Date(today); start = new Date(today); start.setDate(start.getDate() - 364);
      break;
    case 'custom':
      start = state.customStart ? parseDateKey(state.customStart) : new Date(today.getFullYear(), 0, 1);
      end = state.customEnd ? parseDateKey(state.customEnd) : today;
      break;
    case 'all':
    default: {
      const keys = Array.from(state.byDate.keys()).sort();
      start = keys.length ? parseDateKey(keys[0]) : today;
      end = today;
      break;
    }
  }
  return { start, end };
}

function rangeLabel() {
  const labels = { '90': 'last 90 days', '365': 'last 365 days', 'all': 'all time', 'custom': 'custom range' };
  return labels[state.range] || 'last 365 days';
}

function bucketLevel(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

function buildHeatmap(start, end) {
  monthRow.innerHTML = '';
  dayLabels.innerHTML = '';
  weeksEl.innerHTML = '';

  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  dayNames.forEach((n, i) => {
    const s = document.createElement('span');
    s.textContent = (i % 2 === 1) ? n : '';
    dayLabels.appendChild(s);
  });

  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const todayKey = toDateKey(new Date());
  const weeks = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const col = document.createElement('div');
    col.className = 'week-col';
    week.forEach((day, di) => {
      const cell = document.createElement('div');
      const inRange = day >= start && day <= end;
      const key = toDateKey(day);
      if (!inRange) {
        cell.className = 'cell empty';
      } else {
        const titles = state.byDate.get(key) || [];
        const lvl = bucketLevel(titles.length);
        cell.className = 'cell' + (key === todayKey ? ' today' : '');
        cell.style.background = `var(--lvl${lvl})`;
        cell.style.animationDelay = (wi * 0.006) + 's';
        cell.addEventListener('mouseenter', e => showTooltip(e, key, titles));
        cell.addEventListener('mousemove', positionTooltip);
        cell.addEventListener('mouseleave', hideTooltip);
      }
      col.appendChild(cell);

      if (inRange && day.getMonth() !== lastMonth && di === 0) {
        lastMonth = day.getMonth();
        const label = document.createElement('span');
        label.className = 'month-label';
        label.textContent = day.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
        label.style.left = (wi * 19) + 38 + 'px';
        monthRow.appendChild(label);
      }
    });
    weeksEl.appendChild(col);
  });

  const gridWidth = 38 + weeks.length * 19 - 4;
  document.getElementById('heatmap-inner').style.width = gridWidth + 'px';
}

function showTooltip(e, key, titles) {
  const d = parseDateKey(key);
  const dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const count = titles.length;
  let html = `<div class="tooltip-date">${dateStr}</div>`;
  html += `<div class="tooltip-count">watched: ${count} movie${count === 1 ? '' : 's'}</div>`;
  if (count) {
    const shown = titles.slice(0, 6);
    html += '<ul class="tooltip-list">' + shown.map(t => `<li>• ${escapeHtml(t)}</li>`).join('') + '</ul>';
    if (titles.length > 6) html += `<div class="tooltip-more">+ ${titles.length - 6} more</div>`;
  }
  tooltip.innerHTML = html;
  tooltip.classList.add('show');
  positionTooltip(e);
}

function positionTooltip(e) {
  const x = e.clientX + 14;
  const y = e.clientY + 14;
  const maxX = window.innerWidth - tooltip.offsetWidth - 12;
  const maxY = window.innerHeight - tooltip.offsetHeight - 12;
  tooltip.style.left = Math.min(x, maxX) + 'px';
  tooltip.style.top = Math.min(y, maxY) + 'px';
}

function hideTooltip() {
  tooltip.classList.remove('show');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function computeStats(start, end) {
  const dayCounts = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const key = toDateKey(cursor);
    const count = (state.byDate.get(key) || []).length;
    dayCounts.push({ key, count });
    cursor.setDate(cursor.getDate() + 1);
  }

  const totalMovies = dayCounts.reduce((a, d) => a + d.count, 0);
  const activeDays = dayCounts.filter(d => d.count > 0).length;
  const totalDays = dayCounts.length;
  const mostInDay = dayCounts.reduce((m, d) => Math.max(m, d.count), 0);
  const peak = dayCounts.reduce((best, d) => (d.count > (best ? best.count : -1) ? d : best), null);

  let longest = 0, running = 0;
  dayCounts.forEach(d => {
    if (d.count > 0) { running++; longest = Math.max(longest, running); }
    else running = 0;
  });

  let current = 0;
  for (let i = dayCounts.length - 1; i >= 0; i--) {
    if (dayCounts[i].count > 0) current++;
    else break;
  }

  return {
    totalMovies,
    activeDays,
    longest,
    current,
    mostInDay,
    avgPerDay: totalDays ? (totalMovies / totalDays) : 0,
    avgPerActiveDay: activeDays ? (totalMovies / activeDays) : 0,
    peak
  };
}

function renderStats(stats) {
  document.getElementById('stat-total').textContent = stats.totalMovies;
  document.getElementById('stat-active').textContent = stats.activeDays;
  document.getElementById('stat-longest').textContent = stats.longest + 'd';
  document.getElementById('stat-current').textContent = stats.current + 'd';
  document.getElementById('stat-mostday').textContent = stats.mostInDay;
  document.getElementById('stat-avgday').textContent = stats.avgPerDay.toFixed(2);
  document.getElementById('stat-avgactive').textContent = stats.avgPerActiveDay.toFixed(2);
  const peakEl = document.getElementById('stat-peak');
  if (stats.peak && stats.peak.count > 0) {
    const d = parseDateKey(stats.peak.key);
    peakEl.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    peakEl.textContent = '—';
  }
}

function render() {
  const { start, end } = getRangeBounds();
  heatmapTitle.textContent = rangeLabel();
  buildHeatmap(start, end);
  renderStats(computeStats(start, end));
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleZipFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleZipFile(fileInput.files[0]);
});

changeFileBtn.addEventListener('click', () => {
  app.classList.add('hidden');
  uploadScreen.classList.remove('hidden');
  uploadStatus.textContent = '';
  fileInput.value = '';
});

rangePills.addEventListener('click', e => {
  const btn = e.target.closest('.segment');
  if (!btn) return;
  rangePills.querySelectorAll('.segment').forEach(s => s.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.range = btn.dataset.range;
  customRangeWrap.hidden = state.range !== 'custom';
  if (state.range === 'custom' && !state.customStart) {
    const today = new Date();
    const yearAgo = new Date(); yearAgo.setDate(yearAgo.getDate() - 30);
    rangeStart.value = toDateKey(yearAgo);
    rangeEnd.value = toDateKey(today);
    state.customStart = rangeStart.value;
    state.customEnd = rangeEnd.value;
  }
  render();
});
rangeStart.addEventListener('change', () => { state.customStart = rangeStart.value; render(); });
rangeEnd.addEventListener('change', () => { state.customEnd = rangeEnd.value; render(); });

document.addEventListener('click', e => {
  if (state.range !== 'custom') return;
  if (e.target.closest('.range-control')) return;
  customRangeWrap.hidden = true;
});

themeToggle.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  themeToggle.textContent = state.theme === 'dark' ? '☀' : '☾';
  localStorage.setItem('watchlog-theme', state.theme);
});

exportBtn.addEventListener('click', () => {
  const card = document.getElementById('heatmap-card');
  exportWatermark.textContent = (state.username ? '@' + state.username + ' · ' : '') + 'made by shivansh!';
  exportWatermark.classList.add('show');

  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || (state.theme === 'dark' ? '#12161b' : '#ffffff');

  html2canvas(card, {
    backgroundColor: bgColor,
    scale: 3,
    useCORS: true,
    allowTaint: false
  }).then(canvas => {
    exportWatermark.classList.remove('show');
    const link = document.createElement('a');
    link.download = 'watch_log-heatmap.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch((error) => {
    console.error("Export failed:", error);
    exportWatermark.classList.remove('show');
    alert("Export failed! Check the developer console for details.");
  });
});

(function initTheme() {
  const saved = localStorage.getItem('watchlog-theme');
  if (saved) {
    state.theme = saved;
    document.documentElement.setAttribute('data-theme', saved);
  }
  themeToggle.textContent = state.theme === 'dark' ? '☀' : '☾';
})();
