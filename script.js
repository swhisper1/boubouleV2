'use strict';

/* ==========================================================================
   BOULES SATISFAISANTES : moteur physique 2D maison (Canvas 2D, sans librairie)

   Principe : des boules rebondissent dans un cercle qui tourne en continu,
   percé d'une ouverture. Quand une boule sort complètement par l'ouverture,
   elle disparaît et deux nouvelles boules apparaissent : 1 -> 2 -> 4 -> 8 ...

   Tout est piloté par la physique : gravité, réflexion selon la normale,
   restitution réglable, correction de position, pas de temps fixe.

   Modifie les valeurs de CFG juste en dessous pour changer le comportement.
   ========================================================================== */


/* ==========================================================================
   1. RÉGLAGES
   ========================================================================== */
const CFG = {
  // --- Cercle (le monde fait 1080x1920 en portrait, 1080 de haut en paysage) ---
  ringY: 780,            // hauteur du centre du cercle en portrait
  ringRadius: 430,       // rayon (ligne centrale du trait)
  ringThickness: 10,     // épaisseur du trait
  gapWidth: 110,         // distance entre les deux extrémités de l'ouverture
  ringSpeed: 0.9,        // rotation du cercle en rad/s (0 = immobile, négatif = sens inverse)

  // --- Boules ---
  ballRadius: 16,
  maxBalls: 250,         // limite pour ne pas saturer le navigateur
  colorByGeneration: true, // true : la couleur change à chaque division, false : toutes blanches

  // --- Physique ---
  gravity: 1800,         // px/s²  (réglable avec le curseur)
  restitutionWall: 1,    // 1 = rebond parfait : les boules rebondissent à l'infini
  restitutionBall: 1,    // idem pour les chocs entre boules
  wallFriction: 0,       // aucun frottement sur la paroi
  airDrag: 0,            // aucun frottement de l'air
  maxSpeed: 2600,        // vitesse maximale (évite de traverser les parois)
  collisionsBetweenBalls: true,
  physicsStep: 1 / 240,  // pas de temps fixe : indépendant des FPS
  maxStepsPerFrame: 20,

  // --- Apparition des nouvelles boules ---
  // 'top'  : dans la partie haute du cercle
  // 'exit' : juste à l'intérieur de l'ouverture, projetées vers le centre
  spawnMode: 'top',

  // --- Simulation et sons ---
  speed: 1,
  volume: 0.6,
  minImpactSpeedForSound: 60,
};


/* ==========================================================================
   2. GÉOMÉTRIE
   Le monde change de forme selon l'orientation (portrait / paysage) : seuls
   le centre du cercle et la taille du monde changent, la physique reste la même.
   ========================================================================== */
const TAU = Math.PI * 2;
const R = CFG.ringRadius;                  // rayon de la ligne centrale du trait
const T = CFG.ringThickness;
const R_IN = R - T / 2;                    // rayon intérieur : la surface réellement touchée
const CAP_R = T / 2;                       // rayon des extrémités arrondies de l'ouverture
const BR = CFG.ballRadius;
const HALF_GAP = Math.asin(CFG.gapWidth / 2 / R);
const COS_HALF_GAP = Math.cos(HALF_GAP);
const DOWN = Math.PI / 2;                  // au départ, l'ouverture est vers le bas
const PANEL_UNITS = 560;                   // largeur réservée au menu en paysage

let WORLD_W = 1080;                        // taille actuelle du monde
let WORLD_H = 1920;
let CX = 540;                              // centre du cercle
let CY = CFG.ringY;

// Le cercle tourne : angle et direction de l'ouverture, mis à jour à chaque pas
let ringAngle = 0;
let gapDirX = 0;
let gapDirY = 1;
const CAPS = [{ x: 0, y: 0 }, { x: 0, y: 0 }];   // extrémités de la paroi

function updateRingGeometry() {
  const a = DOWN + ringAngle;
  gapDirX = Math.cos(a);
  gapDirY = Math.sin(a);
  CAPS[0].x = CX + R * Math.cos(a + HALF_GAP);
  CAPS[0].y = CY + R * Math.sin(a + HALF_GAP);
  CAPS[1].x = CX + R * Math.cos(a - HALF_GAP);
  CAPS[1].y = CY + R * Math.sin(a - HALF_GAP);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));


