/* Stuntbaan Duel - tekenen, besturing, geluid en netwerk. */
(() => {
  'use strict';
  const E = window.Engine;
  const VERSION = '4.0.0';
  const TS = 0.8;   // tempo: simulatieseconden per echte seconde
  const PEER_PREFIX = 'stuntbaanduel-v4-';
  const $ = id => document.getElementById(id);
  const cv = $('cv'), glc = $('gl'), fxc = $('fx'), g2 = cv.getContext('2d'), gfx = fxc.getContext('2d');
  let g = g2;   // waar de 2D-tekenfuncties op dat moment op tekenen
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    fxc.width = cv.width; fxc.height = cv.height;
    if (window.View3D && window.View3D.ok) window.View3D.resize(W, H, DPR);
  }
  window.addEventListener('resize', resize); resize();
  $('ver').textContent = 'v' + VERSION;

  // ---------------------------------------------------------------- semi-3D
  // Diepte (z, meters van de camera af) schuift alles schuin omhoog: zo zie je de bovenkant
  // van de baan en van de auto's, terwijl het spel zelf een zijaanzicht blijft.
  const DX = -0.10, DY = -0.36;     // schermverschuiving per meter diepte
  const TW = 3.0;                   // breedte van de rijstrook
  const ZL = 3.6;                   // zoveel schuift de baan op in een looping
  const Z_NEAR = -1.2, Z_FAR = 9;   // voor- en achterrand van het landschap
  const CAR_ZN = 0.6, CAR_ZF = 2.4; // zijkanten van de auto binnen de rijstrook

  // ---------------------------------------------------------------- auto's
  // stats = acceleratie, topsnelheid, luchtcontrole, boost (uit Engine.CAR_SPECS)
  const CARS = [
    { name: 'Vlam', cost: 0, tag: 'Allrounder zonder zwakke plek', color: '#e8382f', dark: '#8a130f', light: '#ff8a70', accent: '#ffd23f', rim: '#d9dee8' },
    { name: 'Zandvlo', cost: 600, tag: 'Snel weg en wendbaar, lage top', color: '#f5b921', dark: '#a56600', light: '#ffe58a', accent: '#262a35', rim: '#f1f1f1' },
    { name: 'Pijl', cost: 1200, tag: 'Hoge top, traag op gang en log in de lucht', color: '#2f8bff', dark: '#0f3590', light: '#9ccdff', accent: '#7df9ff', rim: '#7df9ff' },
    { name: 'Brok', cost: 2000, tag: 'Sterke boost, draait traag in de lucht', color: '#39b54a', dark: '#135a27', light: '#97e89b', accent: '#f4f4f4', rim: '#c9ced8' },
    { name: 'Kever', cost: 3000, tag: 'Saltokoning, maar geen sprinter', color: '#9b5de5', dark: '#4b2389', light: '#d0b1ff', accent: '#ffffff', rim: '#ffffff' },
    { name: 'Bolide', cost: 4200, tag: 'Snelste van allemaal, lastig in de lucht', color: '#ff7a1f', dark: '#a03c00', light: '#ffc08a', accent: '#15171c', rim: '#2b2f38' },
    { name: 'Monster', cost: 5600, tag: 'Beste acceleratie, laagste top', color: '#454b59', dark: '#14161b', light: '#8a93a6', accent: '#ff7a1f', rim: '#ff7a1f' },
    { name: 'Raket', cost: 7500, tag: 'Enorme boost, verder traag', color: '#e9edf5', dark: '#7d8696', light: '#ffffff', accent: '#e8382f', rim: '#e8382f' }
  ];
  const STAT_NAMES = ['Acceleratie', 'Topsnelheid', 'Luchtcontrole', 'Boost'];
  const statBars = d => { const s = E.CAR_SPECS[d]; return [s.acc, s.top, s.air, s.boost].map(m => clamp(Math.round((m - 0.75) / 0.1 + 0.5), 1, 5)); };
  const IMG = {};
  const ASSETS = window.STUNT_ASSETS || {};
  for (const k in ASSETS) { const im = new Image(); im.onload = () => { IMG[k] = im; }; im.src = ASSETS[k]; }

  const SPR = 96;   // spritepixels per meter
  const WHEEL_R = [0.48, 0.54, 0.48, 0.54, 0.46, 0.5, 0.62, 0.5];
  const mk = fn => { const p = new Path2D(); fn(p); return p; };
  function sprite(w, h, ox, oy, draw) {
    const cvs = document.createElement('canvas');
    cvs.width = Math.ceil(w * SPR); cvs.height = Math.ceil(h * SPR);
    const c = cvs.getContext('2d'); c.setTransform(SPR, 0, 0, SPR, ox * SPR, oy * SPR); draw(c);
    return cvs;
  }
  function disc(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }
  let SOLID = false;   // bij het maken van het silhouet: geen lichtgloed tekenen

  // carrosserie: kleurverloop, glans, schaduw, wielkasten en omlijning
  function paintBody(c, car, path, arch, deco, wy) {
    const gr = c.createLinearGradient(0, -0.95, 0, 0.35);
    gr.addColorStop(0, car.light); gr.addColorStop(0.42, car.color); gr.addColorStop(1, car.dark);
    c.fillStyle = gr; c.fill(path);
    c.save(); c.clip(path);
    const hl = c.createLinearGradient(0, -0.95, 0, -0.1);
    hl.addColorStop(0, 'rgba(255,255,255,.6)'); hl.addColorStop(0.45, 'rgba(255,255,255,.14)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hl; c.fillRect(-2.3, -1.2, 4.6, 1.15);
    const sh = c.createLinearGradient(0, 0.04, 0, 0.36);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.42)');
    c.fillStyle = sh; c.fillRect(-2.3, 0.04, 4.6, 0.4);
    if (deco) deco();
    if (arch > 0) { c.fillStyle = '#0c0e13'; disc(c, -1.15, wy === undefined ? 0.42 : wy, arch); disc(c, 1.15, wy === undefined ? 0.42 : wy, arch); }
    c.restore();
    c.strokeStyle = 'rgba(10,12,18,.85)'; c.lineWidth = 0.045; c.lineJoin = 'round'; c.stroke(path);
  }
  function glass(c, path) {
    const gg = c.createLinearGradient(0, -0.95, 0, -0.25);
    gg.addColorStop(0, '#6c9cc4'); gg.addColorStop(1, '#101f35');
    c.fillStyle = gg; c.fill(path);
    c.save(); c.clip(path); c.fillStyle = 'rgba(255,255,255,.3)';
    for (const x of [-0.55, 0.3]) { c.beginPath(); c.moveTo(x, -1.1); c.lineTo(x + 0.22, -1.1); c.lineTo(x - 0.28, 0); c.lineTo(x - 0.5, 0); c.closePath(); c.fill(); }
    c.restore();
    c.strokeStyle = 'rgba(10,12,18,.8)'; c.lineWidth = 0.035; c.stroke(path);
  }
  function lamp(c, x, y, r, col) {
    if (!SOLID) {
      const gl = c.createRadialGradient(x, y, 0, x, y, r * 3.2);
      gl.addColorStop(0, col); gl.addColorStop(0.3, col + '88'); gl.addColorStop(1, col + '00');
      c.fillStyle = gl; disc(c, x, y, r * 3.2);
    }
    c.fillStyle = '#ffffff'; disc(c, x, y, r * 0.55);
  }
  function seg(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }

  const BODIES = [
    function coupe(c, car) {
      c.fillStyle = car.dark; c.fillRect(-2.0, -0.62, 0.66, 0.1); c.fillRect(-1.78, -0.54, 0.08, 0.32); c.fillRect(-1.52, -0.54, 0.08, 0.3);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(-2.0, -0.62, 0.66, 0.025);
      const body = mk(p => {
        p.moveTo(-1.74, 0.3); p.lineTo(-1.82, -0.08); p.quadraticCurveTo(-1.8, -0.24, -1.5, -0.26);
        p.quadraticCurveTo(-1.0, -0.76, -0.3, -0.78); p.quadraticCurveTo(0.34, -0.78, 0.8, -0.31);
        p.quadraticCurveTo(1.5, -0.25, 1.78, -0.03); p.quadraticCurveTo(1.86, 0.1, 1.82, 0.3); p.closePath();
      });
      paintBody(c, car, body, 0.6, () => {
        c.fillStyle = car.accent; c.fillRect(-1.9, -0.14, 3.8, 0.07); c.fillRect(-1.9, -0.04, 3.8, 0.03);
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.025;
        seg(c, -0.4, -0.3, -0.36, 0.3); c.beginPath(); c.moveTo(0.62, -0.3); c.quadraticCurveTo(0.7, 0, 0.68, 0.3); c.stroke();
        c.fillStyle = 'rgba(0,0,0,.45)'; for (let k = 0; k < 3; k++) c.fillRect(0.82 + k * 0.09, 0.05, 0.045, 0.13);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0.24, -0.24, 0.2, 0.04);
      });
      glass(c, mk(p => { p.moveTo(-1.02, -0.33); p.quadraticCurveTo(-0.74, -0.67, -0.3, -0.68); p.lineTo(0.16, -0.65); p.lineTo(0.62, -0.31); p.closePath(); }));
      c.fillStyle = car.color; c.fillRect(-0.37, -0.69, 0.07, 0.38);
      lamp(c, 1.7, 0.0, 0.09, '#fff3b0');
      c.fillStyle = '#ff3030'; c.fillRect(-1.82, -0.1, 0.07, 0.15);
      c.fillStyle = '#15171c'; c.fillRect(1.5, 0.27, 0.36, 0.06);
      c.fillStyle = '#9aa3b2'; c.fillRect(-1.9, 0.2, 0.16, 0.07);
    },
    function buggy(c, car) {
      const eg = c.createLinearGradient(0, -0.5, 0, -0.1); eg.addColorStop(0, '#99a1af'); eg.addColorStop(1, '#353a45');
      c.fillStyle = eg; c.fillRect(-1.78, -0.46, 0.56, 0.34);
      c.strokeStyle = '#c9ced8'; c.lineWidth = 0.07; c.lineCap = 'round'; seg(c, -1.62, -0.46, -1.74, -0.8); seg(c, -1.42, -0.46, -1.54, -0.8);
      c.fillStyle = '#262a35'; c.beginPath(); c.ellipse(0.02, -0.2, 0.2, 0.26, 0, 0, 6.2832); c.fill();
      c.fillStyle = '#f4f4f4'; disc(c, 0.1, -0.5, 0.2);
      c.fillStyle = '#16283f'; c.beginPath(); c.ellipse(0.2, -0.5, 0.1, 0.09, 0, 0, 6.2832); c.fill();
      const cage = mk(p => { p.moveTo(-1.0, -0.14); p.lineTo(-0.78, -0.82); p.lineTo(0.34, -0.82); p.lineTo(0.9, -0.14); p.moveTo(-0.26, -0.82); p.lineTo(-0.3, -0.14); p.moveTo(-0.78, -0.82); p.lineTo(-1.66, -0.2); });
      c.lineJoin = 'round'; c.strokeStyle = '#1b1e26'; c.lineWidth = 0.13; c.stroke(cage); c.strokeStyle = '#69718280'; c.lineWidth = 0.045; c.stroke(cage);
      const tub = mk(p => { p.moveTo(-1.64, 0.28); p.lineTo(-1.72, -0.08); p.lineTo(-0.95, -0.2); p.lineTo(0.9, -0.2); p.quadraticCurveTo(1.52, -0.14, 1.78, 0.06); p.lineTo(1.76, 0.28); p.closePath(); });
      paintBody(c, car, tub, 0.66, () => {
        c.fillStyle = car.accent; c.fillRect(-1.8, -0.03, 3.7, 0.08);
        c.fillStyle = '#ffffff'; disc(c, -0.1, 0.03, 0.17);
        c.save(); c.translate(-0.1, 0.045); c.scale(0.01, 0.01); c.fillStyle = '#15171c'; c.font = '900 27px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('7', 0, 0); c.restore();
      });
      c.strokeStyle = '#262a35'; c.lineWidth = 0.08; c.lineCap = 'round'; c.beginPath(); c.moveTo(1.7, 0.2); c.lineTo(1.92, 0.2); c.lineTo(1.92, -0.05); c.stroke();
      lamp(c, 1.48, -0.25, 0.08, '#fff3b0');
    },
    function wedge(c, car) {
      c.fillStyle = car.dark; c.beginPath(); c.moveTo(-1.82, -0.3); c.lineTo(-2.05, -0.9); c.lineTo(-1.75, -0.9); c.lineTo(-1.25, -0.45); c.closePath(); c.fill();
      c.fillStyle = car.accent; c.fillRect(-2.07, -0.93, 0.34, 0.05);
      const body = mk(p => { p.moveTo(-1.78, 0.3); p.lineTo(-1.84, -0.34); p.lineTo(-1.2, -0.5); p.quadraticCurveTo(0.25, -0.58, 1.86, 0.1); p.quadraticCurveTo(1.92, 0.2, 1.84, 0.3); p.closePath(); });
      paintBody(c, car, body, 0.6, () => {
        c.strokeStyle = car.accent; c.globalAlpha = 0.3; c.lineWidth = 0.2; seg(c, -1.9, 0.0, 1.7, 0.15);
        c.globalAlpha = 1; c.lineWidth = 0.055; seg(c, -1.9, 0.0, 1.7, 0.15);
        c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.moveTo(0.5, -0.24); c.lineTo(1.02, -0.1); c.lineTo(0.92, -0.03); c.lineTo(0.45, -0.12); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.025; seg(c, -0.95, -0.5, -0.85, 0.3);
      });
      glass(c, mk(p => { p.ellipse(-0.35, -0.47, 0.64, 0.33, -0.06, Math.PI, 0); p.closePath(); }));
      c.fillStyle = '#15171c'; c.fillRect(-1.96, -0.2, 0.14, 0.38); c.fillStyle = car.accent; c.fillRect(-1.99, -0.13, 0.05, 0.24);
      lamp(c, 1.66, 0.13, 0.07, '#7df9ff');
    },
    function pickup(c, car) {
      c.strokeStyle = '#262a35'; c.lineWidth = 0.1; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-1.5, -0.3); c.lineTo(-1.4, -0.82); c.lineTo(-0.75, -0.82); c.lineTo(-0.62, -0.3); c.stroke();
      c.strokeStyle = '#2b2f3a'; c.lineWidth = 0.09; c.beginPath(); c.moveTo(1.72, 0.28); c.lineTo(1.93, 0.28); c.lineTo(1.93, -0.3); c.lineTo(1.72, -0.3); c.moveTo(1.93, 0.0); c.lineTo(1.74, 0.0); c.stroke();
      const body = mk(p => { p.moveTo(-1.78, 0.3); p.lineTo(-1.82, -0.34); p.lineTo(-0.55, -0.34); p.lineTo(-0.5, -0.84); p.lineTo(0.42, -0.84); p.quadraticCurveTo(0.78, -0.76, 0.94, -0.33); p.lineTo(1.7, -0.25); p.quadraticCurveTo(1.8, -0.1, 1.78, 0.3); p.closePath(); });
      paintBody(c, car, body, 0.68, () => {
        c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(-1.82, -0.22, 1.27, 0.06);
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.025; seg(c, -0.52, -0.34, -0.52, 0.3); seg(c, 0.3, -0.34, 0.3, 0.3);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0.02, -0.22, 0.2, 0.04);
        c.fillStyle = car.accent; c.fillRect(-1.9, -0.03, 3.8, 0.05);
      });
      glass(c, mk(p => { p.moveTo(-0.4, -0.74); p.lineTo(0.38, -0.74); p.quadraticCurveTo(0.63, -0.64, 0.76, -0.36); p.lineTo(-0.4, -0.36); p.closePath(); }));
      c.fillStyle = car.color; c.fillRect(-0.02, -0.74, 0.06, 0.38);
      c.fillStyle = '#262a35'; c.fillRect(-0.34, -0.94, 0.72, 0.1);
      for (let k = 0; k < 3; k++) lamp(c, -0.2 + k * 0.22, -0.9, 0.05, '#fff3b0');
      lamp(c, 1.68, -0.12, 0.08, '#fff3b0');
      c.fillStyle = '#ff3030'; c.fillRect(-1.84, -0.26, 0.07, 0.16);
      c.fillStyle = '#15171c'; c.fillRect(-0.45, 0.24, 0.9, 0.07);
    },
    function kever(c, car) {
      const body = mk(p => {
        p.moveTo(-1.62, 0.3); p.lineTo(-1.7, -0.02); p.quadraticCurveTo(-1.66, -0.42, -1.05, -0.5);
        p.quadraticCurveTo(-0.7, -0.98, -0.05, -1.0); p.quadraticCurveTo(0.62, -1.0, 0.92, -0.5);
        p.quadraticCurveTo(1.5, -0.46, 1.7, -0.06); p.quadraticCurveTo(1.76, 0.12, 1.72, 0.3); p.closePath();
      });
      paintBody(c, car, body, 0.58, () => {
        c.fillStyle = car.accent; c.globalAlpha = 0.9; c.fillRect(-1.8, -0.08, 3.7, 0.09); c.globalAlpha = 1;
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.025; seg(c, -0.72, -0.5, -0.7, 0.3); seg(c, 0.42, -0.5, 0.46, 0.3);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(0.16, -0.3, 0.18, 0.04);
        c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 0.03; c.beginPath(); c.arc(-1.15, 0.42, 0.72, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); c.beginPath(); c.arc(1.15, 0.42, 0.72, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      });
      glass(c, mk(p => { p.moveTo(-0.95, -0.52); p.quadraticCurveTo(-0.66, -0.9, -0.05, -0.91); p.quadraticCurveTo(0.52, -0.91, 0.78, -0.52); p.closePath(); }));
      c.fillStyle = car.color; c.fillRect(-0.12, -0.92, 0.07, 0.4);
      lamp(c, 1.52, -0.26, 0.11, '#fff3b0');
      c.fillStyle = '#ff3030'; disc(c, -1.62, -0.2, 0.07);
      c.fillStyle = '#c9ced8'; c.fillRect(1.6, 0.18, 0.2, 0.08); c.fillRect(-1.8, 0.18, 0.2, 0.08);
    },
    function bolide(c, car) {
      // vleugels
      c.fillStyle = '#15171c'; c.fillRect(-1.92, -0.86, 0.1, 0.72); c.fillRect(-2.1, -0.9, 0.62, 0.1); c.fillRect(-2.06, -0.68, 0.5, 0.07);
      c.fillStyle = car.color; c.fillRect(-2.1, -0.93, 0.62, 0.04);
      c.fillStyle = '#15171c'; c.fillRect(1.5, 0.2, 0.62, 0.07); c.fillRect(2.06, 0.02, 0.06, 0.25);
      // helm
      c.fillStyle = '#f4f4f4'; disc(c, -0.28, -0.42, 0.19);
      c.fillStyle = '#16283f'; c.beginPath(); c.ellipse(-0.18, -0.42, 0.1, 0.08, 0, 0, 6.2832); c.fill();
      const body = mk(p => {
        p.moveTo(-1.7, 0.28); p.lineTo(-1.74, -0.18); p.quadraticCurveTo(-1.5, -0.62, -0.9, -0.66); p.lineTo(-0.62, -0.4);
        p.lineTo(0.0, -0.36); p.quadraticCurveTo(1.0, -0.26, 2.0, 0.08); p.lineTo(2.0, 0.2); p.lineTo(0.9, 0.28); p.closePath();
      });
      paintBody(c, car, body, 0, () => {
        c.fillStyle = car.accent; c.fillRect(-1.8, -0.1, 3.9, 0.06);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.beginPath(); c.moveTo(-0.5, -0.12); c.lineTo(0.5, -0.06); c.lineTo(0.5, 0.2); c.lineTo(-0.6, 0.2); c.closePath(); c.fill();
        c.fillStyle = '#ffffff'; disc(c, -1.2, -0.3, 0.16);
        c.save(); c.translate(-1.2, -0.29); c.scale(0.01, 0.01); c.fillStyle = '#15171c'; c.font = '900 24px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('1', 0, 0); c.restore();
      });
      c.strokeStyle = '#2b2f3a'; c.lineWidth = 0.06; c.lineCap = 'round';
      seg(c, 1.15, 0.35, 0.7, 0.1); seg(c, 1.15, 0.35, 1.5, 0.12); seg(c, -1.15, 0.35, -0.8, 0.1); seg(c, -1.15, 0.35, -1.5, 0.05);
    },
    function monster(c, car) {
      // veren en assen
      c.strokeStyle = '#8d95a3'; c.lineWidth = 0.09; c.lineCap = 'round';
      seg(c, -1.15, 0.3, -0.85, -0.12); seg(c, 1.15, 0.3, 0.85, -0.12); seg(c, -1.15, 0.3, -1.4, -0.12); seg(c, 1.15, 0.3, 1.4, -0.12);
      c.strokeStyle = '#2b2f3a'; c.lineWidth = 0.12; seg(c, -1.15, 0.3, 1.15, 0.3);
      c.strokeStyle = '#262a35'; c.lineWidth = 0.1; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-1.45, -0.62); c.lineTo(-1.36, -1.12); c.lineTo(-0.75, -1.12); c.lineTo(-0.62, -0.62); c.stroke();
      const body = mk(p => { p.moveTo(-1.74, -0.06); p.lineTo(-1.78, -0.64); p.lineTo(-0.55, -0.64); p.lineTo(-0.5, -1.12); p.lineTo(0.4, -1.12); p.quadraticCurveTo(0.76, -1.04, 0.92, -0.63); p.lineTo(1.66, -0.55); p.quadraticCurveTo(1.78, -0.4, 1.76, -0.06); p.closePath(); });
      paintBody(c, car, body, 0, () => {
        // vlammen
        c.fillStyle = car.accent;
        c.beginPath(); c.moveTo(1.8, -0.5); c.quadraticCurveTo(1.0, -0.56, 0.5, -0.36); c.quadraticCurveTo(0.9, -0.34, 0.2, -0.2); c.quadraticCurveTo(0.8, -0.2, 0.0, -0.08); c.lineTo(1.8, -0.08); c.closePath(); c.fill();
        c.fillStyle = '#ffd23f';
        c.beginPath(); c.moveTo(1.8, -0.36); c.quadraticCurveTo(1.2, -0.38, 0.9, -0.26); c.quadraticCurveTo(1.2, -0.24, 0.7, -0.1); c.lineTo(1.8, -0.1); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 0.025; seg(c, -0.52, -0.64, -0.52, -0.06); seg(c, 0.28, -0.64, 0.28, -0.06);
      });
      glass(c, mk(p => { p.moveTo(-0.4, -1.03); p.lineTo(0.36, -1.03); p.quadraticCurveTo(0.61, -0.93, 0.74, -0.66); p.lineTo(-0.4, -0.66); p.closePath(); }));
      c.fillStyle = '#262a35'; c.fillRect(-0.32, -1.22, 0.7, 0.1);
      for (let k = 0; k < 3; k++) lamp(c, -0.18 + k * 0.22, -1.18, 0.05, '#fff3b0');
      lamp(c, 1.66, -0.42, 0.08, '#fff3b0');
      c.fillStyle = '#ff3030'; c.fillRect(-1.8, -0.56, 0.07, 0.16);
    },
    function raket(c, car) {
      // staartvinnen
      c.fillStyle = car.accent;
      c.beginPath(); c.moveTo(-1.5, -0.42); c.lineTo(-2.1, -1.0); c.lineTo(-1.72, -1.0); c.lineTo(-0.9, -0.46); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-1.5, 0.14); c.lineTo(-2.05, 0.34); c.lineTo(-1.2, 0.3); c.closePath(); c.fill();
      // straalpijp
      const ng = c.createLinearGradient(0, -0.4, 0, 0.2); ng.addColorStop(0, '#aeb5c2'); ng.addColorStop(1, '#3a3f4b');
      c.fillStyle = ng; c.beginPath(); c.moveTo(-1.7, -0.36); c.lineTo(-2.08, -0.46); c.lineTo(-2.08, 0.22); c.lineTo(-1.7, 0.14); c.closePath(); c.fill();
      const body = mk(p => {
        p.moveTo(-1.74, 0.2); p.lineTo(-1.74, -0.4); p.quadraticCurveTo(-0.6, -0.62, 0.6, -0.44); p.quadraticCurveTo(1.6, -0.3, 2.02, -0.02);
        p.quadraticCurveTo(1.7, 0.22, 0.9, 0.28); p.lineTo(-1.2, 0.3); p.closePath();
      });
      paintBody(c, car, body, 0.56, () => {
        c.fillStyle = car.accent; c.fillRect(-1.8, -0.16, 2.6, 0.1);
        c.beginPath(); c.moveTo(1.3, -0.4); c.lineTo(2.1, -0.05); c.lineTo(1.3, 0.3); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.025; seg(c, -0.9, -0.55, -0.9, 0.3); seg(c, 0.2, -0.5, 0.2, 0.3);
        c.fillStyle = 'rgba(0,0,0,.45)'; for (let k = 0; k < 4; k++) disc(c, -0.6 + k * 0.22, 0.08, 0.035);
      });
      glass(c, mk(p => { p.ellipse(0.42, -0.42, 0.42, 0.24, 0.08, Math.PI, 0); p.closePath(); }));
    }
  ];
  // per auto: hoogte van de wielkast (monster staat hoger op zijn poten)
  const WHEEL_Y = [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45];

  const bodyCache = [], silCache = [], wheelCache = [];
  const SW = 4.8, SH = 2.7, SOX = 2.4, SOY = 1.55;   // spritemaat en oorsprong in meters
  function bodySprite(d) {
    if (!bodyCache[d]) bodyCache[d] = sprite(SW, SH, SOX, SOY, c => BODIES[d](c, CARS[d]));
    return bodyCache[d];
  }
  // egaal gekleurd silhouet: [0] = dak/motorkap (licht), [1] = onderkant (donker)
  function silhouettes(d) {
    if (silCache[d]) return silCache[d];
    SOLID = true; const base = sprite(SW, SH, SOX, SOY, c => BODIES[d](c, CARS[d])); SOLID = false;
    const tint = col => {
      const cvs = document.createElement('canvas'); cvs.width = base.width; cvs.height = base.height;
      const c = cvs.getContext('2d'); c.drawImage(base, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = col; c.fillRect(0, 0, cvs.width, cvs.height);
      return cvs;
    };
    return (silCache[d] = [tint(CARS[d].light), tint(CARS[d].color), tint('#15171c')]);
  }
  function wheelSprite(d, far) {
    const key = d * 2 + (far ? 1 : 0);
    if (wheelCache[key]) return wheelCache[key];
    const r = WHEEL_R[d], h = r + 0.03, rim = far ? '#4a505e' : CARS[d].rim;
    return (wheelCache[key] = sprite(h * 2, h * 2, h, h, c => {
      c.fillStyle = far ? '#07080b' : '#101216'; disc(c, 0, 0, r);
      c.strokeStyle = far ? '#15181e' : '#2c313b'; c.lineWidth = 0.07; c.setLineDash([0.075, 0.06]); c.beginPath(); c.arc(0, 0, r - 0.04, 0, 6.2832); c.stroke(); c.setLineDash([]);
      c.fillStyle = far ? '#0d0f13' : '#1c1f26'; disc(c, 0, 0, r * 0.84);
      const rg = c.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.05, 0, 0, r * 0.66);
      rg.addColorStop(0, far ? '#7c8494' : '#ffffff'); rg.addColorStop(0.35, rim); rg.addColorStop(1, far ? '#262a33' : '#5a6070');
      c.fillStyle = rg; disc(c, 0, 0, r * 0.64);
      c.fillStyle = '#15171c';
      for (let k = 0; k < 5; k++) { c.save(); c.rotate(k * 1.2566 + 0.63); c.beginPath(); c.ellipse(r * 0.39, 0, r * 0.15, r * 0.115, 0, 0, 6.2832); c.fill(); c.restore(); }
      if (!far) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.022; c.beginPath(); c.arc(0, 0, r * 0.64, 0, 6.2832); c.stroke(); }
      c.fillStyle = far ? '#6b7282' : '#e9edf5'; disc(c, 0, 0, r * 0.19); c.fillStyle = '#3a3f4b'; disc(c, 0, 0, r * 0.08);
    }));
  }

  function wheelsAt(c, v, design, depth, far) {
    const ws = wheelSprite(design, far), r = WHEEL_R[design], h = r + 0.03, wy = WHEEL_Y[design] - (r - 0.48);
    c.save(); c.translate(v.x + DX * depth, v.y + DY * depth); c.rotate(v.a);
    c.save(); c.translate(-1.15, wy - Math.min(v.sus0, 0.3)); c.rotate(v.spin0); c.drawImage(ws, -h, -h, h * 2, h * 2); c.restore();
    c.save(); c.translate(1.15, wy - Math.min(v.sus1, 0.3)); c.rotate(v.spin1); c.drawImage(ws, -h, -h, h * 2, h * 2); c.restore();
    c.restore();
  }

  // v = {x,y,a,spin0,spin1,sus0,sus1,boost,z}; z = diepte van de rijstrook op die plek
  function drawCar(c, v, design, alpha) {
    design = design % CARS.length;
    const z0 = v.z || 0;
    c.save();
    if (alpha < 1) c.globalAlpha = alpha;
    const im = IMG['car-' + (design + 1)];
    if (im) {
      c.translate(v.x + DX * (z0 + 1.5), v.y + DY * (z0 + 1.5)); c.rotate(v.a);
      const w = 3.9, h = w * im.height / im.width; c.drawImage(im, -w / 2, 0.93 - h, w, h);
      c.restore(); return;
    }
    wheelsAt(c, v, design, z0 + CAR_ZF + 0.1, true);
    // carrosserie in plakjes van achter naar voor: zo ontstaat de bovenkant
    const sil = silhouettes(design), up = Math.cos(v.a) > 0, N = 7;
    for (let k = N; k >= 1; k--) {
      const dz = z0 + CAR_ZN + (CAR_ZF - CAR_ZN) * k / N;
      c.save(); c.translate(v.x + DX * dz, v.y + DY * dz); c.rotate(v.a);
      c.drawImage(up ? (k > N - 2 ? sil[1] : sil[0]) : sil[2], -SOX, -SOY, SW, SH);
      c.restore();
    }
    c.save(); c.translate(v.x + DX * (z0 + CAR_ZN), v.y + DY * (z0 + CAR_ZN)); c.rotate(v.a);
    if (v.boost) {
      const f = 1.0 + Math.random() * 0.9;
      c.save(); c.globalCompositeOperation = 'lighter';
      const fg = c.createLinearGradient(-1.8, 0, -1.8 - 1.9 * f, 0);
      fg.addColorStop(0, 'rgba(255,255,230,.95)'); fg.addColorStop(0.3, 'rgba(255,180,50,.85)'); fg.addColorStop(0.7, 'rgba(255,70,20,.45)'); fg.addColorStop(1, 'rgba(255,40,10,0)');
      c.fillStyle = fg; c.beginPath(); c.moveTo(-1.78, -0.2); c.quadraticCurveTo(-1.8 - 1.1 * f, -0.2, -1.8 - 1.9 * f, 0.06); c.quadraticCurveTo(-1.8 - 1.1 * f, 0.34, -1.78, 0.3); c.closePath(); c.fill();
      c.fillStyle = 'rgba(160,220,255,.7)'; c.beginPath(); c.ellipse(-1.95, 0.05, 0.3 * f, 0.11, 0, 0, 6.2832); c.fill();
      c.restore();
    }
    c.drawImage(bodySprite(design), -SOX, -SOY, SW, SH);
    c.restore();
    wheelsAt(c, v, design, z0 + CAR_ZN - 0.1, false);
    c.restore();
  }

  // ---------------------------------------------------------------- thema's
  const THEMES = {
    desert: {
      sky: ['#1f7fd6', '#86cdf2', '#ffe9bd'], orb: { x: 0.76, y: 0.19, r: 34, c: '#fffbe6', glow: '255,236,160' },
      clouds: 'rgba(255,255,255,.8)', haze: '255,226,170',
      layers: [
        { type: 'mesa', c: '#f0c49c', c2: '#f6dcc0', f: 0.04, base: 0.66, amp: 0.22, seed: 1.3, sc: 0.8 },
        { type: 'mesa', c: '#d98c5f', c2: '#e9b48a', f: 0.1, base: 0.76, amp: 0.18, seed: 4.1, sc: 1.3 },
        { type: 'ridge', c: '#a9573a', c2: '#c97d55', f: 0.22, base: 0.9, amp: 0.1, seed: 7.7, sc: 2.2 }
      ],
      ground: ['#e8bf79', '#8a5a2c'], grass: '#f9e6ad', grassHi: '#fff6d6',
      track: '#16c7bd', trackDark: '#0c8f93', trackDeep: '#075c66', edge: '#eafffb',
      pillar: '#6d5a4e', prop: 'desert', dust: '232,207,154',
      top: '#f0d596', topLine: 'rgba(120,70,30,.13)', pit: '#2a160c'
    },
    neon: {
      sky: ['#05031a', '#2b0f58', '#a02a78'], retroSun: true, stars: true, haze: '255,80,190',
      layers: [
        { type: 'city', c: '#33206e', c2: '#4a2a86', f: 0.04, base: 0.72, amp: 0.36, seed: 2.2, w: 64, win: '#ffd86b' },
        { type: 'city', c: '#190f40', c2: '#2a1a5e', f: 0.1, base: 0.85, amp: 0.36, seed: 5.5, w: 96, win: '#62f4ff' },
        { type: 'ridge', c: '#0c0722', c2: '#150c33', f: 0.22, base: 0.96, amp: 0.05, seed: 3.3, sc: 3 }
      ],
      ground: ['#2c2560', '#0b081d'], grass: '#62f4ff', grassHi: '#d9fdff',
      track: '#ff3fb4', trackDark: '#b01f80', trackDeep: '#6a0f52', edge: '#ffe6fa',
      pillar: '#463c86', prop: 'neon', dust: '185,167,255', glow: true,
      top: '#231c52', topLine: 'rgba(98,244,255,.3)', pit: '#6a1260'
    },
    ice: {
      sky: ['#081f47', '#3676b4', '#d9f0fa'], orb: { x: 0.8, y: 0.15, r: 22, c: '#ffffff', glow: '220,240,255' },
      aurora: true, stars: true, snow: true, clouds: 'rgba(255,255,255,.35)', haze: '225,242,255',
      layers: [
        { type: 'peak', c: '#b8d5ea', c2: '#dcecf7', f: 0.035, base: 0.7, amp: 0.36, seed: 3.1, sc: 0.7, snowcap: true },
        { type: 'peak', c: '#84b0d2', c2: '#b4d2e8', f: 0.09, base: 0.8, amp: 0.27, seed: 6.4, sc: 1.2, snowcap: true },
        { type: 'ridge', c: '#5486ae', c2: '#84b0d2', f: 0.22, base: 0.92, amp: 0.1, seed: 9.9, sc: 2.4 }
      ],
      ground: ['#f6fcff', '#86b2d0'], grass: '#ffffff', grassHi: '#ffffff',
      track: '#f0434a', trackDark: '#b3242f', trackDeep: '#701019', edge: '#fff0f0',
      pillar: '#5e7890', prop: 'ice', dust: '255,255,255',
      top: '#f2faff', topLine: 'rgba(90,140,180,.18)', pit: '#0d3a5c'
    }
  };
  const PXM = 24;   // parallaxpixels per meter

  function layerH(L, wx) {
    const s = L.sc || 1, k = L.seed;
    if (L.type === 'peak') {
      return 0.6 * (1 - Math.abs(Math.sin(wx * 0.0036 * s + k))) + 0.3 * (1 - Math.abs(Math.sin(wx * 0.0087 * s + k * 2.1))) + 0.1 * (0.5 + 0.5 * Math.sin(wx * 0.021 * s + k));
    }
    const r = 0.5 + 0.5 * (Math.sin(wx * 0.0055 * s + k) * 0.55 + Math.sin(wx * 0.0127 * s + k * 1.7) * 0.3 + Math.sin(wx * 0.031 * s + k * 2.9) * 0.15);
    if (L.type === 'mesa') return clamp((r - 0.38) * 5, 0, 1) * 0.75 + r * 0.25;
    return r;
  }

  function drawCity(L, off, by, time) {
    const w = L.w, b0 = Math.floor(off / w);
    for (let b = b0 - 1; b * w - off < W; b++) {
      const x0 = b * w - off, bw = w * (0.62 + 0.36 * hash(b + L.seed)), bh = H * L.amp * (0.3 + 0.7 * hash(b * 1.7 + L.seed)), top = by - bh;
      const bg = g.createLinearGradient(0, top, 0, by + 40); bg.addColorStop(0, L.c2); bg.addColorStop(1, L.c);
      g.fillStyle = bg; g.fillRect(x0, top, bw, H - top);
      if (hash(b * 2.3 + L.seed) > 0.55) { g.fillStyle = L.c2; g.fillRect(x0 + bw * 0.25, top - 10, bw * 0.5, 10); }
      g.fillStyle = L.win; g.globalAlpha = 0.6;
      const cols = Math.floor((bw - 8) / 13), rows = Math.min(14, Math.floor((bh - 8) / 17));
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        if (hash(b * 31.7 + q * 7.3 + r * 13.1 + L.seed) > 0.58) g.fillRect(x0 + 6 + q * 13, top + 8 + r * 17, 6, 9);
      }
      g.globalAlpha = 1;
      if (hash(b * 3.3 + L.seed) > 0.68) {
        g.fillStyle = L.c2; g.fillRect(x0 + bw * 0.5 - 1, top - 34, 2, 34);
        g.fillStyle = 'rgba(255,60,60,' + (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 3 + b))).toFixed(2) + ')'; g.beginPath(); g.arc(x0 + bw * 0.5, top - 34, 2.6, 0, 6.2832); g.fill();
      }
      if (bh > 110 && hash(b * 5.9 + L.seed) > 0.66) {
        const col = hash(b * 8.1) > 0.5 ? '#ff3fb4' : '#62f4ff', sx = x0 + bw * 0.18, sy = top + bh * 0.22, sw = bw * 0.64;
        g.strokeStyle = col; g.globalAlpha = 0.25; g.lineWidth = 7; g.strokeRect(sx, sy, sw, 13);
        g.globalAlpha = 0.95; g.lineWidth = 2; g.strokeRect(sx, sy, sw, 13); g.globalAlpha = 1;
      }
    }
  }

  // hz = hoogte van de einder op het scherm (alleen in 3D): daar sluiten de lagen op aan
  function drawBackground(theme, cam, time, hz) {
    const th = THEMES[theme];
    const bg = IMG['bg-' + theme];
    const yoff = hz === undefined ? clamp(-cam.y * 2.2, -H * 0.12, H * 0.12) : 0;
    if (bg) {
      const sc = (H * 1.15) / bg.height, bw = bg.width * sc;
      let ox = -((cam.x * PXM * 0.04) % bw); if (ox > 0) ox -= bw;
      for (let x = ox; x < W; x += bw) g.drawImage(bg, x, -H * 0.075 + yoff * 0.3, bw + 1, H * 1.15);
    } else {
      const sg = g.createLinearGradient(0, 0, 0, H);
      sg.addColorStop(0, th.sky[0]); sg.addColorStop(0.5, th.sky[1]); sg.addColorStop(0.85, th.sky[2]);
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      if (th.stars) {
        for (let i = 0; i < 110; i++) {
          const tw = 0.5 + 0.5 * Math.sin(time * 1.7 + i * 2.3), sz = hash(i * 4.9) > 0.85 ? 2.4 : 1.4;
          g.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.65 * tw * hash(i * 3.1)).toFixed(2) + ')';
          g.fillRect(hash(i) * W, hash(i * 7.7) * H * 0.55, sz, sz);
        }
      }
      if (th.aurora) {
        for (let b = 0; b < 3; b++) {
          const ag = g.createLinearGradient(0, H * 0.04, 0, H * 0.52);
          ag.addColorStop(0, 'rgba(90,255,190,0)'); ag.addColorStop(0.45, 'rgba(90,255,190,' + (0.2 - b * 0.04) + ')'); ag.addColorStop(1, 'rgba(140,120,255,0)');
          g.fillStyle = ag; g.beginPath(); g.moveTo(0, H * 0.52);
          for (let x = 0; x <= W + 24; x += 24) g.lineTo(x, H * (0.14 + b * 0.07) + Math.sin(x * 0.006 + time * 0.25 + b * 2) * H * 0.05 + Math.sin(x * 0.017 + time * 0.4) * H * 0.012);
          g.lineTo(W, H * 0.52); g.closePath(); g.fill();
        }
      }
      if (th.retroSun) {
        const R = Math.min(W, H) * 0.21, cx = W * 0.5, cy = hz === undefined ? H * 0.4 + yoff * 0.25 : hz - R * 0.45;
        const og = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.6);
        og.addColorStop(0, 'rgba(255,90,190,.5)'); og.addColorStop(1, 'rgba(255,90,190,0)');
        g.fillStyle = og; g.fillRect(cx - R * 2.6, cy - R * 2.6, R * 5.2, R * 5.2);
        g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.clip();
        const sgr = g.createLinearGradient(0, cy - R, 0, cy + R);
        sgr.addColorStop(0, '#fff07a'); sgr.addColorStop(0.5, '#ff8a4f'); sgr.addColorStop(1, '#ff3fb4');
        g.fillStyle = sgr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
        g.fillStyle = '#5a1a70';
        for (let k = 0; k < 6; k++) g.fillRect(cx - R, cy + R * (0.08 + k * 0.155), R * 2, R * (0.025 + k * 0.02));
        g.restore();
      } else {
        const o = th.orb, ox = W * o.x, oy = H * o.y + yoff * 0.2, R = o.r * (H / 800 + 0.5);
        const og = g.createRadialGradient(ox, oy, R * 0.5, ox, oy, R * 5);
        og.addColorStop(0, 'rgba(' + o.glow + ',.6)'); og.addColorStop(0.4, 'rgba(' + o.glow + ',.16)'); og.addColorStop(1, 'rgba(' + o.glow + ',0)');
        g.fillStyle = og; g.fillRect(ox - R * 5, oy - R * 5, R * 10, R * 10);
        g.fillStyle = o.c; g.beginPath(); g.arc(ox, oy, R, 0, 6.2832); g.fill();
      }
      if (th.clouds) {
        g.fillStyle = th.clouds;
        const span = W + 520;
        for (let i = 0; i < 7; i++) {
          let x = (hash(i * 5.1) * span - cam.x * PXM * 0.012 * (0.5 + hash(i * 1.9)) - time * 3 * (0.5 + hash(i))) % span; if (x < 0) x += span; x -= 260;
          const y = H * (0.07 + 0.3 * hash(i * 9.3)) + yoff * 0.2, s = (0.6 + hash(i * 3.3) * 0.9) * (H / 700 + 0.4);
          g.beginPath();
          g.ellipse(x, y, 70 * s, 20 * s, 0, 0, 6.2832); g.ellipse(x - 34 * s, y - 13 * s, 34 * s, 22 * s, 0, 0, 6.2832);
          g.ellipse(x + 20 * s, y - 20 * s, 42 * s, 28 * s, 0, 0, 6.2832); g.ellipse(x + 58 * s, y - 6 * s, 30 * s, 17 * s, 0, 0, 6.2832);
          g.fill();
        }
      }
    }
    const from = bg ? th.layers.length - 1 : 0;
    for (let li = from; li < th.layers.length; li++) {
      const L = th.layers[li], off = cam.x * PXM * L.f, by = hz === undefined ? H * L.base + yoff * (0.4 + L.f * 3) : hz + H * 0.02 * (li + 1);
      if (L.type === 'city') { drawCity(L, off, by, time); continue; }
      const lg = g.createLinearGradient(0, by - H * L.amp, 0, by + H * 0.12);
      lg.addColorStop(0, L.c); lg.addColorStop(1, L.c2);
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) g.lineTo(x, by - H * L.amp * layerH(L, x + off));
      g.lineTo(W + 8, H); g.closePath(); g.fill();
      if (L.snowcap) {
        g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath();
        for (let x = 0; x <= W + 8; x += 8) { const y = by - H * L.amp * layerH(L, x + off); if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        for (let x = W + 8; x >= 0; x -= 8) { const h = layerH(L, x + off); g.lineTo(x, by - H * L.amp * h + H * L.amp * Math.max(0, h - 0.6) * 0.95 + Math.sin((x + off) * 0.09) * 3); }
        g.closePath(); g.fill();
      } else if (L.type === 'mesa') {
        g.strokeStyle = 'rgba(120,60,30,.16)'; g.lineWidth = 2;
        for (let k = 1; k <= 2; k++) { g.beginPath(); for (let x = 0; x <= W + 8; x += 8) { const y = by - H * L.amp * layerH(L, x + off) + k * H * 0.028; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
      }
    }
    const hzg = g.createLinearGradient(0, H * 0.5, 0, H);
    hzg.addColorStop(0, 'rgba(' + th.haze + ',0)'); hzg.addColorStop(1, 'rgba(' + th.haze + ',.22)');
    g.fillStyle = hzg; g.fillRect(0, H * 0.5, W, H * 0.5);
  }

  // sneeuw en donkere hoeken, over de wereld heen
  let vig = null, vigKey = '';
  function drawOverlay(theme, cam, time) {
    const th = THEMES[theme];
    if (th.snow) {
      g.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 70; i++) {
        const d = 0.4 + hash(i * 2.1) * 0.9;
        let x = (hash(i) * W - cam.x * PXM * 0.5 * d + Math.sin(time * 0.8 + i) * 14) % W; if (x < 0) x += W;
        let y = (hash(i * 7.3) * H + time * (35 + 55 * d) - cam.y * 12 * d) % H; if (y < 0) y += H;
        g.beginPath(); g.arc(x, y, 1 + d * 1.6, 0, 6.2832); g.fill();
      }
    }
    const key = W + 'x' + H;
    if (key !== vigKey) {
      vigKey = key; const r = Math.hypot(W, H) / 2;
      vig = g.createRadialGradient(W / 2, H / 2, r * 0.55, W / 2, H / 2, r);
      vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.34)');
    }
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- baan tekenen
  const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };

  // diepte van de rijstrook per baanpunt: in een looping schroeft de baan naar achteren
  // (of weer terug), zodat in- en uitgang naast elkaar liggen
  function laneDepth(T, zl) {
    const n = T.n, Z = new Float64Array(n), ZL = zl || 3.6;
    let cur = 0, from = 0;
    for (let k = 0; k < T.loops.length; k++) {
      const l = T.loops[k], z0 = cur, z1 = cur > 0 ? 0 : ZL;
      for (let i = from; i < l.i0; i++) Z[i] = cur;
      for (let i = l.i0; i <= l.i1; i++) Z[i] = z0 + (z1 - z0) * (i - l.i0) / (l.i1 - l.i0);
      cur = z1; from = l.i1 + 1;
      const nextS = k + 1 < T.loops.length ? T.S[T.loops[k + 1].i0] : T.total;
      if (cur > 0 && nextS - T.S[l.i1] > 30) {
        const a = T.S[l.i1] + 3, b = a + 18, end = k + 1 < T.loops.length ? T.loops[k + 1].i0 : n;
        for (let i = from; i < end; i++) { const u = clamp((T.S[i] - a) / (b - a), 0, 1); Z[i] = cur * (1 + Math.cos(Math.PI * u)) / 2; }
        cur = 0; from = end;
      }
    }
    for (let i = from; i < n; i++) Z[i] = cur;
    return Z;
  }
  function laneZ(T, s) {
    const p = E.pointAt(T, s, _pt), Z = T.R.Z, i = p.seg;
    return Z[i] + (Z[i + 1] - Z[i]) * (T.LEN[i] > 0 ? p.u / T.LEN[i] : 0);
  }
  const _pt = {};

  function edgePath(T, Z, idx, w, dy) {
    const p = new Path2D();
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], z = (Z ? Z[i] : 0) + w, x = T.X[i] + DX * z, y = T.Y[i] + DY * z + (dy || 0);
      if (k === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    return p;
  }
  function bandPath(T, Z, idx, w0, w1, dy1) {
    const p = new Path2D();
    for (let k = 0; k < idx.length; k++) { const i = idx[k], z = (Z ? Z[i] : 0) + w0, x = T.X[i] + DX * z, y = T.Y[i] + DY * z; if (k === 0) p.moveTo(x, y); else p.lineTo(x, y); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k], z = (Z ? Z[i] : 0) + w1; p.lineTo(T.X[i] + DX * z, T.Y[i] + DY * z + (dy1 || 0)); }
    p.closePath();
    return p;
  }
  function strip(T, Z, idx) {
    return {
      band: bandPath(T, Z, idx, 0, TW), wall: bandPath(T, Z, idx, 0, 0, 0.34),
      kn: edgePath(T, Z, idx, 0.14), kf: edgePath(T, Z, idx, TW - 0.14), mid: edgePath(T, Z, idx, TW / 2),
      sheen: bandPath(T, Z, idx, TW * 0.62, TW * 0.9), near: edgePath(T, Z, idx, 0, 0.17)
    };
  }

  const patterns = {};
  function terrainPattern(theme) {
    if (patterns[theme] !== undefined) return patterns[theme];
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const x = pc.getContext('2d');
    if (theme === 'desert') {
      for (let i = 0; i < 110; i++) {
        x.fillStyle = hash(i * 1.7) > 0.5 ? 'rgba(110,62,24,.22)' : 'rgba(255,240,200,.3)';
        x.beginPath(); x.ellipse(hash(i) * 128, hash(i * 3.1) * 128, 1 + hash(i * 5.3) * 3.5, 1 + hash(i * 7.9) * 2, hash(i) * 3, 0, 6.2832); x.fill();
      }
    } else if (theme === 'neon') {
      x.strokeStyle = 'rgba(98,244,255,.4)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 1.5); x.lineTo(128, 1.5); x.moveTo(1.5, 0); x.lineTo(1.5, 128); x.stroke();
      x.strokeStyle = 'rgba(255,63,180,.18)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, 64); x.lineTo(128, 64); x.moveTo(64, 0); x.lineTo(64, 128); x.stroke();
    } else {
      x.strokeStyle = 'rgba(120,170,210,.28)'; x.lineWidth = 3; x.lineCap = 'round';
      for (let i = 0; i < 14; i++) { const px = hash(i) * 128, py = hash(i * 3.7) * 128, l = 10 + hash(i * 5) * 26; x.beginPath(); x.moveTo(px, py); x.lineTo(px + l, py + l * 0.35); x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 26; i++) x.fillRect(hash(i * 9.1) * 128, hash(i * 2.7) * 128, 2, 2);
    }
    let pat = null;
    try { pat = g.createPattern(pc, 'repeat'); pat.setTransform(new DOMMatrix([0.04, 0, 0, 0.04, 0, 0])); } catch (e) { pat = null; }
    return (patterns[theme] = pat);
  }

  function prepTrack(T) {
    const n = T.n, Z = laneDepth(T), bottom = T.maxY + 90;
    const R = { Z: Z, runs: [], quarters: [], pads: [], props: [], gaps: [], bottom: bottom };
    const ground = []; for (let i = 0; i < n; i++) if (!(T.FL[i] & E.F_INLOOP)) ground.push(i);
    // voorkant (doorsnede) en bovenkant van het landschap
    const fx = DX * Z_NEAR, fy = DY * Z_NEAR;
    R.front = new Path2D(); R.front.moveTo(T.X[0] - 60 + fx, bottom); R.front.lineTo(T.X[0] - 60 + fx, T.Y[0] + fy);
    for (const i of ground) R.front.lineTo(T.X[i] + fx, T.Y[i] + fy);
    R.front.lineTo(T.X[n - 1] + 60 + fx, T.Y[n - 1] + fy); R.front.lineTo(T.X[n - 1] + 60 + fx, bottom); R.front.closePath();
    R.line = edgePath(T, null, ground, 0);
    R.top = bandPath(T, null, ground, Z_NEAR, Z_FAR);
    // rijstroken op de grond
    let run = null;
    for (let i = 1; i < n - 1; i++) {
      const ok = !(T.FL[i] & (E.F_CLIFF | E.F_LOOP | E.F_PIT));
      if (ok) { if (!run) run = [i]; run.push(i + 1); }
      if ((!ok || i === n - 2) && run) { R.runs.push(strip(T, Z, run)); run = null; }
    }
    // loopings in vier kwarten: vloer of plafond, voor of achter
    for (const l of T.loops) {
      const q = Math.round((l.i1 - l.i0) / 4), cuts = [l.i0, l.i0 + q, l.mid, l.i1 - q, l.i1];
      for (let k = 0; k < 4; k++) {
        const s = strip(T, Z, range(cuts[k], cuts[k + 1]));
        s.ceil = k === 1 || k === 2; s.far = (Z[cuts[k]] + Z[cuts[k + 1]]) / 2 > ZL / 2;
        R.quarters.push(s);
      }
    }
    for (const p of T.pads) {
      const ch = [], idx = range(p.i0, p.i1);
      for (let s = p.s0 + 0.9; s < p.s1; s += 1.6) { E.pointAt(T, s, _pt); const z = Z[_pt.seg] + TW / 2; ch.push({ x: _pt.x + DX * z, y: _pt.y + DY * z, tx: _pt.tx, ty: _pt.ty }); }
      R.pads.push({ band: bandPath(T, Z, idx, 0.3, TW - 0.3), ch: ch });
    }
    // decor achter de baan
    let next = 26;
    for (let i = 4; i < n - 4; i++) {
      if (T.S[i] < next) continue;
      if ((T.FL[i] & (E.F_LOOP | E.F_CLIFF | E.F_INLOOP | E.F_PIT)) || Math.abs(T.TY[i]) > 0.3 || Z[i] > 0.4) continue;
      if (Math.abs(T.S[i] - T.finishS) < 8 || Math.abs(T.S[i] - T.startS - 3) < 8) continue;
      const z = 5.4 + hash(i * 4.3) * 2.8;
      R.props.push({ x: T.X[i] + DX * z, y: T.Y[i] + DY * z, k: hash(i * 1.37), sc: 0.8 + hash(i * 2.9) * 0.6 });
      next = T.S[i] + 12 + hash(i) * 18;
    }
    for (const gp of T.gaps) {
      const i = Math.max(2, gp.i0 - 8), z = TW + 1.2;
      R.props.push({ x: T.X[i] + DX * z, y: T.Y[i] + DY * z, k: 2, sc: 1 });
      const p = new Path2D(), top = Math.min(gp.lipY, gp.landY);
      p.moveTo(gp.x0 + DX * Z_NEAR, gp.lipY + DY * Z_NEAR); p.lineTo(gp.x0 + DX * Z_FAR, gp.lipY + DY * Z_FAR);
      p.lineTo(gp.x1 + DX * Z_FAR, gp.landY + DY * Z_FAR); p.lineTo(gp.x1 + DX * Z_NEAR, gp.landY + DY * Z_NEAR);
      p.lineTo(gp.x1 + DX * Z_NEAR, gp.pitY + 4); p.lineTo(gp.x0 + DX * Z_NEAR, gp.pitY + 4); p.closePath();
      R.gaps.push({ path: p, y0: top + DY * Z_FAR, y1: gp.pitY + 2 });
    }
    R.props.sort((a, b) => a.y - b.y);
    const mark = s => { E.pointAt(T, s, _pt); const z = Z[_pt.seg]; return { x: _pt.x, y: _pt.y, tx: _pt.tx, ty: _pt.ty, z: z }; };
    R.fin = mark(T.finishS); R.start = mark(T.startS + 3);
    return R;
  }

  function drawProp(kind, p, time) {
    g.save(); g.translate(p.x, p.y); g.scale(p.sc, p.sc);
    const k = p.k;
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(0.2, 0, 1.1, 0.22, 0, 0, 6.2832); g.fill();
    if (k === 2) {          // waarschuwingsbord voor een ravijn
      g.fillStyle = '#5a5f6b'; g.fillRect(-0.08, -2.4, 0.16, 2.4);
      g.fillStyle = '#ffd23f'; g.strokeStyle = '#15171c'; g.lineWidth = 0.14; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, -4.1); g.lineTo(1.05, -2.3); g.lineTo(-1.05, -2.3); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#15171c'; g.fillRect(-0.09, -3.55, 0.18, 0.7); g.beginPath(); g.arc(0, -2.6, 0.11, 0, 6.2832); g.fill();
    } else if (kind === 'desert') {
      if (k < 0.45) {
        g.strokeStyle = '#2f7a40'; g.lineCap = 'round'; g.lineWidth = 0.56;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -2.7); g.stroke();
        g.lineWidth = 0.36; g.beginPath(); g.moveTo(0, -1.2); g.lineTo(-0.78, -1.2); g.lineTo(-0.78, -2.0); g.moveTo(0, -1.7); g.lineTo(0.72, -1.7); g.lineTo(0.72, -2.4); g.stroke();
        g.strokeStyle = '#58b56a'; g.lineWidth = 0.14; g.beginPath(); g.moveTo(-0.12, -0.2); g.lineTo(-0.12, -2.6); g.moveTo(-0.86, -1.35); g.lineTo(-0.86, -1.95); g.moveTo(0.62, -1.85); g.lineTo(0.62, -2.35); g.stroke();
        g.fillStyle = '#ff7aa8'; g.beginPath(); g.arc(0, -2.95, 0.14, 0, 6.2832); g.fill();
      } else if (k < 0.75) {
        g.fillStyle = '#9a5a3a'; g.beginPath(); g.moveTo(-1.5, 0); g.lineTo(-1.1, -0.9); g.lineTo(-0.3, -1.25); g.lineTo(0.5, -0.8); g.lineTo(0.9, 0); g.closePath(); g.fill();
        g.fillStyle = '#c07a52'; g.beginPath(); g.moveTo(-1.1, -0.9); g.lineTo(-0.3, -1.25); g.lineTo(-0.1, -0.6); g.lineTo(-0.9, -0.4); g.closePath(); g.fill();
        g.fillStyle = '#7d4329'; g.beginPath(); g.moveTo(0.4, 0); g.lineTo(0.7, -0.55); g.lineTo(1.3, -0.6); g.lineTo(1.7, 0); g.closePath(); g.fill();
      } else {
        g.fillStyle = '#6b4a34'; g.fillRect(-0.09, -2.3, 0.18, 2.3);
        g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(-1.0, -2.6); g.lineTo(0.7, -2.6); g.lineTo(1.15, -2.1); g.lineTo(0.7, -1.6); g.lineTo(-1.0, -1.6); g.closePath(); g.fill();
        g.strokeStyle = '#2b2118'; g.lineWidth = 0.14; g.lineJoin = 'miter';
        for (let q = 0; q < 3; q++) { g.beginPath(); g.moveTo(-0.7 + q * 0.5, -2.4); g.lineTo(-0.4 + q * 0.5, -2.1); g.lineTo(-0.7 + q * 0.5, -1.8); g.stroke(); }
      }
    } else if (kind === 'neon') {
      const col = k > 0.5 ? '#62f4ff' : '#ff3fb4';
      if (k < 0.5) {
        g.strokeStyle = '#4a418c'; g.lineWidth = 0.18; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -4.4); g.lineTo(0.85, -4.75); g.stroke();
        const gl = g.createRadialGradient(0.85, -4.65, 0.05, 0.85, -4.65, 1.9);
        gl.addColorStop(0, '#ffffff'); gl.addColorStop(0.15, '#ff3fb4'); gl.addColorStop(0.5, '#ff3fb455'); gl.addColorStop(1, '#ff3fb400');
        g.fillStyle = gl; g.fillRect(-1.1, -6.6, 3.9, 3.9);
      } else if (k < 0.8) {
        g.fillStyle = '#30295e'; g.fillRect(-1.3, -2.2, 0.16, 2.2); g.fillRect(1.14, -2.2, 0.16, 2.2);
        g.fillStyle = '#120c2c'; g.fillRect(-1.7, -4.0, 3.4, 1.9);
        g.strokeStyle = col; g.globalAlpha = 0.28; g.lineWidth = 0.34; g.strokeRect(-1.7, -4.0, 3.4, 1.9);
        g.globalAlpha = 1; g.lineWidth = 0.1; g.strokeRect(-1.7, -4.0, 3.4, 1.9);
        g.lineWidth = 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
        for (let q = 0; q < 3; q++) { g.globalAlpha = ((time * 2.5 - q * 0.33) % 1 + 1) % 1 < 0.5 ? 1 : 0.3; g.beginPath(); g.moveTo(-1.0 + q * 0.8, -3.6); g.lineTo(-0.45 + q * 0.8, -3.05); g.lineTo(-1.0 + q * 0.8, -2.5); g.stroke(); }
        g.globalAlpha = 1;
      } else {
        for (let q = 0; q < 3; q++) {
          const cx = -0.9 + q * 0.9;
          g.fillStyle = '#ff7a1f'; g.beginPath(); g.moveTo(cx - 0.28, 0); g.lineTo(cx, -0.95); g.lineTo(cx + 0.28, 0); g.closePath(); g.fill();
          g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - 0.17, -0.38); g.lineTo(cx - 0.11, -0.58); g.lineTo(cx + 0.11, -0.58); g.lineTo(cx + 0.17, -0.38); g.closePath(); g.fill();
        }
      }
    } else {
      if (k < 0.8) {
        const s = k < 0.55 ? 1 : 0.62;
        g.scale(s, s);
        g.fillStyle = '#5b4032'; g.fillRect(-0.15, -0.8, 0.3, 0.8);
        for (let q = 0; q < 3; q++) {
          const w = 1.3 - q * 0.3, y0 = -0.5 - q * 1.0;
          g.fillStyle = '#17503d'; g.beginPath(); g.moveTo(-w, y0); g.lineTo(0, y0 - 1.65); g.lineTo(w, y0); g.closePath(); g.fill();
          g.fillStyle = '#2a7358'; g.beginPath(); g.moveTo(-w, y0); g.lineTo(0, y0 - 1.65); g.lineTo(-w * 0.15, y0); g.closePath(); g.fill();
          g.fillStyle = '#f4fbff'; g.beginPath(); g.moveTo(-w * 0.5, y0 - 0.83); g.lineTo(0, y0 - 1.65); g.lineTo(w * 0.5, y0 - 0.83); g.lineTo(w * 0.2, y0 - 1.0); g.lineTo(0, y0 - 0.85); g.lineTo(-w * 0.25, y0 - 1.02); g.closePath(); g.fill();
        }
      } else {
        g.fillStyle = '#ffffff'; g.strokeStyle = '#b9d3e6'; g.lineWidth = 0.05;
        for (const b of [[0, -0.55, 0.6], [0, -1.4, 0.45], [0, -2.05, 0.32]]) { g.beginPath(); g.arc(b[0], b[1], b[2], 0, 6.2832); g.fill(); g.stroke(); }
        g.fillStyle = '#ff8a2a'; g.beginPath(); g.moveTo(0.1, -2.1); g.lineTo(0.62, -2.0); g.lineTo(0.1, -1.95); g.closePath(); g.fill();
        g.fillStyle = '#1b2230'; g.fillRect(-0.36, -2.42, 0.72, 0.09); g.fillRect(-0.24, -2.85, 0.48, 0.45);
        g.beginPath(); g.arc(0.08, -2.14, 0.035, 0, 6.2832); g.arc(-0.1, -2.14, 0.035, 0, 6.2832); g.fill();
        g.fillStyle = '#e8382f'; g.fillRect(-0.34, -1.82, 0.68, 0.12);
      }
    }
    g.restore();
  }

  // rijstrook: bovenvlak met stootranden en middenstreep, plus de zijwand aan de voorkant
  function drawStrips(list, th, back) {
    g.lineJoin = 'round'; g.lineCap = 'butt';
    for (const s of list) {
      if (back) {
        g.fillStyle = th.trackDeep; g.fill(s.band);
        g.strokeStyle = th.trackDark; g.lineWidth = 0.1; g.stroke(s.band);
        continue;
      }
      if (th.glow) { g.strokeStyle = th.track; g.globalAlpha = 0.18; g.lineWidth = 1.4; g.stroke(s.near); g.globalAlpha = 1; }
      g.fillStyle = th.track; g.fill(s.band);
      g.fillStyle = 'rgba(255,255,255,.09)'; g.fill(s.sheen);
      g.strokeStyle = th.edge; g.lineWidth = 0.16; g.stroke(s.kn); g.stroke(s.kf);
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 0.1; g.setLineDash([1.1, 1.3]); g.stroke(s.mid); g.setLineDash([]);
      g.fillStyle = th.trackDark; g.fill(s.wall);
      g.strokeStyle = th.trackDeep; g.lineWidth = 0.05; g.stroke(s.wall);
    }
  }

  function board(x, y, w, h, c1, c2, txt, txtCol) {
    g.fillStyle = '#12141b'; g.fillRect(x - w / 2 - 0.12, y - 0.12, w + 0.24, h + 0.24);
    g.fillStyle = c1; g.fillRect(x - w / 2, y, w, h);
    const sq = h * 0.2, nq = Math.round(w / sq);
    for (let q = 0; q < nq; q++) {
      g.fillStyle = q % 2 ? c2 : '#ffffff'; g.fillRect(x - w / 2 + q * w / nq, y, w / nq + 0.01, sq);
      g.fillStyle = q % 2 ? '#ffffff' : c2; g.fillRect(x - w / 2 + q * w / nq, y + h - sq, w / nq + 0.01, sq);
    }
    g.save(); g.translate(x, y + h * 0.53); g.scale(0.02, 0.02);
    g.fillStyle = txtCol; g.font = 'italic 900 ' + Math.round(h * 0.46 * 50) + 'px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 0, 0); g.restore();
  }
  // poort naast de baan: palen aan de achterrand, bord erboven
  function gate(m, w, h, hi, c1, c2, txt, txtCol, front) {
    const z = m.z + TW + 0.5, x = m.x + DX * z, y = m.y + DY * z;
    if (!front) { g.fillStyle = '#c9ced8'; g.fillRect(x - w / 2 + 0.1, y - hi, 0.22, hi); g.fillRect(x + w / 2 - 0.32, y - hi, 0.22, hi); }
    else board(x, y - hi - h + 0.2, w, h, c1, c2, txt, txtCol);
  }
  // iets plat op het wegdek tekenen: x = langs de baan, y = de diepte in
  function onSurface(m, z, fn) {
    g.save(); g.transform(m.tx, m.ty, DX, DY, m.x + DX * z, m.y + DY * z); fn(); g.restore();
  }

  // cars = [{vis, design, alpha}], al gesorteerd met de eigen auto als laatste
  function drawWorld(T, R, th, time, cars) {
    // steunen van loopings, aan de achterkant
    g.lineCap = 'round';
    for (const l of T.loops) {
      const gy = T.Y[l.i0], hw = l.R * 0.86, z = ZL + TW + 0.5, ox = DX * z, oy = DY * z;
      g.strokeStyle = th.pillar; g.lineWidth = 0.46;
      g.beginPath(); g.moveTo(l.cx - hw - 0.8 + ox, gy + oy); g.lineTo(l.cx - hw - 0.8 + ox, l.cy + oy); g.moveTo(l.cx + hw + 0.8 + ox, gy + oy); g.lineTo(l.cx + hw + 0.8 + ox, l.cy + oy); g.stroke();
      g.lineWidth = 0.16; g.beginPath();
      for (let q = 0; q < 3; q++) {
        const y0 = gy - (l.R * q) / 3 + oy, y1 = gy - (l.R * (q + 1)) / 3 + oy;
        g.moveTo(l.cx - hw - 0.8 + ox, y0); g.lineTo(l.cx - hw + 1.2 + ox, y1); g.moveTo(l.cx + hw + 0.8 + ox, y0); g.lineTo(l.cx + hw - 1.2 + ox, y1);
      }
      g.stroke();
    }
    // bovenkant van het landschap
    g.fillStyle = th.top; g.fill(R.top);
    g.save(); g.clip(R.top); g.lineJoin = 'round';
    g.strokeStyle = th.topLine; g.lineWidth = 0.09;
    for (const z of [3.9, 5.6, 7.3]) { g.save(); g.translate(DX * z, DY * z); g.stroke(R.line); g.restore(); }
    g.restore();
    // ravijnen: donker gat met een gloed op de bodem
    for (const gp of R.gaps) {
      const gr = g.createLinearGradient(0, gp.y0, 0, gp.y1);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.78)'); gr.addColorStop(0.8, th.pit); gr.addColorStop(1, th.pit);
      g.fillStyle = gr; g.fill(gp.path);
    }
    for (const p of R.props) drawProp(th.prop, p, time);
    gate(R.fin, 6.2, 1.5, 5.8, 0, 0, '', '', false); gate(R.start, 4.8, 1.1, 5.0, 0, 0, '', '', false);
    drawStrips(R.runs, th, false);
    // boostvlakken en pijlen plat op de baan
    for (const p of R.pads) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      g.fillStyle = 'rgba(255,225,74,' + (0.5 + 0.25 * pulse).toFixed(2) + ')'; g.fill(p.band);
      for (let k = 0; k < p.ch.length; k++) {
        const c = p.ch[k], ph = (time * 3 - k * 0.45) % 3;
        g.save(); g.transform(c.tx, c.ty, DX, DY, c.x, c.y);
        g.strokeStyle = ph < 1 ? '#ffffff' : '#ff5a1f'; g.lineWidth = 0.28; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(-0.45, -1.0); g.lineTo(0.35, 0); g.lineTo(-0.45, 1.0); g.stroke();
        g.restore();
      }
    }
    // geblokte streep bij start en finish
    for (const m of [R.fin, R.start]) {
      onSurface(m, m.z, () => {
        for (let r = 0; r < 2; r++) for (let q = 0; q < 6; q++) { g.fillStyle = (r + q) % 2 ? '#15171c' : '#ffffff'; g.fillRect(-0.5 + r * 0.5, q * TW / 6, 0.5, TW / 6); }
      });
    }
    const floors = R.quarters.filter(q => !q.ceil), ceils = R.quarters.filter(q => q.ceil);
    for (const far of [true, false]) {
      drawStrips(floors.filter(q => q.far === far), th, false);
      for (const c of cars) {
        if (!!c.vis.far !== far) continue;
        const v = c.vis;
        if (v.sh) onSurface(v.sh, v.sh.z + TW / 2, () => { g.fillStyle = 'rgba(0,0,0,' + v.sh.a.toFixed(2) + ')'; g.beginPath(); g.ellipse(0, 0, 2.0, 1.05, 0, 0, 6.2832); g.fill(); });
        drawCar(g, v, c.design, c.alpha);
      }
      drawStrips(ceils.filter(q => q.far === far), th, true);
    }
    // doorsnede aan de voorkant
    const gg = g.createLinearGradient(0, T.minY, 0, T.maxY + 34);
    gg.addColorStop(0, th.ground[0]); gg.addColorStop(1, th.ground[1]);
    g.fillStyle = gg; g.fill(R.front);
    const pat = terrainPattern(T.theme);
    if (pat) { g.fillStyle = pat; g.fill(R.front); }
    g.save(); g.clip(R.front); g.lineJoin = 'round'; g.translate(DX * Z_NEAR, DY * Z_NEAR);
    g.strokeStyle = th.grassHi; g.lineWidth = 0.5; g.stroke(R.line);
    g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 0.45;
    for (const d of [1.3, 2.4, 3.2, 4.4, 6.0]) { g.translate(0, d); g.stroke(R.line); }
    g.restore();
    gate(R.fin, 6.2, 1.5, 5.8, '#15171c', '#15171c', 'FINISH', '#ffd23f', true);
    gate(R.start, 4.8, 1.1, 5.0, '#0e3d1c', '#39d353', 'START', '#ffffff', true);
  }

  // ---------------------------------------------------------------- deeltjes
  const parts = [];
  // soort: 0 = stof/rook, 1 = vonk, 2 = snipper/brokstuk, 3 = vuur, 4 = los wiel, 5 = schokgolf
  let PZ = 0;   // diepte waarop de volgende deeltjes ontstaan
  function puff(x, y, vx, vy, life, size, rgb, grow, kind, img) {
    if (parts.length > 380) parts.shift();
    if (!use3d()) { x += DX * PZ; y += DY * PZ; }
    parts.push({ z: PZ, x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: size, rgb: rgb, grow: grow || 0, kind: kind || 0, img: img });
  }
  const GRAV = [2, 14, 14, -3, 22, 0];
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV[p.kind] * dt; p.size += p.grow * dt;
      if (p.kind === 2 || p.kind === 3) { p.vx *= 1 - dt * 1.5; if (p.kind === 3) p.vy *= 1 - dt * 1.5; }
    }
  }
  function drawParts() {
    for (const p of parts) {
      const a = p.life / p.max;
      if (p.kind === 1) {
        g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(' + p.rgb + ',' + a.toFixed(2) + ')'; g.lineWidth = p.size; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke(); g.globalCompositeOperation = 'source-over';
      } else if (p.kind === 2) {
        g.save(); g.translate(p.x, p.y); g.rotate(p.life * 9 + p.size * 40); g.fillStyle = 'rgba(' + p.rgb + ',' + Math.min(1, a * 2).toFixed(2) + ')';
        g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size * Math.abs(Math.cos(p.life * 7)) + 0.02); g.restore();
      } else if (p.kind === 3) {
        g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gr.addColorStop(0, 'rgba(255,255,220,' + a.toFixed(2) + ')'); gr.addColorStop(0.4, 'rgba(' + p.rgb + ',' + (0.8 * a).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(' + p.rgb + ',0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.2832); g.fill(); g.globalCompositeOperation = 'source-over';
      } else if (p.kind === 4) {
        g.save(); g.translate(p.x, p.y); g.rotate(p.life * 14); g.globalAlpha = Math.min(1, a * 3); g.drawImage(p.img, -p.size, -p.size, p.size * 2, p.size * 2); g.restore();
      } else if (p.kind === 5) {
        g.strokeStyle = 'rgba(' + p.rgb + ',' + (0.7 * a).toFixed(2) + ')'; g.lineWidth = 0.25 * a + 0.05; g.beginPath(); g.ellipse(p.x, p.y, p.size, p.size * 0.5, 0, 0, 6.2832); g.stroke();
      } else {
        g.fillStyle = 'rgba(' + p.rgb + ',' + (0.55 * a).toFixed(2) + ')'; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.2832); g.fill();
        g.fillStyle = 'rgba(255,255,255,' + (0.18 * a).toFixed(2) + ')'; g.beginPath(); g.arc(p.x - p.size * 0.25, p.y - p.size * 0.25, p.size * 0.55, 0, 6.2832); g.fill();
      }
    }
  }
  function boom(x, y, design) {
    const rnd = () => Math.random() - 0.5;
    puff(x, y + 0.3, 0, 0, 0.5, 0.6, '255,230,170', 22, 5);
    for (let i = 0; i < 22; i++) puff(x + rnd() * 2.2, y + rnd() * 1.3, rnd() * 11, -Math.random() * 8, 0.5 + Math.random() * 0.5, 1.0 + Math.random() * 1.5, i % 3 ? '255,130,30' : '255,70,20', 2.8, 3);
    for (let i = 0; i < 10; i++) puff(x + rnd() * 2.4, y + rnd(), rnd() * 5, -1.5 - Math.random() * 4, 1.2 + Math.random() * 0.9, 0.25 + Math.random() * 0.3, '46,46,54', 1.9, 0);
    for (let i = 0; i < 20; i++) puff(x + rnd(), y, rnd() * 34, -4 - Math.random() * 20, 0.4 + Math.random() * 0.5, 0.08, '255,220,140', 0, 1);
    const col = CARS[design % CARS.length].color, rgb = [1, 3, 5].map(k => parseInt(col.slice(k, k + 2), 16)).join(',');
    for (let i = 0; i < 12; i++) puff(x + rnd() * 2, y + rnd(), rnd() * 22, -5 - Math.random() * 14, 1.0 + Math.random() * 0.8, 0.12 + Math.random() * 0.14, i % 2 ? rgb : '30,32,40', 0, 2);
    for (let i = 0; i < 2; i++) puff(x + (i ? 1.1 : -1.1), y + 0.4, (i ? 1 : -1) * (5 + Math.random() * 7), -9 - Math.random() * 6, 1.6, WHEEL_R[design % CARS.length], '', 0, 4, wheelSprite(design % CARS.length, false));
  }

  // ---------------------------------------------------------------- geluid
  const Snd = {
    ac: null, muted: false, eng: null,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ac = new AC(); this.ac = ac;
        // alles via een zachte hoofdregelaar en een begrenzer: geen harde pieken
        const comp = ac.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 4;
        const master = ac.createGain(); master.gain.value = 0.5; master.connect(comp); comp.connect(ac.destination); this.out = master;
        // motor: twee licht ontstemde lage zaagtanden plus een sinus eronder, sterk gedempt, met een trage brom (cilinders)
        const o = ac.createOscillator(); o.type = 'sawtooth';
        const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 9;
        const sub = ac.createOscillator(); sub.type = 'sine';
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 0.6;
        const gn = ac.createGain(); gn.gain.value = 0;
        const am = ac.createGain(); am.gain.value = 0.75;
        const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 18;
        const lfoG = ac.createGain(); lfoG.gain.value = 0.25; lfo.connect(lfoG); lfoG.connect(am.gain);
        const sg = ac.createGain(); sg.gain.value = 0.8;
        o.connect(f); o2.connect(f); sub.connect(sg); sg.connect(gn); f.connect(gn); gn.connect(am); am.connect(master);
        o.start(); o2.start(); sub.start(); lfo.start();
        this.eng = { o: o, o2: o2, sub: sub, f: f, gn: gn, lfo: lfo };
      } catch (e) { this.ac = null; }
    },
    engine(speed, gas, on) {
      if (!this.eng) return;
      const t = this.ac.currentTime, fr = 34 + speed * 1.7 + (gas ? 7 : 0), e = this.eng;
      e.o.frequency.setTargetAtTime(fr, t, 0.12); e.o2.frequency.setTargetAtTime(fr, t, 0.12); e.sub.frequency.setTargetAtTime(fr * 0.5, t, 0.12);
      e.lfo.frequency.setTargetAtTime(fr * 0.5, t, 0.12);
      e.f.frequency.setTargetAtTime(170 + speed * 9 + (gas ? 90 : 0), t, 0.15);
      e.gn.gain.setTargetAtTime(on && !this.muted ? (gas ? 0.05 : 0.032) : 0, t, 0.2);
    },
    tone(f, d, type, vol, slide) {
      if (!this.ac || this.muted) return;
      // zachte klanken: geen blokgolf of zaagtand meer, kort inzetten, lager volume
      const ac = this.ac, t = ac.currentTime, o = ac.createOscillator(), gn = ac.createGain();
      o.type = type === 'square' ? 'triangle' : type === 'sawtooth' ? 'sine' : (type || 'sine'); o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
      const v = (vol || 0.1) * 0.55;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(v, t + 0.012); gn.gain.exponentialRampToValueAtTime(0.0006, t + d);
      o.connect(gn); gn.connect(this.out); o.start(t); o.stop(t + d + 0.02);
    },
    noise(d, vol, fc) {
      if (!this.ac || this.muted) return;
      const ac = this.ac, t = ac.currentTime, len = Math.floor(ac.sampleRate * d);
      const buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = ac.createBufferSource(); s.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc || 800;
      const gn = ac.createGain(); gn.gain.value = (vol || 0.2) * 0.5;
      s.connect(f); f.connect(gn); gn.connect(this.out); s.start(t);
    }
  };

  // ---------------------------------------------------------------- 3D of 2D
  // Met WebGL tekent view3d.js de wereld in echt 3D; anders valt het spel terug op de 2D-tekencode hierboven.
  // met ?2d achter het adres dwing je de 2D-weergave af (voor trage toestellen)
  const V3 = !/[?&]2d\b/.test(location.search) && window.View3D && !window.View3D.failed ? window.View3D : null;
  if (V3) V3.init(glc, { E: E, CARS: CARS, WHEEL_R: WHEEL_R, WHEEL_Y: WHEEL_Y, bodySprite: bodySprite, wheelSprite: wheelSprite, laneDepth: laneDepth, SW: SW, SH: SH, SOX: SOX, SOY: SOY });
  function use3d() { return !!(V3 && V3.ok); }
  if (use3d()) V3.resize(W, H, DPR); else { glc.hidden = true; fxc.hidden = true; }
  const depthFor = r => use3d() ? V3.depthOf(r.vis.s, r.lane | 0) : r.vis.z + 1.5;

  // ---------------------------------------------------------------- toestand
  const TRACKS = E.TRACKS.map(d => { const T = E.buildTrack(d); T.R = prepTrack(T); return T; });
  const S = {
    mode: 'menu', trackIdx: 0, T: TRACKS[0], racers: [], me: null, cd: 0, time: 0,
    input: { gas: false, brake: false }, cam: { x: 0, y: 0, z: 30 }, shake: 0,
    resultsOpen: false, demo: null, demoIdx: 0, botIn: { gas: false, brake: false },
    stats: null, earned: null, decided: false, firstFin: 0, viewCar: 0,
    game: { mode: 'solo', diff: 1 }, lobbyGame: { mode: 'race', diff: 1 }, lobbyProg: {}, coop: null, starsNow: 0, lowWarned: false, botWanted: false
  };
  const Net = { peer: null, host: false, online: false, conns: new Map(), hc: null, myId: 'me', roster: [], code: '', joinTimer: 0, tally: null, qrFor: '' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sbd-' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sbd-' + k, v); } catch (e) { /* privemodus */ } }
  };
  // profiel: naam, punten en gewonnen auto's (alleen op dit toestel bewaard)
  const Profile = {
    name: store.get('name', ''), pts: Math.max(0, parseInt(store.get('pts', '0'), 10) || 0), owned: new Set([0]), car: 0,
    stars: {}, coop: {}, diff: 1, theme: 'desert',
    load() {
      try { for (const d of JSON.parse(store.get('owned', '[0]'))) if (d >= 0 && d < CARS.length) this.owned.add(d | 0); } catch (e) { /* kapotte opslag: alleen de startauto */ }
      const c = parseInt(store.get('car', '0'), 10) || 0; this.car = this.owned.has(c) ? c : 0;
      const obj = k => { try { const o = JSON.parse(store.get(k, '{}')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
      this.stars = obj('stars'); this.coop = obj('coop');
      const dv = parseInt(store.get('diff', '1'), 10); this.diff = isNaN(dv) ? 1 : clamp(dv, 0, 2);
      const th = store.get('theme', 'desert'); this.theme = E.THEMES.some(t => t.id === th) ? th : 'desert';
    },
    save() {
      store.set('name', this.name); store.set('pts', String(this.pts)); store.set('owned', JSON.stringify([...this.owned])); store.set('car', String(this.car));
      store.set('stars', JSON.stringify(this.stars)); store.set('coop', JSON.stringify(this.coop)); store.set('diff', String(this.diff)); store.set('theme', this.theme);
    }
  };
  Profile.load(); S.viewCar = Profile.car;
  const newTally = () => ({ wins: {}, races: 0, since: Date.now() });
  const authority = () => Net.host || !Net.online;
  S.lobbyGame.diff = Profile.diff;

  // ---------------------------------------------------------------- levels
  // moeilijkheid: benzineverbruik en snelheid van de robot
  const DIFFS = [
    { icon: '🐢', name: 'Rustig', tip: 'Veel benzine, trage robot', fuel: 0.6, bot: 0.84 },
    { icon: '🐇', name: 'Normaal', tip: 'Pak de jerrycans!', fuel: 0.9, bot: 0.93 },
    { icon: '🚀', name: 'Snel', tip: 'Weinig benzine, snelle robot', fuel: 1.1, bot: 1.0 }
  ];
  const LV = TRACKS.map(T => T.def);
  const levelsOf = th => LV.map((d, i) => i).filter(i => LV[i].theme === th).sort((a, b) => LV[a].no - LV[b].no);
  const findLevel = (th, no) => LV.findIndex(d => d.theme === th && d.no === no);
  function isOpen(i, prog) { const d = LV[i]; if (d.no === 1) return true; const j = findLevel(d.theme, d.no - 1); return j >= 0 && (prog[LV[j].id] || 0) > 0; }
  function lastOpen(th, prog) { let best = findLevel(th, 1); for (const i of levelsOf(th)) if (isOpen(i, prog)) best = i; return best; }
  // na het laatste level van een wereld komt level 1 van de volgende wereld
  function nextLevel(i) {
    const d = LV[i], j = findLevel(d.theme, d.no + 1); if (j >= 0) return j;
    const t = E.THEMES.findIndex(q => q.id === d.theme), nt = E.THEMES[t + 1];
    return nt ? findLevel(nt.id, 1) : -1;
  }
  const starStr = (n, max) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
  // sterren als losse tekens: behaalde goud, de rest grijs
  function fillStars(box, n, max) { box.textContent = ''; for (let k = 0; k < max; k++) box.appendChild(el('i', k < n ? 'on' : '', '★')); }
  // plaatje van een level: het hoogteprofiel met loopings als rondjes en ravijnen als gaten
  const thumbCache = [];
  function thumb(i) {
    if (thumbCache[i]) return thumbCache[i];
    const T = TRACKS[i], th = THEMES[T.theme], w = 200, h = 96, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const sg = x.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, th.sky[0]); sg.addColorStop(0.6, th.sky[1]); sg.addColorStop(1, th.sky[2]);
    x.fillStyle = sg; x.fillRect(0, 0, w, h);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 1; k < T.n - 1; k++) {
      if (T.S[k] < T.startS - 12 || T.S[k] > T.finishS + 8 || (T.FL[k] & (E.F_PIT | E.F_INLOOP))) continue;
      x0 = Math.min(x0, T.X[k]); x1 = Math.max(x1, T.X[k]); y0 = Math.min(y0, T.Y[k]); y1 = Math.max(y1, T.Y[k]);
    }
    const sx = (w - 16) / (x1 - x0), sy = Math.min(2.2, (h - 44) / Math.max(8, y1 - y0));
    const X = v => 8 + (v - x0) * sx, Y = v => h - 14 - (y1 - v) * sy;
    x.fillStyle = th.ground[0]; x.strokeStyle = th.track; x.lineWidth = 3.5; x.lineJoin = 'round';
    let path = [];
    const flush = () => {
      if (path.length < 2) { path = []; return; }
      x.beginPath(); x.moveTo(path[0][0], h); for (const q of path) x.lineTo(q[0], q[1]); x.lineTo(path[path.length - 1][0], h); x.closePath(); x.fill();
      x.beginPath(); path.forEach((q, k) => k ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.stroke(); path = [];
    };
    for (let k = 1; k < T.n - 1; k++) {
      if (T.S[k] < T.startS - 12 || T.S[k] > T.finishS + 8) continue;
      if (T.FL[k] & (E.F_PIT | E.F_INLOOP)) { if (T.FL[k] & E.F_PIT) flush(); continue; }
      path.push([X(T.X[k]), Y(T.Y[k])]);
    }
    flush();
    x.strokeStyle = th.track; x.lineWidth = 3;
    for (const l of T.loops) { x.beginPath(); x.arc(X(l.cx), Y(l.cy + l.R) - 7, 7, 0, 6.2832); x.stroke(); }
    x.fillStyle = '#8d8f99';
    for (const r of T.rocks) { const p = E.pointAt(T, r.s, {}); x.beginPath(); x.arc(X(p.x), Y(p.y) - 5, 4.5, 0, 6.2832); x.fill(); }
    const pf = E.pointAt(T, T.finishS, {}); x.font = '16px sans-serif'; x.textAlign = 'center'; x.fillText('🏁', X(pf.x), Y(pf.y) - 6);
    return (thumbCache[i] = c.toDataURL());
  }
  function tile(ico, title, sub, cls) {
    const b = el('button', 'tile' + (cls ? ' ' + cls : ''));
    b.appendChild(el('span', 'ico', ico)); b.appendChild(el('b', '', title)); if (sub) b.appendChild(el('small', '', sub));
    return b;
  }
  // wereld, level en moeilijkheid kiezen. o = {prog, maxStars, theme, sel, canEdit, diff, onTheme, onPick, onDiff}
  function levelPicker(box, o) {
    box.innerHTML = '';
    box.appendChild(el('div', 'sect', '🌍 Kies een wereld'));
    const tr = el('div', 'tiles three themes');
    for (const t of E.THEMES) {
      const got = levelsOf(t.id).reduce((a, i) => a + Math.min(o.maxStars, o.prog[LV[i].id] || 0), 0);
      const b = tile(t.icon, t.name, '★ ' + got + '/' + levelsOf(t.id).length * o.maxStars, t.id === o.theme ? 'sel' : '');
      b.disabled = !o.canEdit && t.id !== o.theme; b.onclick = () => { Snd.init(); Snd.tone(520, 0.08, 'sine', 0.06); o.onTheme(t.id); };
      tr.appendChild(b);
    }
    box.appendChild(tr);
    box.appendChild(el('div', 'sect', '🏁 Kies een level'));
    const lv = el('div', 'lvls');
    for (const i of levelsOf(o.theme)) {
      const d = LV[i], open = isOpen(i, o.prog), st = o.prog[d.id] || 0;
      const b = el('button', 'lvl' + (open ? '' : ' locked') + (i === o.sel ? ' sel' : ''));
      const im = new Image(); im.src = thumb(i); im.alt = ''; b.appendChild(im);
      b.appendChild(el('span', 'no', String(d.no)));
      b.appendChild(el('span', 'nm', d.name));
      const sb = el('span', 'st'); if (open) fillStars(sb, Math.min(st, o.maxStars), o.maxStars); b.appendChild(sb);
      if (!open) b.appendChild(el('span', 'lock', '🔒'));
      b.title = 'Level ' + d.no + ': ' + d.name + ' (' + d.level + ')' + (open ? '' : ' - haal eerst het level ervoor');
      b.disabled = !open || (!o.canEdit && i !== o.sel);
      b.onclick = () => { if (o.canEdit && open) o.onPick(i); };
      lv.appendChild(b);
    }
    box.appendChild(lv);
    box.appendChild(el('div', 'sect', '🎚️ Hoe moeilijk?'));
    const dr = el('div', 'tiles three diffs');
    DIFFS.forEach((df, k) => {
      const b = tile(df.icon, df.name, df.tip, k === o.diff ? 'sel' : '');
      b.disabled = !o.canEdit && k !== o.diff; b.onclick = () => { Snd.init(); Snd.tone(440 + k * 120, 0.08, 'sine', 0.06); o.onDiff(k); };
      dr.appendChild(b);
    });
    box.appendChild(dr);
  }

  function newVis() { return { x: 0, y: 0, a: 0, spin0: 0, spin1: 0, sus0: 0, sus1: 0, boost: false, s: 0, sp: 0, z: 0, far: false, sh: null, dead: false, init: false }; }
  // diepte van de rijstrook en de schaduw op het wegdek onder de auto
  function placeVis(v, T) {
    const p = E.pointAt(T, v.s, {}), Z = T.R.Z, i = p.seg;
    v.z = Z[i] + (Z[i + 1] - Z[i]) * (T.LEN[i] > 0 ? p.u / T.LEN[i] : 0); v.far = v.z > ZL / 2;
    if ((T.FL[i] & (E.F_LOOP | E.F_CLIFF | E.F_PIT)) && p.tx < 0.5) { v.sh = null; return; }
    const h = Math.hypot(v.x - p.x, v.y - p.y);
    if (h > 14) { v.sh = null; return; }
    p.z = v.z; p.a = clamp(0.34 - (h - 0.9) * 0.03, 0.05, 0.34); v.sh = p;
  }
  function visFromCar(v, car, T) {
    v.x = car.x; v.y = car.y; v.a = car.a; v.spin0 = car.cps[0].spin; v.spin1 = car.cps[1].spin;
    v.sus0 = car.cps[0].pen; v.sus1 = car.cps[1].pen; v.boost = car.boostT > 0; v.s = car.s; v.sp = Math.hypot(car.vx, car.vy);
    v.dead = car.dead > 0; v.init = true; placeVis(v, T);
  }

  function startDemo(idx) {
    S.demoIdx = idx === undefined ? (S.demoIdx + 1) % TRACKS.length : idx;
    S.T = TRACKS[S.demoIdx];
    const design = Math.floor(Math.random() * CARS.length), car = E.newCar(S.T, design); car.vmaxK = 0.9; car.fuelRate = 0;
    S.demo = { car: car, vis: newVis(), design: design, kind: 'demo', lane: 0 };
    parts.length = 0;
  }

  function startRace(trackIdx, roster, game) {
    S.trackIdx = trackIdx; S.T = TRACKS[trackIdx];
    S.game = { mode: game && ['solo', 'race', 'coop'].includes(game.mode) ? game.mode : 'race', diff: clamp((game && game.diff) | 0, 0, 2) };
    const df = DIFFS[S.game.diff];
    S.racers = roster.map(p => {
      const local = p.id === Net.myId, bot = p.id === 'bot' && authority();
      const design = clamp(p.car | 0, 0, CARS.length - 1);
      const r = { id: p.id, name: p.name, design: design, kind: local ? 'me' : bot ? 'bot' : 'remote', car: null, vis: newVis(), snap: null, snapT: 0, time: 0, gone: false, outNet: false };
      const c = E.newCar(S.T, design);
      if (local || bot) { r.car = c; c.fuelRate = df.fuel; if (bot) c.vmaxK = df.bot; }
      visFromCar(r.vis, c, S.T);
      return r;
    });
    S.me = S.racers.find(r => r.kind === 'me');
    // ieder zijn eigen baan: jouw auto rijdt op de voorste
    let lane = 1; for (const r of S.racers) r.lane = r === S.me ? 0 : lane++;
    S.mode = 'countdown'; S.cd = 3.4; S.resultsOpen = false; S.lastCd = 4;
    S.stats = { flips: 0, air: 0, pads: 0, crashes: 0, cans: 0 }; S.earned = null; S.decided = false; S.firstFin = 0;
    S.coop = null; S.starsNow = 0; S.lowWarned = false;
    S.input.gas = S.input.brake = false; parts.length = 0;
    $('prog').innerHTML = '';
    for (const r of S.racers) { const i = document.createElement('i'); i.style.background = CARS[r.design].color; if (r.kind === 'me') i.className = 'me'; $('prog').appendChild(i); r.dot = i; }
    show('hud');
    if (S.me) { S.cam.x = S.me.car.x; S.cam.y = S.me.car.y; }
  }

  function ranking() {
    return S.racers.slice().sort((a, b) => {
      if (a.time && b.time) return a.time - b.time;
      if (a.time) return -1; if (b.time) return 1;
      return b.vis.s - a.vis.s;
    });
  }

  let toastT = 0;
  function toast(txt) { const t = $('toast'); t.textContent = txt; t.classList.add('on'); toastT = 1.1; }

  function awardPoints(r) {
    const st = S.stats, gm = S.game, items = [['Gefinisht', 30]];
    if (gm.mode !== 'coop') {
      const place = 1 + S.racers.filter(q => q !== r && !q.gone && q.time && q.time < r.time).length;
      items.push([place + 'e plaats', [60, 30, 15, 5][place - 1] || 0]);
    }
    if (st.flips) items.push([st.flips + (st.flips === 1 ? ' salto' : " salto's"), st.flips * 10]);
    if (st.air) items.push([st.air + (st.air === 1 ? ' grote sprong' : ' grote sprongen'), st.air * 5]);
    if (st.cans) items.push([st.cans + 'x benzine', st.cans * 3]);
    if (!st.crashes) items.push(['Zonder crash', 20]);
    if (gm.mode === 'solo') {
      // 1 ster = gehaald, 2 = sneller dan de robot, 3 = sneller dan de robot en zonder crash
      const bot = S.racers.find(q => q.kind === 'bot'), beat = !bot || !bot.time || r.time < bot.time;
      const stars = 1 + (beat ? 1 : 0) + (beat && !st.crashes ? 1 : 0), id = LV[S.trackIdx].id, prev = Profile.stars[id] || 0;
      S.starsNow = stars;
      if (!prev) items.push(['Nieuw level', 25]);
      if (stars > prev) Profile.stars[id] = stars;
    }
    const total = items.reduce((a, b) => a + b[1], 0);
    S.earned = { items: items, total: total };
    Profile.pts += total; Profile.save();
  }

  function handleEvents(r, isCam) {
    const car = r.car, th = THEMES[S.T.theme], mine = r.kind === 'me';
    PZ = depthFor(r);
    for (const e of car.ev) {
      if (e[0] === 'land') {
        const n = Math.min(10, 3 + Math.floor(e[1] * 0.5));
        for (let i = 0; i < n; i++) puff(car.x + (Math.random() - 0.5) * 2.4, car.y + 0.8, (Math.random() - 0.5) * 6 - car.vx * 0.05, -Math.random() * 3, 0.5 + Math.random() * 0.4, 0.18 + Math.random() * 0.2, th.dust, 0.8);
        if (e[1] > 11) for (let i = 0; i < 9; i++) puff(car.x + (Math.random() - 0.5) * 2.6, car.y + 0.85, car.vx * 0.5 + (Math.random() - 0.5) * 16, -3 - Math.random() * 9, 0.3 + Math.random() * 0.3, 0.07, '255,210,120', 0, 1);
        if (mine && e[2] >= 1.2) S.stats.air++;
        if (isCam) { S.shake = Math.min(0.5, e[1] * 0.02); if (e[1] > 5) Snd.noise(0.18, Math.min(0.3, e[1] * 0.015), 420); }
      } else if (e[0] === 'boost') { if (mine) { S.stats.pads++; toast('BOOST!'); Snd.tone(220, 0.45, 'sawtooth', 0.09, 880); } }
      else if (e[0] === 'flip') { if (mine) { S.stats.flips += e[1]; toast(e[1] > 1 ? e[1] + 'x SALTO! +BOOST' : 'SALTO! +BOOST'); Snd.tone(520, 0.12, 'square', 0.08); Snd.tone(780, 0.2, 'square', 0.08); } }
      else if (e[0] === 'explode') {
        boom(car.x, car.y, r.design);
        if (mine) { S.stats.crashes++; toast(e[1] === 'pit' ? 'IN HET RAVIJN!' : 'BOEM!'); }
        if (isCam) { S.shake = 0.8; Snd.noise(0.6, 0.4, 260); Snd.tone(90, 0.5, 'sawtooth', 0.14, 30); }
      }
      else if (e[0] === 'respawn') { if (mine) Snd.tone(300, 0.25, 'triangle', 0.1, 520); }
      else if (e[0] === 'fuel') { if (mine) { S.stats.cans++; toast('⛽ +BENZINE'); Snd.tone(660, 0.09, 'sine', 0.08); setTimeout(() => Snd.tone(990, 0.14, 'sine', 0.08), 70); } }
      else if (e[0] === 'rockhit') { if (isCam) { S.shake = Math.min(0.45, e[1] * 0.03); Snd.noise(0.2, 0.22, 300); } }
      else if (e[0] === 'rockoff') {
        if (mine) { toast('WEG ERMEE! 🪨'); Snd.noise(0.45, 0.18, 220); }
        const R = car.rocks.find(q => q.off && q.offT < 0.05), p = R ? E.pointAt(S.T, R.s, {}) : null;
        if (p) for (let i = 0; i < 10; i++) puff(p.x + (Math.random() - 0.5) * 2, p.y - 0.3, (Math.random() - 0.5) * 5, -Math.random() * 3, 0.6 + Math.random() * 0.4, 0.25 + Math.random() * 0.2, th.dust, 0.9);
      }
      else if (e[0] === 'nofuel') { if (mine) { toast('BENZINE OP! ⛽'); Snd.tone(330, 0.6, 'sine', 0.1, 110); setTimeout(openResults, 1600); } }
      else if (e[0] === 'finish') {
        r.time = Math.round(car.ticks / 240 / TS * 1000);
        for (let i = 0; i < 70; i++) puff(car.x + (Math.random() - 0.5) * 5, car.y - 5 - Math.random() * 3, car.vx * 0.6 + (Math.random() - 0.5) * 14, -Math.random() * 9, 1.6 + Math.random() * 1.4, 0.1 + Math.random() * 0.08, ['255,210,63', '255,90,54', '98,244,255', '255,255,255', '57,211,83'][i % 5], 0, 2);
        if (mine) { awardPoints(r); Snd.tone(523, 0.14, 'square', 0.09); setTimeout(() => Snd.tone(659, 0.14, 'square', 0.09), 140); setTimeout(() => Snd.tone(784, 0.3, 'square', 0.09), 280); setTimeout(openResults, 1500); }
      }
    }
    car.ev.length = 0;
  }

  const NOINPUT = { gas: false, brake: false };
  function simTick() {
    const dt = E.DT;
    if (S.mode === 'menu' || S.mode === 'lobby') {
      const d = S.demo; if (!d) return;
      E.botInput(d.car, S.T, S.botIn); E.stepCar(d.car, S.botIn, S.T, dt);
      const fin = d.car.finished && Math.hypot(d.car.vx, d.car.vy) < 1;
      handleEvents(d, false);
      if (fin || d.car.ticks > 240 * 110) startDemo();
      return;
    }
    const racing = S.mode === 'race';
    if (S.mode === 'countdown') {
      S.cd -= dt / TS;
      const n = Math.ceil(S.cd - 0.4);
      if (n !== S.lastCd && n >= 1 && n <= 3) { Snd.tone(440, 0.12, 'square', 0.09); S.lastCd = n; }
      if (S.cd <= 0.4 && S.lastCd !== 0) { S.lastCd = 0; S.mode = 'race'; Snd.tone(880, 0.4, 'square', 0.1); for (const r of S.racers) if (r.car) { r.car.ticks = 0; r.car.fuel = 1; } }
    }
    for (const r of S.racers) {
      if (!r.car) continue;
      if (!racing) { E.stepCar(r.car, NOINPUT, S.T, dt); r.car.ticks = 0; r.car.vx *= 0.9; r.car.ev.length = 0; continue; }
      if (r.kind === 'me') E.stepCar(r.car, S.input, S.T, dt);
      else { E.botInput(r.car, S.T, S.botIn); E.stepCar(r.car, S.botIn, S.T, dt); }
      handleEvents(r, r.kind === 'me');
    }
  }

  // ---------------------------------------------------------------- lus
  let last = performance.now(), acc = 0, hudT = 0, slow = 0;
  function frame(now) {
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now; S.time += dt;
    // blijft het beeld een paar seconden onder de 30 per seconde, dan schakelt de 3D-weergave een tandje terug
    if (raw > 0.034 && raw < 0.2) { slow += raw; if (slow > 3 && use3d()) V3.lowQuality(); } else if (raw < 0.025) slow = Math.max(0, slow - raw * 2);
    acc += dt * TS; let guard = 0;
    if (S.paused) acc = 0;   // alleen voor tests: beeld stilzetten
    while (acc >= E.DT && guard++ < 16) { simTick(); acc -= E.DT; }
    if (guard >= 16) acc = 0;
    updateVis(dt, now); if (!S.paused) updateParts(dt);
    render(dt);
    hudT -= dt; if (hudT <= 0) { hudT = 0.08; updateHud(); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
    requestAnimationFrame(frame);
  }

  function updateVis(dt, now) {
    const T = S.T;
    if (S.mode === 'menu' || S.mode === 'lobby') { if (S.demo) visFromCar(S.demo.vis, S.demo.car, T); return; }
    for (const r of S.racers) {
      const v = r.vis;
      if (r.car) { visFromCar(v, r.car, T); continue; }
      const sn = r.snap; if (!sn) continue;
      const e = Math.min(0.2, (now - r.snapT) / 1000) * TS;
      const tx = sn[0] + sn[3] * e, ty = sn[1] + sn[4] * e, ta = sn[2] + sn[5] * e;
      if (!v.init || Math.hypot(tx - v.x, ty - v.y) > 14) { v.x = tx; v.y = ty; v.a = ta; v.init = true; }
      else { const k = 1 - Math.exp(-dt * 16); v.x += (tx - v.x) * k; v.y += (ty - v.y) * k; v.a += E.wrap(ta - v.a) * k; }
      v.sp = Math.hypot(sn[3], sn[4]); v.s = sn[6]; v.boost = !!sn[7];
      v.spin0 += v.sp / 0.48 * dt * TS; v.spin1 = v.spin0; v.sus0 = v.sus1 = 0.08;
      placeVis(v, T);
      const dead = !!sn[9];
      if (dead && !v.dead) { PZ = depthFor(r); boom(v.x, v.y, r.design); }
      v.dead = dead;
      if (sn[8] && !r.time) r.time = sn[8];
      r.outNet = !!sn[10];
    }
  }

  function render3d(dt) {
    const menuish = S.mode === 'menu' || S.mode === 'lobby';
    const focus = menuish ? S.demo : S.me, T = S.T, th = THEMES[T.theme];
    const v = focus ? focus.vis : { x: 0, y: 0, sp: 0, s: 0 };
    const car = focus && focus.car, live = car && !(car.dead > 0);
    const cars = [];
    if (menuish) { if (S.demo && !S.demo.vis.dead) cars.push({ key: 'demo', vis: S.demo.vis, design: S.demo.design, lane: 0 }); }
    else for (const r of S.racers) if (r.vis.init && !r.gone && !r.vis.dead) cars.push({ key: r.id, vis: r.vis, design: r.design, lane: r.lane | 0 });
    V3.setTrack(T, th, menuish ? 2 : S.racers.length);
    if (live && Math.random() < 0.6) {
      PZ = depthFor(focus);
      if (car.boostT > 0) puff(car.x - Math.cos(car.a) * 2.1, car.y - Math.sin(car.a) * 2.1 + 0.1, -car.vx * 0.1 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.35, 0.22, '255,170,60', 1.2, 3);
      else if (car.wheelsOn > 0 && v.sp > 6 && Math.random() < 0.5) puff(car.x - Math.cos(car.a) * 1.3, car.y + 0.85, -car.vx * 0.08, -Math.random() * 1.5, 0.45, 0.16, th.dust, 0.8);
    }
    const seg0 = car ? car.cps[0].seg : -1, loop = car && (T.FL[seg0] & E.F_LOOP) ? T.loops.find(l => seg0 >= l.i0 - 2 && seg0 <= l.i1) : null;
    V3.frame(dt, {
      x: v.x, y: v.y, s: v.s, lane: focus ? focus.lane | 0 : 0, sp: v.sp, vx: live ? car.vx : 0, vy: live ? car.vy : 0,
      inLoop: !!loop, loopR: loop ? loop.R : 0, menu: menuish, shake: S.shake, time: S.time,
      fuelNext: car ? car.fuelNext : 0, rocks: car ? car.rocks : null
    }, cars, parts);
    if (S.shake > 0.01) S.shake *= Math.pow(0.002, dt);
    // getekende lucht en verte achter de 3D-wereld
    g = g2; g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground(T.theme, V3.cam2d, S.time, V3.horizon);
    // alles wat over de wereld heen ligt
    g = gfx; g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
    drawOverlay(T.theme, V3.cam2d, S.time);
    if (v.sp > 33) {
      g.strokeStyle = 'rgba(255,255,255,' + clamp((v.sp - 33) * 0.03, 0, 0.35).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i < 12; i++) { const y = Math.random() * H, x = Math.random() * W, l = 60 + Math.random() * 140; g.moveTo(x, y); g.lineTo(x - l, y); }
      g.stroke();
    }
    if (!menuish) {
      g.font = '700 13px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center';
      for (const r of S.racers) {
        if (r === S.me || !r.vis.init || r.gone || r.vis.dead) continue;
        const p = V3.project(r.vis.x, r.vis.y - 1.7, depthFor(r));
        if (p.behind || p.x < -60 || p.x > W + 60) continue;
        const tw = g.measureText(r.name).width + 14;
        g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); if (g.roundRect) g.roundRect(p.x - tw / 2, p.y - 18, tw, 20, 6); else g.rect(p.x - tw / 2, p.y - 18, tw, 20); g.fill();
        g.fillStyle = CARS[r.design].light; g.fillText(r.name, p.x, p.y - 4);
      }
    }
    g = g2;
    if (car) Snd.engine(v.sp, S.input.gas && S.mode === 'race', !menuish && !car.finished && live);
    else Snd.engine(0, false, false);
  }

  function render(dt) {
    if (use3d()) { render3d(dt); return; }
    const menuish = S.mode === 'menu' || S.mode === 'lobby';
    const focus = menuish ? S.demo : S.me, T = S.T, R = T.R, th = THEMES[T.theme];
    const v = focus ? focus.vis : { x: 0, y: 0, sp: 0, z: 0 };
    const car = focus && focus.car;
    const cam = S.cam;
    // dicht op de auto; bij hoge snelheid en in het menu iets ruimer
    const inLoop = car && (T.FL[car.cps[0].seg] & E.F_LOOP) ? 9 : 0;   // in een looping iets ruimer, zodat je hem ziet
    const viewW = clamp((menuish ? 30 : 21) + inLoop + v.sp * 0.42, 21, 44) * (W < H ? 0.66 : 1);
    const tz = W / viewW;
    cam.z += (tz - cam.z) * Math.min(1, dt * 2.2);
    const live = car && !(car.dead > 0);
    const tx = v.x + DX * (v.z + 1.5) + viewW * 0.2 + (live ? car.vx * 0.1 : 0), ty = v.y + DY * (v.z + 1.5) - 0.8 + (live ? clamp(car.vy * 0.09, -2.5, 3.5) : 0);
    cam.x += (tx - cam.x) * Math.min(1, dt * 7); cam.y += (ty - cam.y) * Math.min(1, dt * 5);
    if (Math.abs(tx - cam.x) > 80) { cam.x = tx; cam.y = ty; }
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground(T.theme, cam, S.time);
    let shx = 0, shy = 0;
    if (S.shake > 0.01) { shx = (Math.random() - 0.5) * S.shake * cam.z; shy = (Math.random() - 0.5) * S.shake * cam.z; S.shake *= Math.pow(0.002, dt); }
    const z = cam.z, ox = W * 0.5 - cam.x * z + shx, oy = H * 0.6 - cam.y * z + shy;
    g.setTransform(DPR * z, 0, 0, DPR * z, DPR * ox, DPR * oy);
    const cars = [];
    if (menuish) { if (S.demo && !S.demo.vis.dead) cars.push({ vis: S.demo.vis, design: S.demo.design, alpha: 1 }); }
    else {
      for (const r of S.racers) if (r !== S.me && r.vis.init && !r.gone && !r.vis.dead) cars.push({ vis: r.vis, design: r.design, alpha: 0.92 });
      if (S.me && !S.me.vis.dead) cars.push({ vis: S.me.vis, design: S.me.design, alpha: 1 });
    }
    drawWorld(T, R, th, S.time, cars);
    if (car) drawPickups2d(T, car, cam);
    // rook en stof van de eigen auto
    if (live && Math.random() < 0.6) {
      PZ = v.z + 1.5; const px = car.x, py = car.y;
      if (car.boostT > 0) puff(px - Math.cos(car.a) * 2.1, py - Math.sin(car.a) * 2.1 + 0.1, -car.vx * 0.1 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.35, 0.22, '255,170,60', 1.2);
      else if (car.wheelsOn > 0 && v.sp > 6 && Math.random() < 0.5) puff(px - Math.cos(car.a) * 1.3, py + 0.85, -car.vx * 0.08, -Math.random() * 1.5, 0.45, 0.14, th.dust, 0.7);
    }
    drawParts();
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawOverlay(T.theme, cam, S.time);
    if (v.sp > 33) {
      g.strokeStyle = 'rgba(255,255,255,' + clamp((v.sp - 33) * 0.03, 0, 0.35).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i < 12; i++) { const y = Math.random() * H, x = Math.random() * W, l = 60 + Math.random() * 140; g.moveTo(x, y); g.lineTo(x - l, y); }
      g.stroke();
    }
    if (!menuish) {
      g.font = '700 13px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center';
      for (const r of S.racers) {
        if (r === S.me || !r.vis.init || r.gone || r.vis.dead) continue;
        const sx = (r.vis.x + DX * (r.vis.z + 1.5)) * z + ox, sy = (r.vis.y + DY * (r.vis.z + 1.5)) * z + oy - 1.9 * z;
        if (sx < -60 || sx > W + 60) continue;
        const tw = g.measureText(r.name).width + 14;
        g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); if (g.roundRect) g.roundRect(sx - tw / 2, sy - 16, tw, 20, 6); else g.rect(sx - tw / 2, sy - 16, tw, 20); g.fill();
        g.fillStyle = CARS[r.design].light; g.fillText(r.name, sx, sy - 2);
      }
    }
    if (car) Snd.engine(v.sp, S.input.gas && S.mode === 'race', !menuish && !car.finished && live);
    else Snd.engine(0, false, false);
  }

  function drawPickups2d(T, car, cam) {
    for (let k = car.fuelNext; k < T.fuels.length; k++) {
      const fu = T.fuels[k]; if (fu.x - cam.x > 60) break; if (cam.x - fu.x > 60) continue;
      const zz = laneZ(T, fu.s) + 1.5, x = fu.x + DX * zz, y = fu.y + DY * zz + Math.sin(S.time * 3 + k) * 0.15;
      g.fillStyle = '#e8382f'; g.fillRect(x - 0.45, y - 0.55, 0.9, 1.1);
      g.fillStyle = '#7a0f0c'; g.fillRect(x - 0.3, y - 0.38, 0.6, 0.76);
      g.fillStyle = '#ffd23f'; g.fillRect(x - 0.38, y - 0.8, 0.22, 0.25);
    }
    for (const Rk of car.rocks) {
      if (Rk.offT > 1.5 || Math.abs(Rk.s - car.s) > 60) continue;
      const p = E.pointAt(T, Rk.s, {}), zz = laneZ(T, Rk.s) + 1.5 - Rk.offT * 4, drop = Rk.offT * Rk.offT * 9;
      const x = p.x + p.ty * Rk.r + DX * zz, y = p.y - p.tx * Rk.r + DY * zz + drop;
      g.save(); g.translate(x, y); g.rotate((Rk.s - Rk.s0) / Rk.r);
      g.fillStyle = '#7d7f88'; g.beginPath(); g.arc(0, 0, Rk.r, 0, 6.2832); g.fill();
      g.fillStyle = '#a3a6b0'; g.beginPath(); g.arc(-Rk.r * 0.3, -Rk.r * 0.3, Rk.r * 0.45, 0, 6.2832); g.fill();
      g.restore();
    }
  }
  function fmt(ms) { return (ms / 1000).toFixed(2); }
  // wie heeft deze race gewonnen: alleen de host (of solo) beslist en houdt de stand bij
  const isOut = r => r.car ? !!r.car.out : !!r.outNet;
  function decideRace() {
    if (!authority() || S.decided || S.mode !== 'race') return;
    const gm = S.game, active = S.racers.filter(r => !r.gone);
    if (gm.mode === 'solo') return;
    if (gm.mode === 'coop') {
      // samen: alleen gehaald als iedereen over de finish komt
      const humans = active.filter(r => r.id !== 'bot');
      if (humans.some(r => isOut(r) && !r.time)) coopVerdict(false);
      else if (humans.length && humans.every(r => r.time)) coopVerdict(true);
      return;
    }
    const fin = active.filter(r => r.time), done = active.filter(r => r.time || isOut(r));
    if (!done.length) return;
    if (!S.firstFin) S.firstFin = performance.now();
    if (done.length < active.length && performance.now() - S.firstFin < 25000) return;
    S.decided = true;
    const t = Net.tally || (Net.tally = newTally());
    if (fin.length) { fin.sort((a, b) => a.time - b.time); t.wins[fin[0].id] = (t.wins[fin[0].id] || 0) + 1; }
    t.races++;
    if (Net.host) broadcast({ t: 'tally', tally: t });
  }
  function coopVerdict(ok) {
    S.decided = true;
    if (Net.host) broadcast({ t: 'coop', ok: ok, track: S.trackIdx });
    applyCoop(ok);
  }
  function applyCoop(ok) {
    if (S.coop || S.mode !== 'race') return;
    S.coop = { ok: ok };
    if (ok) { Profile.coop[LV[S.trackIdx].id] = 1; Profile.pts += 40; Profile.save(); Snd.tone(523, 0.14, 'square', 0.09); setTimeout(() => Snd.tone(784, 0.3, 'square', 0.09), 160); }
    if (S.resultsOpen) fillResults(); else setTimeout(openResults, ok ? 300 : 1400);
  }
  function updateHud() {
    const big = $('big');
    if (S.mode === 'countdown') { const n = Math.ceil(S.cd - 0.4); big.textContent = n >= 1 ? String(Math.min(3, n)) : ''; }
    else if (S.mode === 'race' && S.me && S.me.car.ticks < 170 && !S.me.car.finished) big.textContent = 'GO!';
    else big.textContent = '';
    if (S.mode !== 'countdown' && S.mode !== 'race') return;
    decideRace();
    const me = S.me; if (!me) return;
    const car = me.car, T = S.T;
    $('time').textContent = fmt(me.time || car.ticks / 240 / TS * 1000);
    $('speed').textContent = String(Math.round(Math.hypot(car.vx, car.vy) * 6 * TS));
    $('boostBar').firstElementChild.style.width = clamp(car.boostT / (1.1 * car.spec.boost), 0, 1) * 100 + '%';
    $('fuelBar').firstElementChild.style.width = clamp(car.fuel, 0, 1) * 100 + '%';
    const low = car.fuel < 0.2 && !car.finished && S.mode === 'race';
    $('fuelRow').classList.toggle('low', low);
    if (low && !S.lowWarned && !car.out) { S.lowWarned = true; toast('Bijna leeg! Pak ⛽'); Snd.tone(440, 0.15, 'sine', 0.07); setTimeout(() => Snd.tone(440, 0.15, 'sine', 0.07), 220); }
    else if (car.fuel > 0.35) S.lowWarned = false;
    const rk = ranking(), place = rk.indexOf(me) + 1;
    $('pos').innerHTML = place + '<small>e /' + S.racers.filter(r => !r.gone).length + '</small>';
    const span = T.finishS - T.startS;
    for (const r of S.racers) { r.dot.style.left = clamp((r.vis.s - T.startS) / span, 0, 1) * 100 + '%'; r.dot.hidden = r.gone; }
    if (S.resultsOpen) fillResults();
  }

  // ---------------------------------------------------------------- schermen
  const SCREENS = ['menu', 'levels', 'together', 'lobby', 'results'];
  function show(which) {
    for (const k of SCREENS) $(k).hidden = which !== k;
    $('hud').hidden = !(which === 'hud' || which === 'results');
  }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }

  // garage: gewonnen auto's kiezen, de rest staat er grijs bij als voorproefje
  function renderGarage() {
    $('pts').textContent = Profile.pts + ' punten';
    const box = $('carPick'); box.innerHTML = '';
    CARS.forEach((c, i) => {
      const own = Profile.owned.has(i), b = el('button', (i === S.viewCar ? 'sel ' : '') + (own ? '' : 'locked') + (i === Profile.car ? ' mine' : ''));
      const shot = use3d() ? V3.snapshot(i, 460, 260) : null;
      if (shot) { const im = new Image(); im.src = shot; im.alt = c.name; b.appendChild(im); }
      else {
        const cvs = document.createElement('canvas'); cvs.width = 230; cvs.height = 130;
        const x = cvs.getContext('2d'); x.setTransform(44, 0, 0, 44, 122, 86);
        drawCar(x, { x: 0, y: 0, a: 0, spin0: 0.4, spin1: 1.1, sus0: 0.06, sus1: 0.06, boost: false, z: 0 }, i, 1);
        b.appendChild(cvs);
      } b.appendChild(el('span', '', c.name + (i === Profile.car ? ' ✓' : '')));
      if (!own) b.appendChild(el('small', '', c.cost + ' pt'));
      b.onclick = () => { S.viewCar = i; if (own) { Profile.car = i; Profile.save(); } renderGarage(); };
      box.appendChild(b);
    });
    const d = S.viewCar, c = CARS[d], own = Profile.owned.has(d), info = $('carInfo'); info.innerHTML = '';
    const head = el('div', 'ci-head'); head.appendChild(el('b', '', c.name)); head.appendChild(el('span', '', c.tag)); info.appendChild(head);
    const bars = el('div', 'ci-bars'), vals = statBars(d);
    STAT_NAMES.forEach((nm, k) => {
      const row = el('div', 'ci-row'); row.appendChild(el('span', '', nm));
      const bar = el('i'); for (let q = 0; q < 5; q++) bar.appendChild(el('u', q < vals[k] ? 'on' : '')); row.appendChild(bar); bars.appendChild(row);
    });
    info.appendChild(bars);
    if (!own) {
      const need = c.cost - Profile.pts, buy = el('button', 'buy', need > 0 ? 'Nog ' + need + ' punten nodig' : 'Koop voor ' + c.cost + ' punten');
      buy.disabled = need > 0;
      buy.onclick = () => { if (Profile.pts < c.cost) return; Profile.pts -= c.cost; Profile.owned.add(d); Profile.car = d; Profile.save(); Snd.init(); Snd.tone(660, 0.12, 'square', 0.09); Snd.tone(990, 0.25, 'square', 0.09); renderGarage(); };
      info.appendChild(buy);
    }
  }
  function showMenu(msg) {
    S.mode = 'menu'; S.resultsOpen = false; S.racers = []; S.me = null; $('big').textContent = '';
    if (!S.demo) startDemo(); else S.T = TRACKS[S.demoIdx];
    S.viewCar = Profile.car; renderGarage();
    $('menuMsg').textContent = msg || ''; show('menu');
  }
  function idle(mode) { S.mode = mode; S.resultsOpen = false; S.racers = []; S.me = null; $('big').textContent = ''; if (!S.demo) startDemo(); else S.T = TRACKS[S.demoIdx]; }

  // alleen spelen: levels tegen de robot
  function showLevels(msg) {
    leaveNet(); idle('menu');
    const th = Profile.theme; if (LV[S.demoIdx].theme !== th) startDemo(findLevel(th, 1));
    renderLevels(); $('lvlMsg').textContent = msg || ''; show('levels');
  }
  function renderLevels() {
    levelPicker($('lvlPick'), {
      prog: Profile.stars, maxStars: 3, theme: Profile.theme, sel: -1, canEdit: true, diff: Profile.diff,
      onTheme: t => { Profile.theme = t; Profile.save(); startDemo(findLevel(t, 1)); renderLevels(); },
      onPick: i => { Snd.init(); readProfile(); startSoloLevel(i); },
      onDiff: k => { Profile.diff = k; Profile.save(); renderLevels(); }
    });
  }
  function startSoloLevel(i) {
    leaveNet(); Net.roster = [me()]; setBot(true);
    startRace(i, Net.roster, { mode: 'solo', diff: Profile.diff });
  }

  // samen spelen: spel maken of meedoen met 3 dieren
  const ANIMALS = [['🐶', 'hond'], ['🐱', 'kat'], ['🐰', 'konijn'], ['🦊', 'vos'], ['🐻', 'beer'], ['🐼', 'panda'], ['🐸', 'kikker'], ['🐵', 'aap'], ['🦁', 'leeuw'], ['🐯', 'tijger'], ['🐷', 'varken'], ['🐮', 'koe']];
  const CODE_A = 'ABCDEFGHJKLM';
  const codeIcons = code => String(code || '').split('').map(ch => { const k = CODE_A.indexOf(ch); return k >= 0 ? ANIMALS[k][0] : '?'; }).join('');
  const joinPick = [];
  function showTogether(msg, keep) {
    leaveNet(); idle('menu');
    if (!keep) { joinPick.length = 0; $('joinBox').hidden = true; }
    renderJoin(); $('togMsg').textContent = msg || ''; show('together');
  }
  function renderJoin() {
    const sl = $('slots'); sl.innerHTML = '';
    for (let k = 0; k < 3; k++) { const a = joinPick[k]; sl.appendChild(el('span', a !== undefined ? 'f' : '', a !== undefined ? ANIMALS[a][0] : '')); }
    const bx = $('animals');
    if (!bx.childElementCount) ANIMALS.forEach((a, i) => { const b = el('button', '', a[0]); b.title = a[1]; b.setAttribute('aria-label', a[1]); b.onclick = () => pickAnimal(i); bx.appendChild(b); });
    $('btnJoinGo').hidden = joinPick.length !== 3;
    $('btnJoinDel').style.visibility = joinPick.length ? 'visible' : 'hidden';
  }
  function pickAnimal(i) {
    Snd.init(); if (joinPick.length >= 3) joinPick.length = 0;
    joinPick.push(i); Snd.tone(500 + joinPick.length * 120, 0.1, 'sine', 0.07); renderJoin();
    if (joinPick.length === 3) doJoin();
  }
  function doJoin() { if (joinPick.length !== 3) return; readProfile(); joinGame(joinPick.map(i => CODE_A[i]).join('')); }
  const shareLink = () => location.href.split('#')[0] + '#' + Net.code;

  function tallyText() {
    const t = Net.tally; if (!t || !t.races) return '';
    const rows = Net.roster.map(p => [p.name, t.wins[p.id] || 0]).sort((a, b) => b[1] - a[1]);
    return 'Stand (' + t.races + (t.races === 1 ? ' race' : ' races') + '): ' + rows.map(r => r[0] + ' ' + r[1]).join(' · ');
  }
  function lobbyProg() { return authority() ? (S.lobbyGame.mode === 'coop' ? Profile.coop : Profile.stars) : (S.lobbyProg || {}); }
  function lobbyChanged() { if (Net.host) broadcastLobby(); showLobby(); }
  function showLobby() {
    idle('lobby');
    const canEdit = authority(), t = Net.tally, gm = S.lobbyGame;
    $('codeShow').textContent = codeIcons(Net.code);
    if (Net.qrFor !== Net.code) {
      Net.qrFor = Net.code; const q = $('qr'); q.innerHTML = '';
      if (window.QRCode && Net.code) { try { new QRCode(q, { text: shareLink(), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { q.innerHTML = ''; } }
    }
    const ul = $('players'); ul.innerHTML = '';
    for (const p of Net.roster) {
      const li = el('li', p.id === Net.myId ? 'me' : '');
      const dot = el('i'); dot.style.background = CARS[clamp(p.car | 0, 0, CARS.length - 1)].color;
      li.appendChild(dot); li.appendChild(el('b', '', (p.id === 'bot' ? '🤖 ' : '') + p.name));
      const wins = t && t.races ? (t.wins[p.id] || 0) + 'x gewonnen' : '';
      li.appendChild(el('span', '', [p.id === 'bot' ? 'robot' : p.id === Net.myId ? 'jij' : p.id === 'h' ? 'host' : '', wins].filter(Boolean).join(' · ')));
      ul.appendChild(li);
    }
    for (const b of $('modePick').querySelectorAll('button')) { b.classList.toggle('sel', b.dataset.mode === gm.mode); b.disabled = !canEdit && b.dataset.mode !== gm.mode; }
    const prog = lobbyProg();
    if (canEdit && !isOpen(S.trackIdx, prog)) S.trackIdx = lastOpen(LV[S.trackIdx].theme, prog);
    levelPicker($('lobbyLvl'), {
      prog: prog, maxStars: gm.mode === 'coop' ? 1 : 3, theme: LV[S.trackIdx].theme, sel: S.trackIdx, canEdit: canEdit, diff: gm.diff,
      onTheme: th => { S.trackIdx = lastOpen(th, prog); lobbyChanged(); },
      onPick: i => { S.trackIdx = i; lobbyChanged(); },
      onDiff: k => { gm.diff = k; lobbyChanged(); }
    });
    const bc = $('botChk'); bc.hidden = !canEdit || gm.mode === 'coop'; bc.classList.toggle('sel', Net.roster.some(p => p.id === 'bot'));
    $('btnStart').hidden = !canEdit;
    const humans = Net.roster.filter(p => p.id !== 'bot').length;
    $('lobbyMsg').textContent = !canEdit ? 'De host kiest het level en start.' : humans < 2 ? (gm.mode === 'coop' ? 'Wacht tot je vriend meedoet…' : 'Wacht tot je vriend meedoet… of start alvast tegen de robot.') : '';
    show('lobby');
  }
  function hostStart(idx) {
    if (!authority()) return;
    if (!Net.tally || Date.now() - Net.tally.since > 3600e3) Net.tally = newTally();
    const gm = { mode: S.lobbyGame.mode, diff: S.lobbyGame.diff };
    const roster = gm.mode === 'coop' ? Net.roster.filter(p => p.id !== 'bot') : Net.roster;
    if (Net.host) broadcast({ t: 'start', track: idx, players: roster, tally: Net.tally, game: gm });
    startRace(idx, roster, gm);
  }
  function openResults() {
    if (S.mode !== 'race') return;
    if (S.resultsOpen) { fillResults(); return; }
    S.resultsOpen = true; fillResults();
    show('results');
  }
  function fillResults() {
    const ol = $('rank'), rk = ranking().filter(r => !r.gone), gm = S.game, me = S.me, host = authority(); ol.innerHTML = '';
    rk.forEach((r, i) => {
      const li = el('li', r === S.me ? 'me' : '');
      const dot = el('i'); dot.style.background = CARS[r.design].color;
      li.appendChild(el('b', '', gm.mode === 'coop' ? (r.time ? '✅' : isOut(r) ? '❌' : '…') : String(i + 1))); li.appendChild(dot);
      li.appendChild(el('em', '', (r.kind === 'bot' ? '🤖 ' : '') + r.name));
      li.appendChild(el('span', '', r.time ? fmt(r.time) + ' s' : isOut(r) ? '⛽ leeg' : 'onderweg…')); ol.appendChild(li);
    });
    const myOk = !!(me && me.time), meOut = !!(me && isOut(me)), nx = nextLevel(S.trackIdx);
    let title, stars = '', passed;
    if (gm.mode === 'solo') {
      passed = myOk;
      title = myOk ? (S.starsNow === 3 ? 'Super! 🏆' : 'Level gehaald! 🎉') : meOut ? 'Benzine op! 😢' : 'Uitslag';
      if (myOk) stars = starStr(S.starsNow, 3);
    } else if (gm.mode === 'coop') {
      passed = !!(S.coop && S.coop.ok);
      title = S.coop ? (S.coop.ok ? 'Samen gehaald! 🎉' : 'Helaas, niet allebei gehaald 😢') : myOk ? 'Wachten op je maatje…' : 'Even wachten…';
      if (passed) stars = '★';
    } else {
      passed = true;
      title = rk[0] === me && myOk ? 'Gewonnen! 🏆' : meOut && !myOk ? 'Benzine op! 😢' : 'Uitslag';
    }
    const d = LV[S.trackIdx];
    $('resTitle').textContent = title;
    $('resSub').textContent = E.THEMES.find(q => q.id === d.theme).icon + ' Level ' + d.no + ': ' + d.name;
    if (stars) fillStars($('resStars'), gm.mode === 'solo' ? S.starsNow : 1, gm.mode === 'solo' ? 3 : 1); else $('resStars').textContent = '';
    const e = S.earned, box = $('resPts'); box.innerHTML = '';
    if (e || passed && gm.mode === 'coop') {
      const items = e ? e.items.slice() : [], bonus = S.coop && S.coop.ok ? 40 : 0;
      if (bonus) items.push(['Samen gehaald', bonus]);
      box.appendChild(el('b', '', '+' + ((e ? e.total : 0) + bonus) + ' punten'));
      box.appendChild(el('span', '', items.map(it => it[0] + ' ' + it[1]).join(' · ')));
      box.appendChild(el('small', '', 'Totaal: ' + Profile.pts + ' punten'));
    }
    $('resTally').textContent = gm.mode === 'race' ? tallyText() : '';
    const bn = $('btnNext'), ba = $('btnAgain'), bl = $('btnResLeave');
    bn.hidden = !host || !passed || nx < 0 || (gm.mode === 'coop' && !S.coop);
    if (nx >= 0) bn.textContent = LV[nx].theme !== d.theme ? '▶ Volgende wereld ' + E.THEMES.find(q => q.id === LV[nx].theme).icon : '▶ Volgend level';
    ba.hidden = !host; ba.classList.toggle('big', bn.hidden);
    bl.textContent = gm.mode === 'solo' ? '🗺️ Levels' : host ? '⚙️ Lobby' : '🏠 Stoppen';
    $('resMsg').textContent = !host ? (gm.mode === 'coop' && !S.coop ? '' : 'Wacht op de host voor het volgende level…')
      : gm.mode !== 'race' && !passed && (S.coop || gm.mode === 'solo') ? 'Tip: pak onderweg de jerrycans ⛽ en duw de rotsen weg 🪨' : '';
  }

  // ---------------------------------------------------------------- netwerk
  const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'Racer';
  function me() { return { id: Net.myId, name: cleanName(Profile.name), car: Profile.car }; }
  function randCode() { let c = ''; for (let i = 0; i < 3; i++) c += CODE_A[Math.floor(Math.random() * CODE_A.length)]; return c; }
  function leaveNet() {
    clearTimeout(Net.joinTimer);
    const p = Net.peer; Net.peer = null; Net.conns.clear(); Net.hc = null; Net.online = false; Net.host = false; Net.myId = 'me'; Net.code = ''; Net.roster = []; Net.tally = null; Net.qrFor = '';
    if (p) { try { p.destroy(); } catch (e) { /* al weg */ } }
  }
  function setBot(on) {
    const old = Net.roster.find(p => p.id === 'bot');
    Net.roster = Net.roster.filter(p => p.id !== 'bot');
    if (on) Net.roster.push(old || { id: 'bot', name: 'Robot Bliksem', car: (Profile.car + 1 + Math.floor(Math.random() * (CARS.length - 1))) % CARS.length });
  }

  function hostGame(tries) {
    if (typeof Peer === 'undefined') { showTogether('Samen spelen kan nu niet: geen internet?'); return; }
    leaveNet(); Net.host = true; Net.online = true; Net.myId = 'h'; Net.code = randCode(); Net.tally = newTally();
    $('togMsg').textContent = 'Spel wordt gemaakt…';
    const peer = new Peer(PEER_PREFIX + Net.code); Net.peer = peer;
    peer.on('open', () => {
      if (Net.peer !== peer) return;
      Net.roster = [me()]; S.lobbyGame = { mode: S.lobbyGame.mode || 'race', diff: Profile.diff };
      if (S.lobbyGame.mode === 'race' && S.botWanted) setBot(true);
      S.trackIdx = lastOpen(Profile.theme, lobbyProg()); showLobby();
    });
    peer.on('connection', c => {
      c.on('data', d => hostData(c, d));
      c.on('close', () => dropGuest(c)); c.on('error', () => dropGuest(c));
    });
    peer.on('error', err => {
      if (Net.peer !== peer) return;
      if (err.type === 'unavailable-id' && (tries || 0) < 4) { hostGame((tries || 0) + 1); return; }
      if (err.type === 'peer-unavailable') return;
      if (S.mode === 'menu') showTogether('Spel maken mislukt (' + err.type + '). Is er internet?');
    });
    peer.on('disconnected', () => { if (Net.peer === peer) { try { peer.reconnect(); } catch (e) { /* later */ } } });
  }
  function broadcast(msg) { for (const c of Net.conns.values()) { if (c.open) { try { c.send(msg); } catch (e) { /* verbinding weg */ } } } }
  function broadcastLobby() { const prog = lobbyProg(); for (const c of Net.conns.values()) if (c.open) c.send({ t: 'lobby', you: c.peer, players: Net.roster, track: S.trackIdx, tally: Net.tally, game: S.lobbyGame, prog: prog }); }
  function dropGuest(c) {
    if (!Net.conns.has(c.peer)) return;
    Net.conns.delete(c.peer); Net.roster = Net.roster.filter(p => p.id !== c.peer);
    const r = S.racers.find(q => q.id === c.peer); if (r) r.gone = true;
    broadcast({ t: 'gone', id: c.peer });
    if (S.mode === 'lobby') { broadcastLobby(); showLobby(); }
  }
  function hostData(c, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') {
      if (Net.roster.filter(p => p.id !== 'bot').length >= 4) { c.send({ t: 'full' }); return; }
      Net.conns.set(c.peer, c);
      Net.roster = Net.roster.filter(p => p.id !== c.peer);
      const bot = Net.roster.find(p => p.id === 'bot'); Net.roster = Net.roster.filter(p => p.id !== 'bot');
      Net.roster.push({ id: c.peer, name: cleanName(d.name), car: clamp(d.car | 0, 0, CARS.length - 1) });
      if (bot) Net.roster.push(bot);
      broadcastLobby();
      if (S.mode === 'lobby') showLobby(); else c.send({ t: 'wait' });
    } else if (d.t === 's' && Array.isArray(d.d)) {
      const r = S.racers.find(q => q.id === c.peer); if (r) { r.snap = d.d; r.snapT = performance.now(); }
    }
  }

  function joinGame(code) {
    if (typeof Peer === 'undefined') { showTogether('Samen spelen kan nu niet: geen internet?', true); return; }
    leaveNet(); Net.online = true; Net.host = false; Net.code = code;
    $('togMsg').textContent = 'Verbinden met ' + codeIcons(code) + ' …';
    const peer = new Peer(); Net.peer = peer;
    const fail = msg => { if (Net.peer !== peer) return; showTogether(msg, true); $('joinBox').hidden = false; };
    Net.joinTimer = setTimeout(() => { if (S.mode === 'menu') fail('Geen spel gevonden met ' + codeIcons(code) + '. Kloppen de dieren?'); }, 12000);
    peer.on('open', () => {
      if (Net.peer !== peer) return;
      const c = peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: true }); Net.hc = c;
      c.on('open', () => c.send({ t: 'hello', name: cleanName(Profile.name), car: Profile.car }));
      c.on('data', guestData);
      c.on('close', () => fail('De verbinding met de host is verbroken.'));
    });
    peer.on('error', err => fail(err.type === 'peer-unavailable' ? 'Geen spel gevonden met ' + codeIcons(code) + '. Kloppen de dieren?' : 'Verbinden mislukt (' + err.type + ').'));
  }
  function guestData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.tally) Net.tally = d.tally;
    if (d.t === 'lobby') {
      clearTimeout(Net.joinTimer); Net.myId = d.you; Net.roster = d.players; S.trackIdx = clamp(d.track | 0, 0, TRACKS.length - 1);
      if (d.game) S.lobbyGame = { mode: d.game.mode === 'coop' ? 'coop' : 'race', diff: clamp(d.game.diff | 0, 0, 2) };
      S.lobbyProg = d.prog && typeof d.prog === 'object' ? d.prog : {};
      if (S.mode !== 'race' && S.mode !== 'countdown' || S.resultsOpen) showLobby();
    }
    else if (d.t === 'start') { Net.roster = d.players; startRace(clamp(d.track | 0, 0, TRACKS.length - 1), Net.roster, d.game); }
    else if (d.t === 'coop') { if ((d.track | 0) === S.trackIdx) applyCoop(!!d.ok); }
    else if (d.t === 'S') { const now = performance.now(); for (const r of S.racers) { if (r.kind === 'remote' && d.p[r.id]) { r.snap = d.p[r.id]; r.snapT = now; } } }
    else if (d.t === 'gone') { const r = S.racers.find(q => q.id === d.id); if (r) r.gone = true; }
    else if (d.t === 'back') { showLobby(); }
    else if (d.t === 'wait') { $('togMsg').textContent = 'Je vriend is al aan het rijden; je doet mee met het volgende level.'; }
    else if (d.t === 'full') { showTogether('Dit spel zit vol (4 spelers).'); }
  }
  const r2 = v => Math.round(v * 100) / 100;
  function snapOf(r) {
    const c = r.car;
    return [r2(c.x), r2(c.y), Math.round(c.a * 1000) / 1000, r2(c.vx), r2(c.vy), r2(c.w), r2(c.s), c.boostT > 0 ? 1 : 0, r.time || 0, c.dead > 0 ? 1 : 0, c.out ? 1 : 0];
  }
  setInterval(() => {
    if (!Net.online || (S.mode !== 'race' && S.mode !== 'countdown')) return;
    if (Net.host) {
      const p = {};
      for (const r of S.racers) { if (r.gone) continue; if (r.car) p[r.id] = snapOf(r); else if (r.snap) p[r.id] = r.snap; }
      broadcast({ t: 'S', p: p });
    } else if (Net.hc && Net.hc.open && S.me) { try { Net.hc.send({ t: 's', d: snapOf(S.me) }); } catch (e) { /* verbinding weg */ } }
  }, 50);

  // ---------------------------------------------------------------- bediening
  function hold(elm, key) {
    const on = e => { e.preventDefault(); Snd.init(); S.input[key] = true; elm.classList.add('down'); try { elm.setPointerCapture(e.pointerId); } catch (x) { /* oud toestel */ } };
    const off = e => { e.preventDefault(); S.input[key] = false; elm.classList.remove('down'); };
    elm.addEventListener('pointerdown', on); elm.addEventListener('pointerup', off); elm.addEventListener('pointercancel', off);
    elm.addEventListener('lostpointercapture', off); elm.addEventListener('contextmenu', e => e.preventDefault());
  }
  hold($('pGas'), 'gas'); hold($('pBrake'), 'brake');
  const KEYS = { ArrowRight: 'gas', KeyD: 'gas', ArrowUp: 'gas', KeyW: 'gas', ArrowLeft: 'brake', KeyA: 'brake', ArrowDown: 'brake', KeyS: 'brake' };
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = KEYS[e.code];
    if (k) { S.input[k] = true; $(k === 'gas' ? 'pGas' : 'pBrake').classList.add('down'); e.preventDefault(); }
    else if (e.code === 'KeyR') doReset();
  });
  window.addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) { S.input[k] = false; $(k === 'gas' ? 'pGas' : 'pBrake').classList.remove('down'); } });
  window.addEventListener('blur', () => { S.input.gas = S.input.brake = false; });
  function doReset() { const m = S.me; if (S.mode === 'race' && m && !m.car.finished && !m.car.out && !(m.car.dead > 0)) { S.stats.crashes++; E.respawn(m.car, S.T); } }
  $('btnReset').onclick = doReset;
  $('btnMute').onclick = () => { Snd.muted = !Snd.muted; $('btnMute').style.opacity = Snd.muted ? 0.4 : 1; };
  function quit() { leaveNet(); showMenu(''); }
  $('btnQuit').onclick = quit; $('btnResLeave').onclick = quit;
  $('btnLeave').onclick = quit;

  function readProfile() { Profile.name = cleanName($('name').value); Profile.save(); }
  $('btnSolo').onclick = () => { Snd.init(); readProfile(); showLevels(); };
  $('btnTogether').onclick = () => { Snd.init(); readProfile(); showTogether(); };
  $('btnLvlBack').onclick = () => showMenu('');
  $('btnTogBack').onclick = () => showMenu('');
  $('btnHost').onclick = () => { Snd.init(); readProfile(); hostGame(0); };
  $('btnJoinOpen').onclick = () => { Snd.init(); $('joinBox').hidden = false; renderJoin(); };
  $('btnJoinDel').onclick = () => { joinPick.pop(); renderJoin(); };
  $('btnJoinGo').onclick = () => { Snd.init(); doJoin(); };
  $('btnShare').onclick = async () => {
    const link = shareLink();
    try { if (navigator.share) { await navigator.share({ title: 'Stuntbaan Duel', text: 'Doe mee met mijn race! ' + codeIcons(Net.code), url: link }); return; } }
    catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); $('lobbyMsg').textContent = 'Link gekopieerd! Plak hem in een berichtje.'; }
    catch (e) { $('lobbyMsg').textContent = link; }
  };
  for (const b of $('modePick').querySelectorAll('button')) b.onclick = () => {
    if (!authority()) return; Snd.init();
    S.lobbyGame.mode = b.dataset.mode;
    if (S.lobbyGame.mode === 'coop') setBot(false); else setBot(S.botWanted);
    lobbyChanged();
  };
  $('botChk').onclick = () => { if (!authority()) return; S.botWanted = !Net.roster.some(p => p.id === 'bot'); setBot(S.botWanted); lobbyChanged(); };
  $('btnStart').onclick = () => { if (!authority() || Net.roster.length < 1) return; Snd.init(); hostStart(S.trackIdx); };
  $('btnNext').onclick = () => { const nx = nextLevel(S.trackIdx); if (nx < 0 || !authority()) return; if (S.game.mode === 'solo') startSoloLevel(nx); else hostStart(nx); };
  $('btnAgain').onclick = () => { if (!authority()) return; if (S.game.mode === 'solo') startSoloLevel(S.trackIdx); else hostStart(S.trackIdx); };
  $('btnResLeave').onclick = () => {
    if (S.game.mode === 'solo') showLevels();
    else if (Net.host) { broadcast({ t: 'back' }); broadcastLobby(); showLobby(); }
    else quit();
  };
  window.addEventListener('keydown', e => {
    if (!S.resultsOpen || e.code !== 'Enter') return;
    if (!$('btnNext').hidden) $('btnNext').click(); else if (!$('btnAgain').hidden) $('btnAgain').click();
  });

  $('name').value = Profile.name;
  // link met #CODE (3 dieren): meteen naar meedoen
  const codeFromHash = () => {
    const m = location.hash.match(/^#([A-M]{3})$/i); if (!m) return false;
    joinPick.length = 0; for (const ch of m[1].toUpperCase()) joinPick.push(CODE_A.indexOf(ch));
    showTogether('Je vriend wacht op je! Tik op Meedoen.', true); $('joinBox').hidden = false; renderJoin();
    return true;
  };
  window.addEventListener('hashchange', codeFromHash);

  // voor tests in de browserconsole
  window.__sbd = {
    S: S, Net: Net, E: E, TRACKS: TRACKS, Profile: Profile, startRace: startRace, renderGarage: renderGarage,
    startSoloLevel: startSoloLevel, showLevels: showLevels, showTogether: showTogether, nextLevel: nextLevel, thumb: thumb,
    advance(sec) { const n = Math.round(sec * 240); for (let i = 0; i < n; i++) simTick(); updateVis(0.016, performance.now()); updateParts(0.016); },
    renderMs(n) { const t0 = performance.now(); for (let i = 0; i < (n || 20); i++) render(0.016); return (performance.now() - t0) / (n || 20); }
  };

  if (!codeFromHash()) showMenu('');
  requestAnimationFrame(frame);
})();
