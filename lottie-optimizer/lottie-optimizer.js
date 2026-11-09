/* Lottie Optimizer — 내보낸 Lottie JSON 점검·경량화·이미지 분리·저장.
   브라우저 전용. 필요: window.lottie (lottie-web 5.12.x), 저장(zip/.lottie)에는 window.JSZip.
   플러그인 Lottie 탭과 웹 페이지 도구가 이 파일 하나를 같이 쓴다. */
(function (root) {
  'use strict';
  var VERSION = '1.0.0';
  var LIMITS = { transferBytes: 1.5e6, avgFrameMs: 8 };
  var TY = { 0: 'precomp', 1: 'solid', 2: 'image', 3: 'null', 4: 'shape', 5: 'text', 6: 'audio' };
  var EF = { 20: 'tint', 21: 'fill', 22: 'stroke', 23: 'tritone', 24: 'pro-levels', 25: 'drop-shadow',
    26: 'radial-wipe', 27: 'displacement-map', 28: 'matte3', 29: 'gaussian-blur', 32: 'mesh-warp',
    33: 'wavy', 34: 'spherize', 35: 'puppet' };
  var NATIVE_CHECK = ['drop-shadow', 'gaussian-blur', 'tint', 'fill', 'stroke', 'tritone', 'pro-levels',
    'displacement-map', 'matte3', 'mesh-warp', 'wavy', 'spherize', 'puppet'];

  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  function compsOf(d) {
    var out = [{ L: d.layers, op: d.op }];
    (d.assets || []).forEach(function (a) { if (a.layers) out.push({ L: a.layers, op: null }); });
    return out;
  }
  var isStatic = function (p) { return !p || !p.a; };
  function ksStatic(l) {
    var ks = l.ks || {};
    for (var k in ks) {
      var v = ks[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.s === true) { if (!(isStatic(v.x) && isStatic(v.y))) return false; }
        else if (!isStatic(v)) return false;
      }
    }
    return true;
  }
  function parentRefs(L) { var s = new Set(); L.forEach(function (l) { if (l.parent != null) s.add(l.parent); }); return s; }
  function dataBytes(p) { var i = p.indexOf(','); return Math.floor((p.length - i - 1) * 3 / 4); }
  function b64ToBytes(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function bytesToB64(u) { var s = '', CH = 0x8000; for (var i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); }
  async function gzipSize(str) {
    if (typeof CompressionStream === 'undefined') return null;
    var cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    var buf = await new Response(cs).arrayBuffer(); return buf.byteLength;
  }

  // ================= 점검 =================
  function walkShapes(items, out) {
    (items || []).forEach(function (it) { out[it.ty] = (out[it.ty] || 0) + 1; if (it.ty === 'gr') walkShapes(it.it, out); });
  }
  async function check(d) {
    var comps = {}, imgs = {};
    (d.assets || []).forEach(function (a) { if (a.layers) comps[a.id] = a; else if (a.p) imgs[a.id] = a; });
    var r = { size: { w: d.w, h: d.h, fr: d.fr, frames: (d.op || 0) - (d.ip || 0), generator: (d.meta || {}).g || '' } };
    var defined = {}, rendered = {}, feats = {}, effects = {};
    var inc = function (o, k, n) { o[k] = (o[k] || 0) + (n || 1); };
    compsOf(d).forEach(function (c) { c.L.forEach(function (l) { inc(defined, TY[l.ty] || l.ty); }); });
    var imgUse = {};
    (function expand(L, depth) {
      if (depth > 30) return;
      L.forEach(function (l) {
        inc(rendered, TY[l.ty] || l.ty);
        if (l.td) inc(feats, 'matte');
        if (l.masksProperties) inc(feats, 'mask', l.masksProperties.length);
        if ('tm' in l) inc(feats, 'time-remap');
        if (l.bm) inc(feats, 'blend-mode');
        (l.ef || []).forEach(function (e) { inc(effects, EF[e.ty] || ('ef' + e.ty)); });
        if (l.ty === 2) inc(imgUse, l.refId);
        if (l.ty === 0 && comps[l.refId]) expand(comps[l.refId].layers, depth + 1);
      });
    })(d.layers, 0);
    var sum = function (o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); };
    r.layersDefined = sum(defined); r.layersRendered = sum(rendered); r.layersByType = rendered;
    r.features = feats; r.effects = effects;
    var rows = [], imgB64 = 0, imgRaw = 0;
    Object.keys(imgs).forEach(function (id) {
      var a = imgs[id], p = a.p || '', isData = p.indexOf('data:') === 0;
      var fmt = isData ? p.slice(5, p.indexOf(';')) : 'external';
      var n = isData ? dataBytes(p) : 0;
      imgB64 += isData ? p.length : 0; imgRaw += n;
      rows.push({ id: id, fmt: fmt, w: a.w, h: a.h, bytes: n, uses: imgUse[id] || 0 });
    });
    rows.sort(function (a, b) { return b.bytes - a.bytes; });
    var js = JSON.stringify(d);
    var stripped = clone(d); (stripped.assets || []).forEach(function (a) { if (a.p && a.p.indexOf('data:') === 0) a.p = 'x'; });
    var jsNoImg = JSON.stringify(stripped);
    var gz = await gzipSize(jsNoImg);
    r.bytes = { single: new Blob([js]).size, json: new Blob([jsNoImg]).size, jsonGzip: gz, images: imgRaw };
    r.transferBytes = (gz == null ? r.bytes.json : gz) + imgRaw;
    r.images = { count: rows.length, top: rows.slice(0, 6), formats: rows.reduce(function (o, x) { o[x.fmt] = (o[x.fmt] || 0) + 1; return o; }, {}),
      unused: rows.filter(function (x) { return !x.uses; }).map(function (x) { return x.id; }) };
    r.glyphs = (d.chars || []).length;
    r.nativeCheck = Object.keys(effects).filter(function (k) { return NATIVE_CHECK.indexOf(k) >= 0; });
    r.limits = { transferBytes: { value: r.transferBytes, limit: LIMITS.transferBytes, ok: r.transferBytes <= LIMITS.transferBytes } };
    return r;
  }

  // ================= 재생 비용 =================
  function stage() {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-100000px;top:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(el); return el;
  }
  function load(d, el, renderer) {
    return new Promise(function (res, rej) {
      var anim = root.lottie.loadAnimation({ container: el, renderer: renderer || 'svg', loop: false, autoplay: false, animationData: d });
      var to = setTimeout(function () { rej(new Error('불러오기 시간 초과')); }, 60000);
      anim.addEventListener('DOMLoaded', function () { clearTimeout(to); res(anim); });
    });
  }
  async function measure(d, opt) {
    opt = opt || {};
    var W = opt.width || 850, H = Math.round(W * d.h / d.w);
    var el = stage(); el.style.width = W + 'px'; el.style.height = H + 'px';
    var data = clone(d), t0 = performance.now(), anim;
    try {
      anim = await load(data, el);
      var loadMs = performance.now() - t0, dom = el.querySelectorAll('*').length;
      var per = [], step = opt.step || 3;
      for (var rep = 0; rep < 2; rep++) {
        var i = 0;
        for (var fr = 0; fr < anim.totalFrames; fr += step, i++) {
          var s = performance.now(); anim.goToAndStop(fr, true); void el.offsetHeight; var dt = performance.now() - s;
          per[i] = rep ? Math.min(per[i], dt) : dt;
        }
        await tick();
      }
      var tot = per.reduce(function (a, b) { return a + b; }, 0);
      var avg = tot / per.length;
      return { loadMs: Math.round(loadMs), domNodes: dom, avgFrameMs: Math.round(avg * 10) / 10,
        worstFrameMs: Math.round(Math.max.apply(null, per)), ok: avg <= LIMITS.avgFrameMs, limit: LIMITS.avgFrameMs };
    } finally { if (anim) anim.destroy(); el.remove(); }
  }

  // ================= SVG → 캔버스 =================
  async function svgToCanvas(svg, w, h) {
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    var xml = new XMLSerializer().serializeToString(svg);
    var url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      var img = new Image(); img.decoding = 'sync';
      await new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('SVG 그리기 실패')); }; img.src = url; });
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, w, h); return cv;
    } finally { URL.revokeObjectURL(url); }
  }
  // 한 프레임을 캔버스로 (미리보기 비교용)
  async function snapshot(d, frame, W) {
    var H = Math.round(W * d.h / d.w), el = stage(); el.style.width = W + 'px'; el.style.height = H + 'px';
    var anim;
    try { anim = await load(clone(d), el); anim.goToAndStop(frame, true); return await svgToCanvas(el.querySelector('svg'), W, H); }
    finally { if (anim) anim.destroy(); el.remove(); }
  }
  function alphaBox(cv) {
    var w = cv.width, h = cv.height, px = cv.getContext('2d').getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  // 두 프레임 비교. diffPct: 색이 다른 픽셀 비율(가장자리 포함).
  // contentPct: 3×3 평균으로 흐린 뒤에도 다르고, 주변 3×3 이 모두 다른 픽셀 비율 — 안티에일리어싱·글자 가장자리는 빠지고
  // 빠진 요소·바뀐 색 같은 "내용 차이"만 남는다.
  function composite(cv) {
    var w = cv.width, h = cv.height, D = cv.getContext('2d').getImageData(0, 0, w, h).data, o = new Float32Array(w * h * 3);
    for (var i = 0; i < w * h; i++) { var al = D[i * 4 + 3] / 255; for (var c = 0; c < 3; c++) o[i * 3 + c] = D[i * 4 + c] * al + 255 * (1 - al); }
    return o;
  }
  function blur3(src, w, h) {
    var o = new Float32Array(src.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) for (var c = 0; c < 3; c++) {
      var s = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue; s += src[(yy * w + xx) * 3 + c]; n++;
      }
      o[(y * w + x) * 3 + c] = s / n;
    }
    return o;
  }
  function maskOf(A, B, w, h, thr) {
    var m = new Uint8Array(w * h), n = 0;
    for (var i = 0; i < w * h; i++) {
      var dm = 0; for (var c = 0; c < 3; c++) { var dd = Math.abs(A[i * 3 + c] - B[i * 3 + c]); if (dd > dm) dm = dd; }
      if (dm > thr) { m[i] = 1; n++; }
    }
    return { m: m, n: n };
  }
  function diffCanvases(a, b) {
    var w = a.width, h = a.height, A = composite(a), B = composite(b);
    var raw = maskOf(A, B, w, h, 16);
    var bl = maskOf(blur3(A, w, h), blur3(B, w, h), w, h, 24), m = bl.m, solid = 0;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var k = y * w + x; if (!m[k]) continue;
      if (m[k - 1] && m[k + 1] && m[k - w] && m[k + w] && m[k - w - 1] && m[k - w + 1] && m[k + w - 1] && m[k + w + 1]) solid++;
    }
    return { diffPct: 100 * raw.n / (w * h), contentPct: 100 * solid / (w * h) };
  }
  async function compare(a, b, opt) {
    opt = opt || {}; var W = opt.width || 600, n = opt.samples || 8, frames = [];
    var total = (a.op || 0) - (a.ip || 0);
    for (var i = 0; i < n; i++) frames.push(Math.round((a.ip || 0) + total * (i + 0.5) / n));
    var rows = [];
    for (var j = 0; j < frames.length; j++) {
      var ca = await snapshot(a, frames[j], W), cb = await snapshot(b, frames[j], W);
      var r = diffCanvases(ca, cb); r.frame = frames[j]; rows.push(r);
    }
    var maxD = Math.max.apply(null, rows.map(function (r) { return r.diffPct; }));
    var maxC = Math.max.apply(null, rows.map(function (r) { return r.contentPct; }));
    return { frames: rows, maxDiffPct: maxD, maxContentPct: maxC, same: maxC < 0.1 };
  }

  // ================= 이미지 인코딩 =================
  async function decodeData(p) {
    // data: URL 을 fetch 하지 않는다(일부 환경의 CSP 가 막는다) — 직접 바이트로 바꿔 디코드
    var i = p.indexOf(','), mime = p.slice(5, p.indexOf(';'));
    var blob = new Blob([b64ToBytes(p.slice(i + 1))], { type: mime });
    if (root.createImageBitmap) return await createImageBitmap(blob);
    var url = URL.createObjectURL(blob), img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url); return img;
  }
  async function encodeWebp(src, q) {
    var cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/webp', q); });
    if (!blob || blob.type !== 'image/webp') return null;   // WebP 인코딩을 못 하는 브라우저(Safari)
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function canvasToPng(cv) {
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ================= 경량화 단계 =================
  async function stepWebp(d, q, st, progress) {
    var before = 0, after = 0, list = (d.assets || []).filter(function (a) { return a.p && a.p.indexOf('data:image/png;base64,') === 0; });
    var unsupported = false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], raw = dataBytes(a.p); before += raw;
      var w = await encodeWebp(await decodeData(a.p), q);
      if (!w) { unsupported = true; after += raw; continue; }
      if (w.length < raw) { a.p = 'data:image/webp;base64,' + bytesToB64(w); after += w.length; } else after += raw;
      if (progress && i % 4 === 0) progress('WebP 변환 ' + (i + 1) + '/' + list.length);
    }
    st.webp = unsupported ? '이 브라우저는 WebP 저장을 지원하지 않아 PNG를 유지했습니다' : ('PNG ' + mb(before) + ' → ' + mb(after));
  }
  function visibleIntervals(o, lo, hi) {
    if (isStatic(o)) {
      var v = o ? o.k : 100; if (Array.isArray(v)) v = v[0];
      return v > 0 ? [[lo, hi]] : [];
    }
    var ks = o.k, val = function (k) { var s = k.s; return Array.isArray(s) ? s[0] : (s == null ? 0 : s); };
    var segs = [];
    if (val(ks[0]) > 0) segs.push([-1e9, ks[0].t]);
    for (var i = 0; i < ks.length - 1; i++) {
      var a = ks[i], b = ks[i + 1], va = val(a), vb = ('s' in b) ? val(b) : va;
      if (a.h) { if (va > 0) segs.push([a.t, b.t]); }
      else if (va > 0 || vb > 0) segs.push([a.t, b.t + (vb > 0 ? 1 : 0)]);
    }
    var last = ks[ks.length - 1];
    var vl = ('s' in last) ? val(last) : (ks.length > 1 ? val(ks[ks.length - 2]) : 0);
    if (vl > 0) segs.push([last.t, 1e9]);
    segs.sort(function (x, y) { return x[0] - y[0]; });
    var merged = [];
    segs.forEach(function (sg) {
      var s = Math.max(sg[0], lo), e = Math.min(sg[1], hi);
      if (e <= s) return;
      if (merged.length && s <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
      else merged.push([s, e]);
    });
    return merged.map(function (m) { return [Math.floor(m[0]), Math.ceil(m[1])]; });
  }
  function stepTrim(d, st) {
    var trimmed = 0, split = 0;
    compsOf(d).forEach(function (c) {
      var L = c.L, refs = parentRefs(L), next = L.reduce(function (m, l) { return Math.max(m, l.ind || 0); }, 0) + 1, out = [];
      L.forEach(function (l) {
        if (l.td || l.tt || refs.has(l.ind) || (l.sr || 1) !== 1 || l.ty === 3) { out.push(l); return; }
        var stt = l.st || 0;
        var iv = visibleIntervals(l.ks.o, l.ip - stt, l.op - stt).map(function (x) { return [x[0] + stt, x[1] + stt]; });
        if (!iv.length) { l._dead = true; out.push(l); return; }
        if (iv.length === 1) {
          if (iv[0][0] !== l.ip || iv[0][1] !== l.op) { l.ip = iv[0][0]; l.op = iv[0][1]; trimmed++; }
          out.push(l); return;
        }
        split++;
        iv.forEach(function (x, j) {
          var cpy = j === 0 ? l : clone(l);
          if (j) cpy.ind = next++;
          cpy.ip = x[0]; cpy.op = x[1]; out.push(cpy);
        });
      });
      L.splice.apply(L, [0, L.length].concat(out));
    });
    st.trim = '구간 축소 ' + trimmed + '개, 분할 ' + split + '개';
  }
  function stepDrop(d, st) {
    var n = 0;
    compsOf(d).forEach(function (c) {
      var L = c.L, refs = parentRefs(L), dead = new Set();
      L.forEach(function (l, i) {
        if (refs.has(l.ind) || l.td) return;
        var o = l.ks && l.ks.o;
        var zero = isStatic(o) && o && (Array.isArray(o.k) ? o.k[0] : o.k) === 0 && l.ty !== 3;
        if (l._dead || l.hd || l.ip >= l.op || (c.op != null && l.ip >= c.op) || zero) {
          dead.add(i);
          if (l.tt && i > 0 && L[i - 1].td && !refs.has(L[i - 1].ind)) dead.add(i - 1);
        }
      });
      L.forEach(function (l, i) { if (l.ty === 3 && !refs.has(l.ind) && !l.td) dead.add(i); });
      n += dead.size;
      var keep = L.filter(function (l, i) { return !dead.has(i); });
      keep.forEach(function (l) { delete l._dead; });
      L.splice.apply(L, [0, L.length].concat(keep));
    });
    st.drop = '삭제 ' + n + '개';
  }
  var kval = function (p) { return p.k; };
  function mapProp(prop, fn) {
    if (isStatic(prop)) { prop.k = fn(prop.k); return; }
    prop.k.forEach(function (k) { ['s', 'e'].forEach(function (key) { if (key in k) k[key] = fn(k[key]); }); });
  }
  function mapTangents(prop, lin) {
    if (isStatic(prop)) return;
    prop.k.forEach(function (k) { ['ti', 'to'].forEach(function (key) { if (key in k) k[key] = lin(k[key]); }); });
  }
  function stepBake(d, st) {
    var baked = 0;
    compsOf(d).forEach(function (c) {
      var L = c.L, changed = true;
      while (changed) {
        changed = false;
        for (var ni = 0; ni < L.length; ni++) {
          var nl = L[ni];
          if (nl.ty !== 3 || nl.td || nl.tt || !ksStatic(nl) || nl.ddd) continue;
          var ks = nl.ks;
          if (ks.sk && kval(ks.sk) !== 0) continue;
          var pp = ks.p || { k: [0, 0] }, px, py;
          if (pp.s === true) { px = kval(pp.x); py = kval(pp.y); } else { px = kval(pp)[0]; py = kval(pp)[1]; }
          var av = ks.a ? kval(ks.a) : [0, 0], ax = av[0], ay = av[1];
          var sv = ks.s ? kval(ks.s) : [100, 100], sx = sv[0] / 100, sy = sv[1] / 100;
          var th = ks.r ? kval(ks.r) : 0; if (Array.isArray(th)) th = th[0];
          var uniform = Math.abs(sx - sy) < 1e-9 && sx > 0;
          var kids = L.filter(function (x) { return x.parent === nl.ind; });
          if (!kids.length) continue;
          var ok = kids.every(function (k) {
            var cks = k.ks;
            if (k.ddd) return false;
            if (cks.sk && !(isStatic(cks.sk) && kval(cks.sk) === 0)) return false;
            if (!uniform) {
              if (th !== 0) return false;
              var cr = cks.r || { a: 0, k: 0 };
              if (!(isStatic(cr) && (kval(cr) === 0 || (Array.isArray(kval(cr)) && kval(cr)[0] === 0)))) return false;
            }
            if (th !== 0 && ((k.ef && k.ef.length) || (cks.p && cks.p.s === true))) return false;
            return true;
          });
          if (!ok) continue;
          var co = Math.cos(th * Math.PI / 180), si = Math.sin(th * Math.PI / 180);
          var lin = function (v) { return [co * sx * v[0] - si * sy * v[1], si * sx * v[0] + co * sy * v[1]].concat(v.slice(2)); };
          var aff = function (v) { var w = lin([v[0] - ax, v[1] - ay]); return [px + w[0], py + w[1]].concat(v.slice(2)); };
          kids.forEach(function (k) {
            var cks = k.ks;
            var cp = cks.p || (cks.p = { a: 0, k: [0, 0] });
            if (cp.s === true) {
              var fx = function (v) { return Array.isArray(v) ? [px + sx * (v[0] - ax)] : px + sx * (v - ax); };
              var fy = function (v) { return Array.isArray(v) ? [py + sy * (v[0] - ay)] : py + sy * (v - ay); };
              mapProp(cp.x, fx); mapProp(cp.y, fy);
            } else { mapProp(cp, aff); mapTangents(cp, lin); }
            var cs = cks.s || (cks.s = { a: 0, k: [100, 100] });
            mapProp(cs, function (v) { return [v[0] * sx, v[1] * sy].concat(v.slice(2)); });
            if (th) {
              var cr = cks.r || (cks.r = { a: 0, k: 0 });
              mapProp(cr, function (v) { return Array.isArray(v) ? [v[0] + th] : v + th; });
            }
            if (nl.parent != null) k.parent = nl.parent; else delete k.parent;
          });
          L.splice(ni, 1); baked++; changed = true; break;
        }
      }
    });
    st.bake = 'null 합침 ' + baked + '개';
  }
  function stepAssets(d, st) {
    var comps = {}; (d.assets || []).forEach(function (a) { if (a.layers) comps[a.id] = a; });
    var used = new Set(), seen = new Set(), stack = [d.layers];
    while (stack.length) {
      stack.pop().forEach(function (l) {
        var r = l.refId; if (r) used.add(r);
        if (comps[r] && !seen.has(r)) { seen.add(r); stack.push(comps[r].layers); }
      });
    }
    var before = (d.assets || []).length;
    d.assets = (d.assets || []).filter(function (a) { return used.has(a.id); });
    st.assets = '에셋 ' + before + ' → ' + d.assets.length;
  }
  function stepGlyphs(d, st) {
    if (!d.chars) return;
    var fonts = {}; ((d.fonts || {}).list || []).forEach(function (f) { fonts[f.fName] = f.fFamily + '|' + f.fStyle; });
    var used = new Set(), usedF = new Set();
    compsOf(d).forEach(function (c) {
      c.L.forEach(function (l) {
        if (l.ty !== 5) return;
        l.t.d.k.forEach(function (k) {
          var fam = fonts[k.s.f]; usedF.add(fam);
          Array.from(k.s.t || '').forEach(function (ch) { used.add(ch + '\u0000' + fam); });
        });
      });
    });
    var before = d.chars.length;
    d.chars = d.chars.filter(function (c) { return used.has(c.ch + '\u0000' + c.fFamily + '|' + c.style); });
    if (d.fonts && d.fonts.list) d.fonts.list = d.fonts.list.filter(function (f) { return usedF.has(f.fFamily + '|' + f.fStyle); });
    st.glyphs = '글리프 ' + before + ' → ' + d.chars.length;
  }
  function rnd(x, key) {
    if (typeof x === 'number') return Number.isInteger(x) ? x : Math.round(x * 1000) / 1000;
    if (Array.isArray(x)) return x.map(function (v) { return rnd(v); });
    if (x && typeof x === 'object') { var o = {}; for (var k in x) o[k] = (k === 'p' && typeof x[k] === 'string') ? x[k] : rnd(x[k], k); return o; }
    return x;
  }

  // ================= 움직이지 않는 부분 이미지화 =================
  function makeStatic(d) {
    var comps = {}; (d.assets || []).forEach(function (a) { if (a.layers) comps[a.id] = a; });
    var memo = {};
    var hasAnim = function (o) { return /"a":1[,}]/.test(JSON.stringify(o)); };
    function staticLayer(l) {
      if (hasAnim(l)) return false;
      if (l.ty === 5 && l.t && l.t.d && l.t.d.k && l.t.d.k.length > 1) return false;
      if ('tm' in l || l.ip > 0 || l.op < d.op || (l.sr || 1) !== 1) return false;
      if (l.ty === 0) return staticComp(l.refId);
      return true;
    }
    function staticComp(r) {
      if (!comps[r]) return false;
      if (!(r in memo)) { memo[r] = false; memo[r] = comps[r].layers.every(staticLayer); }
      return memo[r];
    }
    return { staticLayer: staticLayer, comps: comps };
  }
  function findRuns(L, S, minRun) {
    var by = {}; L.forEach(function (l) { by[l.ind] = l; });
    var anchor = function (l) { var p = l.parent; while (p != null) { if (!S.staticLayer(by[p])) return p; p = by[p].parent; } return null; };
    var runs = [], cur = [], curA;
    var flush = function () { if (cur.length >= minRun) runs.push({ layers: cur.slice(), anchor: curA }); cur = []; };
    L.forEach(function (l, i) {
      if (l.ty === 3) return;
      var ok = S.staticLayer(l) && !l.bm;
      if (ok && l.td) { var nx = L[i + 1]; ok = !!nx && S.staticLayer(nx) && !nx.bm && anchor(nx) === anchor(l); }
      if (ok && l.tt) ok = cur.length > 0 && cur[cur.length - 1] === L[i - 1];
      if (!ok) { flush(); curA = undefined; return; }
      var a = anchor(l);
      if (a !== curA) { flush(); curA = a; }
      cur.push(l);
    });
    flush();
    return runs;
  }
  function chainScale(L, ind) {
    var by = {}; L.forEach(function (l) { by[l.ind] = l; });
    var k = 1, p = ind, g = 0;
    while (p != null && g++ < 64) {
      var s = by[p].ks && by[p].ks.s, m = 1;
      if (s) {
        var vals = s.a ? s.k.reduce(function (a, kf) { return a.concat((kf.s || []).slice(0, 2)); }, []) : (s.k || [100, 100]).slice(0, 2);
        m = Math.max.apply(null, vals.map(Math.abs)) / 100 || 1;
      }
      k *= m; p = by[p].parent;
    }
    return k;
  }
  function buildMini(d, S, images, L, run, W, H, ox, oy, k) {
    var by = {}; L.forEach(function (l) { by[l.ind] = l; });
    var inRun = new Set(run.layers.map(function (l) { return l.ind; })), need = new Set();
    run.layers.forEach(function (l) { var p = l.parent; while (p != null && p !== run.anchor) { need.add(p); p = by[p].parent; } });
    var ROOT = 1e6, out = [];
    var fix = function (c) { if (c.parent === run.anchor || c.parent == null) c.parent = ROOT; return c; };
    L.forEach(function (l) {
      if (inRun.has(l.ind)) out.push(fix(clone(l)));
      else if (need.has(l.ind)) {
        var n = { ddd: 0, ind: l.ind, ty: 3, nm: l.nm, ks: clone(l.ks), ip: 0, op: d.op, st: 0, sr: 1 };
        if (l.parent != null) n.parent = l.parent; out.push(fix(n));
      }
    });
    out.forEach(function (c) { c.ip = 0; c.op = d.op; });
    out.unshift({ ddd: 0, ind: ROOT, ty: 3, nm: 'ROOT', ip: 0, op: d.op, st: 0, sr: 1,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [ox, oy, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [k * 100, k * 100, 100] } } });
    var assets = [], seen = new Set();
    (function add(layers) {
      layers.forEach(function (l) {
        var r = l.refId; if (!r || seen.has(r)) return; seen.add(r);
        if (S.comps[r]) { assets.push(S.comps[r]); add(S.comps[r].layers); } else if (images[r]) assets.push(images[r]);
      });
    })(out);
    var m = { v: d.v, fr: d.fr, ip: 0, op: 1, w: W, h: H, nm: 'mini', ddd: 0, assets: clone(assets), layers: out };
    if (d.fonts) m.fonts = clone(d.fonts);
    if (d.chars) m.chars = clone(d.chars);   // lottie-web 가 글리프 데이터를 고쳐 쓰므로 매번 새 사본
    return m;
  }
  async function renderMini(m, wantBox) {
    var el = stage(); el.style.width = Math.max(1, Math.ceil(m.w)) + 'px'; el.style.height = Math.max(1, Math.ceil(m.h)) + 'px';
    var anim;
    try {
      anim = await load(m, el); anim.goToAndStop(0, true);
      if (wantBox) {
        var host = el.getBoundingClientRect(), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        el.querySelectorAll('path,image,rect,ellipse,circle,line,polygon,polyline,text,use').forEach(function (e) {
          if (e.closest('defs')) return;
          var r = e.getBoundingClientRect(); if (!r.width && !r.height) return;
          x0 = Math.min(x0, r.left - host.left); y0 = Math.min(y0, r.top - host.top);
          x1 = Math.max(x1, r.right - host.left); y1 = Math.max(y1, r.bottom - host.top);
        });
        return x1 < x0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
      }
      return await svgToCanvas(el.querySelector('svg'), Math.max(1, Math.ceil(m.w)), Math.max(1, Math.ceil(m.h)));
    } finally { if (anim) anim.destroy(); el.remove(); }
  }
  function cropCanvas(cv, b) {
    var w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(cv, b.x0, b.y0, w, h, 0, 0, w, h); return o;
  }
  async function stepRaster(d, opt, st, progress) {
    var S = makeStatic(d), images = {};
    (d.assets || []).forEach(function (a) { if (a.p) images[a.id] = a; });
    var BASE = opt.rasterScale > 0 ? opt.rasterScale : 2;
    var MAX_PX = 4096, PAD = 120, nRuns = 0, nLayers = 0, nEmpty = 0, nSkip = 0, nextId = 0;
    var lists = [d.layers].concat(Object.keys(S.comps).map(function (k) { return S.comps[k].layers; }));
    var plans = lists.map(function (L) { return { L: L, runs: findRuns(L, S, opt.minRun || 2) }; });
    var total = plans.reduce(function (a, p) { return a + p.runs.length; }, 0), done = 0;
    for (var pi = 0; pi < plans.length; pi++) {
      var L = plans[pi].L;
      for (var ri = 0; ri < plans[pi].runs.length; ri++) {
        var run = plans[pi].runs[ri]; done++;
        if (progress) progress('움직이지 않는 부분 이미지화 ' + done + '/' + total);
        try {
          var box = null;
          var bb = await renderMini(buildMini(d, S, images, L, run, 100, 100, 0, 0, 1), true);
          if (bb) {
            var bx = bb.x0 - PAD, by = bb.y0 - PAD, bw = bb.x1 - bb.x0 + 2 * PAD, bh = bb.y1 - bb.y0 + 2 * PAD;
            if (bw * bh * BASE * BASE < 4e6) box = { x: bx, y: by, w: bw, h: bh };
            else {
              var k1 = Math.min(1, 2000 / Math.max(bw, bh));
              var c1 = await renderMini(buildMini(d, S, images, L, run, bw * k1, bh * k1, -bx * k1, -by * k1, k1), false);
              var a1 = alphaBox(c1);
              if (a1) box = { x: bx + (a1.x0 - 2) / k1, y: by + (a1.y0 - 2) / k1, w: (a1.x1 - a1.x0 + 5) / k1, h: (a1.y1 - a1.y0 + 5) / k1 };
            }
          }
          var inRun = new Set(run.layers.map(function (l) { return l.ind; }));
          var referenced = new Set(L.filter(function (l) { return l.parent != null && !inRun.has(l.ind); }).map(function (l) { return l.parent; }));
          var replacement = [];
          if (box) {
            var k = Math.min(BASE * chainScale(L, run.anchor), MAX_PX / Math.max(box.w, box.h));
            var c2 = await renderMini(buildMini(d, S, images, L, run, box.w * k, box.h * k, -box.x * k, -box.y * k, k), false);
            var a2 = alphaBox(c2);
            if (a2) {
              var cc = cropCanvas(c2, a2), id = 'rs_' + (nextId++);
              var asset = { id: id, w: cc.width, h: cc.height, u: '', p: 'data:image/png;base64,' + bytesToB64(await canvasToPng(cc)), e: 1 };
              d.assets.push(asset); images[id] = asset;
              var img = { ddd: 0, ind: 2e6 + nextId, ty: 2, nm: 'static: ' + run.layers[0].nm + (run.layers.length > 1 ? ' +' + (run.layers.length - 1) : ''),
                refId: id, sr: 1, ao: 0, ip: 0, op: d.op, st: 0, bm: 0,
                ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [box.x + a2.x0 / k, box.y + a2.y0 / k, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100 / k, 100 / k, 100] } } };
              if (run.anchor != null) img.parent = run.anchor;
              replacement.push(img);
            } else nEmpty++;
          } else nEmpty++;
          run.layers.forEach(function (l) {
            if (!referenced.has(l.ind)) return;
            var n = { ddd: 0, ind: l.ind, ty: 3, nm: l.nm, ks: l.ks, ip: l.ip, op: l.op, st: l.st || 0, sr: 1 };
            if (l.parent != null) n.parent = l.parent; replacement.push(n);
          });
          var next = [], placed = false;
          L.forEach(function (l) {
            if (inRun.has(l.ind)) { if (!placed) { next.push.apply(next, replacement); placed = true; } return; }
            next.push(l);
          });
          L.splice.apply(L, [0, L.length].concat(next));
          nRuns++; nLayers += run.layers.length;
        } catch (e) { nSkip++; }
        await tick();
      }
    }
    st.raster = '구간 ' + nRuns + '개, 레이어 ' + nLayers + '개 → 이미지' + (nEmpty ? ', 빈 구간 ' + nEmpty + '개 삭제' : '') + (nSkip ? ', 건너뜀 ' + nSkip + '개' : '') + ' (배율 ' + BASE + ')';
  }

  // 흐린 이미지(그림자·블러 배경 등)는 해상도를 낮춰도 똑같이 보인다 → 줄였다가 다시 키웠을 때 차이가 거의 없으면 줄인다.
  // 에셋의 w·h 는 그대로 둔다(재생기가 그 크기로 늘려 그린다).
  function premul(cv) {
    var D = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, o = new Float32Array(cv.width * cv.height * 4);
    for (var i = 0; i < D.length; i += 4) { var al = D[i + 3] / 255; o[i] = D[i] * al; o[i + 1] = D[i + 1] * al; o[i + 2] = D[i + 2] * al; o[i + 3] = D[i + 3]; }
    return o;
  }
  function resized(src, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h); return c;
  }
  async function stepDownscale(d, st, progress) {
    var list = (d.assets || []).filter(function (a) { return a.p && a.p.indexOf('data:image/') === 0; });
    var n = 0, before = 0, after = 0;
    for (var i = 0; i < list.length; i++) {
      var a = list[i], bmp = await decodeData(a.p), W = bmp.width, H = bmp.height;
      if (W * H < 40000) continue;
      var orig = resized(bmp, W, H), O = premul(orig), best = null;
      for (var f of [0.25, 0.33, 0.5]) {
        var w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));
        var back = premul(resized(resized(orig, w, h), W, H)), sum = 0, hist = new Uint32Array(256), cnt = O.length;
        for (var k = 0; k < cnt; k++) { var e = Math.abs(O[k] - back[k]); sum += e; hist[Math.min(255, e | 0)]++; }
        var acc = 0, p99 = 0; for (var b = 0; b < 256; b++) { acc += hist[b]; if (acc >= cnt * 0.999) { p99 = b; break; } }
        if (sum / cnt < 0.6 && p99 <= 6) { best = { w: w, h: h }; break; }
      }
      if (progress && i % 4 === 0) progress('흐린 이미지 해상도 조정 ' + (i + 1) + '/' + list.length);
      if (!best) continue;
      var png = await canvasToPng(resized(orig, best.w, best.h)), old = dataBytes(a.p);
      before += old; after += png.length; n++;
      if (a.w == null) { a.w = W; a.h = H; }
      a.p = 'data:image/png;base64,' + bytesToB64(png);
    }
    st.downscale = '흐린 이미지 ' + n + '개 해상도 낮춤' + (n ? ' (' + mb(before) + ' → ' + mb(after) + ', PNG 기준)' : '');
  }

  // ================= 실행 =================
  var DEFAULTS = { raster: true, downscale: true, webp: true, quality: 0.85, trim: true, drop: true, bake: true, assets: true, glyphs: true, round: true, rasterScale: 2, minRun: 2 };
  async function optimize(src, opt, progress) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    var d = clone(src), st = {};
    if (!d.assets) d.assets = [];
    if (opt.raster) await stepRaster(d, opt, st, progress);
    if (opt.downscale) await stepDownscale(d, st, progress);
    if (opt.webp) await stepWebp(d, opt.quality, st, progress);
    if (progress) progress('구조 정리');
    if (opt.trim) stepTrim(d, st);
    if (opt.drop) stepDrop(d, st);
    if (opt.bake) stepBake(d, st);
    if (opt.assets) stepAssets(d, st);
    if (opt.glyphs) stepGlyphs(d, st);
    if (opt.round) d = rnd(d);
    d.meta = d.meta || {}; d.meta.g = (d.meta.g || '') + ' + Lottie Optimizer ' + VERSION;
    return { data: d, steps: st };
  }

  // PNG 상태의 결과를 품질 q 로 WebP 변환한 사본 (자동 품질 조정용)
  async function encodeImages(d, q, progress) { var c = clone(d), st = {}; await stepWebp(c, q, st, progress); return { data: c, steps: st }; }

  // 자동: 재생 비용이 기준을 넘을 때만 이미지화하고, 받는 양이 기준을 넘으면 WebP 품질을 0.85 → 0.75 → 0.65 로 낮춘다.
  async function autoOptimize(src, progress, override) {
    if (progress) progress('점검');
    var c0 = await check(src), m0 = await measure(src);
    var opt = Object.assign({ raster: !m0.ok }, override || {}, { webp: false });
    var base = await optimize(src, opt, progress), out = null, c1 = null, q = null;
    var qs = (override && override.quality) ? [override.quality] : [0.85, 0.75, 0.65];
    for (var i = 0; i < qs.length; i++) {
      q = qs[i]; out = (override && override.webp === false) ? { data: base.data, steps: {} } : await encodeImages(base.data, q, progress);
      c1 = await check(out.data);
      if (c1.transferBytes <= LIMITS.transferBytes || (override && override.webp === false)) break;
    }
    if (progress) progress('재생 비용 측정');
    var m1 = await measure(out.data);
    var steps = Object.assign({}, base.steps, out.steps);
    return { data: out.data, steps: steps, quality: (override && override.webp === false) ? null : q, raster: opt.raster,
      before: { check: c0, measure: m0 }, after: { check: c1, measure: m1 } };
  }

  // ================= 저장 =================
  function extOf(p) { var m = /^data:image\/(\w+)/.exec(p); return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png'; }
  function splitImages(d, prefix) {
    var out = clone(d), files = [], n = 0;
    (out.assets || []).forEach(function (a) {
      if (!a.p || a.p.indexOf('data:') !== 0) return;
      var name = 'img_' + (n++) + '.' + extOf(a.p);
      files.push({ name: name, bytes: b64ToBytes(a.p.slice(a.p.indexOf(',') + 1)) });
      a.u = prefix; a.p = name; a.e = 0;
    });
    return { data: out, files: files };
  }
  async function packZip(d, baseName) {
    var s = splitImages(d, 'images/'), zip = new root.JSZip();
    zip.file(baseName + '.json', JSON.stringify(s.data));
    s.files.forEach(function (f) { zip.file('images/' + f.name, f.bytes); });
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
  async function packDotLottie(d, id) {
    id = id || 'animation';
    var s = splitImages(d, '/images/'), zip = new root.JSZip();
    zip.file('manifest.json', JSON.stringify({ version: '1.0', generator: 'Lottie Optimizer ' + VERSION, author: '',
      animations: [{ id: id, speed: 1, loop: true, autoplay: true }] }));
    zip.file('animations/' + id + '.json', JSON.stringify(s.data));
    s.files.forEach(function (f) { zip.file('images/' + f.name, f.bytes); });
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
  function mb(n) { return n >= 1e5 ? (n / 1e6).toFixed(2) + 'MB' : Math.max(1, Math.round(n / 1e3)) + 'KB'; }

  root.LottieOptimizer = { VERSION: VERSION, LIMITS: LIMITS, DEFAULTS: DEFAULTS, check: check, measure: measure, optimize: optimize,
    compare: compare, snapshot: snapshot, encodeImages: encodeImages, autoOptimize: autoOptimize, splitImages: splitImages, packZip: packZip, packDotLottie: packDotLottie, mb: mb };
})(typeof window !== 'undefined' ? window : this);