/* ==========================================================================
   3. SONS
   - Web Audio (précis, volume réglable, même sur iPhone) si le projet est
     servi par http(s) (Live Server, GitHub Pages...).
   - Sinon, repli sur des balises <audio> en rotation.
   - Quand il y a trop de sons, le plus ancien est coupé : aucun son perdu.
   ========================================================================== */
const sound = {
  mode: 'none',          // 'webaudio' | 'html' | 'none'
  ctx: null,
  master: null,
  buffers: {},
  pools: {},
  poolIdx: {},
  active: { son1: [], son2: [] },
  last: { son1: 0, son2: 0 },
  volume: CFG.volume,
  ready: false,
  defs: {
    son1: { src: 'son1.mp3', minGapMs: 12, maxVoices: 24, poolSize: 16 }, // collisions
    son2: { src: 'son2.mp3', minGapMs: 40, maxVoices: 8, poolSize: 6 },   // multiplication
  },

  // À appeler depuis un clic (exigé par les navigateurs pour activer l'audio)
  async init() {
    if (this.ready) return;
    this.ready = true;

    const AC = window.AudioContext || window.webkitAudioContext;
    const viaFile = location.protocol === 'file:';

    if (AC && !viaFile) {
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        // Compresseur : évite la saturation quand beaucoup de sons se jouent ensemble
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp).connect(this.ctx.destination);
        this.ctx.resume();
        for (const name of Object.keys(this.defs)) {
          const res = await fetch(this.defs[name].src);
          if (!res.ok) throw new Error('fichier introuvable : ' + this.defs[name].src);
          const data = await res.arrayBuffer();
          this.buffers[name] = await new Promise((ok, ko) => this.ctx.decodeAudioData(data, ok, ko));
        }
        this.mode = 'webaudio';
        return;
      } catch (e) {
        console.warn('Web Audio indisponible, repli sur <audio> :', e);
      }
    }

    for (const name of Object.keys(this.defs)) {
      const d = this.defs[name];
      this.pools[name] = [];
      this.poolIdx[name] = 0;
      for (let i = 0; i < d.poolSize; i++) {
        const a = new Audio(d.src);
        a.preload = 'auto';
        a.muted = true;            // "déverrouillage" iOS/Safari dans le geste utilisateur
        a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
                .catch(() => { a.muted = false; });
        this.pools[name].push(a);
      }
    }
    this.mode = 'html';
  },

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  },

  play(name, vol = 1, rate = 1) {
    if (this.mode === 'none' || this.volume <= 0) return;
    const d = this.defs[name];
    const now = performance.now();
    if (now - this.last[name] < d.minGapMs) return;

    if (this.mode === 'webaudio') {
      if (!this.buffers[name]) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const list = this.active[name];
      if (list.length >= d.maxVoices) {
        const old = list.shift();
        try { old.stop(); } catch (e) { /* déjà terminé */ }
      }
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = this.buffers[name];
      src.playbackRate.value = rate;
      g.gain.value = vol / (1 + list.length * 0.05);
      src.connect(g).connect(this.master);
      list.push(src);
      src.onended = () => {
        const i = list.indexOf(src);
        if (i !== -1) list.splice(i, 1);
      };
      src.start();
    } else {
      const pool = this.pools[name];
      const a = pool[this.poolIdx[name]];
      this.poolIdx[name] = (this.poolIdx[name] + 1) % pool.length;
      try {
        a.currentTime = 0;
        a.volume = clamp(vol * this.volume, 0, 1);
        a.play().catch(() => {});
      } catch (e) { /* ignoré */ }
    }
    this.last[name] = now;
  },
};


/* ==========================================================================
   4. ÉTAT
   ========================================================================== */
let balls = [];
let running = false;
let acc = 0;
let lastTs = 0;
let lastCount = -1;

function makeBall(x, y, vx, vy, gen) {
  const hue = (200 + gen * 47) % 360;
  return {
    x, y, vx, vy, gen,
    color: CFG.colorByGeneration ? `hsl(${hue},80%,60%)` : '#ffffff',
    dead: false,
  };
}

function resetSimulation() {
  balls = [];
  acc = 0;
  ringAngle = 0;
  updateRingGeometry();
  balls.push(makeBall(CX + rnd(-140, 140), CY - R * 0.55, rnd(-250, 250), rnd(-100, 100), 0));
}


/* ==========================================================================
   5. MOTEUR PHYSIQUE
   ========================================================================== */

