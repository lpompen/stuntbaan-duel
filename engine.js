/* Stuntbaan Duel - physics en banen (geen DOM; draait ook in node voor tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 22;            // zwaartekracht m/s2 (arcade)
  const DT = 1 / 240;      // vaste simulatiestap
  const INERTIA = 1.3;     // massa = 1
  const VMAX = 31, VBOOST = 40, VREV = 9;
  const ENGINE = 8.5, BRAKE = 13, BOOSTF = 7;   // per wiel
  const MU = 1.7;
  const AIR_ACC = 11, AIR_DAMP = 2.2;
  const K1 = 130, C1 = 12, C_REB = 38, SOFT = 0.26, K2 = 2600;   // wielvering
  const KC = 1800, CC = 22;                          // carrosserie
  const FMAX = 1200;
  const STEP = 0.5;
  const DEAD_T = 1.25;     // seconden tussen ontploffen en terugkomen
  const PIT_DEPTH = 18;
  const LOOP_DRIVE = 0.3;  // in een looping duwt de motor nauwelijks mee: je moet vaart hebben

  // contactpunten in autocoordinaten (x vooruit, y omlaag)
  const POINTS = [
    { x: -1.15, y: 0.45, r: 0.48, wheel: true },
    { x: 1.15, y: 0.45, r: 0.48, wheel: true },
    { x: 1.5, y: 0.05, r: 0.28 },
    { x: -1.55, y: -0.05, r: 0.28 },
    { x: 0.5, y: -0.5, r: 0.3 },
    { x: -0.6, y: -0.5, r: 0.3 }
  ];

  // eigenschappen per auto (vermenigvuldigers): acceleratie, topsnelheid, luchtcontrole, boost
  const CAR_SPECS = [
    { acc: 1.00, top: 1.00, air: 1.00, boost: 1.00 },   // Vlam
    { acc: 1.15, top: 0.93, air: 1.15, boost: 0.95 },   // Zandvlo
    { acc: 0.90, top: 1.10, air: 0.85, boost: 1.05 },   // Pijl
    { acc: 1.10, top: 0.95, air: 0.80, boost: 1.12 },   // Brok
    { acc: 1.05, top: 0.92, air: 1.35, boost: 1.00 },   // Kever
    { acc: 0.94, top: 1.16, air: 0.75, boost: 0.92 },   // Bolide
    { acc: 1.22, top: 0.90, air: 0.90, boost: 0.88 },   // Monster
    { acc: 0.86, top: 1.04, air: 0.95, boost: 1.45 }    // Raket
  ];

  // vlaggen per punt: 1 = segment is looping, 2 = segment is klif/muur,
  // 4 = niet geschikt om te herstarten, 8 = punt ligt in een looping (geen grond),
  // 16 = bodem van een ravijn
  const F_LOOP = 1, F_CLIFF = 2, F_UNSAFE = 4, F_INLOOP = 8, F_PIT = 16;

  // ['gap', aanloop, hoogte, breedte, val] = schans met een ravijn erachter
  const TRACKS = [
    {
      id: 'zand', name: 'Zandkloof', theme: 'desert', level: 'Makkelijk',
      parts: [
        ['flat', 20], ['hill', 28, 2.5], ['flat', 6], ['slope', 36, -7], ['boost', 10],
        ['ramp', 16, 2.8, 6], ['slope', 44, -4], ['flat', 34],
        ['boost', 10], ['flat', 6], ['loop', 6.5], ['flat', 16],
        ['hill', 14, 1.1], ['hill', 14, 1.1], ['hill', 14, 1.1], ['flat', 14],
        ['slope', 34, 6], ['flat', 10], ['ramp', 14, 2.4, 5], ['slope', 40, -5], ['flat', 34],
        ['boost', 10], ['flat', 6], ['loop', 7.5], ['flat', 14],
        ['hill', 38, 5], ['flat', 12], ['slope', 50, -9], ['boost', 8],
        ['ramp', 18, 3.4, 7], ['slope', 56, -5], ['flat', 44],
        ['finish'], ['flat', 70]
      ]
    },
    {
      id: 'kloof', name: 'Kloofsprong', theme: 'desert', level: 'Gemiddeld',
      parts: [
        ['flat', 20], ['slope', 30, -4], ['boost', 10], ['gap', 14, 2.2, 12, 1],
        ['slope', 40, -3], ['flat', 40], ['hill', 20, 2], ['flat', 30],
        ['boost', 10], ['flat', 6], ['loop', 6.5], ['flat', 20],
        ['slope', 30, 5], ['flat', 10], ['boost', 8], ['gap', 16, 2.6, 16, 2],
        ['slope', 50, -5], ['flat', 50],
        ['hill', 14, 1.1], ['hill', 14, 1.1], ['hill', 14, 1.1], ['flat', 30],
        ['boost', 10], ['gap', 14, 2.4, 14, 0], ['flat', 70],
        ['boost', 10], ['flat', 6], ['loop', 8], ['flat', 16],
        ['slope', 40, -6], ['boost', 8], ['gap', 16, 2.8, 20, 3], ['slope', 50, -4], ['flat', 50],
        ['finish'], ['flat', 70]
      ]
    },
    {
      id: 'neon', name: 'Neonstad', theme: 'neon', level: 'Gemiddeld',
      parts: [
        ['flat', 20], ['boost', 10], ['flat', 6], ['loop', 6], ['flat', 12],
        ['slope', 30, 5], ['flat', 8], ['ramp', 14, 2.6, 8], ['slope', 50, -6], ['flat', 44],
        ['boost', 10], ['flat', 6], ['loop', 7], ['flat', 6], ['loop', 7], ['flat', 14],
        ['hill', 20, 2.2], ['hill', 20, 2.2], ['flat', 10], ['slope', 40, 8], ['flat', 10],
        ['boost', 8], ['ramp', 18, 3.6, 12], ['slope', 60, -8], ['flat', 50],
        ['hill', 16, 1.4], ['hill', 16, 1.4], ['hill', 16, 1.4], ['flat', 34],
        ['slope', 30, -6], ['boost', 10], ['flat', 6], ['loop', 9], ['flat', 16],
        ['ramp', 14, 2.4, 5], ['slope', 44, -4], ['flat', 44],
        ['finish'], ['flat', 70]
      ]
    },
    {
      id: 'daken', name: 'Dakenrace', theme: 'neon', level: 'Pittig',
      parts: [
        ['flat', 20], ['boost', 10], ['gap', 12, 1.8, 10, 0], ['flat', 60],
        ['gap', 12, 2.0, 12, 2], ['flat', 60],
        ['boost', 10], ['flat', 6], ['loop', 7], ['flat', 22],
        ['slope', 30, 6], ['flat', 8], ['boost', 8], ['gap', 14, 2.4, 16, 4], ['flat', 70],
        ['hill', 20, 2], ['hill', 20, 2], ['flat', 30],
        ['boost', 10], ['gap', 16, 2.8, 22, 3], ['slope', 50, -5], ['flat', 50],
        ['boost', 10], ['flat', 6], ['loop', 7], ['flat', 6], ['loop', 7], ['flat', 24],
        ['boost', 8], ['gap', 12, 2.0, 12, 1], ['flat', 70],
        ['finish'], ['flat', 70]
      ]
    },
    {
      id: 'ijs', name: 'IJspiek', theme: 'ice', level: 'Zwaar',
      parts: [
        ['flat', 20], ['slope', 40, 9], ['flat', 8], ['boost', 8], ['ramp', 16, 3.2, 10],
        ['slope', 60, -9], ['flat', 44], ['boost', 10], ['flat', 6],
        ['loop', 7], ['flat', 5], ['loop', 8], ['flat', 5], ['loop', 7], ['flat', 14],
        ['hill', 30, 5], ['hill', 24, 3], ['flat', 12], ['slope', 46, 11], ['flat', 10],
        ['boost', 10], ['gap', 20, 4.2, 20, 16], ['slope', 70, -10], ['flat', 60],
        ['hill', 12, 1.2], ['hill', 12, 1.2], ['hill', 12, 1.2], ['hill', 12, 1.2], ['flat', 36],
        ['slope', 36, -8], ['boost', 10], ['flat', 6], ['loop', 10], ['flat', 14],
        ['slope', 30, 6], ['flat', 6], ['boost', 8], ['gap', 16, 3, 18, 9], ['slope', 56, -6], ['flat', 40],
        ['boost', 8], ['gap', 14, 2.4, 14, 5], ['slope', 44, -4], ['flat', 44],
        ['finish'], ['flat', 70]
      ]
    }
  ];

  function buildTrack(def) {
    const pts = [];
    let x = 0, y = 0, layer = 0, finishIdx = -1;
    const padsIdx = [], loops = [], gaps = [], zones = [];
    const add = (px, py, fl) => { pts.push({ x: px, y: py, layer: layer, fl: fl | 0 }); };
    add(0, -9, F_CLIFF | F_UNSAFE);   // muur achter de start
    add(0, 0, 0);
    for (const p of def.parts) {
      const kind = p[0];
      if (kind === 'flat' || kind === 'boost') {
        const L = p[1], n = Math.ceil(L / STEP), i0 = pts.length - 1;
        for (let i = 1; i <= n; i++) add(x + L * i / n, y, 0);
        x += L;
        if (kind === 'boost') padsIdx.push([i0, pts.length - 1]);
      } else if (kind === 'slope') {
        const L = p[1], h = p[2], n = Math.ceil(L / STEP);
        for (let i = 1; i <= n; i++) { const u = i / n; add(x + L * u, y - h * (1 - Math.cos(Math.PI * u)) / 2, 0); }
        x += L; y -= h;
      } else if (kind === 'hill') {
        const L = p[1], h = p[2], n = Math.ceil(L / STEP);
        for (let i = 1; i <= n; i++) { const u = i / n; add(x + L * u, y - h * (1 - Math.cos(2 * Math.PI * u)) / 2, 0); }
        x += L;
      } else if (kind === 'ramp' || kind === 'gap') {
        const L = p[1], h = p[2], n = Math.ceil(L / STEP), i0 = pts.length - 1;
        for (let i = 1; i <= n; i++) { const u = i / n; add(x + L * u, y - h * u * u, u > 0.6 ? F_UNSAFE : 0); }
        x += L; y -= h;
        pts[pts.length - 1].fl |= F_CLIFF | F_UNSAFE;
        if (kind === 'ramp') {
          x += 0.35; y += p[3];
          add(x, y, F_UNSAFE);
        } else {
          const width = p[3], lipY = y, pitY = y + PIT_DEPTH, x0 = x;
          add(x + 0.3, pitY, F_PIT | F_UNSAFE);
          add(x + width - 0.3, pitY, F_CLIFF | F_UNSAFE);
          x += width; y = lipY + h + p[4];
          add(x, y, F_UNSAFE);
          gaps.push({ x0: x0, x1: x, lipY: lipY, landY: y, pitY: pitY, ky: Math.max(lipY, y) + 6, i0: i0, i1: pts.length - 1 });
          zones.push([i0, pts.length - 1, 26, 4]);
        }
      } else if (kind === 'loop') {
        const R = p[1], shift = R * 0.55, n = Math.ceil(2 * Math.PI * R / STEP);
        const i0 = pts.length - 1, half = Math.floor(n / 2);
        pts[i0].fl |= F_LOOP | F_UNSAFE;
        for (let i = 1; i <= n; i++) {
          if (i === half) layer++;
          const a = 2 * Math.PI * i / n;
          add(x + R * Math.sin(a) + shift * i / n, y - R * (1 - Math.cos(a)),
            i < n ? (F_LOOP | F_UNSAFE | F_INLOOP) : F_UNSAFE);
        }
        loops.push({ i0: i0, mid: i0 + half, i1: i0 + n, R: R, cx: x + shift / 2, cy: y - R });
        zones.push([i0, i0 + n, 34, 0]);
        x += shift;
      } else if (kind === 'finish') {
        finishIdx = pts.length - 1;
      }
    }
    pts[pts.length - 1].fl |= F_CLIFF | F_UNSAFE;
    add(x, y - 9, F_UNSAFE);         // eindmuur

    const n = pts.length;
    const T = {
      def: def, name: def.name, theme: def.theme, n: n,
      X: new Float64Array(n), Y: new Float64Array(n), S: new Float64Array(n),
      TX: new Float64Array(n), TY: new Float64Array(n), LEN: new Float64Array(n),
      LAYER: new Int16Array(n), FL: new Uint8Array(n),
      pads: [], loops: loops, gaps: gaps, finishS: 0, total: 0, minY: 1e9, maxY: -1e9, startS: 9
    };
    for (let i = 0; i < n; i++) {
      T.X[i] = pts[i].x; T.Y[i] = pts[i].y; T.LAYER[i] = pts[i].layer; T.FL[i] = pts[i].fl;
      if (pts[i].y < T.minY) T.minY = pts[i].y;
      if (pts[i].y > T.maxY) T.maxY = pts[i].y;
    }
    for (let i = 0; i < n - 1; i++) {
      const dx = T.X[i + 1] - T.X[i], dy = T.Y[i + 1] - T.Y[i], len = Math.hypot(dx, dy) || 1e-9;
      T.TX[i] = dx / len; T.TY[i] = dy / len; T.LEN[i] = len; T.S[i + 1] = T.S[i] + len;
    }
    T.TX[n - 1] = T.TX[n - 2]; T.TY[n - 1] = T.TY[n - 2];
    T.total = T.S[n - 1];
    T.startS = T.S[1] + 10;
    T.finishS = finishIdx >= 0 ? T.S[finishIdx] : T.total - 20;
    for (const pi of padsIdx) T.pads.push({ s0: T.S[pi[0]], s1: T.S[pi[1]], i0: pi[0], i1: pi[1] });
    // geen herstart vlak voor een looping of ravijn: je hebt een aanloop nodig
    for (const z of zones) {
      const sa = T.S[z[0]] - z[2], sb = T.S[z[1]] + z[3];
      for (let i = 2; i < n; i++) if (T.S[i] >= sa && T.S[i] <= sb) T.FL[i] |= F_UNSAFE;
    }
    return T;
  }

  // punt op de baan bij booglengte s
  function pointAt(T, s, out) {
    let lo = 0, hi = T.n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T.S[m] <= s) lo = m; else hi = m - 1; }
    const u = Math.max(0, Math.min(T.LEN[lo], s - T.S[lo]));
    out.x = T.X[lo] + T.TX[lo] * u; out.y = T.Y[lo] + T.TY[lo] * u;
    out.tx = T.TX[lo]; out.ty = T.TY[lo]; out.seg = lo; out.u = u;
    return out;
  }

  const _c = { seg: 0, nx: 0, ny: 0, sd: 0, u: 0 };
  // dichtstbijzijnde punt op de baan binnen een venster rond 'seg'. De baan is eenzijdig:
  // de rijkant is de linkernormaal van de rijrichting. 'wide' = in de lucht, ruimer zoeken.
  function closest(T, px, py, seg, wide) {
    const win = wide ? 90 : 12;
    const lo = Math.max(0, seg - win), hi = Math.min(T.n - 2, seg + win);
    const L0 = T.LAYER[seg];
    let best = -1, bestD = 1e18, bu = 0, bdx = 0, bdy = 0, bside = 0;
    for (let i = lo; i <= hi; i++) {
      if (wide && T.LAYER[i] !== L0 && (i - seg > 12 || seg - i > 12)) continue;
      const tx = T.TX[i], ty = T.TY[i];
      let u = (px - T.X[i]) * tx + (py - T.Y[i]) * ty;
      if (u < 0) u = 0; else if (u > T.LEN[i]) u = T.LEN[i];
      const dx = px - (T.X[i] + tx * u), dy = py - (T.Y[i] + ty * u);
      const d2 = dx * dx + dy * dy;
      const side = dx * ty - dy * tx;
      if (side < 0 && d2 > 0.49) continue;
      if (d2 < bestD) { bestD = d2; best = i; bu = u; bdx = dx; bdy = dy; bside = side; }
    }
    if (best < 0) return false;
    const d = Math.sqrt(bestD);
    _c.seg = best; _c.u = bu;
    if (bside >= 0 && d > 1e-6) { _c.nx = bdx / d; _c.ny = bdy / d; _c.sd = d; }
    else { _c.nx = T.TY[best]; _c.ny = -T.TX[best]; _c.sd = -d; }
    return true;
  }

  function newCar(T, design) {
    const car = {
      x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0,
      cps: POINTS.map(() => ({ seg: 0, u: 0, on: false, pen: 0, spin: 0 })),
      s: 0, boostT: 0, airT: 0, flipAcc: 0, wheelsOn: 0, roofOn: 0,
      stuckT: 0, startSeg: 2, finished: false, ticks: 0, respawns: 0, dead: 0,
      vmaxK: 1, spec: CAR_SPECS[(design | 0) % CAR_SPECS.length], ev: []
    };
    const p = pointAt(T, T.startS, {});
    car.startSeg = p.seg;
    placeAt(car, T, p.seg);
    car.ev.length = 0;
    return car;
  }

  function placeAt(car, T, seg) {
    const tx = T.TX[seg], ty = T.TY[seg];
    car.x = T.X[seg] + ty * 1.0; car.y = T.Y[seg] - tx * 1.0;
    car.a = Math.atan2(ty, tx);
    car.vx = car.vy = car.w = 0;
    for (const cp of car.cps) { cp.seg = seg; cp.on = false; cp.pen = 0; cp.u = 0; }
    car.boostT = 0; car.airT = 0; car.flipAcc = 0; car.stuckT = 0; car.dead = 0;
    car.wheelsOn = 0; car.roofOn = 0;
    car.s = T.S[seg];
  }

  // waar kom je terug na een crash bij segment 'seg'
  function respawnSeg(T, seg, startSeg) {
    seg = Math.max(startSeg, Math.min(seg, T.n - 3));
    while (seg > startSeg && (T.FL[seg] & F_UNSAFE)) seg--;
    return seg;
  }

  function respawn(car, T) {
    const seg = respawnSeg(T, car.cps[0].seg, car.startSeg);
    placeAt(car, T, seg);
    car.vx = T.TX[seg] * 10; car.vy = T.TY[seg] * 10;
    car.ev.push(['respawn', 0]);
  }

  function explode(car, why) {
    car.dead = DEAD_T; car.respawns++; car.boostT = 0;
    car.ev.push(['explode', why]);
  }

  function stepCar(car, inp, T, dt) {
    if (!car.finished) car.ticks++;
    if (car.dead > 0) {
      car.dead -= dt;
      if (car.dead <= 0) respawn(car, T);
      return;
    }
    const gas = inp.gas ? 1 : 0, brake = inp.brake ? 1 : 0, spec = car.spec;
    const ca = Math.cos(car.a), sa = Math.sin(car.a);
    const boosting = car.boostT > 0;
    let fx = 0, fy = G, tq = 0, wheelsOn = 0, roofOn = 0, impact = 0;
    for (let i = 0; i < 6; i++) {
      const d = POINTS[i], cp = car.cps[i];
      const rx = d.x * ca - d.y * sa, ry = d.x * sa + d.y * ca;
      let pen = 0;
      if (closest(T, car.x + rx, car.y + ry, cp.seg, !cp.on)) {
        cp.seg = _c.seg; cp.u = _c.u;
        pen = d.r - _c.sd;
        if (pen > 0) {
          const nx = _c.nx, ny = _c.ny, tx = -ny, ty = nx;
          const vpx = car.vx - car.w * ry, vpy = car.vy + car.w * rx;
          const vn = vpx * nx + vpy * ny, vt = vpx * tx + vpy * ty;
          let Fn, Ft = 0;
          if (d.wheel) {
            Fn = K1 * pen + (pen > SOFT ? K2 * (pen - SOFT) : 0) - (vn > 0 ? C_REB : C1) * vn;
            if (Fn < 0) Fn = 0; else if (Fn > FMAX) Fn = FMAX;
            wheelsOn++;
            if (car.finished) { Ft = vt > 0.8 ? -BRAKE : -vt * 4; }
            else if (gas && !brake) {
              const vm = (boosting ? VBOOST : VMAX * car.vmaxK) * spec.top;
              if (vt < vm) { const q = Math.max(vt, 0) / vm; Ft = ENGINE * spec.acc * (1 - q * q * q); }
              if (boosting) Ft += BOOSTF * spec.boost;
            } else if (brake && !gas) {
              if (vt > 1) Ft = -BRAKE; else if (vt > -VREV) Ft = -ENGINE * 0.7;
            } else { Ft = -vt * 0.12; if (boosting) Ft += BOOSTF * spec.boost; }
            if (Ft > 0 && (T.FL[_c.seg] & F_LOOP)) Ft *= LOOP_DRIVE;
            const lim = MU * Fn;
            if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
            cp.spin += vt / d.r * dt;
          } else {
            Fn = KC * pen - CC * vn;
            if (Fn < 0) Fn = 0; else if (Fn > FMAX) Fn = FMAX;
            const lim = 0.45 * Fn;
            Ft = -vt * 8; if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
            if (i >= 4) roofOn++;
          }
          if (-vn > impact) impact = -vn;
          const Fx = nx * Fn + tx * Ft, Fy = ny * Fn + ty * Ft;
          fx += Fx; fy += Fy; tq += rx * Fy - ry * Fx;
        }
      }
      if (d.wheel && pen <= 0) cp.spin += (gas ? 40 : 0) * dt;
      cp.on = pen > 0; cp.pen = pen > 0 ? pen : 0;
    }

    if (wheelsOn === 0) {
      car.airT += dt;
      if (!car.finished) tq += INERTIA * AIR_ACC * spec.air * (brake - gas);
      tq -= INERTIA * AIR_DAMP * car.w;
    } else {
      if (car.airT > 0.25) {
        const flips = Math.floor((Math.abs(car.flipAcc) + 0.9) / (2 * Math.PI));
        if (flips > 0 && roofOn === 0) {
          car.boostT = Math.max(car.boostT, (0.5 + 0.6 * flips) * spec.boost);
          car.ev.push(['flip', flips]);
        }
        car.ev.push(['land', impact, car.airT]);
      }
      car.airT = 0; car.flipAcc = 0;
    }

    const sp = Math.hypot(car.vx, car.vy);
    const cd = 0.0016 + (sp > 42 ? 0.004 * (sp - 42) : 0);
    fx -= cd * car.vx * sp; fy -= cd * car.vy * sp;

    car.vx += fx * dt; car.vy += fy * dt; car.w += tq / INERTIA * dt;
    if (car.w > 12) car.w = 12; else if (car.w < -12) car.w = -12;
    car.x += car.vx * dt; car.y += car.vy * dt; car.a += car.w * dt;
    if (wheelsOn === 0) car.flipAcc += car.w * dt;
    if (car.boostT > 0) car.boostT -= dt;

    const c0 = car.cps[0], c1 = car.cps[1];
    car.s = (T.S[c0.seg] + c0.u + T.S[c1.seg] + c1.u) / 2;
    car.wheelsOn = wheelsOn; car.roofOn = roofOn;

    if (wheelsOn > 0 && !car.finished) {
      for (const pad of T.pads) {
        if (car.s >= pad.s0 && car.s <= pad.s1 + 1) {
          if (car.boostT < 0.2) car.ev.push(['boost', 0]);
          if (car.boostT < 1.1 * spec.boost) car.boostT = 1.1 * spec.boost;
        }
      }
    }

    if (wheelsOn < 2 && sp < 0.6) car.stuckT += dt; else car.stuckT = 0;
    if (!car.finished) {
      if (car.s >= T.finishS) { car.finished = true; car.ev.push(['finish', 0]); return; }
      if (roofOn > 0) { explode(car, 'roof'); return; }
      for (const gp of T.gaps) {
        if (car.x > gp.x0 && car.x < gp.x1 && car.y > gp.ky) { explode(car, 'pit'); return; }
      }
      if (car.y > T.maxY + 30) explode(car, 'fall');
      else if (car.stuckT > 2.5) respawn(car, T);
    }
  }

  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  // eenvoudige botbesturing met dezelfde twee pedalen als de speler
  function botInput(car, T, out) {
    out.gas = true; out.brake = false;
    if (car.wheelsOn > 0 || car.dead > 0) return out;
    const j = Math.min(T.n - 2, car.cps[1].seg + 3);
    if (T.FL[j] & F_LOOP) return out;
    const target = (T.FL[j] & (F_CLIFF | F_PIT)) ? 0 : Math.atan2(T.TY[j], T.TX[j]);
    const err = wrap(car.a - target) + car.w * 0.16;
    if (err > 0.14) { out.gas = true; out.brake = false; }
    else if (err < -0.14) { out.gas = false; out.brake = true; }
    else { out.gas = false; out.brake = false; }
    return out;
  }

  return {
    G: G, DT: DT, POINTS: POINTS, TRACKS: TRACKS, VMAX: VMAX, CAR_SPECS: CAR_SPECS, DEAD_T: DEAD_T,
    F_LOOP: F_LOOP, F_CLIFF: F_CLIFF, F_UNSAFE: F_UNSAFE, F_INLOOP: F_INLOOP, F_PIT: F_PIT,
    buildTrack: buildTrack, pointAt: pointAt, newCar: newCar, stepCar: stepCar,
    respawn: respawn, respawnSeg: respawnSeg, placeAt: placeAt, botInput: botInput, wrap: wrap
  };
});
