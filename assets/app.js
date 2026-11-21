/* 현실판 Paper.io — 걸어서 땅따먹기
 * GPS로 이동하며 내 영역을 넓히는 지도 게임 (Leaflet + Turf.js, 빌드 없음)
 */
(function () {
  'use strict';

  var turf = window.turf;
  var Lmap = window.L;

  var STORE_KEY = 'realpaperio.v1';
  var DEFAULT_CENTER = { lat: 37.3185, lng: 127.1099 }; // 보정동(용인) 기본 좌표
  var HOME_RADIUS_M = 35;
  var ZOOM_DEFAULT = 18;
  var TEST_SPEED = 2.6; // 테스트 패드 이동 속도 m/s
  var GPS_MAX_ACC = 45; // m — 이보다 부정확한 측정은 궤적에 반영하지 않음
  var GPS_MIN_MOVE = 1.2; // m
  var TEST_MIN_MOVE = 0.8; // m
  var MIN_CAPTURE_M2 = 1.5;
  var MAX_TRAIL_POINTS = 2000;

  // ---------------------------------------------------------------- helpers
  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function dist(a, b) {
    if (!a || !b) return 0;
    try {
      return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'kilometers' }) * 1000;
    } catch (e) {
      return 0;
    }
  }

  function areaOf(f) {
    if (!f) return 0;
    try {
      var a = turf.area(f);
      return isFinite(a) ? a : 0;
    } catch (e) {
      return 0;
    }
  }

  function fmtArea(m2) {
    if (!isFinite(m2) || m2 <= 0) return '0 m²';
    if (m2 >= 1000000) return (m2 / 1000000).toFixed(2) + ' km²';
    if (m2 >= 1000) return Math.round(m2).toLocaleString('ko-KR') + ' m²';
    if (m2 >= 100) return Math.round(m2) + ' m²';
    return m2.toFixed(1) + ' m²';
  }

  function haptic(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch (e) {}
  }

  // ---------------------------------------------------------------- state
  var S = {
    territory: null,
    home: null,
    stats: { area: 0, captures: 0 },
    mode: 'gps',
    player: null,
    lastInside: null,
    insideStreak: 0,
    follow: true,
    trail: [],
    trailActive: false,
    trailDistance: 0,
    walkTarget: null,
    watchId: null,
    raf: null,
    lastT: 0,
    dpad: { x: 0, y: 0 },
    helpShown: false,
    farHintShown: false
  };

  var map = null;
  var territoryLayer = null;
  var trailGlow = null;
  var trailLine = null;
  var previewPoly = null;
  var playerMarker = null;
  var targetMarker = null;

  var playerIcon = null;
  var targetIcon = null;

  // ---------------------------------------------------------------- geometry
  function makeBase(c) {
    return turf.circle([c.lng, c.lat], HOME_RADIUS_M / 1000, {
      steps: 72,
      units: 'kilometers'
    });
  }

  function centroidOf(f) {
    try {
      var c = turf.centroid(f).geometry.coordinates;
      return { lat: c[1], lng: c[0] };
    } catch (e) {
      return { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
    }
  }

  function pointInTerritory(p) {
    if (!S.territory || !p) return false;
    try {
      var pt = turf.point([p.lng, p.lat]);
      var g = S.territory.geometry;
      if (!g) return false;
      if (g.type === 'MultiPolygon') {
        for (var i = 0; i < g.coordinates.length; i++) {
          try {
            if (turf.booleanPointInPolygon(pt, turf.polygon(g.coordinates[i]))) return true;
          } catch (e) {}
        }
        return false;
      }
      return turf.booleanPointInPolygon(pt, S.territory);
    } catch (e) {
      return false;
    }
  }

  function unionTwo(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    var r;
    try {
      r = turf.union(a, b);
      if (r && r.geometry) return r;
    } catch (e) {}
    try {
      r = turf.union(turf.featureCollection([a, b]));
      if (r && r.geometry) return r;
    } catch (e) {}
    return null;
  }

  function boundsOf(coords) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i];
      if (c[0] < b[0]) b[0] = c[0];
      if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0];
      if (c[1] > b[3]) b[3] = c[1];
    }
    return b;
  }

  function bboxAreaM2(b) {
    var midLat = (b[1] + b[3]) / 2;
    var w = Math.abs((b[2] - b[0]) * 111320 * Math.cos((midLat * Math.PI) / 180));
    var h = Math.abs((b[3] - b[1]) * 111320);
    return w * h;
  }

  function safeUnion(base, add, before, capLimit) {
    var out = unionTwo(base, add);
    if (!out || !out.geometry) return null;
    var t = out.geometry.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon') return null;
    var after = areaOf(out);
    if (!isFinite(after) || after <= 0) return null;
    var gain = after - before;
    if (gain < -0.5) return null; // 합쳤는데 줄어들면 실패로 본다
    if (gain > capLimit) return null; // 비정상적으로 큰 점령 방지
    return { feature: out, area: after };
  }

  // 궤적 점들로 점령 영역을 만든다. 자기 교차 궤적에서도 실패하지 않도록 단계별 대체 경로 사용.
  function buildCapture(pts) {
    if (!S.territory || !pts || pts.length < 3) return null;

    var coords = [];
    for (var i = 0; i < pts.length; i++) {
      var c = [pts[i].lng, pts[i].lat];
      var prev = coords[coords.length - 1];
      if (!prev || Math.abs(prev[0] - c[0]) > 1e-9 || Math.abs(prev[1] - c[1]) > 1e-9) {
        coords.push(c);
      }
    }
    if (coords.length > 3) {
      try {
        var simp = turf.simplify(turf.lineString(coords), {
          tolerance: 0.000012,
          highQuality: false,
          mutate: false
        });
        if (simp && simp.geometry.coordinates.length >= 3) coords = simp.geometry.coordinates;
      } catch (e) {}
    }
    if (coords.length < 3) return null;

    var bbox = boundsOf(coords);
    var capLimit = Math.max(bboxAreaM2(bbox) * 2, 3000);
    var before = areaOf(S.territory);

    // 1) 궤적을 그대로 닫은 다각형 + 기존 영역
    var ring = coords.slice();
    var first = ring[0];
    var last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
      ring.push([first[0], first[1]]);
    }
    if (ring.length >= 4) {
      var loop = null;
      try {
        loop = turf.polygon([ring]);
      } catch (e) {
        loop = null;
      }
      if (loop) {
        var r1 = safeUnion(S.territory, loop, before, capLimit);
        if (r1) return r1;
      }
    }

    // 2) 궤적을 얇은 띠로 만들어 합치기 (자기 교차 궤적도 안전)
    var r2 = null;
    try {
      var ribbon = turf.buffer(turf.lineString(coords), 0.0015, {
        units: 'kilometers',
        steps: 6
      });
      if (ribbon) r2 = safeUnion(S.territory, ribbon, before, capLimit);
    } catch (e) {
      r2 = null;
    }
    if (r2) return r2;

    // 3) 마지막 수단: 뾰족한 삼각형 점령을 막기 위해 궤적 볼록 껍질을 아주 낮은 비중으로 사용하지 않고 포기
    return null;
  }

  // ---------------------------------------------------------------- render
  function renderTerritory() {
    if (!territoryLayer) return;
    territoryLayer.clearLayers();
    if (!S.territory) return;
    try {
      Lmap.geoJSON(S.territory, {
        interactive: false,
        style: function () {
          return { color: '#22d3ee', weight: 14, opacity: 0.1, fill: false, lineJoin: 'round' };
        }
      }).addTo(territoryLayer);
      Lmap.geoJSON(S.territory, {
        interactive: false,
        style: function () {
          return {
            color: '#3ee9ff',
            weight: 2.5,
            opacity: 0.95,
            fillColor: '#22d3ee',
            fillOpacity: 0.18,
            lineJoin: 'round'
          };
        }
      }).addTo(territoryLayer);
    } catch (e) {}
  }

  function updateStats() {
    var a = $('statArea');
    var c = $('statCount');
    if (a) a.textContent = fmtArea(S.stats.area);
    if (c) c.textContent = String(S.stats.captures);
  }

  function trailLatLngs() {
    var out = [];
    for (var i = 0; i < S.trail.length; i++) {
      out.push([S.trail[i].lat, S.trail[i].lng]);
    }
    if (S.trailActive && S.player) {
      var p = [S.player.lat, S.player.lng];
      var last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    return out;
  }

  function drawTrail() {
    if (!trailGlow) return;
    var pts = trailLatLngs();
    trailGlow.setLatLngs(pts);
    trailLine.setLatLngs(pts);
    if (pts.length >= 3) {
      try {
        previewPoly.setLatLngs(pts);
      } catch (e) {
        previewPoly.setLatLngs([]);
      }
    } else {
      previewPoly.setLatLngs([]);
    }
  }

  function clearTrail() {
    S.trailActive = false;
    S.trail = [];
    S.trailDistance = 0;
    S.insideStreak = 0;
    if (trailGlow) trailGlow.setLatLngs([]);
    if (trailLine) trailLine.setLatLngs([]);
    if (previewPoly) previewPoly.setLatLngs([]);
  }

  // ---------------------------------------------------------------- toast / celebrate
  var toastTimer = null;

  function toast(msg, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, ms || 2400);
  }

  function celebrate(gain) {
    var el = $('celebrate');
    if (!el) return;
    el.innerHTML =
      '<div class="big">+' + fmtArea(gain) + '</div><div class="sub">점령 성공!</div>';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove('show');
    }, 1750);
  }

  // ---------------------------------------------------------------- persistence
  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          v: 1,
          territory: S.territory,
          home: S.home,
          stats: { area: S.stats.area, captures: S.stats.captures },
          mode: S.mode,
          helpShown: S.helpShown,
          savedAt: Date.now()
        })
      );
    } catch (e) {}
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      if (
        d.territory &&
        d.territory.geometry &&
        (d.territory.geometry.type === 'Polygon' || d.territory.geometry.type === 'MultiPolygon')
      ) {
        S.territory = d.territory;
      }
      if (d.home && isFinite(d.home.lat) && isFinite(d.home.lng)) {
        S.home = { lat: d.home.lat, lng: d.home.lng };
      }
      if (S.territory) S.stats.area = areaOf(S.territory);
      S.stats.captures = d.stats && isFinite(d.stats.captures) ? d.stats.captures : 0;
      S.mode = d.mode === 'test' ? 'test' : 'gps';
      S.helpShown = !!d.helpShown;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- base / reset
  function ensureBase(c) {
    S.home = { lat: c.lat, lng: c.lng };
    S.territory = makeBase(c);
    S.stats.area = areaOf(S.territory);
    renderTerritory();
    updateStats();
    save();
  }

  function doReset() {
    var c = S.player
      ? { lat: S.player.lat, lng: S.player.lng }
      : S.home || { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng };
    clearTrail();
    clearWalkTarget();
    S.territory = makeBase(c);
    S.home = { lat: c.lat, lng: c.lng };
    S.stats = { area: areaOf(S.territory), captures: 0 };
    S.lastInside = { lat: c.lat, lng: c.lng };
    renderTerritory();
    updateStats();
    save();
    if (map) map.setView([c.lat, c.lng], Math.max(map.getZoom(), 17));
    toast('새 기지를 만들었어요', 2200);
  }

  // ---------------------------------------------------------------- capture flow
  function beginTrail(p) {
    S.trailActive = true;
    S.trailDistance = 0;
    S.insideStreak = 0;
    S.trail = [];
    var start = S.lastInside;
    // 오래 전 위치에서 시작하면 지도에 긴 선이 그려지므로 가까운 경우에만 연결
    if (start && dist(start, p) <= 120) S.trail.push({ lat: start.lat, lng: start.lng });
    S.trail.push({ lat: p.lat, lng: p.lng });
    drawTrail();
    haptic(8);
  }

  function simplifyTrail() {
    try {
      var line = turf.lineString(
        S.trail.map(function (p) {
          return [p.lng, p.lat];
        })
      );
      var simp = turf.simplify(line, { tolerance: 0.00002, highQuality: false, mutate: false });
      S.trail = simp.geometry.coordinates.map(function (c) {
        return { lat: c[1], lng: c[0] };
      });
    } catch (e) {}
  }

  function closeLoop(entry) {
    var pts = S.trail.slice();
    pts.push({ lat: entry.lat, lng: entry.lng });
    var before = areaOf(S.territory);
    var result = buildCapture(pts);
    clearTrail();
    S.lastInside = { lat: entry.lat, lng: entry.lng };

    if (!result) {
      toast('궤적을 알아보지 못했어요. 더 크게 돌아보세요', 2600);
      return;
    }
    var gain = result.area - before;
    if (gain < MIN_CAPTURE_M2) {
      toast('조금만 더 넓게 돌아보세요', 2200);
      return;
    }
    S.territory = result.feature;
    S.stats.area = areaOf(S.territory);
    S.stats.captures += 1;
    renderTerritory();
    updateStats();
    save();
    celebrate(gain);
    haptic([14, 45, 20]);
  }

  function advanceTrail(p, inside, isTest) {
    var minMove = isTest ? TEST_MIN_MOVE : GPS_MIN_MOVE;
    var head = S.trail[S.trail.length - 1];
    var d = head ? dist(head, p) : 0;
    if (d >= minMove) {
      S.trail.push({ lat: p.lat, lng: p.lng });
      S.trailDistance += d;
      if (S.trail.length > MAX_TRAIL_POINTS) simplifyTrail();
    }

    if (inside) {
      S.insideStreak += 1;
      var needStreak = isTest ? 1 : 2;
      var minDist = isTest ? 4 : 8;
      if (S.insideStreak >= needStreak) {
        if (S.trailDistance >= minDist && S.trail.length >= 3) {
          closeLoop(p);
          return;
        }
        if (S.trailDistance < minDist) {
          clearTrail();
          S.lastInside = { lat: p.lat, lng: p.lng };
          toast('영역 밖으로 조금 더 나가 보세요', 2000);
          return;
        }
      }
    } else {
      S.insideStreak = 0;
    }
    drawTrail();
  }

  function setPlayer(p, opts) {
    opts = opts || {};
    var prev = S.player;
    S.player = { lat: p.lat, lng: p.lng, acc: p.acc || 0 };

    if (!playerMarker) {
      playerMarker = Lmap.marker([p.lat, p.lng], {
        icon: playerIcon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 900
      }).addTo(map);
    } else {
      playerMarker.setLatLng([p.lat, p.lng]);
    }

    if (map && S.follow) {
      if (!prev) {
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
      } else if (typeof map.panInside === 'function') {
        map.panInside(Lmap.latLng(p.lat, p.lng), {
          padding: [70, 70],
          animate: true,
          duration: 0.4
        });
      }
    }

    if (!S.territory) {
      ensureBase({ lat: p.lat, lng: p.lng });
      S.lastInside = { lat: p.lat, lng: p.lng };
      return;
    }

    var inside = pointInTerritory(S.player);

    // 영역에서 아주 멀리 떨어져 있으면 궤적을 만들지 않고 안내만 한다
    if (!inside && S.lastInside && dist(S.lastInside, p) > 250) {
      if (S.trailActive) clearTrail();
      if (!S.farHintShown) {
        S.farHintShown = true;
        toast('내 영역에서 멀리 있어요 · 초기화로 지금 위치에 새 기지를 만들 수 있어요', 4200);
      }
      return;
    }
    if (inside) S.farHintShown = false;

    if (S.trailActive) {
      advanceTrail(S.player, inside, !!opts.test);
    } else if (!inside) {
      beginTrail(S.player);
    } else {
      S.lastInside = { lat: p.lat, lng: p.lng };
    }
  }

  // ---------------------------------------------------------------- test walking
  function moveByMeters(dx, dy) {
    if (!S.player) return;
    var lat = S.player.lat + dy / 111320;
    var lng =
      S.player.lng + dx / (111320 * Math.cos((S.player.lat * Math.PI) / 180) || 1);
    setPlayer({ lat: lat, lng: lng, acc: 0 }, { test: true });
  }

  function stepToward(target, metersStep) {
    if (!S.player || !target) return;
    var d = dist(S.player, target);
    if (d < 0.02) {
      setPlayer({ lat: target.lat, lng: target.lng, acc: 0 }, { test: true });
      return;
    }
    var f = Math.min(1, metersStep / d);
    setPlayer(
      {
        lat: S.player.lat + (target.lat - S.player.lat) * f,
        lng: S.player.lng + (target.lng - S.player.lng) * f,
        acc: 0
      },
      { test: true }
    );
  }

  function ensureWalkLoop() {
    if (S.raf != null) return;
    S.lastT = performance.now();
    S.raf = requestAnimationFrame(walkTick);
  }

  function walkTick(t) {
    S.raf = null;
    var dt = clamp((t - S.lastT) / 1000, 0, 0.08);
    S.lastT = t;
    if (S.mode !== 'test' || !S.player) return;

    var vx = S.dpad.x;
    var vy = S.dpad.y;
    if (vx || vy) {
      var len = Math.sqrt(vx * vx + vy * vy) || 1;
      clearWalkTarget();
      moveByMeters((vx / len) * TEST_SPEED * dt, (vy / len) * TEST_SPEED * dt);
      ensureWalkLoop();
      return;
    }
    if (S.walkTarget) {
      var d = dist(S.player, S.walkTarget);
      if (d <= 0.6) {
        clearWalkTarget();
        return;
      }
      stepToward(S.walkTarget, Math.min(TEST_SPEED * dt, d));
      ensureWalkLoop();
    }
  }

  function setWalkTarget(latlng) {
    S.walkTarget = { lat: latlng.lat, lng: latlng.lng };
    if (!targetMarker) {
      targetMarker = Lmap.marker([latlng.lat, latlng.lng], {
        icon: targetIcon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 850
      }).addTo(map);
    } else {
      targetMarker.setLatLng([latlng.lat, latlng.lng]);
    }
    S.dpad.x = 0;
    S.dpad.y = 0;
    setPadActive(null);
    ensureWalkLoop();
  }

  function clearWalkTarget() {
    S.walkTarget = null;
    if (targetMarker) {
      map.removeLayer(targetMarker);
      targetMarker = null;
    }
  }

  var padActiveEl = null;

  function setPadActive(el) {
    if (padActiveEl && padActiveEl !== el) padActiveEl.classList.remove('active');
    padActiveEl = el;
    if (el) el.classList.add('active');
  }

  // ---------------------------------------------------------------- gps
  function updateAccChip(acc) {
    var el = $('accChip');
    if (!el) return;
    if (!isFinite(acc) || acc <= 0) {
      el.hidden = true;
      return;
    }
    var v = $('accVal');
    if (v) v.textContent = Math.round(acc);
    el.hidden = acc <= 18;
    el.classList.toggle('warn', acc > 35);
  }

  function onFix(pos) {
    var c = pos.coords;
    var acc = isFinite(c.accuracy) ? c.accuracy : 60;
    updateAccChip(acc);
    var raw = { lat: c.latitude, lng: c.longitude };

    if (!S.player) {
      S.follow = true;
      setPlayer({ lat: raw.lat, lng: raw.lng, acc: acc }, { test: false });
      return;
    }
    if (S.mode !== 'gps') return;
    if (acc > GPS_MAX_ACC) return;
    var d = dist(S.player, raw);
    if (d < GPS_MIN_MOVE) return;
    var alpha = acc <= 12 ? 0.8 : acc <= 25 ? 0.5 : 0.3;
    setPlayer(
      {
        lat: S.player.lat + (raw.lat - S.player.lat) * alpha,
        lng: S.player.lng + (raw.lng - S.player.lng) * alpha,
        acc: acc
      },
      { test: false }
    );
  }

  function onGeoError(err) {
    if (S.mode !== 'gps') return;
    if (err && err.code === 1) {
      toast('위치 권한이 꺼져 있어요 · 테스트 패드로도 놀 수 있어요', 4200);
    } else {
      toast('위치를 확인하는 중이에요…', 2600);
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      toast('이 브라우저에서는 GPS를 쓸 수 없어요', 3000);
      return;
    }
    if (S.watchId != null) return;
    try {
      S.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
      });
    } catch (e) {
      toast('GPS를 시작하지 못했어요', 3000);
    }
  }

  function stopGps() {
    if (S.watchId != null) {
      try {
        navigator.geolocation.clearWatch(S.watchId);
      } catch (e) {}
      S.watchId = null;
    }
  }

  // ---------------------------------------------------------------- mode / ui
  function updateModeUi() {
    var btn = $('modeBtn');
    var label = $('modeLabel');
    var dpad = $('dpad');
    var isTest = S.mode === 'test';
    if (label) label.textContent = isTest ? '테스트 패드' : 'GPS 모드';
    if (btn) {
      btn.classList.toggle('test', isTest);
      btn.setAttribute('aria-pressed', isTest ? 'true' : 'false');
    }
    if (dpad) dpad.hidden = !isTest;
  }

  function setMode(next, opts) {
    opts = opts || {};
    if (next === S.mode && !opts.force) {
      updateModeUi();
      return;
    }
    S.mode = next;
    if (next === 'gps') {
      setPadActive(null);
      S.dpad.x = 0;
      S.dpad.y = 0;
      clearWalkTarget();
      startGps();
      toast('GPS 모드 · 실제 위치로 이동해요', 2400);
    } else {
      stopGps();
      clearWalkTarget();
      if (!S.player) {
        var c = S.home || (S.territory ? centroidOf(S.territory) : DEFAULT_CENTER);
        S.follow = true;
        setPlayer({ lat: c.lat, lng: c.lng, acc: 0 }, { test: true });
        if (map) map.setView([c.lat, c.lng], ZOOM_DEFAULT);
      }
      toast('테스트 패드 · 지도를 눌러 이동해 보세요', 3200);
    }
    updateModeUi();
    save();
  }

  function showSheet(id) {
    var el = $(id);
    if (el) el.hidden = false;
  }

  function hideSheet(id) {
    var el = $(id);
    if (el) el.hidden = true;
  }

  // ---------------------------------------------------------------- init
  function initDpad() {
    var pad = $('dpad');
    if (!pad) return;

    function release() {
      if (!S.dpad.x && !S.dpad.y) {
        setPadActive(null);
        return;
      }
      S.dpad.x = 0;
      S.dpad.y = 0;
      setPadActive(null);
    }

    pad.addEventListener('pointerdown', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.pad-btn') : null;
      if (!btn) return;
      ev.preventDefault();
      if (btn.id === 'padStop') {
        release();
        clearWalkTarget();
        return;
      }
      var dx = parseFloat(btn.getAttribute('data-dx'));
      var dy = parseFloat(btn.getAttribute('data-dy'));
      if (!isFinite(dx) || !isFinite(dy)) return;
      S.dpad.x = dx;
      S.dpad.y = dy;
      setPadActive(btn);
      if (S.walkTarget) clearWalkTarget();
      ensureWalkLoop();
      try {
        btn.setPointerCapture(ev.pointerId);
      } catch (e) {}
    });

    pad.addEventListener('lostpointercapture', release);
    pad.addEventListener('pointercancel', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', release);
  }

  function onMapClick(e) {
    if (S.mode !== 'test') return;
    if (!S.player) return;
    setWalkTarget(e.latlng);
  }

  function bindUi() {
    var modeBtn = $('modeBtn');
    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        setMode(S.mode === 'gps' ? 'test' : 'gps');
      });
    }

    var locateBtn = $('locateBtn');
    if (locateBtn) {
      locateBtn.addEventListener('click', function () {
        S.follow = true;
        if (S.player && map) {
          map.setView([S.player.lat, S.player.lng], Math.max(map.getZoom(), 17));
        } else {
          toast('위치를 아직 찾지 못했어요', 2200);
        }
        haptic(6);
      });
    }

    var resetBtn = $('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        showSheet('resetSheet');
      });
    }
    var resetCancel = $('resetCancel');
    if (resetCancel) {
      resetCancel.addEventListener('click', function () {
        hideSheet('resetSheet');
      });
    }
    var resetConfirm = $('resetConfirm');
    if (resetConfirm) {
      resetConfirm.addEventListener('click', function () {
        hideSheet('resetSheet');
        doReset();
      });
    }
    var helpClose = $('helpClose');
    if (helpClose) {
      helpClose.addEventListener('click', function () {
        hideSheet('helpSheet');
        S.helpShown = true;
        save();
      });
    }
  }

  function initMap() {
    map = Lmap.map('map', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 20,
      zoomSnap: 0.5,
      tap: false
    });

    var start = S.home || (S.territory ? centroidOf(S.territory) : DEFAULT_CENTER);
    map.setView([start.lat, start.lng], ZOOM_DEFAULT);

    Lmap.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    Lmap.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    territoryLayer = Lmap.layerGroup().addTo(map);

    previewPoly = Lmap.polygon([], {
      interactive: false,
      color: '#22d3ee',
      weight: 2,
      opacity: 0.55,
      dashArray: '5 7',
      fillColor: '#22d3ee',
      fillOpacity: 0.12
    }).addTo(map);

    trailGlow = Lmap.polyline([], {
      interactive: false,
      color: '#22d3ee',
      weight: 16,
      opacity: 0.16,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    trailLine = Lmap.polyline([], {
      interactive: false,
      color: '#9df5ff',
      weight: 4,
      opacity: 1,
      dashArray: '9 9',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    map.on('dragstart', function () {
      S.follow = false;
    });
    map.on('click', onMapClick);

    playerIcon = Lmap.divIcon({
      className: 'player-icon',
      html: '<div class="me"><span class="me-pulse"></span><span class="me-dot"></span></div>',
      iconSize: [46, 46],
      iconAnchor: [23, 23]
    });

    targetIcon = Lmap.divIcon({
      className: 'target-icon',
      html: '<div class="target"></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function boot() {
    if (!Lmap || !turf) {
      var m = $('map');
      if (m) {
        m.innerHTML =
          '<div style="padding:24px;font:600 14px/1.6 -apple-system,sans-serif;color:#eaf2ff">' +
          '지도 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.</div>';
      }
      return;
    }

    load();
    initMap();
    renderTerritory();
    updateStats();
    updateModeUi();
    initDpad();
    bindUi();

    if (S.home) S.lastInside = { lat: S.home.lat, lng: S.home.lng };

    if (S.mode === 'test') {
      var c =
        S.player || S.home || (S.territory ? centroidOf(S.territory) : DEFAULT_CENTER);
      S.follow = true;
      setPlayer({ lat: c.lat, lng: c.lng, acc: 0 }, { test: true });
      map.setView([c.lat, c.lng], ZOOM_DEFAULT);
    } else {
      startGps();
    }

    if (!S.helpShown) showSheet('helpSheet');

    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') save();
    });

    if (/(\?|&)debug=1/.test(window.location.search)) {
      window.geoDebug = {
        state: function () {
          return {
            territory: S.territory,
            stats: S.stats,
            mode: S.mode,
            player: S.player,
            trailActive: S.trailActive,
            trailLen: S.trail.length,
            trailDistance: S.trailDistance
          };
        },
        tp: function (lat, lng) {
          setPlayer({ lat: lat, lng: lng, acc: 0 }, { test: true });
          return S.stats;
        },
        path: function (pts) {
          for (var i = 0; i < pts.length - 1; i++) {
            var a = { lat: pts[i][0], lng: pts[i][1] };
            var b = { lat: pts[i + 1][0], lng: pts[i + 1][1] };
            var d = dist(a, b);
            var n = Math.max(1, Math.ceil(d / 1.5));
            for (var k = 1; k <= n; k++) {
              var f = k / n;
              setPlayer(
                {
                  lat: a.lat + (b.lat - a.lat) * f,
                  lng: a.lng + (b.lng - a.lng) * f,
                  acc: 0
                },
                { test: true }
              );
            }
          }
          return { area: S.stats.area, captures: S.stats.captures };
        },
        mode: function (m) {
          setMode(m, { force: true });
        },
        reset: doReset,
        closeHelp: function () {
          hideSheet('helpSheet');
          S.helpShown = true;
          save();
        }
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
