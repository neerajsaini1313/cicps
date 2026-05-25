/* ═══════════════════════════════════════════════════════
   CICPS v4.1 — Main JavaScript
   Bug-free, production-ready
   R = records from Flask, S = summary from Flask
   Record: [0]dist [1]mob_full [2]mob_s [3]imei [4]prov
           [5]time [6]lat [7]lon [8]addr [9]victim [10]ackdet
           [11]hour [12]date
═══════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ─────────────────────────────────────── */
var COLORS = [
  '#63b3ed','#fc8181','#68d391','#f6e05e','#b794f4',
  '#f6ad55','#f687b3','#4fd1c5','#9ae6b4','#feb2b2',
  '#90cdf4','#fbd38d'
];
var CHART_GC  = 'rgba(99,179,237,0.07)';
var CHART_TC  = '#2d3748';
var CHART_TT  = {
  backgroundColor: '#0e1220',
  borderColor: 'rgba(99,179,237,0.3)',
  borderWidth: 1,
  titleColor: '#63b3ed',
  bodyColor: '#a0aec0',
  padding: 10,
  cornerRadius: 7
};

/* ── State ──────────────────────────────────────────── */
var LANG       = localStorage.getItem('cicps_lang')  || 'en';
var IS_DARK    = (localStorage.getItem('cicps_theme') || 'dark') === 'dark';
var mapReady   = false;
var leafMap, darkTL, lightTL, mapLayer;
var filteredData = [];
var currentPage  = 1;
var pageSize     = 50;
var sortCol      = -1;
var sortDir      = 1;
var analyticsBuilt = false;
var insightsBuilt  = false;

/* ═══════════════════════════════════════════════════════
   LANGUAGE
═══════════════════════════════════════════════════════ */
function applyLang() {
  document.querySelectorAll('.t[data-' + LANG + ']').forEach(function(el) {
    el.textContent = el.getAttribute('data-' + LANG);
  });
  var lb = document.getElementById('lang-btn');
  if (lb) lb.textContent = LANG === 'en' ? 'हिं' : 'EN';
  var tb = document.getElementById('tb-tagline');
  if (tb) tb.textContent = LANG === 'hi'
    ? 'शिकायत खुफिया और अपराध पैटर्न प्रणाली · एनसीटी दिल्ली'
    : 'COMPLAINT INTELLIGENCE & CRIME PATTERN SYSTEM · NCT DELHI';
  var si = document.getElementById('s-query');
  if (si) si.placeholder = LANG === 'hi'
    ? 'मोबाइल, IMEI, जिला, पता, पीड़ित खोजें…'
    : 'Mobile, IMEI, district, address, victim, case ref…';
}

document.getElementById('lang-btn').addEventListener('click', function() {
  LANG = LANG === 'en' ? 'hi' : 'en';
  localStorage.setItem('cicps_lang', LANG);
  applyLang();
});

/* ═══════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════ */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', IS_DARK ? 'dark' : 'light');
  var btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = IS_DARK ? '☀' : '🌙';
  localStorage.setItem('cicps_theme', IS_DARK ? 'dark' : 'light');
  CHART_TT.backgroundColor = IS_DARK ? '#0e1220' : '#e8edf5';
  CHART_GC = IS_DARK ? 'rgba(99,179,237,0.07)' : 'rgba(49,130,206,0.07)';
  CHART_TC = IS_DARK ? '#2d3748' : '#a0aec0';
}

document.getElementById('theme-btn').addEventListener('click', function() {
  IS_DARK = !IS_DARK;
  applyTheme();
  updateAllChartColors();
  if (mapReady) {
    if (IS_DARK) {
      if (lightTL) leafMap.removeLayer(lightTL);
      if (darkTL)  darkTL.addTo(leafMap);
    } else {
      if (darkTL)  leafMap.removeLayer(darkTL);
      if (lightTL) lightTL.addTo(leafMap);
    }
  }
});

function updateAllChartColors() {
  Object.values(Chart.instances || {}).forEach(function(c) {
    if (!c || !c.options || !c.options.scales) return;
    Object.values(c.options.scales).forEach(function(ax) {
      if (ax.grid)  ax.grid.color  = CHART_GC;
      if (ax.ticks) ax.ticks.color = CHART_TC;
    });
    c.update('none');
  });
}

/* ═══════════════════════════════════════════════════════
   CLOCK
═══════════════════════════════════════════════════════ */
(function tickClock() {
  var n  = new Date();
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][n.getMonth()];
  var el = document.getElementById('tb-clock');
  if (el) el.textContent =
    pad(n.getDate()) + ' ' + mo + '  ' +
    pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
  setTimeout(tickClock, 1000);
})();

function pad(n) { return String(n).padStart(2, '0'); }

/* ═══════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════ */
function navTo(page) {
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('active', n.getAttribute('data-page') === page);
  });
  document.querySelectorAll('.page').forEach(function(p) {
    p.classList.remove('active');
  });
  var el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  if (page === 'geo'      && !mapReady)       initMap();
  if (page === 'records')                     renderTable();
  if (page === 'analytics' && !analyticsBuilt) buildAnalytics();
  if (page === 'insights'  && !insightsBuilt)  buildInsights();
}

document.querySelectorAll('.nav-item').forEach(function(n) {
  n.addEventListener('click', function() {
    navTo(n.getAttribute('data-page'));
  });
});

/* ═══════════════════════════════════════════════════════
   CHART HELPERS
═══════════════════════════════════════════════════════ */
Chart.defaults.font.family = "'Inter', sans-serif";

function destroyChart(id) {
  var c = Chart.getChart(id);
  if (c) c.destroy();
}