// ----- Grille spatiale pour les collisions boule/boule (évite le O(n²)) -----
const CELL = BR * 2;
const COLS = Math.ceil((2 * R + 6 * CELL) / CELL);
const ROWS = COLS;
let GX0 = 0;
let GY0 = 0;
const gridHead = new Int32Array(COLS * ROWS);
const gridNext = new Int32Array(CFG.maxBalls + 16);

function cellOf(v, origin) {
  return clamp(Math.floor((v - origin) / CELL), 0, COLS - 1);
}

function collideBalls() {
  const n = balls.length;
  if (n < 2) return;
  GX0 = CX - R - 3 * CELL;
  GY0 = CY - R - 3 * CELL;

  gridHead.fill(-1);
  for (let i = 0; i < n; i++) {
    const c = cellOf(balls[i].y, GY0) * COLS + cellOf(balls[i].x, GX0);
    gridNext[i] = gridHead[c];
    gridHead[c] = i;
  }

  const rr = BR * 2;
  for (let i = 0; i < n; i++) {
    const a = balls[i];
    const cx = cellOf(a.x, GX0);
    const cy = cellOf(a.y, GY0);
    for (let oy = -1; oy <= 1; oy++) {
      const yy = cy + oy;
      if (yy < 0 || yy >= ROWS) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox;
        if (xx < 0 || xx >= COLS) continue;
        for (let j = gridHead[yy * COLS + xx]; j !== -1; j = gridNext[j]) {
          if (j <= i) continue;                 // chaque paire une seule fois
          const b = balls[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = rnd(-1, 1); dy = rnd(-1, 1); d = Math.hypot(dx, dy) || 1; }
          const nx = dx / d;
          const ny = dy / d;

          // Correction de position : on sépare les deux boules à parts égales
          const push = (rr - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;

          // Choc entre masses égales (quantité de mouvement conservée)
          const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rvn < 0) {
            const imp = (-(1 + CFG.restitutionBall) * rvn) / 2;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
          }
        }
      }
    }
  }
}

// Vitesse d'un point de la paroi (le cercle tourne autour de son centre)
function wallVelX(py) { return -CFG.ringSpeed * (py - CY); }
function wallVelY(px) { return CFG.ringSpeed * (px - CX); }

// Rebond sur une extrémité arrondie de la paroi (bords de l'ouverture)
function collideCap(b, cap) {
  const dx = b.x - cap.x;
  const dy = b.y - cap.y;
  const minD = BR + CAP_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = dx / d;
  const ny = dy / d;
  b.x = cap.x + nx * minD;
  b.y = cap.y + ny * minD;
  const vn = (b.vx - wallVelX(cap.y)) * nx + (b.vy - wallVelY(cap.x)) * ny;
  if (vn < 0) {
    const e = CFG.restitutionWall;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    onImpact(-vn);
  }
}

// Rebond sur la paroi intérieure du cercle (sauf dans l'ouverture)
function collideRing(b) {
  const dx = b.x - CX;
  const dy = b.y - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6 || d >= R) return;
  if ((dx * gapDirX + dy * gapDirY) / d > COS_HALF_GAP) return; // dans l'ouverture
  if (d + BR <= R_IN) return;                                   // pas de contact

  const nx = dx / d;                                // normale vers l'extérieur
  const ny = dy / d;
  b.x = CX + nx * (R_IN - BR);                      // jamais dans la paroi
  b.y = CY + ny * (R_IN - BR);

  const px = CX + nx * R_IN;
  const py = CY + ny * R_IN;
  const vn = (b.vx - wallVelX(py)) * nx + (b.vy - wallVelY(px)) * ny;
  if (vn > 0) {
    const e = CFG.restitutionWall;
    // Réflexion de la vitesse relative selon la normale de collision
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
    if (CFG.wallFriction > 0) {
      const tx = -ny, ty = nx;
      const vt = (b.vx - wallVelX(py)) * tx + (b.vy - wallVelY(px)) * ty;
      b.vx -= vt * CFG.wallFriction * tx;
      b.vy -= vt * CFG.wallFriction * ty;
    }
    onImpact(vn);
  }
}

// Appelé à chaque vrai choc avec la paroi
function onImpact(speed) {
  if (speed >= CFG.minImpactSpeedForSound) {
    sound.play('son1', clamp(speed / 1200, 0.2, 1), rnd(0.95, 1.05));
  }
}

