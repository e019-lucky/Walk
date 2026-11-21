/* ⚽ 폴란드볼 고 — 칸 점령 땅따먹기
 * 지도 칸을 콕 눌러 점령하는 위치 기반 게임 (Leaflet, 빌드 없음)
 */
(function () {
  'use strict';

  var Lm = window.L;
  if (!Lm) {
    var bf = document.getElementById('bootFail');
    if (bf) bf.hidden = false;
    return;
  }

  // ---------------------------------------------------------------- 상수
  var STORE_KEY = 'walk_polandball_v1';

  var CELL_M = 80; // 머케이터 기준 칸 크기 (위도 37.5° ≈ 63m)
  var CAPTURE_RANGE_M = 200; // 점령 가능 반경
  var START_COINS = 10;
  var COIN_STEP_M = 40; // 40m 이동 = 코인 1
  var PASSIVE_MS = 30000; // 코인 자동 회복 주기
  var PASSIVE_MAX = 10; // 코인이 이 값보다 적을 때만 회복
  var DROP_VALUE = 2;
  var DROP_MAX = 4;
  var DROP_SPAWN_MS = 5500;
  var DROP_LIFE_MS = 150000;
  var DROP_PICK_M = 30;
  var DROP_SPAWN_MAX_M = 170;
  var TEST_SPEED = 3.6; // m/s (D-pad)
  var WALK_SPEED = 9; // m/s (탭 이동)
  var DEFAULT_ZOOM = 16;
  var DEFAULT_CENTER = { lat: 37.3185, lng: 127.1099 }; // 보정동(용인)
  var MAX_GRID_CELLS = 2600;

  // ---------------------------------------------------------------- 나라볼
  var COUNTRIES = [
    { code: 'KR', name: '대한민국', main: '#2e6be6', dark: '#1b4b9e', alt: '#e0453f' },
    { code: 'PL', name: '폴란드', main: '#e0453f', dark: '#9c2530', alt: '#ffffff' },
    { code: 'US', name: '미국', main: '#4553c4', dark: '#242f80', alt: '#e0453f' },
    { code: 'JP', name: '일본', main: '#e8556e', dark: '#a32c42', alt: '#ffffff' },
    { code: 'GB', name: '영국', main: '#1b3a6b', dark: '#0f2344', alt: '#e0453f' },
    { code: 'DE', name: '독일', main: '#d9a520', dark: '#8f6a0d', alt: '#1b1f27' },
    { code: 'FR', name: '프랑스', main: '#4e8ae0', dark: '#28568f', alt: '#e0453f' }
  ];

  function flagArt(code, c, r) {
    var x = c - r;
    var y = c - r;
    var d = 2 * r;
    var s = '';
    var i;

    if (code === 'KR') {
      s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="#ffffff"/>';
      s += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="#1c4fa8"/>';
      s +=
        '<path d="M ' + (c - r) + ' ' + c +
        ' A ' + r + ' ' + r + ' 0 0 1 ' + (c + r) + ' ' + c +
        ' A ' + (r / 2) + ' ' + (r / 2) + ' 0 0 1 ' + c + ' ' + c +
        ' A ' + (r / 2) + ' ' + (r / 2) + ' 0 0 0 ' + (c - r) + ' ' + c +
        ' Z" fill="#c8102e"/>';
      var angs = [45, 135, 225, 315];
      for (i = 0; i < 4; i++) {
        var a = (angs[i] * Math.PI) / 180;
        var tx = c + Math.cos(a) * r * 0.76;
        var ty = c + Math.sin(a) * r * 0.76;
        s += '<g transform="translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ') rotate(' + angs[i] + ')">';
        for (var k = -1; k <= 1; k++) {
          s +=
            '<rect x="' + (-r * 0.15).toFixed(2) + '" y="' + (k * r * 0.105 - r * 0.021).toFixed(2) +
            '" width="' + (r * 0.3).toFixed(2) + '" height="' + (r * 0.042).toFixed(2) + '" fill="#10151f"/>';
        }
        s += '</g>';
      }
      return s;
    }

    if (code === 'PL') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + d + '" height="' + r + '" fill="#ffffff"/>';
      s += '<rect x="' + x + '" y="' + c + '" width="' + d + '" height="' + r + '" fill="#dc143c"/>';
      return s;
    }

    if (code === 'US') {
      var n = 7;
      var sh = d / n;
      for (i = 0; i < n; i++) {
        s += '<rect x="' + x + '" y="' + (y + i * sh).toFixed(2) + '" width="' + d +
          '" height="' + (sh + 0.5).toFixed(2) + '" fill="' + (i % 2 === 0 ? '#b22234' : '#ffffff') + '"/>';
      }
      s += '<rect x="' + x + '" y="' + y + '" width="' + (d * 0.56).toFixed(2) + '" height="' +
        (sh * 4).toFixed(2) + '" fill="#3c3b6e"/>';
      for (var r0 = 0; r0 < 3; r0++) {
        for (var c0 = 0; c0 < 4; c0++) {
          s += '<circle cx="' + (x + d * 0.1 + c0 * d * 0.12).toFixed(2) + '" cy="' +
            (y + sh * 0.62 + r0 * sh * 1.05).toFixed(2) + '" r="' + (r * 0.045).toFixed(2) +
            '" fill="#ffffff"/>';
        }
      }
      return s;
    }

    if (code === 'JP') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + d + '" height="' + d + '" fill="#ffffff"/>';
      s += '<circle cx="' + c + '" cy="' + c + '" r="' + (r * 0.62).toFixed(2) + '" fill="#bc002d"/>';
      return s;
    }

    if (code === 'GB') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + d + '" height="' + d + '" fill="#012169"/>';
      s += '<path d="M' + x + ' ' + y + ' L' + (x + d) + ' ' + (y + d) + ' M' + (x + d) + ' ' + y +
        ' L' + x + ' ' + (y + d) + '" stroke="#ffffff" stroke-width="' + (r * 0.34).toFixed(2) + '"/>';
      s += '<path d="M' + x + ' ' + y + ' L' + (x + d) + ' ' + (y + d) + ' M' + (x + d) + ' ' + y +
        ' L' + x + ' ' + (y + d) + '" stroke="#c8102e" stroke-width="' + (r * 0.16).toFixed(2) + '"/>';
      s += '<path d="M' + c + ' ' + y + ' V' + (y + d) + ' M' + x + ' ' + c + ' H' + (x + d) +
        '" stroke="#ffffff" stroke-width="' + (r * 0.5).toFixed(2) + '"/>';
      s += '<path d="M' + c + ' ' + y + ' V' + (y + d) + ' M' + x + ' ' + c + ' H' + (x + d) +
        '" stroke="#c8102e" stroke-width="' + (r * 0.3).toFixed(2) + '"/>';
      return s;
    }

    if (code === 'DE') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + d + '" height="' + (d / 3).toFixed(2) + '" fill="#111111"/>';
      s += '<rect x="' + x + '" y="' + (y + d / 3).toFixed(2) + '" width="' + d + '" height="' +
        (d / 3).toFixed(2) + '" fill="#dd0000"/>';
      s += '<rect x="' + x + '" y="' + (y + (2 * d) / 3).toFixed(2) + '" width="' + d + '" height="' +
        (d / 3).toFixed(2) + '" fill="#ffce00"/>';
      return s;
    }

    if (code === 'FR') {
      s += '<rect x="' + x + '" y="' + y + '" width="' + (d / 3).toFixed(2) + '" height="' + d + '" fill="#0055a4"/>';
      s += '<rect x="' + (x + d / 3).toFixed(2) + '" y="' + y + '" width="' + (d / 3).toFixed(2) +
        '" height="' + d + '" fill="#ffffff"/>';
      s += '<rect x="' + (x + (2 * d) / 3).toFixed(2) + '" y="' + y + '" width="' + (d / 3).toFixed(2) +
        '" height="' + d + '" fill="#ef4135"/>';
      return s;
    }

    return '<rect x="' + x + '" y="' + y + '" width="' + d + '" height="' + d + '" fill="#8899aa"/>';
  }

  function eyesArt(c, r) {
    var s = '';
    var ex = r * 0.36;
    var ey = c - r * 0.03;
    var rx = r * 0.2;
    var ry = r * 0.245;
    var pr = r * 0.105;
    var side;
    for (side = -1; side <= 1; side += 2) {
      var x = c + side * ex;
      s += '<ellipse cx="' + x.toFixed(2) + '" cy="' + ey.toFixed(2) + '" rx="' + rx.toFixed(2) +
        '" ry="' + ry.toFixed(2) + '" fill="#ffffff" stroke="#10151f" stroke-width="' + (r * 0.032).toFixed(2) + '"/>';
      s += '<circle cx="' + (x + side * r * 0.02).toFixed(2) + '" cy="' + (ey + r * 0.055).toFixed(2) +
        '" r="' + pr.toFixed(2) + '" fill="#10151f"/>';
      s += '<circle cx="' + (x + side * r * 0.02 - pr * 0.34).toFixed(2) + '" cy="' +
        (ey + r * 0.055 - pr * 0.42).toFixed(2) + '" r="' + (pr * 0.36).toFixed(2) + '" fill="#ffffff"/>';
    }
    s += '<path d="M ' + (c - r * 0.17).toFixed(2) + ' ' + (c + r * 0.33).toFixed(2) +
      ' Q ' + c + ' ' + (c + r * 0.5).toFixed(2) + ' ' + (c + r * 0.17).toFixed(2) + ' ' +
      (c + r * 0.33).toFixed(2) + '" fill="none" stroke="#10151f" stroke-width="' + (r * 0.06).toFixed(2) +
      '" stroke-linecap="round"/>';
    return s;
  }

  function ballSVG(code, uid, size) {
    var s = size || 64;
    var c = s / 2;
    var r = s / 2 - s * 0.03;
    var clip = 'pbclip_' + uid;
    var grad = 'pbgrad_' + uid;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" width="' + s +
      '" height="' + s + '" aria-hidden="true" focusable="false">';
    out += '<defs><clipPath id="' + clip + '"><circle cx="' + c + '" cy="' + c + '" r="' + r + '"/></clipPath>';
    out += '<radialGradient id="' + grad + '" cx="0.34" cy="0.26" r="0.92">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.36"/>' +
      '<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.02"/>' +
      '<stop offset="1" stop-color="#000000" stop-opacity="0.28"/></radialGradient></defs>';
    out += '<g clip-path="url(#' + clip + ')">' + flagArt(code, c, r) + '</g>';
    out += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="url(#' + grad + ')"/>';
    out += eyesArt(c, r);
    out += '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#0c1220" stroke-width="' +
      (s * 0.045).toFixed(2) + '" stroke-linejoin="round"/>';
    out += '</svg>';
    return out;
  }

  // ---------------------------------------------------------------- 유틸
  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function distM(a, b) {
    if (!a || !b) return 0;
    var R = 6371000;
    var la1 = (a.lat * Math.PI) / 180;
    var la2 = (b.lat * Math.PI) / 180;
    var dLa = la2 - la1;
    var dLo = ((b.lng - a.lng) * Math.PI) / 180;
    var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, s))));
  }

  function haptic(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch (e) {}
  }

  function nowMs() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  var CRS = null;

  function cellOf(lat, lng) {
    var p = CRS.project(Lm.latLng(lat, lng));
    var ix = Math.floor(p.x / CELL_M);
    var iy = Math.floor(p.y / CELL_M);
    return { ix: ix, iy: iy, key: ix + '_' + iy };
  }

  function cellLatLng(ix, iy) {
    var ll = CRS.unproject(Lm.point(ix * CELL_M, iy * CELL_M));
    return Lm.latLng(ll.lat, ll.lng);
  }

  function cellCenter(ix, iy) {
    var ll = CRS.unproject(Lm.point((ix + 0.5) * CELL_M, (iy + 0.5) * CELL_M));
    return { lat: ll.lat, lng: ll.lng };
  }

  // ---------------------------------------------------------------- 상태
  var S = {
    cells: {},
    cellCount: 0,
    coins: START_COINS,
    captures: 0,
    coinsEarned: 0,
    walkAccum: 0,
    totalDist: 0,
    country: 'KR',
    mode: 'gps',
    player: { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng },
    lastRecharge: Date.now(),
    drops: [],
    helpShown: false,
    follow: true,
    gpsAcc: 0,
    gpsGot: false
  };

  var map = null;
  var gcanvas = null;
  var gctx = null;
  var fxcanvas = null;
  var fxctx = null;
  var playerMarker = null;
  var targetMarker = null;
  var watchId = null;
  var suppress = false;
  var walkTarget = null;
  var dpad = { x: 0, y: 0 };
  var bursts = [];
  var fxDirty = false;
  var drawQueued = false;
  var lastPan = 0;
  var lastSave = 0;
  var lastTick = 0;

  function country() {
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].code === S.country) return COUNTRIES[i];
    }
    return COUNTRIES[0];
  }

  // ---------------------------------------------------------------- 저장
  function save() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          v: 1,
          cells: S.cells,
          coins: S.coins,
          captures: S.captures,
          coinsEarned: S.coinsEarned,
          walkAccum: S.walkAccum,
          totalDist: Math.round(S.totalDist),
          country: S.country,
          mode: S.mode,
          player: S.player,
          helpShown: S.helpShown,
          savedAt: Date.now()
        })
      );
    } catch (e) {}
  }

  function load() {
    var d = null;
    try {
      d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      d = null;
    }
    if (!d || d.v !== 1) return;

    if (d.cells && typeof d.cells === 'object') {
      var cells = {};
      var n = 0;
      Object.keys(d.cells).forEach(function (k) {
        if (/^-?\d+_-?\d+$/.test(k)) {
          cells[k] = typeof d.cells[k] === 'number' ? d.cells[k] : 1;
          n++;
        }
      });
      S.cells = cells;
      S.cellCount = n;
    }
    S.coins = isFinite(d.coins) ? clamp(Math.round(d.coins), 0, 9999) : START_COINS;
    S.captures = isFinite(d.captures) ? d.captures : 0;
    S.coinsEarned = isFinite(d.coinsEarned) ? d.coinsEarned : 0;
    S.walkAccum = isFinite(d.walkAccum) ? clamp(d.walkAccum, 0, COIN_STEP_M) : 0;
    S.totalDist = isFinite(d.totalDist) ? d.totalDist : 0;
    if (d.player && isFinite(d.player.lat) && isFinite(d.player.lng)) {
      S.player = { lat: d.player.lat, lng: d.player.lng };
    }
    var ok = false;
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].code === d.country) ok = true;
    }
    S.country = ok ? d.country : 'KR';
    S.mode = d.mode === 'test' ? 'test' : 'gps';
    S.helpShown = !!d.helpShown;
    S.lastRecharge = Date.now();
  }

  // ---------------------------------------------------------------- 지도
  function initMap() {
    CRS = Lm.CRS.EPSG3857;

    map = Lm.map('map', {
      center: [S.player.lat, S.player.lng],
      zoom: DEFAULT_ZOOM,
      minZoom: 13,
      maxZoom: 19,
      zoomControl: false,
      doubleClickZoom: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      attributionControl: true
    });

    Lm.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    gcanvas = Lm.DomUtil.create('canvas', 'wx-canvas');
    gctx = gcanvas.getContext('2d');
    map.getPanes().overlayPane.appendChild(gcanvas);
    fxcanvas = Lm.DomUtil.create('canvas', 'wx-canvas');
    fxctx = fxcanvas.getContext('2d');
    map.getPanes().overlayPane.appendChild(fxcanvas);

    playerMarker = Lm.marker(S.player, {
      icon: makeBallIcon(64),
      interactive: false,
      keyboard: false,
      zIndexOffset: 600
    }).addTo(map);

    map.on('move zoomend resize moveend viewreset', onMapMove);
    map.on('zoomanim', function (e) {
      suppress = true;
      zoomCanvas(gcanvas, e);
      zoomCanvas(fxcanvas, e);
    });
    map.on('zoomend', function () {
      suppress = false;
      if (gcanvas) gcanvas.style.opacity = '1';
      if (fxcanvas) fxcanvas.style.opacity = '1';
      requestDraw();
    });
    map.on('dragstart', function () {
      S.follow = false;
    });
    map.on('click', function (e) {
      onCellTap(cellOf(e.latlng.lat, e.latlng.lng));
    });

    requestDraw();
  }

  function makeBallIcon(size) {
    var s = size || 64;
    return Lm.divIcon({
      className: 'ball-icon',
      html: '<span class="ball-halo"></span>' + ballSVG(S.country, 'mk', s),
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2]
    });
  }

  function makeTargetIcon() {
    return Lm.divIcon({
      className: 'target-icon',
      html: '<span></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function setTargetMarker(p) {
    if (!targetMarker) {
      targetMarker = Lm.marker(p, {
        icon: makeTargetIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 400
      }).addTo(map);
    } else {
      targetMarker.setLatLng(p);
    }
  }

  function clearTargetMarker() {
    if (targetMarker) {
      map.removeLayer(targetMarker);
      targetMarker = null;
    }
  }

  function onMapMove() {
    if (!suppress) requestDraw();
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    window.requestAnimationFrame(function () {
      drawQueued = false;
      drawGrid();
    });
  }

  // ---------------------------------------------------------------- 뷰 계산
  // 칸 격자는 머케이터 미터 좌표에 고정 → 지도를 움직여도 칸이 밀리지 않는다.
  function computeView() {
    if (!map) return null;
    var size = map.getSize();
    if (!size || !size.x || !size.y) return null;
    var center = map.getCenter();
    var cc = cellOf(center.lat, center.lng);

    var base = map.latLngToContainerPoint(cellLatLng(cc.ix, cc.iy));
    var pX = map.latLngToContainerPoint(cellLatLng(cc.ix + 1, cc.iy));
    var pY = map.latLngToContainerPoint(cellLatLng(cc.ix, cc.iy + 1));
    var cw = pX.x - base.x;
    var ch = pY.y - base.y;
    if (!(cw > 0.4) || !(ch < -0.4)) return null;

    var W = size.x;
    var H = size.y;
    var dxFrom = Math.ceil((-cw - base.x) / cw);
    var dxTo = Math.floor((W - base.x) / cw);
    var dyFrom = Math.ceil((H - ch - base.y) / ch);
    var dyTo = Math.floor((0 - base.y) / ch);
    if (dxTo < dxFrom || dyTo < dyFrom) return null;
    if (dxTo - dxFrom > 400 || dyTo - dyFrom > 400) return null;

    return {
      base: base,
      cw: cw,
      ch: ch,
      cx: cc.ix,
      cy: cc.iy,
      dxFrom: dxFrom,
      dxTo: dxTo,
      dyFrom: dyFrom,
      dyTo: dyTo,
      count: (dxTo - dxFrom + 1) * (dyTo - dyFrom + 1)
    };
  }

  function cellScreen(v, ix, iy) {
    return {
      x: v.base.x + (ix - v.cx + 0.5) * v.cw,
      y: v.base.y + (iy - v.cy + 0.5) * v.ch
    };
  }

  // ---------------------------------------------------------------- 그리기
  function ensureCanvas(canvas, ctx, W, H) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }
    Lm.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return dpr;
  }

  // 확대 애니메이션 동안 캔버스를 타일과 같은 배율로 따라가게 한다.
  function zoomCanvas(canvas, e) {
    if (!canvas || !canvas.style) return;
    try {
      var scale = map.getZoomScale(e.zoom);
      var ll = map.containerPointToLatLng([0, 0]);
      var offset = map._latLngToNewLayerPoint(ll, e.zoom, e.center);
      Lm.DomUtil.setTransform(canvas, offset, scale);
    } catch (err) {
      canvas.style.opacity = '0';
    }
  }

  function drawGrid() {
    if (!gctx || !map) return;
    var size = map.getSize();
    if (!size || !size.x) return;
    var W = size.x;
    var H = size.y;
    ensureCanvas(gcanvas, gctx, W, H);
    gctx.clearRect(0, 0, W, H);

    var v = computeView();
    if (!v) return;

    var C = country();
    var cw = v.cw;
    var chAbs = -v.ch;
    var showGrid = cw >= 17 && v.count <= MAX_GRID_CELLS;
    var showRange = cw >= 10;

    var pm = CRS.project(Lm.latLng(S.player.lat, S.player.lng));
    var rangeMerc = CAPTURE_RANGE_M / Math.max(0.2, Math.cos((S.player.lat * Math.PI) / 180));
    var rangeSq = rangeMerc * rangeMerc;

    var i, ix, iy, key, dx, dy, left, top, mx, my, ddx, ddy;

    // 1) 칸 격자선 (빈 칸)
    if (showGrid) {
      gctx.beginPath();
      for (iy = v.dyFrom; iy <= v.dyTo; iy++) {
        for (ix = v.dxFrom; ix <= v.dxTo; ix++) {
          key = ix + '_' + iy;
          if (S.cells[key]) continue;
          dx = ix - v.cx;
          dy = iy - v.cy;
          left = v.base.x + dx * cw;
          top = v.base.y + (dy + 1) * v.ch;
          gctx.rect(left + 0.5, top + 0.5, cw - 1, chAbs - 1);
        }
      }
      gctx.lineWidth = 1;
      gctx.strokeStyle = 'rgba(16,32,54,0.17)';
      gctx.stroke();
    }

    // 2) 점령 가능한 칸
    if (showRange) {
      gctx.beginPath();
      var anyRange = false;
      for (iy = v.dyFrom; iy <= v.dyTo; iy++) {
        my = (iy + 0.5) * CELL_M - pm.y;
        for (ix = v.dxFrom; ix <= v.dxTo; ix++) {
          key = ix + '_' + iy;
          if (S.cells[key]) continue;
          mx = (ix + 0.5) * CELL_M - pm.x;
          if (mx * mx + my * my > rangeSq) continue;
          dx = ix - v.cx;
          dy = iy - v.cy;
          left = v.base.x + dx * cw;
          top = v.base.y + (dy + 1) * v.ch;
          gctx.rect(left + 1.2, top + 1.2, cw - 2.4, chAbs - 2.4);
          anyRange = true;
        }
      }
      if (anyRange) {
        gctx.fillStyle = hexA(C.main, 0.13);
        gctx.fill();
        gctx.setLineDash([5, 4]);
        gctx.lineWidth = 1.3;
        gctx.strokeStyle = hexA(C.main, 0.55);
        gctx.stroke();
        gctx.setLineDash([]);
      }
    }

    // 3) 점령한 칸
    var anyCap = false;
    gctx.beginPath();
    for (iy = v.dyFrom; iy <= v.dyTo; iy++) {
      for (ix = v.dxFrom; ix <= v.dxTo; ix++) {
        if (!S.cells[ix + '_' + iy]) continue;
        dx = ix - v.cx;
        dy = iy - v.cy;
        left = v.base.x + dx * cw;
        top = v.base.y + (dy + 1) * v.ch;
        gctx.rect(left + 0.8, top + 0.8, cw - 1.6, chAbs - 1.6);
        anyCap = true;
      }
    }
    if (anyCap) {
      gctx.fillStyle = hexA(C.main, 0.62);
      gctx.fill();
      gctx.lineWidth = 1.4;
      gctx.strokeStyle = hexA(C.dark, 0.9);
      gctx.stroke();

      if (cw >= 26) {
        var bs = Math.min(cw * 0.26, 9);
        gctx.beginPath();
        for (iy = v.dyFrom; iy <= v.dyTo; iy++) {
          for (ix = v.dxFrom; ix <= v.dxTo; ix++) {
            if (!S.cells[ix + '_' + iy]) continue;
            dx = ix - v.cx;
            dy = iy - v.cy;
            left = v.base.x + dx * cw;
            top = v.base.y + (dy + 1) * v.ch;
            gctx.moveTo(left + 2.4, top + 2.4 + bs);
            gctx.lineTo(left + 2.4 + bs, top + 2.4);
            gctx.lineTo(left + 2.4, top + 2.4);
            gctx.closePath();
          }
        }
        gctx.fillStyle = hexA(C.alt, 0.85);
        gctx.fill();
      }
    }

    // 4) 점령 범위 링
    var pp = map.latLngToContainerPoint(S.player);
    var pxPerM = cw / (CELL_M * Math.max(0.2, Math.cos((S.player.lat * Math.PI) / 180)));
    gctx.beginPath();
    gctx.arc(pp.x, pp.y, CAPTURE_RANGE_M * pxPerM, 0, Math.PI * 2);
    gctx.setLineDash([2, 7]);
    gctx.lineWidth = 1.4;
    gctx.strokeStyle = hexA(C.main, 0.35);
    gctx.stroke();
    gctx.setLineDash([]);
  }

  function drawFx(now) {
    if (!fxctx || !map) return;
    var size = map.getSize();
    if (!size || !size.x) return;
    var W = size.x;
    var H = size.y;
    ensureCanvas(fxcanvas, fxctx, W, H);

    var hasWork = S.drops.length > 0 || bursts.length > 0;
    if (!hasWork) {
      if (fxDirty) {
        fxctx.clearRect(0, 0, W, H);
        fxDirty = false;
      }
      return;
    }

    fxDirty = true;
    fxctx.clearRect(0, 0, W, H);

    var v = computeView();
    if (!v) return;
    var C = country();
    var i, p, d, t;

    // 코인 드롭
    for (i = 0; i < S.drops.length; i++) {
      d = S.drops[i];
      p = cellScreen(v, d.ix, d.iy);
      var rad = clamp(v.cw * 0.2, 6.5, 13);
      var pulse = 1 + Math.sin(now / 300 + i) * 0.08;
      var rr = rad * pulse;
      fxctx.beginPath();
      fxctx.arc(p.x, p.y + 1.5, rr * 1.05, 0, Math.PI * 2);
      fxctx.fillStyle = 'rgba(20,14,0,0.24)';
      fxctx.fill();
      fxctx.beginPath();
      fxctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      fxctx.fillStyle = '#f7c948';
      fxctx.fill();
      fxctx.lineWidth = 1.6;
      fxctx.strokeStyle = '#a9760a';
      fxctx.stroke();
      fxctx.beginPath();
      fxctx.arc(p.x, p.y, rr * 0.62, 0, Math.PI * 2);
      fxctx.strokeStyle = 'rgba(255,246,205,0.85)';
      fxctx.lineWidth = 1.2;
      fxctx.stroke();
      if (rr >= 8) {
        fxctx.fillStyle = '#6b4a00';
        fxctx.font = '700 ' + Math.round(rr * 0.95) + 'px -apple-system, system-ui, sans-serif';
        fxctx.textAlign = 'center';
        fxctx.textBaseline = 'middle';
        fxctx.fillText('2', p.x, p.y + 0.5);
      }
    }

    // 점령 이펙트
    for (i = bursts.length - 1; i >= 0; i--) {
      t = (now - bursts[i].t0) / 560;
      if (t >= 1 || t < 0) {
        bursts.splice(i, 1);
        continue;
      }
      p = cellScreen(v, bursts[i].ix, bursts[i].iy);
      var e = 1 - Math.pow(1 - t, 2);
      fxctx.beginPath();
      fxctx.arc(p.x, p.y, v.cw * (0.18 + e * 0.55), 0, Math.PI * 2);
      fxctx.strokeStyle = hexA(C.main, (1 - t) * 0.9);
      fxctx.lineWidth = 3 * (1 - t) + 0.6;
      fxctx.stroke();
    }
  }

  // ---------------------------------------------------------------- HUD
  var toastTimer = null;

  function toast(msg, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, ms || 2200);
  }

  function updateHud() {
    var c = $('statCoins');
    var k = $('statCells');
    if (c) c.textContent = String(S.coins);
    if (k) k.textContent = String(S.cellCount);
    var fill = $('coinFill');
    if (fill) {
      fill.style.width = clamp((S.walkAccum / COIN_STEP_M) * 100, 0, 100).toFixed(1) + '%';
    }
    var lab = $('coinLabel');
    if (lab) {
      var left = Math.max(0, Math.ceil(COIN_STEP_M - S.walkAccum));
      lab.textContent = left + 'm 더 걸으면 +1 코인';
    }
  }

  function updateNation() {
    var C = country();
    var root = document.documentElement;
    root.style.setProperty('--nation', C.main);
    root.style.setProperty('--nation-dark', C.dark);
    root.style.setProperty('--nation-soft', hexA(C.main, 0.16));
    var mini = $('charMini');
    if (mini) mini.innerHTML = ballSVG(C.code, 'mini', 26);
    var nm = $('charName');
    if (nm) nm.textContent = C.name;
  }

  // ---------------------------------------------------------------- 코인
  function gainCoins(n, msg) {
    S.coins += n;
    S.coinsEarned += n;
    updateHud();
    save();
    if (msg) toast(msg);
  }

  function addDistance(d) {
    if (!(d > 0)) return;
    S.totalDist += d;
    S.walkAccum += d;
    var got = 0;
    while (S.walkAccum >= COIN_STEP_M) {
      S.walkAccum -= COIN_STEP_M;
      S.coins += 1;
      S.coinsEarned += 1;
      got++;
    }
    if (got > 0) {
      updateHud();
      save();
      toast('걸어서 +' + got + ' 코인 · 지금 ' + S.coins + '개');
      haptic(10);
    } else {
      updateHud();
    }
  }

  // ---------------------------------------------------------------- 드롭
  function findDrop(key) {
    for (var i = 0; i < S.drops.length; i++) {
      if (S.drops[i].key === key) return S.drops[i];
    }
    return null;
  }

  function spawnDrop() {
    if (S.drops.length >= DROP_MAX) return;
    var pc = cellOf(S.player.lat, S.player.lng);
    for (var t = 0; t < 48; t++) {
      var ix = pc.ix + Math.round((Math.random() * 2 - 1) * 3);
      var iy = pc.iy + Math.round((Math.random() * 2 - 1) * 3);
      var key = ix + '_' + iy;
      if (S.cells[key]) continue;
      if (findDrop(key)) continue;
      var c = cellCenter(ix, iy);
      if (distM(S.player, c) > DROP_SPAWN_MAX_M) continue;
      S.drops.push({ key: key, ix: ix, iy: iy, born: Date.now() });
      return;
    }
  }

  function collectDrop(drop) {
    var idx = S.drops.indexOf(drop);
    if (idx >= 0) S.drops.splice(idx, 1);
    bursts.push({ ix: drop.ix, iy: drop.iy, t0: nowMs() });
    haptic([8, 40, 12]);
    gainCoins(DROP_VALUE, '+' + DROP_VALUE + ' 코인 획득!');
  }

  function pickupNearby() {
    for (var i = S.drops.length - 1; i >= 0; i--) {
      var d = S.drops[i];
      var c = cellCenter(d.ix, d.iy);
      if (distM(S.player, c) <= DROP_PICK_M) collectDrop(d);
    }
  }

  function expireDrops() {
    var now = Date.now();
    for (var i = S.drops.length - 1; i >= 0; i--) {
      if (now - S.drops[i].born > DROP_LIFE_MS) S.drops.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- 점령
  function captureCell(cell) {
    var key = cell.key;
    if (S.cells[key]) return;
    if (S.coins < 1) return;
    S.cells[key] = Date.now();
    S.cellCount += 1;
    S.captures += 1;
    S.coins -= 1;
    bursts.push({ ix: cell.ix, iy: cell.iy, t0: nowMs() });
    haptic(16);
    updateHud();
    save();
    requestDraw();
    toast('점령 성공! 칸 +1 · 코인 ' + S.coins + '개 남음', 1500);
  }

  function onCellTap(cell) {
    var drop = findDrop(cell.key);
    if (drop) {
      collectDrop(drop);
      return;
    }
    if (S.cells[cell.key]) {
      toast('이미 점령한 칸이에요', 1200);
      return;
    }
    var c = cellCenter(cell.ix, cell.iy);
    var d = distM(S.player, c);
    if (d > CAPTURE_RANGE_M) {
      if (S.mode === 'test') {
        walkTarget = { lat: c.lat, lng: c.lng };
        setTargetMarker(walkTarget);
        toast('점령 범위(200m) 밖이에요 · 그쪽으로 걸어갈게요', 1900);
      } else {
        toast('점령 범위(200m) 밖이에요 · 가까이 이동해 주세요', 1900);
      }
      return;
    }
    if (S.coins < 1) {
      toast('점령 코인이 없어요 · 40m 걸으면 +1', 2000);
      return;
    }
    captureCell(cell);
  }

  // ---------------------------------------------------------------- 플레이어
  var pendMove = 0;

  function applyPlayer(p, minMove) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return;
    var d = distM(S.player, p);
    if (d <= 0.00001) return;
    if (d > 200) {
      pendMove = 0; // 텔레포트(최초 GPS 고정 등)는 거리 적립에서 제외
    } else {
      pendMove += d;
      if (pendMove >= (minMove || 0)) {
        addDistance(pendMove);
        pendMove = 0;
      }
    }
    S.player = { lat: p.lat, lng: p.lng };
    if (playerMarker) playerMarker.setLatLng(S.player);
    if (S.follow) keepInView();
    pickupNearby();
    requestDraw();
    if (Date.now() - lastSave > 3000) {
      lastSave = Date.now();
      save();
    }
  }

  function keepInView() {
    if (!map) return;
    var t = Date.now();
    if (t - lastPan < 650) return;
    var size = map.getSize();
    var pt = map.latLngToContainerPoint(S.player);
    var m = Math.min(size.x, size.y) * 0.26;
    if (pt.x < m || pt.y < m || pt.x > size.x - m || pt.y > size.y - m) {
      lastPan = t;
      map.panTo(S.player, { animate: true, duration: 0.3 });
    }
  }

  function moveBy(dxM, dyM) {
    var lat = S.player.lat;
    var lng = S.player.lng;
    var dLat = dyM / 111320;
    var dLng = dxM / (111320 * Math.cos((lat * Math.PI) / 180));
    applyPlayer({ lat: lat + dLat, lng: lng + dLng }, 0);
  }

  // ---------------------------------------------------------------- GPS
  function startGps() {
    if (!navigator.geolocation) {
      toast('이 브라우저에서는 GPS를 쓸 수 없어요', 2400);
      setMode('test', true);
      return;
    }
    if (watchId != null) return;
    try {
      watchId = navigator.geolocation.watchPosition(onGps, onGpsErr, {
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 20000
      });
    } catch (e) {
      watchId = null;
    }
  }

  function stopGps() {
    if (watchId != null) {
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch (e) {}
      watchId = null;
    }
  }

  function onGps(pos) {
    if (!pos || !pos.coords) return;
    var acc = pos.coords.accuracy || 999;
    S.gpsAcc = acc;
    var p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (!S.gpsGot) {
      S.gpsGot = true;
      S.player = p;
      if (playerMarker) playerMarker.setLatLng(p);
      S.follow = true;
      map.setView(p, map.getZoom());
      save();
      requestDraw();
      if (acc > 60) toast('GPS 정확도 ±' + Math.round(acc) + 'm · 실내면 테스트 패드를 쓰세요', 2600);
      return;
    }
    if (acc > 90) return; // 너무 부정확한 측정은 무시
    if (S.mode !== 'gps') return;
    applyPlayer(p, 1.2);
  }

  function onGpsErr(err) {
    var code = err && err.code;
    if (code === 1) {
      toast('위치 권한이 필요해요 · 테스트 패드로 시작할게요', 3000);
      setMode('test', true);
    } else {
      toast('위치를 찾는 중이에요 · 실내면 테스트 패드를 쓰세요', 2600);
    }
  }

  // ---------------------------------------------------------------- 모드
  function setMode(mode, silent) {
    S.mode = mode === 'test' ? 'test' : 'gps';
    var test = S.mode === 'test';
    var btn = $('modeBtn');
    if (btn) btn.setAttribute('aria-pressed', test ? 'true' : 'false');
    var lab = $('modeLabel');
    if (lab) lab.textContent = test ? '테스트 패드' : 'GPS 모드';
    var pad = $('dpad');
    if (pad) pad.hidden = !test;

    if (test) {
      stopGps();
    } else {
      walkTarget = null;
      clearTargetMarker();
      startGps();
    }
    save();
    requestDraw();
    if (!silent) {
      toast(test ? '테스트 패드 · 방향키나 탭으로 이동해요' : 'GPS 모드 · 실제 위치를 따라가요');
    }
  }

  // ---------------------------------------------------------------- 루프
  function testStep(dt) {
    if (S.mode !== 'test') return;
    if (dpad.x || dpad.y) {
      if (walkTarget) {
        walkTarget = null;
        clearTargetMarker();
      }
      var len = Math.sqrt(dpad.x * dpad.x + dpad.y * dpad.y) || 1;
      moveBy((dpad.x / len) * TEST_SPEED * dt, (dpad.y / len) * TEST_SPEED * dt);
      return;
    }
    if (walkTarget) {
      var d = distM(S.player, walkTarget);
      if (d < 4) {
        walkTarget = null;
        clearTargetMarker();
      } else {
        var step = Math.min(WALK_SPEED * dt, d);
        var t = step / d;
        applyPlayer(
          {
            lat: S.player.lat + (walkTarget.lat - S.player.lat) * t,
            lng: S.player.lng + (walkTarget.lng - S.player.lng) * t
          },
          0
        );
      }
    }
  }

  function loop(now) {
    var dt = lastTick ? Math.min((now - lastTick) / 1000, 0.12) : 0;
    lastTick = now;
    testStep(dt);
    drawFx(now);
    window.requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 캐릭터
  function renderCharGrid() {
    var wrap = $('charGrid');
    if (!wrap) return;
    wrap.innerHTML = '';
    COUNTRIES.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-item' + (c.code === S.country ? ' on' : '');
      b.innerHTML =
        '<span class="char-ball">' + ballSVG(c.code, 'sel' + i, 48) + '</span>' +
        '<span class="char-name">' + c.name + '</span>';
      b.addEventListener('click', function () {
        pickCountry(c.code);
      });
      wrap.appendChild(b);
    });
  }

  function pickCountry(code) {
    S.country = code;
    save();
    updateNation();
    renderCharGrid();
    if (playerMarker) playerMarker.setIcon(makeBallIcon(64));
    requestDraw();
    hideSheet('charSheet');
    toast(country().name + ' 볼로 점령해요!', 1600);
    haptic(12);
  }

  // ---------------------------------------------------------------- 시트
  function showSheet(id) {
    var el = $(id);
    if (el) el.hidden = false;
  }

  function hideSheet(id) {
    var el = $(id);
    if (el) el.hidden = true;
  }

  function resetGame() {
    S.cells = {};
    S.cellCount = 0;
    S.coins = START_COINS;
    S.captures = 0;
    S.coinsEarned = 0;
    S.walkAccum = 0;
    S.totalDist = 0;
    S.drops = [];
    bursts = [];
    S.lastRecharge = Date.now();
    walkTarget = null;
    clearTargetMarker();
    save();
    updateHud();
    requestDraw();
    hideSheet('resetSheet');
    toast('새로 시작! 코인 ' + START_COINS + '개로 다시 모아요');
  }

  // ---------------------------------------------------------------- 이벤트
  function bind() {
    var modeBtn = $('modeBtn');
    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        setMode(S.mode === 'gps' ? 'test' : 'gps');
      });
    }

    var charBtn = $('charBtn');
    if (charBtn) {
      charBtn.addEventListener('click', function () {
        renderCharGrid();
        showSheet('charSheet');
      });
    }

    var helpBtn = $('helpBtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', function () {
        showSheet('helpSheet');
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

    var locateBtn = $('locateBtn');
    if (locateBtn) {
      locateBtn.addEventListener('click', function () {
        S.follow = true;
        if (S.mode === 'gps' && watchId == null) startGps();
        if (map) map.setView(S.player, Math.max(map.getZoom(), DEFAULT_ZOOM), { animate: true });
        requestDraw();
        toast('내 위치로 이동');
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
    if (resetConfirm) resetConfirm.addEventListener('click', resetGame);

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        hideSheet(el.getAttribute('data-close'));
      });
    });

    document.querySelectorAll('.sheet').forEach(function (sheet) {
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) sheet.hidden = true;
      });
    });

    // D-pad
    document.querySelectorAll('.pad-btn[data-dx]').forEach(function (btn) {
      var dx = parseInt(btn.getAttribute('data-dx'), 10) || 0;
      var dy = parseInt(btn.getAttribute('data-dy'), 10) || 0;
      var press = function (e) {
        if (e && e.cancelable) e.preventDefault();
        dpad.x = dx;
        dpad.y = dy;
        btn.classList.add('held');
        try {
          if (btn.setPointerCapture && e && e.pointerId != null) btn.setPointerCapture(e.pointerId);
        } catch (err) {}
      };
      var release = function () {
        if (dpad.x === dx && dpad.y === dy) {
          dpad.x = 0;
          dpad.y = 0;
        }
        btn.classList.remove('held');
      };
      btn.addEventListener('pointerdown', press, { passive: false });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
      });
    });

    var padStop = $('padStop');
    if (padStop) {
      padStop.addEventListener('click', function () {
        dpad.x = 0;
        dpad.y = 0;
        walkTarget = null;
        clearTargetMarker();
        document.querySelectorAll('.pad-btn.held').forEach(function (b) {
          b.classList.remove('held');
        });
      });
    }

    window.addEventListener('pointerup', function () {
      dpad.x = 0;
      dpad.y = 0;
      document.querySelectorAll('.pad-btn.held').forEach(function (b) {
        b.classList.remove('held');
      });
    });

    window.addEventListener('blur', function () {
      dpad.x = 0;
      dpad.y = 0;
      save();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) save();
    });

    window.addEventListener('resize', function () {
      requestDraw();
    });
  }

  // ---------------------------------------------------------------- 시작
  function boot() {
    load();
    initMap();
    updateNation();
    updateHud();
    bind();

    setMode(S.mode, true);

    if (!S.helpShown) showSheet('helpSheet');

    spawnDrop();
    spawnDrop();

    setInterval(function () {
      var now = Date.now();
      if (S.coins >= PASSIVE_MAX) {
        S.lastRecharge = now;
        return;
      }
      if (now - S.lastRecharge >= PASSIVE_MS) {
        S.lastRecharge = now;
        gainCoins(1, '코인 자동 회복 +1');
      }
    }, 1000);

    setInterval(function () {
      spawnDrop();
      expireDrops();
    }, DROP_SPAWN_MS);

    setInterval(function () {
      updateHud();
    }, 1000);

    window.requestAnimationFrame(loop);
    requestDraw();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