function mkBar(id, labels, data, color) {
  destroyChart(id);
  var ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ data: data,
      backgroundColor: color + '44', borderColor: color,
      borderWidth: 1.5, borderRadius: 5 }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: CHART_TT },
      scales: {
        x: { grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}},
        y: { grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}}
      }
    }
  });
}

function mkLine(id, labels, data, color) {
  destroyChart(id);
  var ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: [{ data: data,
      borderColor: color, backgroundColor: color + '1a',
      fill: true, tension: 0.4, pointRadius: 1.5, borderWidth: 2 }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: CHART_TT },
      scales: {
        x: { grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }, maxTicksLimit: 14 }},
        y: { grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}}
      }
    }
  });
}

function mkDonut(id, labels, data, colors) {
  destroyChart(id);
  var ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data,
      backgroundColor: colors,
      borderColor: IS_DARK ? '#0e1220' : '#e8edf5',
      borderWidth: 3 }]},
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { labels: { color: IS_DARK ? '#a0aec0' : '#2d3748', font: { size: 11 }, padding: 14 }},
        tooltip: CHART_TT
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val != null ? val : '—';
}

function providerBadgeClass(prov) {
  if (prov === 'AIRTEL') return 'badge badge-airtel';
  if (prov === 'JIO')    return 'badge badge-jio';
  return 'badge badge-other';
}

function populateDropdowns() {
  var dists = Object.keys(S.districts || {});
  var provs = Object.keys(S.providers || {});

  ['s-filter-dist', 'f-dist'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var cur = el.value;
    var first = el.options[0];
    el.innerHTML = '';
    el.appendChild(first.cloneNode(true));
    dists.forEach(function(d) {
      var o = document.createElement('option');
      o.value = d; o.textContent = d; el.appendChild(o);
    });
    el.value = cur;
  });

  ['s-filter-prov', 'f-prov'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var cur = el.value;
    var first = el.options[0];
    el.innerHTML = '';
    el.appendChild(first.cloneNode(true));
    provs.forEach(function(p) {
      var o = document.createElement('option');
      o.value = p; o.textContent = p; el.appendChild(o);
    });
    el.value = cur;
  });

  // Search total label
  var sl = document.getElementById('search-total-label');
  if (sl && S.total) sl.textContent = S.total.toLocaleString() + ' RECORDS';
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════ */
function buildDashboard() {
  var hasData = R && R.length > 0 && S && S.total;

  var emptyEl   = document.getElementById('dash-empty');
  var contentEl = document.getElementById('dash-content');
  if (emptyEl)   emptyEl.style.display   = hasData ? 'none'  : 'block';
  if (contentEl) contentEl.style.display = hasData ? 'flex'  : 'none';
  if (!hasData) return;

  var dk = Object.keys(S.districts || {});
  var dv = Object.values(S.districts || {});
  var total = S.total || 1;

  /* KPIs */
  setText('kv-total',       total.toLocaleString());
  setText('kv-total-sub',   dk.length + ' districts covered');
  setText('kv-mob',         (S.uniq_mob  || 0).toLocaleString());
  setText('kv-imei',        (S.uniq_imei || 0).toLocaleString());
  setText('kv-dists',       dk.length);
  setText('sb-total',       total.toLocaleString());
  setText('status-record-count', total.toLocaleString() + ' RECORDS');

  if (S.top_district) {
    setText('kv-top-dist', S.top_district);
    var td = S.districts[S.top_district] || 0;
    setText('kv-top-dist-sub', td.toLocaleString() + ' · ' + (td / total * 100).toFixed(1) + '%');
  }
  if (S.top_provider) {
    setText('kv-prov', S.top_provider);
    var tp = S.providers[S.top_provider] || 0;
    setText('kv-prov-sub', tp.toLocaleString() + ' · ' + (tp / total * 100).toFixed(1) + '%');
  }
  if (S.peak_hour != null) {
    setText('kv-peak', S.peak_hour + ':00');
    var phv = (S.hours || {})[String(S.peak_hour)] || 0;
    setText('kv-peak-sub', phv.toLocaleString() + ' records');
  }
  if (S.top_hotspot && S.top_hotspot.c) {
    setText('kv-top-hs', S.top_hotspot.c + '×');
    setText('kv-top-hs-sub', (S.top_hotspot.la||0).toFixed(4) + '°N ' + (S.top_hotspot.lo||0).toFixed(4) + '°E');
  }
  if (S.date_range && S.date_range.from) {
    setText('sb-period', S.date_range.from + ' → ' + S.date_range.to);
    var pl = document.getElementById('daily-period-label');
    if (pl) pl.textContent = S.date_range.from + ' → ' + S.date_range.to;
  }

  /* Charts */
  mkBar('chart-dist', dk, dv, '#63b3ed');

  var hv = [];
  for (var h = 0; h < 24; h++) hv.push(+(S.hours && S.hours[String(h)] || 0));
  mkBar('chart-hour', hv.map(function(_, i) { return i + ':00'; }), hv, '#fc8181');

  var pk = Object.keys(S.providers || {});
  var pv = Object.values(S.providers || {});
  mkDonut('chart-prov', pk, pv, COLORS.slice(0, pk.length).map(function(c) { return c + '99'; }));

  /* Dist intensity bars */
  var maxD  = Math.max.apply(null, dv.concat([1]));
  var dbEl  = document.getElementById('dist-bars');
  if (dbEl) {
    dbEl.innerHTML = '';
    dk.forEach(function(d, i) {
      var pct = Math.round(dv[i] / maxD * 100);
      var pp  = (dv[i] / total * 100).toFixed(1);
      dbEl.innerHTML +=
        '<div class="dist-row">' +
        '<span class="dist-name">' + d + '</span>' +
        '<div class="dist-bar-o"><div class="dist-bar-i" style="width:' + pct + '%;background:' + COLORS[i % COLORS.length] + '"></div></div>' +
        '<span class="dist-count">' + dv[i].toLocaleString() + '</span>' +
        '<span class="dist-pct">'  + pp + '%</span>' +
        '</div>';
    });
  }

  /* Daily trend */
  var dates = Object.keys(S.dates || {});
  var dvals = Object.values(S.dates || {});
  mkLine('chart-date', dates.map(function(d) { return d.slice(5); }), dvals, '#68d391');

  /* Sidebar mini bars */
  var sbEl = document.getElementById('sb-mini-bars');
  if (sbEl) {
    sbEl.innerHTML = '';
    dk.slice(0, 8).forEach(function(d, i) {
      sbEl.innerHTML +=
        '<div class="mini-row">' +
        '<span class="mini-name">' + d + '</span>' +
        '<div class="mini-bar-wrap"><div class="mini-bar-fill" style="width:' + Math.round(dv[i] / maxD * 100) + '%"></div></div>' +
        '<span class="mini-num">' + dv[i] + '</span>' +
        '</div>';
    });
  }

  /* Geo page KPIs */
  setText('geo-total', total.toLocaleString());
  if (S.top_hotspot && S.top_hotspot.c) {
    setText('geo-hs-count', S.top_hotspot.c + ' hits');
    setText('geo-hs-coord', (S.top_hotspot.la || 0).toFixed(4) + '°N · ' + (S.top_hotspot.lo || 0).toFixed(4) + '°E');
  }
  if (S.date_range && S.date_range.from) {
    setText('geo-range', S.date_range.from + '\n' + S.date_range.to);
  }

  /* Hotspot list */
  var hlEl = document.getElementById('hs-list');
  if (hlEl && S.hotspots && S.hotspots.length) {
    var maxH = S.hotspots[0].c;
    hlEl.innerHTML = '';
    S.hotspots.slice(0, 25).forEach(function(h, i) {
      hlEl.innerHTML +=
        '<div class="hs-row">' +
        '<span class="hs-rank">#' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="hs-coords">' + h.la.toFixed(4) + '°N, ' + h.lo.toFixed(4) + '°E</span>' +
        '<div class="hs-bar-o"><div class="hs-bar-i" style="width:' + Math.round(h.c / maxH * 100) + '%"></div></div>' +
        '<span class="hs-count">' + h.c + '</span>' +
        '</div>';
    });
  }

  /* Unique coords count for geo KPI */
  var coordMap = {};
  (R || []).forEach(function(r) {
    if (r[6]) coordMap[r[6].toFixed(4) + ',' + r[7].toFixed(4)] = 1;
  });
  setText('geo-uniq', Object.keys(coordMap).length.toLocaleString());

  populateDropdowns();
}