// Création des deux nouvelles boules après une sortie
function spawnChildren(gen) {
  const free = CFG.maxBalls - balls.length;
  const n = Math.min(2, free);
  for (let i = 0; i < n; i++) {
    const side = i === 0 ? -1 : 1;
    let x, y, vx, vy;
    if (CFG.spawnMode === 'exit') {
      const px = -gapDirY, py = gapDirX;
      const depth = R_IN - BR * 3;
      const kick = rnd(900, 1600);
      x = CX + gapDirX * depth + px * side * BR * 1.6;
      y = CY + gapDirY * depth + py * side * BR * 1.6;
      vx = -gapDirX * kick + px * side * rnd(150, 500);
      vy = -gapDirY * kick + py * side * rnd(150, 500);
    } else {
      x = CX + side * rnd(R * 0.1, R * 0.35);
      y = CY - R * 0.5 + rnd(-40, 40);
      vx = side * rnd(120, 400);
      vy = rnd(-200, 200);
    }
    balls.push(makeBall(x, y, vx, vy, gen + 1));
  }
}

// Un pas de physique à durée fixe
function step(dt) {
  // 0) Le cercle tourne : on met à jour l'ouverture avant tout calcul
  ringAngle = (ringAngle + CFG.ringSpeed * dt) % TAU;
  updateRingGeometry();

  const g = CFG.gravity;
  const drag = 1 - CFG.airDrag * dt;
  const vmax = CFG.maxSpeed;

  // 1) Intégration : gravité, déplacement
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    b.vy += g * dt;
    if (drag !== 1) { b.vx *= drag; b.vy *= drag; }
    const v2 = b.vx * b.vx + b.vy * b.vy;
    if (v2 > vmax * vmax) {
      const k = vmax / Math.sqrt(v2);
      b.vx *= k; b.vy *= k;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // 2) Collisions entre boules
  if (CFG.collisionsBetweenBalls) collideBalls();

  // 3) Collisions avec la paroi, puis détection de la sortie
  let exits = null;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    const dx = b.x - CX;
    const dy = b.y - CY;
    const d = Math.sqrt(dx * dx + dy * dy);

    // Sortie complète du cercle : multiplication (une seule fois par boule)
    if (!b.dead && d - BR > R + CAP_R && dx * gapDirX + dy * gapDirY > 0) {
      b.dead = true;
      (exits || (exits = [])).push(b);
      continue;
    }
    collideCap(b, CAPS[0]);
    collideCap(b, CAPS[1]);
    collideRing(b);
  }

  // 4) Traitement des sorties
  if (exits) {
    balls = balls.filter((b) => !b.dead);
    for (const b of exits) {
      sound.play('son2', 1, rnd(0.97, 1.03));
      spawnChildren(b.gen);
    }
  }
}


/* ==========================================================================
   6. RENDU (boules unies, sans effet)
   ========================================================================== */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const hint = document.getElementById('hint');
let scale = 1;
let ringCache = null;
const RING_BOX = 2 * (R + 60);                   // carré qui contient le cercle et son halo

// Le cercle est dessiné une fois dans un petit canvas caché, puis simplement tourné
function buildRingCache() {
  ringCache = document.createElement('canvas');
  ringCache.width = Math.ceil(RING_BOX * scale);
  ringCache.height = Math.ceil(RING_BOX * scale);
  const c = ringCache.getContext('2d');
  c.setTransform(scale, 0, 0, scale, (RING_BOX / 2) * scale, (RING_BOX / 2) * scale);
  c.lineCap = 'round';

  const a0 = DOWN + HALF_GAP;
  const a1 = DOWN - HALF_GAP + TAU;

  // Halo blanc discret
  c.save();
  c.shadowColor = 'rgba(255,255,255,0.6)';
  c.shadowBlur = 22 * scale;
  c.strokeStyle = 'rgba(255,255,255,0.45)';
  c.lineWidth = T;
  c.beginPath();
  c.arc(0, 0, R, a0, a1, false);
  c.stroke();
  c.restore();

  // Trait net
  c.strokeStyle = '#ffffff';
  c.lineWidth = T;
  c.beginPath();
  c.arc(0, 0, R, a0, a1, false);
  c.stroke();
}

