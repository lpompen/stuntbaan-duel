/* Stuntbaan Duel - 3D-weergave (three.js). Het spel zelf blijft 2D; deze module zet de baan,
   het landschap en de auto's als echte 3D-wereld in beeld. Lukt WebGL niet, dan tekent main.js in 2D. */
(function () {
  'use strict';
  const T3 = window.THREE;
  const V = window.View3D = { ok: false, failed: !T3, horizon: 0, cam2d: { x: 0, y: 0, z: 30 } };
  if (!T3) return;

  let A, E, renderer, scene, camera, sun, hemi, aniso = 1, W = 1, H = 1;
  const LW = 3.2, HW = LW / 2, TH = 0.42, DROP = 0.36, Z_FRONT = 6.5, FOV = 38;
  const PITCH = 3.7;                 // afstand tussen twee banen naast elkaar
  const LIFT = [0, 0, 1.2, 3.6, 8.5];
  // rijen van het landschap, van voor naar achter; het vlakke deel is breed genoeg voor alle banen
  const rowsFor = n => { const f = 2 * n * PITCH + 3.5; return [Z_FRONT, -f, -f - 9, -f - 22, -f - 50]; };
  const col = h => new T3.Color(h).convertSRGBToLinear();
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function canvas(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
  function tex(cvs, repeat) {
    const t = new T3.CanvasTexture(cvs); t.encoding = T3.sRGBEncoding; t.anisotropy = aniso;
    if (repeat) t.wrapS = t.wrapT = T3.RepeatWrapping;
    return t;
  }
  function geo(pos, idx, uv, nor) {
    const g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.Float32BufferAttribute(pos, 3));
    if (uv) g.setAttribute('uv', new T3.Float32BufferAttribute(uv, 2));
    if (nor) g.setAttribute('normal', new T3.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    if (!nor) g.computeVertexNormals();
    return g;
  }
  const std = o => new T3.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0 }, o));

  // sfeer per thema: licht, mist en materialen
  const LOOK = {
    desert: { sun: '#fff0d2', sunI: 1.3, dir: [-0.5, 1, 0.55], sky: '#d6ecff', gnd: '#dba76a', hemiI: 0.85, fog: '#f4dfb8', fogN: 70, fogF: 240, top: 'sand', face: 'earth', rail: ['#ffffff', '#e8382f'], pit: '#1c0f08' },
    neon: { sun: '#c3b0ff', sunI: 0.8, dir: [0.35, 1, 0.6], sky: '#8a5fe0', gnd: '#2a1260', hemiI: 0.95, fog: '#4d1c70', fogN: 55, fogF: 215, top: 'grid', face: 'grid', rail: ['#62f4ff', '#2a1f66'], pit: '#b01f80' },
    ice: { sun: '#fff6e8', sunI: 0.8, dir: [-0.55, 0.8, 0.5], sky: '#b9d6f2', gnd: '#7f9fba', hemiI: 0.55, fog: '#d5e9f6', fogN: 60, fogF: 225, top: 'snow', face: 'ice', rail: ['#ffffff', '#2f8bff'], pit: '#1c5f92' }
  };

  // ------------------------------------------------------------------ texturen
  const TEX = {};
  function speckle(c, w, h, n, cols, rmax) {
    for (let i = 0; i < n; i++) { c.fillStyle = cols[i % cols.length]; c.beginPath(); c.ellipse(hash(i * 1.3) * w, hash(i * 3.7) * h, 1 + hash(i * 5.1) * rmax, 1 + hash(i * 7.3) * rmax * 0.6, hash(i) * 3, 0, 6.2832); c.fill(); }
  }
  function trackTex(th) {
    return tex(canvas(512, 128, (c, w, h) => {
      c.fillStyle = th.track; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,.14)'); g.addColorStop(0.5, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(0,0,0,.14)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      speckle(c, w, h, 160, ['rgba(255,255,255,.08)', 'rgba(0,0,0,.08)'], 3);
      c.fillStyle = th.edge; c.fillRect(0, 10, w, 5); c.fillRect(0, h - 15, w, 5);
      c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(40, h / 2 - 3, 190, 6);
      c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(0, 0, 3, h);
    }), true);
  }
  function kerbTex(a, b) { return tex(canvas(64, 8, (c) => { c.fillStyle = a; c.fillRect(0, 0, 64, 8); c.fillStyle = b; c.fillRect(44, 0, 20, 8); }), true); }
  function topTex(kind, th) {
    return tex(canvas(256, 256, (c, w, h) => {
      if (kind === 'grid') {
        c.fillStyle = '#1b1445'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#62f4ff'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 2); c.lineTo(w, 2); c.moveTo(2, 0); c.lineTo(2, h); c.stroke();
        c.strokeStyle = 'rgba(255,63,180,.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
      } else if (kind === 'snow') {
        c.fillStyle = '#dfeaf4'; c.fillRect(0, 0, w, h);
        speckle(c, w, h, 120, ['rgba(120,165,205,.4)', 'rgba(255,255,255,.95)'], 11);
        c.fillStyle = '#ffffff'; for (let i = 0; i < 60; i++) c.fillRect(hash(i * 9.1) * w, hash(i * 2.7) * h, 2, 2);
      } else {
        c.fillStyle = '#efd08e'; c.fillRect(0, 0, w, h);
        speckle(c, w, h, 220, ['rgba(150,95,45,.22)', 'rgba(255,244,205,.5)'], 5);
        c.strokeStyle = 'rgba(160,105,55,.22)'; c.lineWidth = 3;
        for (let i = 0; i < 9; i++) { const y = (i + 0.5) * h / 9; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y - 9, w * 0.6, y + 9, w, y); c.stroke(); }
      }
    }), true);
  }
  function emisGridTex() {
    return tex(canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#62f4ff'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 2); c.lineTo(w, 2); c.moveTo(2, 0); c.lineTo(2, h); c.stroke();
      c.strokeStyle = 'rgba(255,63,180,.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
    }), true);
  }
  function faceTex(kind, th) {
    return tex(canvas(256, 256, (c, w, h) => {
      if (kind === 'grid') {
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2c2560'); g.addColorStop(1, '#0d0922'); c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(98,244,255,.55)'; c.lineWidth = 3; c.beginPath(); for (let i = 0; i <= 4; i++) { c.moveTo(0, i * 64 + 1); c.lineTo(w, i * 64 + 1); c.moveTo(i * 64 + 1, 0); c.lineTo(i * 64 + 1, h); } c.stroke();
      } else {
        const bands = kind === 'ice' ? ['#f2fbff', '#cfe6f5', '#b3d4ea', '#dcedf8', '#9cc4de'] : ['#e9c27e', '#d6a55f', '#c08a4a', '#dab06a', '#a9733c'];
        let y = 0, i = 0;
        while (y < h) { const bh = 22 + hash(i * 3.3) * 34; c.fillStyle = bands[i % bands.length]; c.fillRect(0, y, w, bh + 1); y += bh; i++; }
        speckle(c, w, h, 200, kind === 'ice' ? ['rgba(90,150,200,.25)', 'rgba(255,255,255,.6)'] : ['rgba(100,58,22,.28)', 'rgba(255,240,200,.3)'], 6);
        c.strokeStyle = kind === 'ice' ? 'rgba(80,140,190,.3)' : 'rgba(90,50,20,.25)'; c.lineWidth = 2;
        for (let k = 0; k < 7; k++) { const yy = hash(k * 4.1) * h; c.beginPath(); c.moveTo(0, yy); c.bezierCurveTo(w * 0.3, yy + 10, w * 0.7, yy - 10, w, yy); c.stroke(); }
      }
    }), true);
  }
  function chevronTex() {
    return tex(canvas(128, 64, (c, w, h) => {
      c.fillStyle = 'rgba(255,214,60,.82)'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffffff'; c.lineWidth = 11; c.lineJoin = 'miter'; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(22, 6); c.lineTo(56, 32); c.lineTo(22, 58); c.stroke();
      c.strokeStyle = '#ff5a1f'; c.beginPath(); c.moveTo(74, 6); c.lineTo(108, 32); c.lineTo(74, 58); c.stroke();
    }), true);
  }
  function checkerTex() { return tex(canvas(64, 64, (c) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { c.fillStyle = (x + y) % 2 ? '#15171c' : '#ffffff'; c.fillRect(x * 16, y * 16, 16, 16); } }), true); }
  function boardTex(txt, bg, fg, chk) {
    return tex(canvas(512, 128, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      for (let q = 0; q < 32; q++) { c.fillStyle = q % 2 ? chk : '#ffffff'; c.fillRect(q * 16, 0, 16, 16); c.fillStyle = q % 2 ? '#ffffff' : chk; c.fillRect(q * 16, h - 16, 16, 16); }
      c.fillStyle = fg; c.font = 'italic 900 72px "Segoe UI", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 4);
    }));
  }
  function windowTex(seed, lit) {
    return tex(canvas(64, 128, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      for (let r = 0; r < 10; r++) for (let q = 0; q < 4; q++) if (hash(seed + r * 7.3 + q * 3.1) > 0.45) { c.fillStyle = lit[Math.floor(hash(seed * 2 + r + q * 5) * lit.length)]; c.fillRect(6 + q * 14, 6 + r * 12, 8, 7); }
    }), true);
  }
  function warnTex() {
    return tex(canvas(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.fillStyle = '#ffd23f'; c.strokeStyle = '#15171c'; c.lineWidth = 9; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(64, 10); c.lineTo(120, 114); c.lineTo(8, 114); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#15171c'; c.fillRect(57, 44, 14, 40); c.beginPath(); c.arc(64, 98, 8, 0, 6.2832); c.fill();
    }));
  }
  function softTex() { return tex(canvas(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); })); }
  function squareTex() { return tex(canvas(8, 8, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 8, 8); })); }
  function ringTex() { return tex(canvas(128, 128, (c) => { c.strokeStyle = '#fff'; c.lineWidth = 9; c.beginPath(); c.arc(64, 64, 56, 0, 6.2832); c.stroke(); })); }

  // ------------------------------------------------------------------ baan en landschap
  function runsOf(T) {
    const runs = []; let run = null;
    for (let i = 1; i < T.n - 1; i++) {
      const ok = !(T.FL[i] & (E.F_CLIFF | E.F_PIT));
      if (ok) { if (!run) run = [i]; run.push(i + 1); }
      if ((!ok || i === T.n - 2) && run) { if (run.length > 1) runs.push(run); run = null; }
    }
    return runs;
  }
  // normaal van het rijvlak per punt van een stuk baan (3D: y omhoog)
  function runNormals(T, idx) {
    const m = idx.length, N = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      let ax = 0, ay = 0;
      if (k < m - 1) { ax += T.TY[idx[k]]; ay += T.TX[idx[k]]; }
      if (k > 0) { ax += T.TY[idx[k - 1]]; ay += T.TX[idx[k - 1]]; }
      const l = Math.hypot(ax, ay) || 1; N[k * 2] = ax / l; N[k * 2 + 1] = ay / l;
    }
    return N;
  }

  function buildRibbon(T, Z, runs, th, L, G, lanes) {
    const tp = [], tn = [], tu = [], ti = [];       // rijvlak
    const bp = [], bi = [];                         // zijkanten en onderkant
    const rp = [], ru = [], ri = [];                // stootranden
    const RH = 0.15, RW = 0.2;
    for (const idx of runs) {
      const N = runNormals(T, idx), m = idx.length, t0 = tp.length / 3, b0 = bp.length / 3, r0 = rp.length / 3;
      for (let k = 0; k < m; k++) {
        const i = idx[k], x = T.X[i], y = -T.Y[i], z = -Z[i], nx = N[k * 2], ny = N[k * 2 + 1], u = T.S[i] / 6;
        tp.push(x, y, z + HW, x, y, z - HW); tn.push(nx, ny, 0, nx, ny, 0); tu.push(u, 0, u, 1);
        bp.push(x, y, z + HW, x - nx * TH, y - ny * TH, z + HW, x - nx * TH, y - ny * TH, z - HW, x, y, z - HW);
        for (const s of [1, -1]) {
          const ze = z + s * HW, zi = ze - s * RW, ku = T.S[i] / 3.2;
          rp.push(x, y, ze, x + nx * RH, y + ny * RH, ze, x + nx * RH, y + ny * RH, zi, x, y, zi);
          ru.push(ku, 0.5, ku, 0.5, ku, 0.5, ku, 0.5);
        }
        if (k < m - 1) {
          const a = t0 + k * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          const b = b0 + k * 4; for (let q = 0; q < 3; q++) bi.push(b + q, b + q + 4, b + q + 1, b + q + 1, b + q + 4, b + q + 5);
          for (let s = 0; s < 2; s++) { const r = r0 + k * 8 + s * 4; for (let q = 0; q < 3; q++) ri.push(r + q, r + q + 8, r + q + 1, r + q + 1, r + q + 8, r + q + 9); }
        }
      }
    }
    const glow = L === LOOK.neon;
    const top = new T3.Mesh(geo(tp, ti, tu, tn), std({ map: TEX.track, roughness: 0.55, side: T3.DoubleSide, emissive: glow ? col(th.track) : col('#000'), emissiveIntensity: glow ? 0.35 : 0, emissiveMap: glow ? TEX.track : null }));
    top.receiveShadow = true; G.add(top);
    const body = new T3.Mesh(geo(bp, bi), std({ color: col(th.trackDark), roughness: 0.7, flatShading: true, side: T3.DoubleSide, emissive: glow ? col(th.trackDeep) : col('#000'), emissiveIntensity: glow ? 0.5 : 0 }));
    body.castShadow = true; body.receiveShadow = true; G.add(body);
    const rails = new T3.Mesh(geo(rp, ri, ru), std({ map: TEX.kerb, roughness: 0.6, flatShading: true, side: T3.DoubleSide, emissive: glow ? col('#62f4ff') : col('#000'), emissiveIntensity: glow ? 0.45 : 0, emissiveMap: glow ? TEX.kerb : null }));
    rails.receiveShadow = true; G.add(rails);
    for (let j = 1; j < lanes; j++) for (const src of [top, body, rails]) {
      const m = new T3.Mesh(src.geometry, src.material); m.position.z = -j * PITCH; m.castShadow = src.castShadow; m.receiveShadow = true; G.add(m);
    }
  }

  function buildTerrain(T, L, G, ROWS) {
    const n = T.n, xs = [], ys = [], deep = [];
    const isPit = y => { for (const gp of T.gaps) if (Math.abs(y - gp.pitY) < 0.01) return true; return false; };
    xs.push(T.X[0] - 120); ys.push(-T.Y[0]); deep.push(false);
    for (let i = 0; i < n; i++) if (!(T.FL[i] & E.F_INLOOP)) { xs.push(T.X[i]); ys.push(-T.Y[i]); deep.push(isPit(T.Y[i])); }
    xs.push(T.X[n - 1] + 120); ys.push(-T.Y[n - 1]); deep.push(false);
    const m = xs.length, R = ROWS.length, bottom = -(T.maxY + 60);
    const wob = (x, r) => LIFT[r] * (0.55 + 0.45 * Math.sin(x * 0.021 + r * 2.1) + 0.25 * Math.sin(x * 0.057 + r * 1.3));
    const pos = [], uv = [], idx = [], cl = [], fp = [], fu = [], fn = [], fi = [], fc = [];
    for (let k = 0; k < m; k++) {
      const dk = deep[k] ? 0.16 : 1;
      for (let r = 0; r < R; r++) {
        pos.push(xs[k], ys[k] - DROP + (deep[k] ? 0 : wob(xs[k], r)), ROWS[r]); uv.push(xs[k] / 8, ROWS[r] / 8);
        // lichte kleurvlekken, zodat het landschap geen egaal vlak is
        const v = dk * (0.86 + 0.14 * (0.5 + 0.5 * Math.sin(xs[k] * 0.045 + r * 1.9) * Math.cos(xs[k] * 0.013 + r)));
        cl.push(v, v, v);
      }
      fp.push(xs[k], ys[k] - DROP, Z_FRONT, xs[k], bottom, Z_FRONT); fn.push(0, 0, 1, 0, 0, 1); fc.push(dk, dk, dk, 0.55, 0.55, 0.55); fu.push(xs[k] / 14, (ys[k] - DROP) / 14, xs[k] / 14, bottom / 14);
      if (k < m - 1) {
        for (let r = 0; r < R - 1; r++) { const a = k * R + r; idx.push(a, a + R, a + 1, a + 1, a + R, a + R + 1); }
        const f = k * 2; fi.push(f, f + 1, f + 2, f + 2, f + 1, f + 3);
      }
    }
    const neon = L === LOOK.neon;
    const tg = geo(pos, idx, uv); tg.setAttribute('color', new T3.Float32BufferAttribute(cl, 3));
    const fg = geo(fp, fi, fu, fn); fg.setAttribute('color', new T3.Float32BufferAttribute(fc, 3));
    const top = new T3.Mesh(tg, std({ map: TEX.top, roughness: 1, flatShading: true, vertexColors: true, side: T3.DoubleSide, emissive: neon ? col('#ffffff') : col('#000'), emissiveMap: neon ? TEX.topEmis : null, emissiveIntensity: neon ? 0.7 : 0 }));
    top.receiveShadow = true; G.add(top);
    const face = new T3.Mesh(fg, std({ map: TEX.face, roughness: 1, vertexColors: true, side: T3.DoubleSide, emissive: neon ? col('#ffffff') : col('#000'), emissiveMap: neon ? TEX.faceEmis : null, emissiveIntensity: neon ? 0.5 : 0 }));
    G.add(face);
    // hoogte van het landschap op een willekeurige plek achter of voor de baan
    return (k, z) => {
      let r = 0; while (r < R - 2 && z < ROWS[r + 1]) r++;
      const t = clamp((ROWS[r] - z) / (ROWS[r] - ROWS[r + 1]), 0, 1);
      return ys[k] - DROP + (deep[k] ? 0 : wob(xs[k], r) * (1 - t) + wob(xs[k], r + 1) * t);
    };
  }

  // ------------------------------------------------------------------ decor
  const SHARED = {};
  function shared() {
    if (SHARED.done) return SHARED;
    SHARED.done = true;
    SHARED.cyl = new T3.CylinderGeometry(1, 1, 1, 10); SHARED.cylTop = new T3.CylinderGeometry(0.75, 1, 1, 10);
    SHARED.sph = new T3.SphereGeometry(1, 14, 10); SHARED.cone = new T3.ConeGeometry(1, 1, 9);
    SHARED.rock = new T3.DodecahedronGeometry(1, 0); SHARED.box = new T3.BoxGeometry(1, 1, 1);
    SHARED.plane = new T3.PlaneGeometry(1, 1);
    return SHARED;
  }
  function part(G, g, mat, x, y, z, sx, sy, sz, shadow) {
    const m = new T3.Mesh(g, mat); m.position.set(x, y, z); m.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    if (shadow !== false) m.castShadow = true; G.add(m); return m;
  }
  function buildProps(T, Z, L, theme, tY, G, ROWS, lanes) {
    const S = shared(), n = T.n, M = {};
    const mat = (k, o) => M[k] || (M[k] = std(o));
    const glowMat = (k, hex) => M[k] || (M[k] = new T3.MeshBasicMaterial({ color: col(hex) }));
    const sprite = (hex, x, y, z, s) => { const sp = new T3.Sprite(new T3.SpriteMaterial({ map: TEX.soft, color: col(hex), blending: T3.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 })); sp.position.set(x, y, z); sp.scale.set(s, s, 1); G.add(sp); };
    // k = index in de grondlijn (1-gebaseerd door het extra beginpunt)
    const ground = []; for (let i = 0; i < n; i++) if (!(T.FL[i] & E.F_INLOOP)) ground.push(i);
    let next = 12;
    for (let k = 3; k < ground.length - 3; k++) {
      const i = ground[k], gk = k + 1;
      if (T.S[i] < next) continue;
      if ((T.FL[i] & (E.F_LOOP | E.F_CLIFF | E.F_PIT)) || (T.FL[ground[k + 1]] & (E.F_CLIFF | E.F_PIT)) || (T.FL[ground[k - 1]] & (E.F_CLIFF | E.F_PIT)) || Math.abs(T.TY[i]) > 0.35) continue;
      next = T.S[i] + 5 + hash(i) * 9;
      const h1 = hash(i * 1.37), h2 = hash(i * 2.9), front = h1 > 0.9;
      const z = front ? 3.6 + h2 * 2.2 : ROWS[1] - 2 - h2 * 22, x = T.X[i], y = tY(gk, z), s = 0.8 + hash(i * 4.4) * 0.7, near = z > ROWS[1] - 12;
      if (front) { part(G, S.rock, mat('rock' + theme, { color: col(theme === 'ice' ? '#bfe0f2' : theme === 'neon' ? '#3a2f80' : '#a8643f'), flatShading: true, roughness: 1 }), x, y + 0.2, z, 0.5 * s, 0.35 * s, 0.45 * s); continue; }
      if (theme === 'desert') {
        if (h1 < 0.4) {
          const gm = mat('cactus', { color: col('#3d8f4d'), roughness: 0.9 });
          part(G, S.cyl, gm, x, y + 1.5 * s, z, 0.3 * s, 3 * s, 0.3 * s); part(G, S.sph, gm, x, y + 3 * s, z, 0.3 * s);
          part(G, S.cyl, gm, x - 0.55 * s, y + 1.5 * s, z, 0.19 * s, 1.1 * s, 0.19 * s); part(G, S.cyl, gm, x - 0.3 * s, y + 1.05 * s, z, 0.19 * s, 0.6 * s, 0.19 * s).rotation.z = Math.PI / 2;
          part(G, S.cyl, gm, x + 0.5 * s, y + 2.0 * s, z, 0.17 * s, 0.9 * s, 0.17 * s); part(G, S.cyl, gm, x + 0.27 * s, y + 1.62 * s, z, 0.17 * s, 0.55 * s, 0.17 * s).rotation.z = Math.PI / 2;
          part(G, S.sph, mat('bloom', { color: col('#ff7aa8') }), x, y + 3.32 * s, z, 0.13 * s);
        } else if (h1 < 0.72) {
          const rm = mat('rockD', { color: col('#b06a44'), flatShading: true, roughness: 1 }), rm2 = mat('rockD2', { color: col('#8d4f31'), flatShading: true, roughness: 1 });
          part(G, S.rock, rm, x, y + 0.7 * s, z, 1.5 * s, 1.1 * s, 1.2 * s).rotation.y = h2 * 6; part(G, S.rock, rm2, x + 1.5 * s, y + 0.4 * s, z + 0.5, 0.8 * s, 0.6 * s, 0.8 * s);
        } else {
          const bm = mat('bush', { color: col('#8a8f3c'), flatShading: true, roughness: 1 });
          part(G, S.rock, bm, x, y + 0.45 * s, z, 0.8 * s, 0.55 * s, 0.8 * s); part(G, S.rock, bm, x + 0.7 * s, y + 0.3 * s, z + 0.3, 0.5 * s, 0.38 * s, 0.5 * s);
        }
      } else if (theme === 'neon') {
        if (h1 < 0.42 && near) {
          const hex = h2 > 0.5 ? '#62f4ff' : '#ff3fb4';
          part(G, S.cyl, mat('pole', { color: col('#4a418c'), roughness: 0.6 }), x, y + 2.4, z, 0.09, 4.8, 0.09);
          part(G, S.sph, glowMat('lamp' + hex, hex), x, y + 4.9, z, 0.24, 0.24, 0.24, false); sprite(hex, x, y + 4.9, z, 4.2);
        } else if (h1 < 0.62 && near) {
          const hex = h2 > 0.5 ? '#62f4ff' : '#ff3fb4';
          part(G, S.box, mat('bbPost', { color: col('#30295e') }), x - 1.5, y + 1.2, z, 0.16, 2.4, 0.16); part(G, S.box, mat('bbPost', {}), x + 1.5, y + 1.2, z, 0.16, 2.4, 0.16);
          part(G, S.box, mat('bbBack', { color: col('#120c2c') }), x, y + 3.3, z, 3.8, 2.0, 0.14);
          part(G, S.box, glowMat('bbFrame' + hex, hex), x, y + 4.32, z + 0.02, 3.9, 0.08, 0.18, false); part(G, S.box, glowMat('bbFrame' + hex, hex), x, y + 2.28, z + 0.02, 3.9, 0.08, 0.18, false);
          const pm = part(G, S.plane, new T3.MeshBasicMaterial({ map: TEX.chev, transparent: true }), x, y + 3.3, z + 0.09, 3.4, 1.6, 1, false); pm.userData.bb = true;
        } else {
          // gebouw met verlichte ramen
          const v = Math.floor(h2 * 3), w = 7 + hash(i * 7.7) * 7, hh = 9 + hash(i * 3.1) * 26, zz = Math.min(z, ROWS[1] - 14) - hash(i * 5.3) * 16;
          const bm = M['bld' + v] || (M['bld' + v] = std({ color: col(['#2a1f66', '#1f1750', '#33206e'][v]), roughness: 0.9, emissive: col('#ffffff'), emissiveMap: TEX['win' + v], emissiveIntensity: 1.1 }));
          part(G, S.box, bm, x, tY(gk, zz) + hh / 2 - 1, zz, w, hh, 7 + hash(i) * 5, false);
          if (hash(i * 9.9) > 0.5) { part(G, S.cyl, mat('ant', { color: col('#4a418c') }), x, tY(gk, zz) + hh + 1.2, zz, 0.06, 4, 0.06, false); part(G, S.sph, glowMat('antL', '#ff3030'), x, tY(gk, zz) + hh + 3.2, zz, 0.2, 0.2, 0.2, false); }
          next += 6;
        }
      } else {
        if (h1 < 0.62) {
          const tm = mat('trunk', { color: col('#5b4032'), roughness: 1 }), pm = mat('pine', { color: col('#1d5a45'), flatShading: true, roughness: 1 }), sm = mat('snowcap', { color: col('#f6fcff'), flatShading: true, roughness: 1 });
          part(G, S.cyl, tm, x, y + 0.5 * s, z, 0.16 * s, 1.0 * s, 0.16 * s);
          for (let q = 0; q < 3; q++) { const r = (1.35 - q * 0.33) * s, yy = y + (1.3 + q * 1.05) * s; part(G, S.cone, pm, x, yy, z, r, 1.7 * s, r); part(G, S.cone, sm, x, yy + 0.5 * s, z, r * 0.5, 0.72 * s, r * 0.5); }
        } else if (h1 < 0.82) {
          const im = mat('iceRock', { color: col('#bfe0f2'), flatShading: true, roughness: 0.4 });
          part(G, S.rock, im, x, y + 0.7 * s, z, 1.2 * s, 1.4 * s, 1.0 * s).rotation.y = h2 * 6; part(G, S.rock, im, x + 1.2 * s, y + 0.4 * s, z, 0.6 * s, 0.8 * s, 0.6 * s);
        } else {
          const wm = mat('snowman', { color: col('#ffffff'), roughness: 1 });
          part(G, S.sph, wm, x, y + 0.6, z, 0.65); part(G, S.sph, wm, x, y + 1.5, z, 0.48); part(G, S.sph, wm, x, y + 2.2, z, 0.34);
          part(G, S.cone, mat('carrot', { color: col('#ff8a2a') }), x, y + 2.2, z + 0.45, 0.07, 0.4, 0.07).rotation.x = Math.PI / 2;
          part(G, S.cyl, mat('hat', { color: col('#1b2230') }), x, y + 2.62, z, 0.26, 0.4, 0.26); part(G, S.cyl, mat('hat', {}), x, y + 2.44, z, 0.4, 0.06, 0.4);
          part(G, S.cyl, mat('scarf', { color: col('#e8382f') }), x, y + 1.92, z, 0.36, 0.14, 0.36);
        }
      }
    }
    // waarschuwingsbord voor elk ravijn
    for (const gp of T.gaps) {
      const i = Math.max(2, gp.i0 - 6), x = T.X[i], y = -T.Y[i] - DROP, z = -Z[i] - (lanes - 1) * PITCH - HW - 1.3;
      part(G, S.cyl, mat('signPost', { color: col('#5a5f6b') }), x, y + 1.3, z, 0.08, 2.6, 0.08);
      part(G, S.plane, new T3.MeshBasicMaterial({ map: TEX.warn, transparent: true, side: T3.DoubleSide, alphaTest: 0.5 }), x, y + 3.2, z, 2.2, 2.2, 1, false);
    }
  }

  function buildExtras(T, Z, th, L, G, lanes) {
    const span = (lanes - 1) * PITCH;
    const S = shared();
    // boostvlakken: pijlen die over de baan lopen
    const pp = [], pu = [], pi = [];
    for (const p of T.pads) {
      const idx = []; for (let i = p.i0; i <= p.i1; i++) idx.push(i);
      const N = runNormals(T, idx), b0 = pp.length / 3;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k], x = T.X[i] + N[k * 2] * 0.03, y = -T.Y[i] + N[k * 2 + 1] * 0.03, z = -Z[i], u = (T.S[i] - p.s0) / 1.8;
        pp.push(x, y, z + HW - 0.4, x, y, z - HW + 0.4); pu.push(u, 0, u, 1);
        if (k < idx.length - 1) { const a = b0 + k * 2; pi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    if (pp.length) {
      const m = new T3.Mesh(geo(pp, pi, pu), new T3.MeshBasicMaterial({ map: TEX.chev, transparent: true, side: T3.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false }));
      G.add(m);
      for (let j = 1; j < lanes; j++) { const q = new T3.Mesh(m.geometry, m.material); q.position.z = -j * PITCH; G.add(q); }
    }
    // start en finish: boog over de baan en een bord erachter
    const pt = {};
    const gate = (s, txt, bg, fg, chk, hi) => {
      E.pointAt(T, s, pt); const x = pt.x, y = -pt.y, z = -Z[pt.seg];
      const pm = std({ color: col('#d5dae3'), roughness: 0.4, metalness: 0.2 });
      part(G, S.box, pm, x, y + hi / 2 - DROP, z + HW + 0.45, 0.3, hi, 0.3); part(G, S.box, pm, x, y + hi / 2 - DROP, z - span - HW - 0.45, 0.3, hi, 0.3);
      part(G, S.box, std({ map: TEX.checker, roughness: 0.6 }), x, y + hi - DROP, z - span / 2, 0.4, 0.9, span + LW + 1.2);
      const zb = z - span - HW - 0.6;
      const bm = new T3.Mesh(S.plane, new T3.MeshBasicMaterial({ map: boardTex(txt, bg, fg, chk) })); bm.position.set(x, y + hi + 1.3, zb); bm.scale.set(7.2, 1.8, 1); G.add(bm);
      for (const sx of [-3.2, 3.2]) part(G, S.box, pm, x + sx, y + (hi + 0.5) / 2 - DROP, zb - 0.02, 0.2, hi + 0.5, 0.2);
      // geblokte streep op het wegdek
      const dp = new T3.Mesh(S.plane, new T3.MeshBasicMaterial({ map: TEX.checker, polygonOffset: true, polygonOffsetFactor: -3 }));
      dp.rotation.x = -Math.PI / 2; dp.position.set(x, y + 0.04, z - span / 2); dp.scale.set(1.0, span + LW - 0.6, 1); G.add(dp);
    };
    gate(T.finishS, 'FINISH', '#15171c', '#ffd23f', '#15171c', 6.6);
    gate(T.startS + 3, 'START', '#0e3d1c', '#ffffff', '#39d353', 5.6);
    // steunpalen bij loopings
    const pil = std({ color: col(th.pillar), roughness: 0.6, metalness: 0.2 });
    for (const l of T.loops) {
      const gy = -T.Y[l.i0] - DROP, zb = -Math.max(Z[l.i0], Z[l.i1]) - span - HW - 0.7, hw = l.R * 0.9;
      for (const sx of [-1, 1]) {
        part(G, S.cyl, pil, l.cx + sx * hw, gy + l.R * 0.55, zb, 0.2, l.R * 1.1, 0.2);
        const d = part(G, S.cyl, pil, l.cx + sx * (hw - 1.4), gy + l.R * 0.5, zb, 0.09, l.R * 1.15, 0.09); d.rotation.z = sx * 0.25;
      }
      part(G, S.box, pil, l.cx, gy + l.R * 1.1, zb, hw * 2 + 0.5, 0.25, 0.25);
    }
    // jerrycans met benzine op de voorste baan (die van jezelf)
    G.userData.cans = [];
    const canM = std({ color: col('#e8382f'), roughness: 0.35, metalness: 0.3 }), capM = std({ color: col('#ffd23f'), roughness: 0.4, metalness: 0.4 });
    const darkM = std({ color: col('#7a0f0c'), roughness: 0.6 });
    for (const fu of T.fuels || []) {
      const cg = new T3.Group();
      part(cg, S.box, canM, 0, 0, 0, 0.9, 1.1, 0.42);
      part(cg, S.box, darkM, 0, 0, 0.215, 0.62, 0.78, 0.02, false);
      part(cg, S.box, canM, 0.12, 0.66, 0, 0.42, 0.14, 0.12);
      part(cg, S.cyl, capM, -0.3, 0.66, 0, 0.11, 0.22, 0.11);
      const halo = new T3.Sprite(new T3.SpriteMaterial({ map: TEX.soft, color: col('#ffd23f'), blending: T3.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
      halo.scale.set(3, 3, 1); cg.add(halo);
      cg.position.set(fu.x, -fu.y, -Z[fu.seg]); cg.userData.y0 = -fu.y;
      G.add(cg); G.userData.cans.push(cg);
    }
    // rotsblokken (worden per frame op de plek van jouw eigen rotsen gezet)
    G.userData.rocks = [];
    const rockM = std({ color: col(th.pillar === undefined ? '#7d7f88' : '#8a8c96'), flatShading: true, roughness: 0.95 });
    for (const r of T.rocks || []) {
      const m = part(G, S.rock, rockM, 0, 0, 0, r.r * 1.05, r.r, r.r * 1.1);
      m.receiveShadow = true; m.userData.r = r.r; m.userData.s0 = r.s; G.userData.rocks.push(m);
    }
    // bodem van de ravijnen
    for (const gp of T.gaps) {
      const m = new T3.Mesh(S.plane, new T3.MeshBasicMaterial({ color: col(L.pit) }));
      m.rotation.x = -Math.PI / 2; m.position.set((gp.x0 + gp.x1) / 2, -gp.pitY + 0.5, -40); m.scale.set(gp.x1 - gp.x0 + 1, 100, 1); G.add(m);
    }
  }

  const envCache = {};
  function envFor(theme, L) {
    if (envCache[theme]) return envCache[theme];
    const t = new T3.CanvasTexture(canvas(256, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, L.sky); g.addColorStop(0.46, L.fog); g.addColorStop(0.54, L.gnd); g.addColorStop(1, L.gnd);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const r = c.createRadialGradient(w * 0.3, h * 0.22, 0, w * 0.3, h * 0.22, 46); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = r; c.fillRect(0, 0, w, h);
    }));
    t.mapping = T3.EquirectangularReflectionMapping; t.encoding = T3.sRGBEncoding;
    const pm = new T3.PMREMGenerator(renderer); const env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose();
    return (envCache[theme] = env);
  }
  const trackCache = new Map();
  let current = null;
  const _pt = {};
  // lanes = aantal banen naast elkaar (elke auto zijn eigen baan)
  V.setTrack = function (T, th, lanes) {
    lanes = clamp(lanes | 0, 1, 4);
    if (current && current.T === T && current.lanes === lanes) return;
    if (current) scene.remove(current.G);
    const key = T.def.id + ':' + lanes;
    let c = trackCache.get(key);
    if (!c) {
      const L = LOOK[T.theme], G = new T3.Group(), Z = A.laneDepth(T, lanes * PITCH + 0.3), rows = rowsFor(lanes);
      TEX.track = trackTex(th); TEX.kerb = kerbTex(L.rail[0], L.rail[1]); TEX.top = topTex(L.top, th); TEX.face = faceTex(L.face, th);
      buildRibbon(T, Z, runsOf(T), th, L, G, lanes);
      const tY = buildTerrain(T, L, G, rows);
      buildProps(T, Z, L, T.theme, tY, G, rows, lanes);
      buildExtras(T, Z, th, L, G, lanes);
      c = { T: T, G: G, L: L, Z: Z, lanes: lanes, far: rows[rows.length - 1], env: envFor(T.theme, L) }; trackCache.set(key, c);
    }
    current = c; scene.add(c.G); scene.environment = c.env;
    const L = c.L;
    sun.color.copy(col(L.sun)); sun.intensity = L.sunI; hemi.color.copy(col(L.sky)); hemi.groundColor.copy(col(L.gnd)); hemi.intensity = L.hemiI * 0.6;
    scene.fog.color.copy(col(L.fog)); scene.fog.near = L.fogN; scene.fog.far = L.fogF + lanes * 8;
    sunDir.set(L.dir[0], L.dir[1], L.dir[2]).normalize();
    first = true;
  };
  // diepte (van de camera af) van baan 'lane' op booglengte s
  V.depthOf = function (s, lane) {
    if (!current) return 0;
    const T = current.T, Z = current.Z, p = E.pointAt(T, s, _pt), i = p.seg;
    return Z[i] + (Z[i + 1] - Z[i]) * (T.LEN[i] > 0 ? p.u / T.LEN[i] : 0) + (lane | 0) * PITCH;
  };

  // ------------------------------------------------------------------ auto's
  function outlinePts(fn) {
    const pts = []; let cx = 0, cy = 0;
    fn({
      moveTo(x, y) { pts.push([x, y]); cx = x; cy = y; }, lineTo(x, y) { pts.push([x, y]); cx = x; cy = y; },
      quadraticCurveTo(a, b, x, y) { for (let k = 1; k <= 7; k++) { const t = k / 7, u = 1 - t; pts.push([u * u * cx + 2 * u * t * a + t * t * x, u * u * cy + 2 * u * t * b + t * t * y]); } cx = x; cy = y; },
      closePath() { }
    });
    return pts;
  }
  // deel van de veelhoek boven (above = true) of onder de lijn y = c (2D: y omlaag)
  function clipY(pts, c, above) {
    const out = [], inside = p => above ? p[1] <= c : p[1] >= c;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) { const t = (c - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, c]); }
    }
    return out;
  }
  function shapeOf(pts) { const s = new T3.Shape(); pts.forEach((p, i) => { if (i) s.lineTo(p[0], -p[1]); else s.moveTo(p[0], -p[1]); }); s.closePath(); return s; }

  const OUTLINES = [
    p => { p.moveTo(-1.74, 0.3); p.lineTo(-1.82, -0.08); p.quadraticCurveTo(-1.8, -0.24, -1.5, -0.26); p.quadraticCurveTo(-1.0, -0.76, -0.3, -0.78); p.quadraticCurveTo(0.34, -0.78, 0.8, -0.31); p.quadraticCurveTo(1.5, -0.25, 1.78, -0.03); p.quadraticCurveTo(1.86, 0.1, 1.82, 0.3); },
    p => { p.moveTo(-1.64, 0.28); p.lineTo(-1.72, -0.08); p.lineTo(-0.95, -0.2); p.lineTo(0.9, -0.2); p.quadraticCurveTo(1.52, -0.14, 1.78, 0.06); p.lineTo(1.76, 0.28); },
    p => { p.moveTo(-1.78, 0.3); p.lineTo(-1.84, -0.34); p.lineTo(-1.2, -0.5); p.quadraticCurveTo(0.25, -0.58, 1.86, 0.1); p.quadraticCurveTo(1.92, 0.2, 1.84, 0.3); },
    p => { p.moveTo(-1.78, 0.3); p.lineTo(-1.82, -0.34); p.lineTo(-0.55, -0.34); p.lineTo(-0.5, -0.84); p.lineTo(0.42, -0.84); p.quadraticCurveTo(0.78, -0.76, 0.94, -0.33); p.lineTo(1.7, -0.25); p.quadraticCurveTo(1.8, -0.1, 1.78, 0.3); },
    p => { p.moveTo(-1.62, 0.3); p.lineTo(-1.7, -0.02); p.quadraticCurveTo(-1.66, -0.42, -1.05, -0.5); p.quadraticCurveTo(-0.7, -0.98, -0.05, -1.0); p.quadraticCurveTo(0.62, -1.0, 0.92, -0.5); p.quadraticCurveTo(1.5, -0.46, 1.7, -0.06); p.quadraticCurveTo(1.76, 0.12, 1.72, 0.3); },
    p => { p.moveTo(-1.7, 0.28); p.lineTo(-1.74, -0.18); p.quadraticCurveTo(-1.5, -0.62, -0.9, -0.66); p.lineTo(-0.62, -0.4); p.lineTo(0.0, -0.36); p.quadraticCurveTo(1.0, -0.26, 2.0, 0.08); p.lineTo(2.0, 0.2); p.lineTo(0.9, 0.28); },
    p => { p.moveTo(-1.74, -0.06); p.lineTo(-1.78, -0.64); p.lineTo(-0.55, -0.64); p.lineTo(-0.5, -1.12); p.lineTo(0.4, -1.12); p.quadraticCurveTo(0.76, -1.04, 0.92, -0.63); p.lineTo(1.66, -0.55); p.quadraticCurveTo(1.78, -0.4, 1.76, -0.06); },
    p => { p.moveTo(-1.74, 0.2); p.lineTo(-1.74, -0.4); p.quadraticCurveTo(-0.6, -0.62, 0.6, -0.44); p.quadraticCurveTo(1.6, -0.3, 2.02, -0.02); p.quadraticCurveTo(1.7, 0.22, 0.9, 0.28); p.lineTo(-1.2, 0.3); }
  ];
  // w = breedte, belt = hoogte van de raamlijn (daarboven is de cabine smaller), wz/ww = wielen
  const SPEC = [
    { w: 1.8, belt: -0.3, gw: 1.42, wz: 0.76, ww: 0.4 }, { w: 1.5, wz: 0.88, ww: 0.46 }, { w: 1.78, wz: 0.75, ww: 0.42 },
    { w: 1.86, belt: -0.34, gw: 1.6, wz: 0.8, ww: 0.44 }, { w: 1.7, belt: -0.5, gw: 1.4, wz: 0.72, ww: 0.36 }, { w: 0.95, wz: 0.84, ww: 0.54 },
    { w: 1.8, belt: -0.64, gw: 1.56, wz: 1.0, ww: 0.62 }, { w: 1.15, wz: 0.74, ww: 0.4 }
  ];
  const carTex = [], wheelTex = [];
  function bodyTexture(d) {
    if (!carTex[d]) { const t = tex(A.bodySprite(d)); t.repeat.set(1 / A.SW, 1 / A.SH); t.offset.set(A.SOX / A.SW, 1 - A.SOY / A.SH); carTex[d] = t; }
    return carTex[d];
  }
  function extrude(pts, w, bevel, mats) {
    const g = new T3.ExtrudeGeometry(shapeOf(pts), { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
    g.translate(0, 0, -(w - 2 * bevel) / 2);
    const m = new T3.Mesh(g, mats); m.castShadow = true; return m;
  }

  function buildCar(d) {
    const c = A.CARS[d], sp = SPEC[d], S = shared(), grp = new T3.Group(), body = new T3.Group(); grp.add(body);
    const paint = std({ color: col(c.color), roughness: 0.32, metalness: 0.25 }), dark = std({ color: col('#15171c'), roughness: 0.6 });
    const trim = std({ color: col(c.dark), roughness: 0.4, metalness: 0.2 }), chrome = std({ color: col('#cfd5df'), roughness: 0.25, metalness: 0.6 });
    const accent = std({ color: col(c.accent), roughness: 0.4 }), glass = std({ color: col('#14263f'), roughness: 0.08, metalness: 0.7 });
    const white = std({ color: col('#f4f4f4'), roughness: 0.4 });
    const glow = hex => new T3.MeshBasicMaterial({ color: col(hex) });
    const cap = std({ map: bodyTexture(d), roughness: 0.4, metalness: 0.15 });
    const add = m => { m.castShadow = true; body.add(m); return m; };
    const box = (w, h, dp, m, x, y, z) => { const b = new T3.Mesh(S.box, m); b.scale.set(w, h, dp); b.position.set(x, -y, z || 0); return add(b); };
    const ball = (r, m, x, y, z, sx, sy, sz) => { const b = new T3.Mesh(S.sph, m); b.scale.set(r * (sx || 1), r * (sy || 1), r * (sz || 1)); b.position.set(x, -y, z || 0); return add(b); };
    const bar = (x0, y0, z0, x1, y1, z1, r, m) => {
      const a = new T3.Vector3(x0, -y0, z0), b = new T3.Vector3(x1, -y1, z1), dir = b.clone().sub(a), len = dir.length();
      const me = new T3.Mesh(S.cyl, m); me.scale.set(r, len, r); me.position.copy(a).add(b).multiplyScalar(0.5);
      me.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), dir.normalize()); return add(me);
    };
    const both = fn => { fn(1); fn(-1); };
    const lampGlow = (hex, x, y, z, s) => { const q = new T3.Sprite(new T3.SpriteMaterial({ map: TEX.soft, color: col(hex), blending: T3.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 })); q.position.set(x, -y, z); q.scale.set(s, s, 1); body.add(q); };
    const head = (x, y, z, hex) => both(s => { box(0.07, 0.13, 0.34, glow(hex || '#fff3b0'), x, y, s * z); lampGlow(hex || '#fff3b0', x + 0.06, y, s * z, 0.9); });
    const tail = (x, y, z) => both(s => box(0.06, 0.13, 0.36, glow('#ff3030'), x, y, s * z));

    const pts = outlinePts(OUTLINES[d]), bev = 0.07;
    if (sp.belt !== undefined) {
      add(extrude(clipY(pts, sp.belt, false), sp.w, bev, [cap, paint]));
      const up = clipY(pts, sp.belt + 0.02, true);
      add(extrude(up, sp.gw, 0.05, [cap, glass]));
      let top = 1e9; for (const p of up) top = Math.min(top, p[1]);
      add(extrude(clipY(up, top + 0.085, true), sp.gw + 0.03, 0.03, [paint, paint]));
    } else add(extrude(pts, sp.w, d === 7 ? 0.2 : bev, [cap, paint]));

    if (d === 0) {
      box(0.72, 0.06, 1.72, trim, -1.68, -0.6); both(s => box(0.08, 0.32, 0.08, trim, -1.7, -0.42, s * 0.55));
      head(1.79, 0.0, 0.58); tail(-1.84, -0.03, 0.6);
      box(0.42, 0.05, 1.72, dark, 1.62, 0.31); both(s => bar(-1.8, 0.23, s * 0.45, -2.0, 0.23, s * 0.45, 0.06, chrome));
    } else if (d === 1) {
      both(s => { const z = s * 0.62; bar(-1.0, -0.14, z, -0.78, -0.82, z, 0.055, dark); bar(-0.78, -0.82, z, 0.34, -0.82, z, 0.055, dark); bar(0.34, -0.82, z, 0.9, -0.14, z, 0.055, dark); bar(-0.78, -0.82, z, -1.66, -0.2, z, 0.055, dark); bar(-0.26, -0.82, z, -0.3, -0.14, z, 0.045, dark); });
      bar(-0.78, -0.82, -0.62, -0.78, -0.82, 0.62, 0.055, dark); bar(0.34, -0.82, -0.62, 0.34, -0.82, 0.62, 0.055, dark);
      box(0.4, 0.46, 0.52, dark, 0.0, -0.3); ball(0.21, white, 0.1, -0.56, 0); box(0.14, 0.1, 0.3, glass, 0.27, -0.56);
      box(0.56, 0.36, 1.0, chrome, -1.48, -0.32); both(s => bar(-1.6, -0.46, s * 0.25, -1.74, -0.84, s * 0.25, 0.055, chrome));
      bar(1.92, 0.2, -0.72, 1.92, 0.2, 0.72, 0.05, dark); both(s => { ball(0.1, glow('#fff3b0'), 1.46, -0.27, s * 0.4); lampGlow('#fff3b0', 1.52, -0.27, s * 0.4, 0.9); });
    } else if (d === 2) {
      ball(1, glass, -0.35, -0.42, 0, 0.66, 0.37, 0.5);
      add(extrude([[-1.82, -0.3], [-2.05, -0.9], [-1.75, -0.9], [-1.25, -0.45]], 0.1, 0, [trim, trim]));
      both(s => { box(3.3, 0.05, 0.03, glow(c.accent), -0.1, 0.07, s * (sp.w / 2 + 0.01)); add(extrude([[-1.6, -0.36], [-1.95, -0.62], [-1.75, -0.62], [-1.2, -0.42]], 0.07, 0, [trim, trim])).position.z = s * 0.7; });
      box(0.14, 0.4, 1.3, dark, -1.9, -0.01); box(0.05, 0.24, 1.1, glow(c.accent), -1.98, -0.01); lampGlow(c.accent, -2.05, -0.01, 0, 1.4);
      head(1.72, 0.14, 0.5, c.accent);
    } else if (d === 3) {
      both(s => { const z = s * 0.72; bar(-1.5, -0.3, z, -1.4, -0.84, z, 0.055, dark); bar(-0.75, -0.84, z, -0.62, -0.3, z, 0.055, dark); });
      bar(-1.4, -0.84, -0.72, -1.4, -0.84, 0.72, 0.055, dark); bar(-0.75, -0.84, -0.72, -0.75, -0.84, 0.72, 0.055, dark);
      both(s => bar(1.95, 0.28, s * 0.5, 1.95, -0.32, s * 0.5, 0.05, dark)); bar(1.95, -0.32, -0.75, 1.95, -0.32, 0.75, 0.05, dark); bar(1.95, 0.0, -0.75, 1.95, 0.0, 0.75, 0.05, dark);
      box(0.18, 0.1, 1.3, dark, 0.0, -0.93); for (let k = 0; k < 4; k++) { ball(0.075, glow('#fff3b0'), 0.08, -0.93, -0.48 + k * 0.32); }
      lampGlow('#fff3b0', 0.2, -0.93, 0, 1.2);
      head(1.76, -0.12, 0.64); tail(-1.87, -0.2, 0.66); both(s => box(0.9, 0.06, 0.2, dark, 0, 0.28, s * 0.98));
    } else if (d === 4) {
      both(s => { ball(0.14, glow('#fff3b0'), 1.5, -0.26, s * 0.56); lampGlow('#fff3b0', 1.58, -0.26, s * 0.56, 1.0); ball(0.08, glow('#ff3030'), -1.66, -0.2, s * 0.56); });
      box(0.12, 0.1, 1.62, chrome, 1.74, 0.22); box(0.12, 0.1, 1.62, chrome, -1.7, 0.22);
    } else if (d === 5) {
      box(0.62, 0.06, 1.56, dark, -1.8, -0.9); box(0.5, 0.05, 1.56, paint, -1.82, -0.68); both(s => box(0.66, 0.52, 0.05, dark, -1.8, -0.72, s * 0.78));
      box(0.62, 0.06, 1.76, dark, 1.82, 0.22); both(s => box(0.5, 0.3, 0.05, paint, 1.84, 0.1, s * 0.88));
      ball(0.2, white, -0.28, -0.46, 0); box(0.13, 0.09, 0.3, glass, -0.13, -0.46); box(0.5, 0.32, 0.42, paint, -0.78, -0.56);
      both(s => { bar(1.15, 0.38, s * 0.8, 0.8, 0.08, s * 0.4, 0.035, dark); bar(1.15, 0.38, s * 0.8, 1.5, 0.12, s * 0.4, 0.035, dark); bar(-1.15, 0.38, s * 0.8, -0.8, 0.08, s * 0.4, 0.035, dark); bar(-1.15, 0.38, s * 0.8, -1.5, 0.02, s * 0.4, 0.035, dark); });
      both(s => box(1.3, 0.34, 0.3, paint, -0.3, 0.06, s * 0.6));
    } else if (d === 6) {
      for (const x of [-1.15, 1.15]) { bar(x, 0.31, -1.0, x, 0.31, 1.0, 0.09, dark); both(s => { bar(x, 0.31, s * 0.72, x * 0.78, -0.1, s * 0.7, 0.06, chrome); bar(x, 0.31, s * 0.72, x * 1.25, -0.1, s * 0.7, 0.06, chrome); }); }
      both(s => { const z = s * 0.7; bar(-1.45, -0.62, z, -1.36, -1.14, z, 0.055, dark); bar(-0.75, -1.14, z, -0.62, -0.62, z, 0.055, dark); });
      bar(-1.36, -1.14, -0.7, -1.36, -1.14, 0.7, 0.055, dark); bar(-0.75, -1.14, -0.7, -0.75, -1.14, 0.7, 0.055, dark);
      box(0.18, 0.1, 1.3, dark, 0.0, -1.21); for (let k = 0; k < 4; k++) ball(0.075, glow('#fff3b0'), 0.08, -1.21, -0.48 + k * 0.32);
      lampGlow('#fff3b0', 0.2, -1.21, 0, 1.2);
      head(1.72, -0.42, 0.62); tail(-1.82, -0.5, 0.64); box(0.2, 0.3, 1.7, dark, 1.82, -0.2);
    } else {
      ball(1, glass, 0.42, -0.4, 0, 0.46, 0.27, 0.34);
      add(extrude([[-1.5, -0.42], [-2.1, -1.02], [-1.72, -1.02], [-0.9, -0.46]], 0.09, 0, [accent, accent]));
      both(s => { const f = box(1.0, 0.06, 0.55, accent, -1.5, 0.12, s * 0.8); f.rotation.x = s * 0.25; });
      const nz = new T3.Mesh(S.cylTop, chrome); nz.scale.set(0.36, 0.5, 0.36); nz.rotation.z = -Math.PI / 2; nz.position.set(-1.92, 0.1, 0); add(nz);
      const fl = new T3.Mesh(S.cyl, glow('#ffb347')); fl.scale.set(0.25, 0.06, 0.25); fl.rotation.z = Math.PI / 2; fl.position.set(-2.16, 0.1, 0); body.add(fl);
      lampGlow('#ffb347', -2.2, -0.1, 0, 1.3);
      box(2.4, 0.07, 0.03, accent, -0.5, -0.1, 0.59); box(2.4, 0.07, 0.03, accent, -0.5, -0.1, -0.59);
    }

    // wielen
    const r = A.WHEEL_R[d], wy = A.WHEEL_Y[d] - (r - 0.48);
    if (!wheelTex[d]) wheelTex[d] = tex(A.wheelSprite(d, false));
    const wg = new T3.CylinderGeometry(r, r, sp.ww, 22); wg.rotateX(Math.PI / 2);
    const tire = std({ color: col('#17191e'), roughness: 0.95 }), hub = std({ map: wheelTex[d], roughness: 0.5 });
    const wheels = [];
    for (const x of [-1.15, 1.15]) for (const s of [1, -1]) {
      const w = new T3.Mesh(wg, [tire, hub, hub]); w.position.set(x, -wy, s * sp.wz); w.castShadow = true; grp.add(w); wheels.push(w);
    }
    // boostvlam
    const flame = new T3.Group();
    const cone = new T3.Mesh(new T3.ConeGeometry(0.3, 2.2, 12, 1, true), new T3.MeshBasicMaterial({ color: col('#ffb030'), transparent: true, opacity: 0.85, blending: T3.AdditiveBlending, depthWrite: false, side: T3.DoubleSide }));
    cone.rotation.z = Math.PI / 2; cone.position.x = -1.1; flame.add(cone);
    const core = new T3.Mesh(new T3.ConeGeometry(0.16, 1.3, 10, 1, true), new T3.MeshBasicMaterial({ color: col('#fff6d0'), transparent: true, opacity: 0.95, blending: T3.AdditiveBlending, depthWrite: false, side: T3.DoubleSide }));
    core.rotation.z = Math.PI / 2; core.position.x = -0.65; flame.add(core);
    const fg = new T3.Sprite(new T3.SpriteMaterial({ map: TEX.soft, color: col('#ff8a2a'), blending: T3.AdditiveBlending, depthWrite: false, transparent: true })); fg.scale.set(2.6, 2.6, 1); fg.position.x = -0.5; flame.add(fg);
    flame.position.set(-1.85, -0.05, 0); flame.visible = false; grp.add(flame);
    grp.userData = { wheels: wheels, flame: flame, wy: wy, design: d };
    return grp;
  }

  const carPool = new Map();
  function carFor(key, d) {
    let g = carPool.get(key);
    if (g && g.userData.design !== d) { scene.remove(g); g = null; }
    if (!g) { g = buildCar(d); carPool.set(key, g); scene.add(g); }
    return g;
  }

  // ------------------------------------------------------------------ deeltjes
  const sprites = [], colorCache = new Map(), imgTex = new Map();
  function rgbCol(s) { let c = colorCache.get(s); if (!c) { const p = s.split(','); c = new T3.Color(p[0] / 255, p[1] / 255, p[2] / 255).convertSRGBToLinear(); colorCache.set(s, c); } return c; }
  function syncParts(parts) {
    const n = parts.length;
    while (sprites.length < n) { const s = new T3.Sprite(new T3.SpriteMaterial({ map: TEX.soft, transparent: true, depthWrite: false })); s.renderOrder = 5; scene.add(s); sprites.push(s); }
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (i >= n) { s.visible = false; continue; }
      const p = parts[i], m = s.material, a = p.life / p.max, k = p.kind;
      s.visible = true; s.position.set(p.x, -p.y, -(p.z || 0) + (k === 0 ? 0.6 : 0));
      const add = k === 1 || k === 3; s.renderOrder = add ? 7 : k === 0 ? 5 : 6; const map = k === 2 ? TEX.square : k === 5 ? TEX.ring : k === 4 ? (imgTex.get(p.img) || (imgTex.set(p.img, tex(p.img)), imgTex.get(p.img))) : TEX.soft;
      if (m.map !== map) { m.map = map; m.needsUpdate = true; }
      const bl = add ? T3.AdditiveBlending : T3.NormalBlending; if (m.blending !== bl) { m.blending = bl; m.needsUpdate = true; }
      if (k === 4) m.color.setRGB(1, 1, 1); else m.color.copy(rgbCol(p.rgb));
      m.rotation = k === 2 ? p.life * 9 + p.size * 40 : k === 4 ? p.life * 14 : 0;
      m.opacity = k === 0 ? 0.6 * a : k === 2 || k === 4 ? Math.min(1, a * 3) : k === 5 ? 0.7 * a : a;
      const sc = k === 1 ? 0.28 : k === 2 ? p.size * 2.2 : k === 5 ? p.size * 2 : p.size * 2.4;
      s.scale.set(sc, k === 5 ? sc * 0.45 : sc, 1);
    }
  }

  // ------------------------------------------------------------------ opzet en beeld
  const sunDir = new T3.Vector3(-0.5, 1, 0.55).normalize();
  const ct = new T3.Vector3(), tmp = new T3.Vector3();
  let camDist = 20, first = true, _unused = 0;

  V.init = function (cvs, art) {
    A = art; E = art.E;
    try {
      renderer = new T3.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { V.failed = true; return false; }
    if (!renderer || !renderer.getContext()) { V.failed = true; return false; }
    renderer.setClearColor(0x000000, 0); renderer.outputEncoding = T3.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T3.PCFSoftShadowMap;
    aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    scene = new T3.Scene(); scene.fog = new T3.Fog(0xffffff, 60, 220);
    camera = new T3.PerspectiveCamera(FOV, 1, 0.5, 420);
    hemi = new T3.HemisphereLight(0xffffff, 0x888888, 0.8); scene.add(hemi);
    sun = new T3.DirectionalLight(0xffffff, 1.2); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera; sc.near = 1; sc.far = 190; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34;
    scene.add(sun); scene.add(sun.target);
    TEX.soft = softTex(); TEX.square = squareTex(); TEX.ring = ringTex(); TEX.chev = chevronTex(); TEX.checker = checkerTex(); TEX.warn = warnTex();
    TEX.topEmis = emisGridTex(); TEX.faceEmis = TEX.topEmis;
    TEX.win0 = windowTex(1.1, ['#ffd86b', '#ffb347']); TEX.win1 = windowTex(5.7, ['#62f4ff', '#9be9ff']); TEX.win2 = windowTex(9.3, ['#ff7ad1', '#ffd86b']);
    V.ok = true; V.renderer = renderer;
    return true;
  };
  V.resize = function (w, h, dpr) {
    W = w; H = h; if (!V.ok) return;
    renderer.setPixelRatio(V.low ? 1 : dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  // trage toestellen: schaduwen uit en minder pixels, zodat het spel vloeiend blijft
  V.lowQuality = function () {
    if (!V.ok || V.low) return;
    V.low = true; sun.castShadow = false; renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  };
  V.project = function (x, y, z) { tmp.set(x, -y, -z).project(camera); return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, behind: tmp.z > 1 }; };

  // f = {x,y,s,lane,sp,vx,vy,inLoop,menu,shake,time,fuelNext}; cars = [{key,vis,design,lane}]
  V.frame = function (dt, f, cars, parts) {
    const portrait = W < H;
    let wt = clamp((f.menu ? 30 : 21) + (f.inLoop ? 9 : 0) + f.sp * 0.42, 21, 44) * (portrait ? 0.66 : 1);
    // in een looping moet de hele looping in beeld passen, ook op een laag scherm
    if (f.loopR) wt = Math.max(wt, Math.min(52, (2 * f.loopR + 7) * camera.aspect));
    const dist = wt / (2 * camera.aspect * Math.tan(FOV * Math.PI / 360));
    const tx = f.x + wt * 0.2 + f.vx * 0.1, ty = -f.y + 0.6 - clamp(f.vy * 0.09, -2.5, 3.5), tz = -V.depthOf(f.s, f.lane);
    if (first || Math.abs(tx - ct.x) > 80) { ct.set(tx, ty, tz); camDist = dist; first = false; }
    ct.x += (tx - ct.x) * Math.min(1, dt * 7); ct.y += (ty - ct.y) * Math.min(1, dt * 5); ct.z += (tz - ct.z) * Math.min(1, dt * 4);
    camDist += (dist - camDist) * Math.min(1, dt * 2.2);
    const sh = f.shake > 0.01 ? f.shake : 0;
    camera.position.set(ct.x + (Math.random() - 0.5) * sh, ct.y + camDist * 0.3 + (Math.random() - 0.5) * sh, ct.z + camDist);
    camera.lookAt(ct.x, ct.y + 0.6, ct.z);
    sun.position.copy(ct).addScaledVector(sunDir, 90); sun.target.position.copy(ct); sun.target.updateMatrixWorld();
    // auto's
    const seen = new Set();
    for (const c of cars) {
      const g = carFor(c.key, c.design), v = c.vis, u = g.userData; seen.add(c.key);
      g.visible = true; g.position.set(v.x, -v.y, -V.depthOf(v.s, c.lane)); g.rotation.z = -v.a;
      for (let k = 0; k < 4; k++) { const w = u.wheels[k], front = k >= 2; w.rotation.z = -(front ? v.spin1 : v.spin0); w.position.y = -u.wy + Math.min(front ? v.sus1 : v.sus0, 0.3); }
      u.flame.visible = !!v.boost;
      if (v.boost) { const s = 0.8 + Math.random() * 0.6; u.flame.scale.set(s, 0.9 + Math.random() * 0.3, 0.9 + Math.random() * 0.3); }
    }
    for (const [k, g] of carPool) if (!seen.has(k)) g.visible = false;
    // jerrycans: alleen die je nog niet gepakt hebt, draaiend en zwevend
    if (current && current.G.userData.cans) {
      const cans = current.G.userData.cans, nx = f.fuelNext | 0;
      for (let k = 0; k < cans.length; k++) {
        const cg = cans[k]; cg.visible = k >= nx;
        if (cg.visible) { cg.rotation.y = f.time * 2 + k; cg.position.y = cg.userData.y0 + Math.sin(f.time * 3 + k) * 0.15; }
      }
    }
    if (current && current.G.userData.rocks) {
      const rm = current.G.userData.rocks, T = current.T;
      for (let k = 0; k < rm.length; k++) {
        const m = rm[k], st = f.rocks && f.rocks[k], r = m.userData.r, s = st ? st.s : m.userData.s0, offT = st ? st.offT : 0;
        m.visible = offT < 1.6;
        if (!m.visible) continue;
        E.pointAt(T, s, _pt);
        m.position.set(_pt.x + _pt.ty * r, -(_pt.y - _pt.tx * r) - offT * offT * 9, -V.depthOf(s, 0) + offT * 5);
        m.rotation.set(offT * 3, k * 1.3, -(s - m.userData.s0) / r);
      }
    }
    syncParts(parts);
    TEX.chev.offset.x = -(f.time * 1.6) % 1;
    renderer.render(scene, camera);
    // waar ligt de einder op het scherm: daar sluit de getekende achtergrond op aan
    tmp.set(ct.x, ct.y + 3, current ? current.far : -58).project(camera);
    V.horizon = (-tmp.y * 0.5 + 0.5) * H;
    V.cam2d.x = ct.x; V.cam2d.y = -ct.y; V.cam2d.z = W / wt;
  };

  // plaatje van een auto voor de garage
  const shots = [];
  V.snapshot = function (d, w, h) {
    if (!V.ok) return null;
    if (shots[d]) return shots[d];
    const sc = new T3.Scene(), cam = new T3.PerspectiveCamera(30, w / h, 0.1, 50), car = buildCar(d);
    sc.add(new T3.HemisphereLight(0xffffff, 0x6b7280, 1.0));
    const l = new T3.DirectionalLight(0xffffff, 1.2); l.position.set(-3, 6, 5); sc.add(l);
    car.rotation.y = -0.5; sc.add(car);
    cam.position.set(0.2, 1.25, 6.1); cam.lookAt(0, -0.22, 0);
    const pr = renderer.getPixelRatio(), sm = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    renderer.render(sc, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.shadowMap.enabled = sm; renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
    return (shots[d] = url);
  };
})();