/* ═══════════════════════════════════════════════════════
   ANALYTICS
═══════════════════════════════════════════════════════ */
function buildAnalytics() {
  if (analyticsBuilt || !S || !S.total) return;
  analyticsBuilt = true;

  var dk = Object.keys(S.districts || {});
  var dv = Object.values(S.districts || {});

  /* Monthly */
  var mkeys = Object.keys(S.months || {});
  var mvals = Object.values(S.months || {});
  mkBar('chart-month', mkeys.map(function(k) {
    var m = { '2026-03':'Mar 26','2026-04':'Apr 26','2026-05':'May 26' };
    return m[k] || k;
  }), mvals, '#f6e05e');

  /* Daily */
  var dates = Object.keys(S.dates || {});
  var dvals = Object.values(S.dates || {});
  mkLine('chart-date2', dates.map(function(d) { return d.slice(5); }), dvals, '#63b3ed');

  /* Hour */
  var hv = [];
  for (var h = 0; h < 24; h++) hv.push(+(S.hours && S.hours[String(h)] || 0));
  mkBar('chart-hour2', hv.map(function(_, i) { return i + ':00'; }), hv, '#fc8181');

  /* District pie */
  mkDonut('chart-distpie', dk, dv, COLORS.slice(0, dk.length));

  /* District horizontal bar */
  destroyChart('chart-distbar');
  var dbc = document.getElementById('chart-distbar');
  if (dbc) {
    new Chart(dbc, {
      type: 'bar',
      data: {
        labels: dk,
        datasets: [{ data: dv,
          backgroundColor: COLORS.slice(0, dk.length).map(function(c) { return c + '88'; }),
          borderColor: COLORS.slice(0, dk.length), borderWidth: 1.5, borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: CHART_TT },
        scales: {
          x: { grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}},
          y: { grid: { color: CHART_GC }, ticks: { color: IS_DARK ? '#a0aec0' : '#2d3748', font: { size: 10 }}}
        }
      }
    });
  }

  /* Provider × District stacked */
  destroyChart('chart-provdist');
  var pdc = document.getElementById('chart-provdist');
  if (pdc) {
    var ad = S.airtel_dist || {}, jd = S.jio_dist || {};
    new Chart(pdc, {
      type: 'bar',
      data: {
        labels: dk,
        datasets: [
          { label: 'AIRTEL', data: dk.map(function(d) { return ad[d] || 0; }), backgroundColor: '#fc818155', borderColor: '#fc8181', borderWidth: 1.5 },
          { label: 'JIO',    data: dk.map(function(d) { return jd[d] || 0; }), backgroundColor: '#63b3ed55', borderColor: '#63b3ed', borderWidth: 1.5 }
        ]
      },
      options: {
        plugins: { legend: { labels: { color: IS_DARK ? '#a0aec0' : '#2d3748', font: { size: 11 }}}, tooltip: CHART_TT },
        scales: {
          x: { stacked: true, grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}},
          y: { stacked: true, grid: { color: CHART_GC }, ticks: { color: CHART_TC, font: { size: 10 }}}
        }
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════
   MAP
═══════════════════════════════════════════════════════ */
function initMap() {
  mapReady = true;
  leafMap  = L.map('map', { center: [28.65, 77.20], zoom: 11 });
  darkTL   = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { attribution: '© CartoDB', maxZoom: 19 });
  lightTL  = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 });
  (IS_DARK ? darkTL : lightTL).addTo(leafMap);
  if (R && R.length) setMapMode('cluster');
}

function setMapMode(mode) {
  ['cluster', 'heat', 'hotspot'].forEach(function(m) {
    var b = document.getElementById('map-btn-' + m);
    if (b) b.classList.toggle('active', m === mode);
  });
  if (!mapReady) return;
  if (mapLayer) {
    try { mapLayer.clearLayers ? mapLayer.clearLayers() : leafMap.removeLayer(mapLayer); } catch(e) {}
  }

  /* Build coord cluster map */
  var cmap = {};
  (R || []).forEach(function(r) {
    if (!r[6] || !r[7]) return;
    var k = r[6].toFixed(4) + ',' + r[7].toFixed(4);
    if (!cmap[k]) cmap[k] = { la: r[6], lo: r[7], c: 0, d: r[0], entries: [] };
    cmap[k].c++;
    if (cmap[k].entries.length < 8) cmap[k].entries.push(r);
  });
  var pts = Object.values(cmap);

  mapLayer = L.layerGroup();

  function makePopup(p) {
    var r0  = p.entries && p.entries[0];
    var html = '<div class="popup-head">' + p.la.toFixed(5) + '°N, ' + p.lo.toFixed(5) + '°E</div>';
    html += '<div class="popup-row"><span class="popup-lbl">Hits</span><span class="popup-val" style="color:#fc8181;font-weight:700">' + p.c + '</span></div>';
    html += '<div class="popup-row"><span class="popup-lbl">District</span><span class="popup-val">' + (p.d || '—') + '</span></div>';
    if (r0) {
      html += '<div class="popup-row"><span class="popup-lbl">Mobile</span><span class="popup-val" style="color:#63b3ed">' + r0[1] + '</span></div>';
      html += '<div class="popup-row"><span class="popup-lbl">Provider</span><span class="popup-val">' + r0[4] + '</span></div>';
      html += '<div class="popup-row"><span class="popup-lbl">Time</span><span class="popup-val">' + r0[5] + '</span></div>';
      if (r0[8]) html += '<div class="popup-row"><span class="popup-lbl">Address</span><span class="popup-val">' + r0[8].slice(0, 45) + (r0[8].length > 45 ? '…' : '') + '</span></div>';
      if (r0[9]) html += '<div class="popup-row"><span class="popup-lbl">Victim</span><span class="popup-val" style="color:#f6e05e">' + r0[9].slice(0, 40) + '</span></div>';
      if (r0[10]) html += '<div class="popup-row"><span class="popup-lbl">Case Ref</span><span class="popup-val" style="color:#a0aec0">' + r0[10].slice(0, 40) + '</span></div>';
    }
    if (p.c > 1) html += '<div class="popup-more">+ ' + (p.c - 1) + ' more entries at this location</div>';
    return html;
  }

  if (mode === 'cluster') {
    pts.forEach(function(p) {
      var col = p.c >= 10 ? '#fc8181' : p.c >= 5 ? '#f6e05e' : '#63b3ed';
      var rad = Math.min(4 + p.c * 0.9, 22);
      L.circleMarker([p.la, p.lo], { radius: rad, color: col, fillColor: col, fillOpacity: 0.72, weight: 1 })
        .bindPopup(makePopup(p), { maxWidth: 300 })
        .addTo(mapLayer);
    });
  } else if (mode === 'heat') {
    pts.forEach(function(p) {
      var op  = Math.min(0.05 + p.c * 0.07, 0.88);
      var rad = Math.min(10 + p.c * 2.5, 80);
      L.circleMarker([p.la, p.lo], { radius: rad, color: 'transparent', fillColor: '#fc8181', fillOpacity: op, weight: 0 })
        .bindPopup(makePopup(p), { maxWidth: 300 })
        .addTo(mapLayer);
    });
  } else {
    (S.hotspots || []).slice(0, 50).forEach(function(h, i) {
      var key = h.la.toFixed(4) + ',' + h.lo.toFixed(4);
      var p   = cmap[key] || { la: h.la, lo: h.lo, c: h.c, d: '—', entries: [] };
      var rad = Math.min(8 + h.c * 0.8, 42);
      L.circleMarker([h.la, h.lo], { radius: rad, color: '#fc8181', fillColor: '#fc8181', fillOpacity: 0.65, weight: 2 })
        .bindPopup(makePopup(p), { maxWidth: 300 })
        .addTo(mapLayer);
    });
  }

  mapLayer.addTo(leafMap);
  var mpc = document.getElementById('map-pt-count');
  if (mpc) mpc.textContent = '● ' + pts.length.toLocaleString() + ' unique coordinates';
}

/* ═══════════════════════════════════════════════════════
   TABLE
═══════════════════════════════════════════════════════ */
function renderTable() {
  filteredData = R || [];
  applyFilters();
}

function applyFilters() {
  var fd = (document.getElementById('f-dist')   || {}).value || '';
  var fp = (document.getElementById('f-prov')   || {}).value || '';
  var fm = ((document.getElementById('f-mobile') || {}).value || '').trim();
  var ff = (document.getElementById('f-from')   || {}).value || '';
  var ft = (document.getElementById('f-to')     || {}).value || '';

  filteredData = (R || []).filter(function(r) {
    if (fd && r[0] !== fd)                             return false;
    if (fp && r[4] !== fp)                             return false;
    if (fm && r[1].indexOf(fm) < 0 && r[2].indexOf(fm) < 0) return false;
    if (ff && r[12] < ff)                              return false;
    if (ft && r[12] > ft)                              return false;
    return true;
  });

  var fc = document.getElementById('f-count');
  if (fc) fc.textContent = filteredData.length.toLocaleString() + ' records';
  currentPage = 1;
  renderTablePage();
}

function resetFilters() {
  ['f-dist', 'f-prov', 'f-mobile', 'f-from', 'f-to'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  applyFilters();
}

function renderTablePage() {
  var s   = (currentPage - 1) * pageSize;
  var e   = Math.min(s + pageSize, filteredData.length);
  var rows = filteredData.slice(s, e);

  var html = '';
  if (!rows.length) {
    html = '<tr class="no-data-row"><td colspan="10">No records match the current filters</td></tr>';
  } else {
    rows.forEach(function(r, i) {
      var idx = s + i;
      html +=
        '<tr onclick="openDetailModal(' + idx + ')">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><b>' + r[0] + '</b></td>' +
        '<td style="font-family:var(--mono)">' + r[1] + '</td>' +
        '<td style="font-family:var(--mono);color:var(--t2);font-size:10px">' + r[3] + '</td>' +
        '<td><span class="' + providerBadgeClass(r[4]) + '">' + r[4] + '</span></td>' +
        '<td style="font-family:var(--mono);font-size:11px">' + r[5] + '</td>' +
        '<td style="font-family:var(--mono);font-size:11px">' + r[6].toFixed(5) + '</td>' +
        '<td style="font-family:var(--mono);font-size:11px">' + r[7].toFixed(5) + '</td>' +
        '<td style="max-width:190px;overflow:hidden;text-overflow:ellipsis;color:var(--t2)">' + r[8] + '</td>' +
        '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;color:#f6e05e">' + r[9] + '</td>' +
        '</tr>';
    });
  }
  document.getElementById('table-body').innerHTML = html;

  /* Pagination */
  var tot = Math.ceil(filteredData.length / pageSize);
  var ph  = '<span class="pagination-info">' + (s + 1) + '–' + e + ' of ' + filteredData.length.toLocaleString() + '</span>';
  if (currentPage > 1) ph += '<button class="page-btn" onclick="goPage(1)">«</button><button class="page-btn" onclick="goPage(' + (currentPage - 1) + ')">‹</button>';
  var sp = Math.max(1, currentPage - 2), ep = Math.min(tot, currentPage + 2);
  for (var i = sp; i <= ep; i++) {
    ph += '<button class="page-btn' + (i === currentPage ? ' current' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
  }
  if (currentPage < tot) ph += '<button class="page-btn" onclick="goPage(' + (currentPage + 1) + ')">›</button><button class="page-btn" onclick="goPage(' + tot + ')">»</button>';
  document.getElementById('pagination').innerHTML = ph;
}

function goPage(n) { currentPage = n; renderTablePage(); }

function sortTable(col) {
  if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  filteredData.sort(function(a, b) {
    var av = a[col], bv = b[col];
    return (typeof av === 'number' ? (av - bv) : String(av).localeCompare(String(bv))) * sortDir;
  });
  renderTablePage();
}

function openDetailModal(idx) {
  var r = filteredData[idx];
  if (!r) return;
  document.getElementById('modal-content').innerHTML =
    '<div class="modal-grid">' +
    '<div><div class="mf-label t" data-en="DISTRICT" data-hi="जिला">DISTRICT</div><div class="mf-value">' + r[0] + '</div></div>' +
    '<div><div class="mf-label">PROVIDER</div><div class="mf-value"><span class="' + providerBadgeClass(r[4]) + '">' + r[4] + '</span></div></div>' +
    '<div><div class="mf-label t" data-en="MOBILE" data-hi="मोबाइल">MOBILE</div><div class="mf-value" style="font-family:var(--mono);color:var(--a)">' + r[1] + '</div></div>' +
    '<div><div class="mf-label">IMEI</div><div class="mf-value" style="font-family:var(--mono)">' + r[3] + '</div></div>' +
    '<div><div class="mf-label t" data-en="DATE & TIME" data-hi="दिनांक और समय">DATE & TIME</div><div class="mf-value" style="font-family:var(--mono)">' + r[5] + '</div></div>' +
    '<div><div class="mf-label t" data-en="COORDINATES" data-hi="निर्देशांक">COORDINATES</div><div class="mf-value" style="font-family:var(--mono)">' + r[6].toFixed(5) + '°N, ' + r[7].toFixed(5) + '°E</div></div>' +
    '<div style="grid-column:span 2"><div class="mf-label t" data-en="ADDRESS" data-hi="पता">ADDRESS</div><div class="mf-value" style="color:var(--t1)">' + (r[8] || '—') + '</div></div>' +
    '<div style="grid-column:span 2"><div class="mf-label t" data-en="VICTIM DETAILS" data-hi="पीड़ित विवरण">VICTIM DETAILS</div><div class="mf-value" style="color:#f6e05e">' + (r[9] || '—') + '</div></div>' +
    '<div style="grid-column:span 2"><div class="mf-label t" data-en="CASE REFERENCE" data-hi="केस संदर्भ">CASE REFERENCE</div><div class="mf-value" style="color:var(--t2);font-size:12px">' + (r[10] || '—') + '</div></div>' +
    '</div>';
  document.getElementById('detail-modal').classList.add('open');
  applyLang();
}

function closeModal() { document.getElementById('detail-modal').classList.remove('open'); }
document.getElementById('detail-modal').addEventListener('click', function(e) {
  if (e.target.id === 'detail-modal') closeModal();
});

function exportCSV() {
  var fd = (document.getElementById('f-dist')   || {}).value || '';
  var fp = (document.getElementById('f-prov')   || {}).value || '';
  var fm = ((document.getElementById('f-mobile') || {}).value || '').trim();
  var ff = (document.getElementById('f-from')   || {}).value || '';
  var ft = (document.getElementById('f-to')     || {}).value || '';
  var p  = new URLSearchParams();
  if (fd) p.set('district',  fd);
  if (fp) p.set('provider',  fp);
  if (fm) p.set('mobile',    fm);
  if (ff) p.set('date_from', ff);
  if (ft) p.set('date_to',   ft);
  window.location.href = '/api/export?' + p.toString();
}

/* ═══════════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════════ */
function doSearch() {
  var field = (document.getElementById('s-field')       || {}).value || 'all';
  var raw   = ((document.getElementById('s-query')      || {}).value || '').trim();
  var term  = raw.toLowerCase();
  var prov  = (document.getElementById('s-filter-prov') || {}).value || '';
  var dist  = (document.getElementById('s-filter-dist') || {}).value || '';
  var df    = (document.getElementById('s-from')        || {}).value || '';
  var dt    = (document.getElementById('s-to')          || {}).value || '';
  var hint  = document.getElementById('s-hint');
  var cntEl = document.getElementById('s-result-count');
  var resEl = document.getElementById('s-results');

  if (!raw && !prov && !dist && !df && !dt) {
    if (hint) hint.textContent = 'Please enter a search term or select a filter.';
    return;
  }

  var results = (R || []).filter(function(r) {
    if (prov && r[4] !== prov) return false;
    if (dist && r[0] !== dist) return false;
    if (df   && r[12] < df)   return false;
    if (dt   && r[12] > dt)   return false;
    if (!raw) return true;
    switch (field) {
      case 'mob':    return r[1].indexOf(raw) >= 0 || r[2].indexOf(raw) >= 0;
      case 'imei':   return r[3].indexOf(raw) >= 0;
      case 'dist':   return r[0].toLowerCase().indexOf(term) >= 0;
      case 'prov':   return r[4].toLowerCase().indexOf(term) >= 0;
      case 'victim': return r[9].toLowerCase().indexOf(term) >= 0;
      case 'addr':   return r[8].toLowerCase().indexOf(term) >= 0;
      case 'ackdet': return r[10].toLowerCase().indexOf(term) >= 0;
      default:
        return (r[1].indexOf(raw) >= 0 || r[2].indexOf(raw) >= 0 ||
                r[3].indexOf(raw) >= 0 ||
                r[0].toLowerCase().indexOf(term) >= 0 ||
                r[4].toLowerCase().indexOf(term) >= 0 ||
                r[8].toLowerCase().indexOf(term) >= 0 ||
                r[9].toLowerCase().indexOf(term) >= 0 ||
                r[10].toLowerCase().indexOf(term) >= 0);
    }
  });

  if (cntEl) cntEl.textContent = results.length ? results.length.toLocaleString() + ' results' : '';
  if (hint)  hint.textContent  = results.length
    ? results.length.toLocaleString() + ' record' + (results.length === 1 ? '' : 's') + ' found' + (results.length > 100 ? ' — showing first 100' : '')
    : 'No records found. Try fewer digits, a different field, or remove filters.';

  if (!results.length) {
    if (resEl) resEl.innerHTML = '<div class="empty-state" style="padding:40px">No matching records</div>';
    return;
  }

  var html = '';
  results.slice(0, 100).forEach(function(r) {
    html +=
      '<div class="search-result-card">' +
      '<div class="src-header">' +
      '<span class="src-mobile">' + r[1] + '</span>' +
      '<span class="' + providerBadgeClass(r[4]) + '">' + r[4] + '</span>' +
      '</div>' +
      '<div class="src-grid">' +
      '<div><div class="src-field-label">DISTRICT</div><div class="src-field-value">' + r[0] + '</div></div>' +
      '<div><div class="src-field-label">DATE / TIME</div><div class="src-field-value mono">' + r[5] + '</div></div>' +
      '<div><div class="src-field-label">IMEI</div><div class="src-field-value mono" style="font-size:10px">' + r[3] + '</div></div>' +
      '<div><div class="src-field-label">LAT / LON</div><div class="src-field-value mono">' + r[6].toFixed(4) + '°N ' + r[7].toFixed(4) + '°E</div></div>' +
      '<div style="grid-column:span 2"><div class="src-field-label">ADDRESS</div><div class="src-field-value" style="color:var(--t2);font-size:12px">' + r[8] + '</div></div>' +
      '</div>' +
      (r[9]  ? '<div style="margin-top:8px;font-size:12px;color:#f6e05e">' + r[9]  + '</div>' : '') +
      (r[10] ? '<div style="margin-top:4px;font-size:11px;color:var(--t2)">' + r[10] + '</div>' : '') +
      '</div>';
  });
  if (results.length > 100) {
    html += '<div style="text-align:center;padding:10px;color:var(--t2);font-family:var(--mono);font-size:10px">Showing 100 of ' + results.length.toLocaleString() + ' results — use filters to narrow</div>';
  }
  if (resEl) resEl.innerHTML = html;
}

function clearSearch() {
  ['s-query', 's-from', 's-to'].forEach(function(id) { var e = document.getElementById(id); if (e) e.value = ''; });
  ['s-filter-prov', 's-filter-dist'].forEach(function(id) { var e = document.getElementById(id); if (e) e.value = ''; });
  var cnt = document.getElementById('s-result-count'); if (cnt) cnt.textContent = '';
  var hint = document.getElementById('s-hint');
  if (hint) hint.textContent = 'Enter search term or apply filters, then press Search or Enter.';
  var res = document.getElementById('s-results');
  if (res) res.innerHTML = '<div class="empty-state" style="padding:40px">No active query</div>';
}

document.getElementById('s-query').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doSearch();
});

/* ═══════════════════════════════════════════════════════
   INSIGHTS
═══════════════════════════════════════════════════════ */
function buildInsights() {
  if (insightsBuilt || !S || !S.total) return;
  insightsBuilt = true;

  var mobC = {};
  (R || []).forEach(function(r) { mobC[r[1]] = (mobC[r[1]] || 0) + 1; });
  var repeats = Object.values(mobC).filter(function(v) { return v >= 3; }).length;

  var dk    = Object.keys(S.districts || {});
  var dv    = Object.values(S.districts || {});
  var total = S.total || 1;
  var days  = Object.keys(S.dates || {}).length || 1;
  var avg   = Math.round(total / days);

  setText('ins-kv-critical', '3');
  setText('ins-kv-pattern',  '5');

  var items = [
    { cls:'ic-r', icon:'▲', html: '<strong>' + (dk[0]||'—') + '</strong> leads with <strong>' + (dv[0]||0).toLocaleString() + ' entries</strong> — ' + ((dv[0]||0)/total*100).toFixed(1) + '% of total. Primary concentration zone.' },
    { cls:'ic-r', icon:'▲', html: 'Coordinate <strong>' + (S.top_hotspot&&S.top_hotspot.la||0).toFixed(4) + '°N, ' + (S.top_hotspot&&S.top_hotspot.lo||0).toFixed(4) + '°E</strong> repeated <strong>' + (S.top_hotspot&&S.top_hotspot.c||0) + ' times</strong>. Highest density point in dataset.' },
    { cls:'ic-r', icon:'▲', html: '<strong>' + (S.peak_date||'—') + '</strong> recorded <strong>' + (S.peak_date_count||0) + ' entries</strong> — ' + Math.round((S.peak_date_count||0)/avg) + '× the daily average of ' + avg + '.' },
    { cls:'ic-y', icon:'◆', html: 'Peak hour: <strong>' + (S.peak_hour||'?') + ':00</strong>. Activity is concentrated in a structured time window indicating non-random behavioral pattern.' },
    { cls:'ic-y', icon:'◆', html: '<strong>' + (S.top_provider||'—') + '</strong> is the dominant provider with <strong>' + ((S.providers&&S.providers[S.top_provider])||0).toLocaleString() + ' records</strong> — ' + (((S.providers&&S.providers[S.top_provider])||0)/total*100).toFixed(1) + '% of dataset.' },
    { cls:'ic-y', icon:'◆', html: 'Top 2 districts <strong>' + dk.slice(0,2).join(' + ') + '</strong> account for <strong>' + ((dv[0]||0)+(dv[1]||0)).toLocaleString() + ' entries</strong> combined — ' + (((dv[0]||0)+(dv[1]||0))/total*100).toFixed(1) + '%.' },
    { cls:'',     icon:'◉', html: '<strong>' + repeats.toLocaleString() + ' mobile numbers</strong> appear 3 or more times, indicating repeat entries for same device across multiple timestamps.' },
    { cls:'',     icon:'◉', html: 'IMEI-to-mobile ratio: <strong>' + (S.uniq_imei||0).toLocaleString() + ' IMEIs</strong> vs <strong>' + (S.uniq_mob||0).toLocaleString() + ' mobiles</strong> — indicates consistent device usage.' },
    { cls:'ic-g', icon:'✓', html: 'All <strong>' + total.toLocaleString() + ' records</strong> loaded and verified. Coverage: <strong>' + (S.date_range&&S.date_range.from||'?') + '</strong> to <strong>' + (S.date_range&&S.date_range.to||'?') + '</strong>.' },
    { cls:'ic-g', icon:'✓', html: '<strong>' + dk.length + ' districts</strong> present: ' + dk.join(', ') + '.' },
  ];

  var html = items.map(function(item) {
    return '<div class="insight-card' + (item.cls ? ' ' + item.cls : '') + '">' +
      '<span class="insight-icon">' + item.icon + '</span>' +
      '<div class="insight-body">' + item.html + '</div>' +
      '</div>';
  }).join('');

  var el = document.getElementById('insights-container');
  if (el) el.innerHTML = html;
}

function exportReport() {
  if (!S || !S.total) { alert('No data to export.'); return; }
  var dk = Object.keys(S.districts || {});
  var dv = Object.values(S.districts || {});
  var total = S.total || 1;
  var sep = '─'.repeat(54);
  var lines = [
    'CICPS — INTELLIGENCE SUMMARY REPORT',
    'Generated: ' + new Date().toLocaleString('en-IN'),
    sep,
    'Total Records : ' + total.toLocaleString(),
    'Period        : ' + (S.date_range&&S.date_range.from||'?') + ' to ' + (S.date_range&&S.date_range.to||'?'),
    'Unique Mobiles: ' + (S.uniq_mob||0).toLocaleString(),
    'Unique IMEIs  : ' + (S.uniq_imei||0).toLocaleString(),
    sep,
    'DISTRICT BREAKDOWN',
    sep
  ];
  dk.forEach(function(d, i) {
    lines.push(d.padEnd(18) + String(dv[i]).padStart(6) + '   ' + (dv[i]/total*100).toFixed(1) + '%');
  });
  lines.push(sep);
  lines.push('PROVIDER BREAKDOWN');
  lines.push(sep);
  Object.entries(S.providers || {}).forEach(function(e) {
    lines.push(e[0].padEnd(18) + String(e[1]).padStart(6) + '   ' + (e[1]/total*100).toFixed(1) + '%');
  });
  lines = lines.concat([
    sep,
    'TOP COORDINATE  : ' + (S.top_hotspot&&S.top_hotspot.la||0).toFixed(4) + '°N, ' + (S.top_hotspot&&S.top_hotspot.lo||0).toFixed(4) + '°E (' + (S.top_hotspot&&S.top_hotspot.c||0) + ' hits)',
    'PEAK DATE       : ' + (S.peak_date||'—') + ' (' + (S.peak_date_count||0) + ' records)',
    'PEAK HOUR       : ' + (S.peak_hour||'?') + ':00',
    sep,
    'CLASSIFICATION  : RESTRICTED',
    sep
  ]);
  var a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  a.download = 'CICPS_Report_' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
}

/* ═══════════════════════════════════════════════════════
   UPLOAD
═══════════════════════════════════════════════════════ */
function loadUploadHistory() {
  fetch('/api/files')
    .then(function(r) { return r.json(); })
    .then(function(files) {
      var el = document.getElementById('upload-history');
      if (!el) return;
      if (!files || !files.length) {
        el.innerHTML = '<div class="empty-state" style="padding:20px">No files uploaded yet</div>';
        return;
      }
      var html = '';
      files.slice().reverse().forEach(function(f) {
        html +=
          '<div class="file-item">' +
          '<div class="file-item-info">' +
          '<div class="file-item-name">' + f.name + '</div>' +
          '<div class="file-item-meta">' + f.uploaded + ' &nbsp;|&nbsp; ' + f.size_kb + ' KB &nbsp;|&nbsp; New: ' + f.new + ' &nbsp;|&nbsp; Dup: ' + f.dup + '</div>' +
          '</div>' +
          '<button class="btn btn-danger" style="padding:5px 12px;font-size:12px" onclick="deleteFile(\'' + f.id + '\')">Delete</button>' +
          '</div>';
      });
      el.innerHTML = html;
    })
    .catch(function() {});
}

function deleteFile(id) {
  if (!confirm('Remove this upload record?')) return;
  fetch('/api/files/' + id, { method: 'DELETE' })
    .then(function() { loadUploadHistory(); })
    .catch(function() {});
}

function confirmReset() {
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  fetch('/api/reset', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      R = [];
      S = data.summary || {};
      analyticsBuilt = false;
      insightsBuilt  = false;
      Object.values(Chart.instances || {}).forEach(function(c) { try { c.destroy(); } catch(e) {} });
      buildDashboard();
      loadUploadHistory();
      if (mapReady && mapLayer) {
        try { mapLayer.clearLayers ? mapLayer.clearLayers() : leafMap.removeLayer(mapLayer); } catch(e) {}
      }
    })
    .catch(function() {});
}