// Choisit la taille du monde selon l'orientation et adapte le canvas
function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const landscape = vw > vh;

  let w, h, worldW, worldH;
  if (landscape) {                       // paysage : plein écran, monde de 1080 de haut
    w = vw; h = vh;
    worldH = 1080;
    worldW = Math.round(1080 * vw / vh);
  } else {                               // portrait : format 9:16 centré
    w = Math.floor(Math.min(vw, (vh * 9) / 16));
    h = Math.floor((w * 16) / 9);
    worldW = 1080; worldH = 1920;
  }

  // Nouveau centre du cercle ; les boules suivent le déplacement
  const oldCX = CX, oldCY = CY;
  WORLD_W = worldW; WORLD_H = worldH;
  if (landscape) {
    CX = Math.min(WORLD_W / 2, WORLD_W - PANEL_UNITS - R - 20);
    CY = WORLD_H / 2;
  } else {
    CX = WORLD_W / 2;
    CY = CFG.ringY;
  }
  for (const b of balls) { b.x += CX - oldCX; b.y += CY - oldCY; }
  updateRingGeometry();

  const unit = w / worldW;               // pixels CSS par unité du monde
  stage.classList.toggle('landscape', landscape);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  stage.style.fontSize = unit * 40 + 'px';  // 1em = 40 unités du monde
  hint.style.left = (CX / WORLD_W) * 100 + '%';
  hint.style.top = (CY / WORLD_H) * 100 + '%';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  scale = canvas.width / WORLD_W;
  buildRingCache();
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Cercle tournant
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.translate(CX, CY);
  ctx.rotate(ringAngle);
  ctx.drawImage(ringCache, -RING_BOX / 2, -RING_BOX / 2, RING_BOX, RING_BOX);

  // Boules : simples disques de couleur
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const b of balls) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BR, 0, TAU);
    ctx.fill();
  }
}


/* ==========================================================================
   7. BOUCLE PRINCIPALE (pas de temps fixe + accumulateur)
   ========================================================================== */
const countEl = document.getElementById('count');
const countLabelEl = document.getElementById('count-label');

function updateHud() {
  const n = balls.length;
  if (n === lastCount) return;
  lastCount = n;
  countEl.textContent = n;
  countLabelEl.textContent = n > 1 ? 'boules' : 'boule';
}

function frame(ts) {
  requestAnimationFrame(frame);
  const frameDt = Math.min((ts - lastTs) / 1000 || 0, 0.1);
  lastTs = ts;

  if (running) {
    acc = Math.min(acc + frameDt * CFG.speed, 0.1);
    let steps = 0;
    while (acc >= CFG.physicsStep && steps < CFG.maxStepsPerFrame) {
      step(CFG.physicsStep);
      acc -= CFG.physicsStep;
      steps++;
    }
    if (steps === CFG.maxStepsPerFrame) acc = 0;
  }

  render();
  updateHud();
}


/* ==========================================================================
   8. INTERFACE
   ========================================================================== */
const $ = (id) => document.getElementById(id);

function setState(state) {                 // 'idle' | 'running' | 'paused'
  stage.dataset.state = state;
}

async function start() {
  await sound.init();                      // active l'audio (geste utilisateur)
  running = true;
  setState('running');
  hint.classList.add('hidden');
}

$('btn-start').addEventListener('click', start);
$('btn-pause').addEventListener('click', () => {
  if (!running) return;
  running = false;
  setState('paused');
});
$('btn-reset').addEventListener('click', async () => {
  resetSimulation();
  await start();
});
$('btn-toggle').addEventListener('click', () => {
  const collapsed = $('sliders').classList.toggle('collapsed');
  $('btn-toggle').setAttribute('aria-expanded', String(!collapsed));
});

// Curseurs : la partie remplie du curseur suit la valeur (variable CSS --p)
function bindSlider(id, outId, format, apply) {
  const input = $(id);
  const out = $(outId);
  const update = () => {
    const v = Number(input.value);
    input.style.setProperty('--p', ((v - input.min) / (input.max - input.min)) * 100 + '%');
    out.textContent = format(v);
    apply(v);
  };
  input.addEventListener('input', update);
  update();
}

bindSlider('gravity', 'gravity-out', (v) => v, (v) => { CFG.gravity = v; });
bindSlider('speed', 'speed-out', (v) => v.toFixed(2) + '×', (v) => { CFG.speed = v; });
bindSlider('volume', 'volume-out', (v) => Math.round(v * 100) + '%', (v) => { CFG.volume = v; sound.setVolume(v); });

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));

// Démarrage de la page
setState('idle');
resize();
resetSimulation();
requestAnimationFrame(frame);