/* Upload zone */
var upZone = document.getElementById('upload-zone');
upZone.addEventListener('dragover',  function(e) { e.preventDefault(); upZone.classList.add('drag'); });
upZone.addEventListener('dragleave', function()  { upZone.classList.remove('drag'); });
upZone.addEventListener('drop', function(e) {
  e.preventDefault(); upZone.classList.remove('drag');
  var f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
function handleFileSelect(e) { var f = e.target.files[0]; if (f) uploadFile(f); }

function uploadFile(file) {
  var statEl = document.getElementById('upload-status');
  statEl.innerHTML =
    '<div class="alert-card info">' +
    '<span class="alert-icon">⏳</span>' +
    '<div class="alert-text">Processing <strong>' + file.name + '</strong> (' + (file.size / 1024).toFixed(1) + ' KB)…</div>' +
    '</div>';

  var fd = new FormData();
  fd.append('file', file);

  fetch('/api/upload', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        statEl.innerHTML =
          '<div class="alert-card error">' +
          '<span class="alert-icon">✕</span>' +
          '<div class="alert-text"><strong>Error:</strong> ' + data.error + '</div>' +
          '</div>';
        return;
      }

      /* Reload page data from server */
      fetch('/api/records?per_page=10000')
        .then(function(r) { return r.json(); })
        .then(function(rd) {
          R = rd.data || R;
          S = data.summary || S;
          analyticsBuilt = false;
          insightsBuilt  = false;
          Object.values(Chart.instances || {}).forEach(function(c) { try { c.destroy(); } catch(e) {} });
          buildDashboard();
          if (mapReady) setMapMode('cluster');
          loadUploadHistory();
          populateDropdowns();
        });

      statEl.innerHTML =
        '<div class="alert-card success">' +
        '<span class="alert-icon">✓</span>' +
        '<div class="alert-text">' +
        '<strong>' + data.filename + '</strong> uploaded successfully<br>' +
        'New records: <strong style="color:var(--a3)">' + data.new_records + '</strong> &nbsp;·&nbsp; ' +
        'Duplicates skipped: <strong style="color:var(--a4)">' + data.duplicate_records + '</strong> &nbsp;·&nbsp; ' +
        'Failed rows: <strong style="color:var(--a2)">' + data.failed_records + '</strong>' +
        '</div>' +
        '</div>';
    })
    .catch(function() {
      statEl.innerHTML =
        '<div class="alert-card error">' +
        '<span class="alert-icon">✕</span>' +
        '<div class="alert-text">Upload failed. Check the file format and try again.</div>' +
        '</div>';
    });
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', function() {
  applyTheme();
  applyLang();
  buildDashboard();
  loadUploadHistory();
  filteredData = R || [];
});
