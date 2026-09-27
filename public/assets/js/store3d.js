// ============================================================================
// Toko 3D (Three.js) — terinspirasi gambar referensi toko Interport:
// ruangan isometrik, green wall + logo, bar counter & stool, rak baju, meja
// tengah, rak mainan, pantry + kulkas, lampu gantung, tanaman.
// Setiap "zona" terhubung ke kategori (kolom categories.zone) dan isinya
// mengikuti jumlah barang tersedia dari database.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { createPeople } from './store3d-people.js';

export const ZONES = {
  bar_counter: 'Bar counter (dinding hijau)',
  table_center: 'Meja tengah',
  rack_left: 'Rak baju kiri',
  rack_back: 'Rak baju belakang',
  rack_front: 'Rak depan',
  rack_side: 'Rak samping',
  shelf_toys: 'Rak mainan',
  kitchen: 'Pantry / kitchen',
  sign_board: 'Papan tulis',
  floor_corner: 'Pojok lantai'
};

const W = 12, D = 10, H = 3.2;           // ukuran ruangan (x, z, tinggi)
// Papan logo di green wall: rasio 2,4 : 1 mengikuti logo Interport (horizontal, ± 2,8 : 1)
// dengan bantalan putih di sekelilingnya.
const LOGO = { w: 2.4, h: 1.0, x: -W / 2 + 0.15, y: 2.05, z: 1.1 };
function addLogo(scene, url) {
  if (!url) return;
  const PX = 1000;                                   // lebar elemen dalam px -> 1 px = LOGO.w / PX meter
  const el = document.createElement('div');
  el.className = 's3d-logo';
  el.style.width = PX + 'px';
  el.style.height = Math.round(PX * LOGO.h / LOGO.w) + 'px';
  const img = document.createElement('img');
  img.alt = 'Interport';
  img.decoding = 'async';
  img.onload = () => el.classList.add('ready');
  img.onerror = () => el.remove();                   // gagal -> teks cadangan di WebGL tetap tampil
  img.src = url;
  el.appendChild(img);
  const obj = new CSS3DObject(el);
  obj.position.set(LOGO.x + 0.012, LOGO.y, LOGO.z);
  obj.rotation.y = Math.PI / 2;
  obj.scale.setScalar(LOGO.w / PX);
  scene.add(obj);
}

const HOME = { pos: new THREE.Vector3(13, 11.2, 13), target: new THREE.Vector3(0, 0.9, 0) };

export function createStore3D(container, { settings = {}, categories = [], products = [], onSelect, logoUrl = '' } = {}) {
  // ---------- renderer, scene, kamera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.prepend(renderer.domElement);
  // Lapisan CSS3D: logo Interport dipasang sebagai <img> biasa yang diproyeksikan 3D,
  // sehingga URL logo dari domain mana pun bisa dipakai tanpa syarat CORS WebGL.
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.className = 's3d-css';
  renderer.domElement.after(cssRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 34;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.28;
  controls.minAzimuthAngle = 0.05;         // kamera selalu di sisi terbuka ruangan
  controls.maxAzimuthAngle = Math.PI / 2 - 0.05;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.update();

  // ---------- cahaya ----------
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a7a66, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(9, 16, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);

  // ---------- material & tekstur ----------
  const M = materials(settings);
  const zones = {};                        // name -> { group, dynamic, hit, anchor, label, ring }
  const pickables = [];

  const root = new THREE.Group();
  scene.add(root);
  buildRoom(root, M, settings);
  buildStaticDecor(root, M);
  buildZones();
  addLogo(scene, logoUrl);

  // ---------- data dinamis ----------
  let cats = categories, prods = products, latestStats = {};
  function zoneStats() {
    const stats = {};
    Object.keys(ZONES).forEach((z) => (stats[z] = { cats: [], available: 0, total: 0, items: [] }));
    cats.forEach((c) => { if (c.zone && stats[c.zone]) stats[c.zone].cats.push(c); });
    prods.forEach((p) => {
      const c = cats.find((x) => x.id === p.category_id);
      if (!c || !stats[c.zone]) return;
      stats[c.zone].total++;
      if (p.stock > 0) { stats[c.zone].available++; stats[c.zone].items.push(p); }
    });
    return stats;
  }

  function populate() {
    const stats = zoneStats();
    latestStats = stats;
    Object.entries(zones).forEach(([name, z]) => {
      z.dynamic.clear();
      const st = stats[name];
      z.stats = st;
      const n = st.available;
      FILLERS[name]?.(z.dynamic, M, st.cats.length ? Math.max(n, 1) : 0, n === 0);
      // label melayang
      if (z.label) { z.group.remove(z.label); z.label.material.map.dispose(); z.label.material.dispose(); }
      if (st.cats.length) {
        const text = st.cats.length === 1 ? `${st.cats[0].icon || ''} ${st.cats[0].name}` : st.cats.map((c) => c.icon || c.name).join(' ') + ' ' + st.cats.map((c) => c.name).join(' / ');
        z.label = labelSprite(text.trim(), `${n} tersedia`);
        z.label.position.copy(z.anchor);
        z.group.add(z.label);
      } else z.label = null;
    });
  }
  populate();

  // ---------- interaksi: hover, klik ----------
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tip = document.createElement('div');
  tip.className = 'store3d-tip';
  tip.hidden = true;
  container.appendChild(tip);
  let hovered = null, downAt = null;

  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? { zone: hit.object.userData.zone, x: ev.clientX - r.left, y: ev.clientY - r.top } : null;
  }
  function setHover(name) {
    if (hovered === name) return;
    hovered = name;
    renderer.domElement.style.cursor = name ? 'pointer' : '';
  }
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const h = pick(ev);
    const z = h && zones[h.zone];
    if (!z || !z.stats?.cats.length) { setHover(null); tip.hidden = true; return; }
    setHover(h.zone);
    tip.hidden = false;
    tip.style.left = h.x + 'px';
    tip.style.top = h.y + 'px';
    tip.innerHTML = `${escapeHtml(z.stats.cats.map((c) => `${c.icon || ''} ${c.name}`).join(', '))}<small>${z.stats.available} tersedia · klik untuk lihat</small>`;
  });
  renderer.domElement.addEventListener('pointerleave', () => { setHover(null); tip.hidden = true; });
  renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return;  // drag, bukan klik
    const h = pick(ev);
    const z = h && zones[h.zone];
    if (z?.stats?.cats.length) {
      focusZone(h.zone);
      onSelect?.(z.stats.cats.map((c) => c.id));
    }
  });

  // ---------- animasi kamera ----------
  let tween = null;
  function flyTo(pos, target, ms = 900) {
    tween = { from: camera.position.clone(), fromT: controls.target.clone(), to: pos.clone(), toT: target.clone(), t0: performance.now(), ms };
  }
  function focusZone(name) {
    const z = zones[name];
    if (!z) return;
    const t = z.anchorWorld.clone(); t.y = 0.9;
    const dir = HOME.pos.clone().sub(HOME.target).normalize();
    flyTo(t.clone().add(dir.multiplyScalar(13)), t);
  }

  // ---------- loop render (hanya saat terlihat) ----------
  let visible = true, raf = 0;
  const clock = new THREE.Timer();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) loop(); }, { threshold: 0.01 });
  io.observe(container);

  function resize() {
    const w = container.clientWidth || 800, h = container.clientHeight || 450;
    renderer.setSize(w, h, false);
    cssRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 1.1 ? 42 : 30;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function loop() {
    raf = 0;
    if (!visible || document.hidden) return;
    clock.update(); const t = clock.getElapsed(); const dt = clock.getDelta();
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / tween.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(tween.from, tween.to, e);
      controls.target.lerpVectors(tween.fromT, tween.toT, e);
      if (k >= 1) tween = null;
    }
    Object.entries(zones).forEach(([name, z]) => {
      const on = name === hovered;
      z.ring.material.opacity += ((on ? 0.55 : 0) - z.ring.material.opacity) * 0.15;
      if (z.label) z.label.position.y = z.anchor.y + Math.sin(t * 1.6 + z.anchor.x) * 0.06 + (on ? 0.15 : 0);
    });
    people?.update(dt, t);
    controls.update();
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) loop(); });
  // animasi penjual & pembeli (dimatikan jika admin set enable_3d_people = 0 atau pengguna memilih reduced motion)
  const people = String(settings.enable_3d_people ?? '1') !== '0' && !matchMedia('(prefers-reduced-motion: reduce)').matches
    ? createPeople({ root, camera, container, getStats: () => latestStats, getCategories: () => cats })
    : null;
  loop();

  // ---------- zona ----------
  function buildZones() {
    const defs = {
      rack_left: { pos: [-2.4, 0, 1.6], rotY: 0, hit: [3.0, 2.0, 0.9], anchor: [-2.4, 2.55, 1.6], ring: 1.9 },
      rack_back: { pos: [0.4, 0, -2.9], rotY: 0, hit: [2.6, 2.0, 0.9], anchor: [0.4, 2.55, -2.9], ring: 1.7 },
      rack_front: { pos: [1.0, 0, 3.4], rotY: 0, hit: [2.4, 2.0, 0.9], anchor: [1.0, 2.5, 3.4], ring: 1.6 },
      rack_side: { pos: [4.6, 0, 1.2], rotY: Math.PI / 2, hit: [1.8, 2.0, 0.8], anchor: [4.6, 2.5, 1.2], ring: 1.3 },
      table_center: { pos: [0.6, 0, 0.6], rotY: 0, hit: [2.6, 1.3, 1.6], anchor: [0.6, 2.0, 0.6], ring: 1.9 },
      shelf_toys: { pos: [3.3, 0, -1.0], rotY: -Math.PI / 2, hit: [2.2, 1.6, 0.7], anchor: [3.3, 2.3, -1.0], ring: 1.5 },
      kitchen: { pos: [0.9, 0, -4.55], rotY: 0, hit: [4.6, 2.9, 0.9], anchor: [0.9, 3.4, -4.3], ring: 2.4 },
      bar_counter: { pos: [-5.25, 0, 0.8], rotY: Math.PI / 2, hit: [5.0, 1.4, 1.6], anchor: [-4.7, 1.9, -0.9], ring: 2.6 },
      sign_board: { pos: [2.3, 0, -2.2], rotY: -0.5, hit: [1.0, 1.7, 0.6], anchor: [2.3, 2.3, -2.2], ring: 0.8 },
      floor_corner: { pos: [4.4, 0, 3.6], rotY: -0.8, hit: [1.6, 1.4, 1.2], anchor: [4.4, 1.9, 3.6], ring: 1.2 }
    };
    Object.entries(defs).forEach(([name, d]) => {
      const group = new THREE.Group();
      group.position.set(...d.pos);
      group.rotation.y = d.rotY;
      root.add(group);
      const body = new THREE.Group();     // perabot statis zona
      const dynamic = new THREE.Group();  // isi yang mengikuti data
      group.add(body, dynamic);
      STRUCTURES[name]?.(body, M, settings);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(...d.hit), new THREE.MeshBasicMaterial());
      hit.position.y = d.hit[1] / 2;
      hit.visible = false;
      hit.userData.zone = name;
      group.add(hit);
      pickables.push(hit);
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.ring * 0.82, d.ring, 48),
        new THREE.MeshBasicMaterial({ color: 0x2eb59d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.pos[0], 0.03, d.pos[2]);
      root.add(ring);
      // anchor dalam koordinat lokal grup
      const anchorWorld = new THREE.Vector3(...d.anchor);
      group.updateMatrixWorld(true);
      const anchor = group.worldToLocal(anchorWorld.clone());
      zones[name] = { group, body, dynamic, hit, ring, anchor, anchorWorld };
    });
  }

  return {
    update(newCats, newProds) { cats = newCats; prods = newProds; populate(); },
    reset() { flyTo(HOME.pos, HOME.target); },
    focusCategory(id) {
      const c = cats.find((x) => x.id === id);
      if (c?.zone && zones[c.zone]) {
        focusZone(c.zone);
        hovered = c.zone;
        setTimeout(() => { if (hovered === c.zone) hovered = null; }, 1800);
      }
    },
    dispose() { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); people?.dispose(); renderer.dispose(); renderer.domElement.remove(); cssRenderer.domElement.remove(); tip.remove(); }
  };
}

// ============================================================================
// Material & tekstur prosedural (canvas) — tanpa file gambar eksternal
// ============================================================================
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function rand(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function materials(settings) {
  const r = rand(7);
  const floorTex = canvasTex(1024, 1024, (g, w, h) => {
    const rows = 8;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 300;
      while (x < w) {
        const len = 260 + r() * 260;
        const tone = 150 + r() * 40;
        g.fillStyle = `rgb(${tone + 45},${tone - 5},${tone - 60})`;
        g.fillRect(x, (i * h) / rows, len, h / rows);
        for (let k = 0; k < 14; k++) {             // serat kayu
          g.strokeStyle = `rgba(90,55,25,${0.05 + r() * 0.08})`;
          g.beginPath();
          const yy = (i * h) / rows + r() * (h / rows);
          g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len, yy);
          g.stroke();
        }
        g.fillStyle = 'rgba(60,35,15,.35)';
        g.fillRect(x, (i * h) / rows, 2, h / rows);
        x += len;
      }
      g.fillStyle = 'rgba(60,35,15,.3)';
      g.fillRect(0, (i * h) / rows, w, 2);
    }
  }, [2.2, 2.2]);

  const slatTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a5a34'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = x % 32 ? '#a06a3e' : '#94613a'; g.fillRect(x, 0, 11, h); g.fillStyle = 'rgba(40,20,5,.45)'; g.fillRect(x + 11, 0, 5, h); }
  }, [3, 1]);

  const leafTex = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#1f4d1d'; g.fillRect(0, 0, w, h);
    const greens = ['#2f6d25', '#3f8a2c', '#4f9e33', '#5fae3b', '#2b5e22', '#78c04a', '#6a9f2f'];
    for (let i = 0; i < 2600; i++) {
      const x = r() * w, y = r() * h;
      const brown = x > w * 0.68 && x < w * 0.84 && r() > 0.15;
      g.fillStyle = brown ? ['#6b2e1e', '#8a3b22', '#5a2a1b', '#a0522d'][Math.floor(r() * 4)] : greens[Math.floor(r() * greens.length)];
      g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
      g.beginPath(); g.ellipse(0, 0, 7 + r() * 9, 3 + r() * 4, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  });

  const logoTex = canvasTex(1200, 500, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.lineWidth = 22; g.lineCap = 'round';
    const wave = (color, off) => { g.strokeStyle = color; g.beginPath(); for (let x = 0; x <= 360; x += 6) { const y = 170 + Math.sin((x / 360) * Math.PI * 2 + off) * 38 - x * 0.12; x === 0 ? g.moveTo(420 + x, y) : g.lineTo(420 + x, y); } g.stroke(); };
    wave('#1f9d55', 0); wave('#1d4ed8', 1.2);
    g.fillStyle = '#1d4ed8';
    g.font = '800 150px "Plus Jakarta Sans", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(settings.logo_text || 'interport', w / 2, 340);
  });

  const signTex = canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6b4a2b'; g.lineWidth = 26; g.strokeRect(0, 0, w, h);
    g.fillStyle = '#f5f5f0';
    g.font = 'italic 700 70px "Plus Jakarta Sans", sans-serif';
    g.textAlign = 'center';
    const lines = String(settings.sign_text || 'Good Items\nBrighter Stories').split(/\n|\\n/).flatMap((l) => l.split(' ')).slice(0, 6);
    lines.forEach((l, i) => g.fillText(l, w / 2, 140 + i * 100));
  });

  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });
  return {
    floor: std(0xffffff, { map: floorTex, roughness: 0.6 }),
    slab: std(0x4b5563, { roughness: 0.9 }),
    wallOuter: std(0x4b5563, { roughness: 0.9 }),
    wallInner: std(0xf3efe8),
    slat: std(0xffffff, { map: slatTex }),
    leaves: std(0xffffff, { map: leafTex, roughness: 0.95 }),
    logo: new THREE.MeshBasicMaterial({ map: logoTex, toneMapped: false }),
    sign: std(0xffffff, { map: signTex }),
    wood: std(0xb8844f, { roughness: 0.55 }),
    woodDark: std(0x7a4f2c),
    white: std(0xf7f5f0, { roughness: 0.5 }),
    counter: std(0xffffff, { roughness: 0.25 }),
    black: std(0x1c1f24, { roughness: 0.45, metalness: 0.4 }),
    metal: std(0x9aa3ad, { roughness: 0.25, metalness: 0.85 }),
    steel: std(0xb9c0c7, { roughness: 0.2, metalness: 0.9 }),
    seat: std(0x55595f, { roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe3f0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0, transmission: 0 }),
    pot: std(0xe7e3dc, { roughness: 0.9 }),
    plant: std(0x2f7d32, { roughness: 0.8, side: THREE.DoubleSide }),
    plant2: std(0x4c9a3a, { roughness: 0.8, side: THREE.DoubleSide }),
    rug: std(0xd9d6cf, { roughness: 1 }),
    led: new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false }),
    amber: std(0x9a5a1c, { roughness: 0.2, transparent: true, opacity: 0.9 }),
    jar: std(0xd9c7a3, { roughness: 0.3 }),
    grey: std(0xb8bcc2),
    cloth: (c) => std(c, { roughness: 0.95 })
  };
}

// ============================================================================
// Primitif
// ============================================================================
function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(parent, rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function sphere(parent, r, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(x, y, z); m.castShadow = true;
  parent.add(m);
  return m;
}
function rod(parent, a, b, r, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Siluet baju (kaos / hoodie / celana) sebagai extrude tipis
const SHAPES = {};
function garmentGeo(kind) {
  if (SHAPES[kind]) return SHAPES[kind];
  const s = new THREE.Shape();
  if (kind === 'pants') {
    s.moveTo(-0.22, 0); s.lineTo(0.22, 0); s.lineTo(0.26, -0.95); s.lineTo(0.05, -0.95); s.lineTo(0, -0.3);
    s.lineTo(-0.05, -0.95); s.lineTo(-0.26, -0.95); s.lineTo(-0.22, 0);
  } else {
    const L = kind === 'hoodie' ? 0.82 : 0.66;
    s.moveTo(-0.1, 0); s.lineTo(-0.22, -0.02); s.lineTo(-0.42, -0.18); s.lineTo(-0.33, -0.32); s.lineTo(-0.24, -0.24);
    s.lineTo(-0.24, -L); s.lineTo(0.24, -L); s.lineTo(0.24, -0.24); s.lineTo(0.33, -0.32); s.lineTo(0.42, -0.18);
    s.lineTo(0.22, -0.02); s.lineTo(0.1, 0); s.quadraticCurveTo(0, -0.08, -0.1, 0);
  }
  SHAPES[kind] = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
  SHAPES[kind].translate(0, 0, -0.025);
  return SHAPES[kind];
}

function labelSprite(title, sub) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '800 44px "Plus Jakarta Sans", sans-serif';
  g.font = font;
  const w = Math.min(1000, Math.max(g.measureText(title).width, 260) + 60), h = 124;
  c.width = w; c.height = h;
  g.fillStyle = 'rgba(18,60,86,.94)';
  const r = 26;
  g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
  g.fillStyle = '#fff'; g.font = font; g.textBaseline = 'top'; g.fillText(title, 30, 14, w - 60);
  g.fillStyle = '#a5e9d4'; g.font = '700 32px "Plus Jakarta Sans", sans-serif'; g.fillText(sub, 30, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 10;
  const scale = 0.0056;
  sp.scale.set(w * scale, h * scale, 1);
  return sp;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// ============================================================================
// Ruangan
// ============================================================================
function buildRoom(root, M, settings) {
  // lantai + slab gelap
  box(root, W + 0.6, 0.35, D + 0.6, M.slab, 0, -0.2, 0, false);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // dinding kiri (x = -W/2) & belakang (z = -D/2) — tebal dengan sisi luar gelap
  const t = 0.3;
  box(root, t, H + 0.2, D + 0.6, M.wallOuter, -W / 2 - t / 2, H / 2 - 0.1, 0);
  box(root, W + 0.6, H + 0.2, t, M.wallOuter, 0, H / 2 - 0.1, -D / 2 - t / 2);
  const innerL = new THREE.Mesh(new THREE.PlaneGeometry(D, H), M.wallInner);
  innerL.rotation.y = Math.PI / 2; innerL.position.set(-W / 2 + 0.01, H / 2, 0); innerL.receiveShadow = true; root.add(innerL);
  const innerB = new THREE.Mesh(new THREE.PlaneGeometry(W, H), M.wallInner);
  innerB.position.set(0, H / 2, -D / 2 + 0.01); innerB.receiveShadow = true; root.add(innerB);

  // plafon tipis (lis atas) + strip LED hangat
  box(root, 0.5, 0.18, D, M.white, -W / 2 + 0.25, H - 0.09, 0, false);
  box(root, W, 0.18, 0.5, M.white, 0, H - 0.09, -D / 2 + 0.25, false);
  box(root, 0.04, 0.03, D - 0.2, M.led, -W / 2 + 0.52, H - 0.2, 0, false);
  box(root, W - 0.2, 0.03, 0.04, M.led, 0, H - 0.2, -D / 2 + 0.52, false);
  [[-W / 2 + 0.25, -3], [-W / 2 + 0.25, 0], [-W / 2 + 0.25, 3], [-3, -D / 2 + 0.25], [0.5, -D / 2 + 0.25], [4, -D / 2 + 0.25]].forEach(([x, z]) => {
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), M.lampGlow);
    spot.rotation.x = Math.PI / 2; spot.position.set(x, H - 0.185, z); root.add(spot);
  });

  // panel kayu slat
  const slat = (x, z, w, rotY) => { const m = box(root, w, H - 0.2, 0.06, M.slat, x, (H - 0.2) / 2, z, false); m.rotation.y = rotY; };
  slat(-W / 2 + 0.04, 4.35, 1.2, Math.PI / 2);
  slat(-W / 2 + 0.04, -4.45, 1.0, Math.PI / 2);
  slat(-4.9, -D / 2 + 0.04, 1.8, 0);

  // green wall + papan logo
  const green = new THREE.Mesh(new THREE.BoxGeometry(0.12, H - 0.35, 5.6), [M.leaves, M.leaves, M.leaves, M.leaves, M.leaves, M.leaves]);
  green.position.set(-W / 2 + 0.07, (H - 0.35) / 2 + 0.02, 0.9);
  green.receiveShadow = true;
  root.add(green);
  // papan logo: teks cadangan di WebGL, ditimpa <img> logo asli lewat CSS3D (lihat addLogo)
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(LOGO.w, LOGO.h), M.logo);
  logo.rotation.y = Math.PI / 2;
  logo.position.set(LOGO.x, LOGO.y, LOGO.z);
  root.add(logo);
  const frame = box(root, 0.04, LOGO.h + 0.08, LOGO.w + 0.08, M.woodDark, LOGO.x - 0.03, LOGO.y, LOGO.z, false);
  frame.castShadow = false;
  // lampu sorot kecil di atas green wall
  for (let i = 0; i < 5; i++) {
    const z = -1.5 + i * 1.2;
    cyl(root, 0.05, 0.07, 0.16, M.black, -W / 2 + 0.35, H - 0.35, z);
  }

  // pintu kaca (dinding kiri, dekat sudut)
  const gx = -W / 2 + 0.05;
  box(root, 0.08, H - 0.2, 0.06, M.black, gx, (H - 0.2) / 2, -1.95);
  box(root, 0.08, H - 0.2, 0.06, M.black, gx, (H - 0.2) / 2, -3.05);
  box(root, 0.08, H - 0.2, 0.06, M.black, gx, (H - 0.2) / 2, -3.9);
  box(root, 0.08, 0.08, 2.0, M.black, gx, H - 0.24, -2.95);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, H - 0.3), M.glass);
  glass.rotation.y = Math.PI / 2; glass.position.set(gx + 0.02, (H - 0.3) / 2, -2.93); root.add(glass);
  rod(root, [gx + 0.12, 1.0, -2.9], [gx + 0.12, 1.8, -2.9], 0.02, M.metal);
  rod(root, [gx + 0.12, 1.0, -3.2], [gx + 0.12, 1.8, -3.2], 0.02, M.metal);

  // lampu gantung
  [[-0.1, 0.6], [2.4, -2.6]].forEach(([x, z]) => {
    rod(root, [x, H, z], [x, H - 0.9, z], 0.01, M.black);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.34, 28, 1, true), M.black);
    shade.material = M.black; shade.position.set(x, H - 1.05, z); shade.castShadow = true; root.add(shade);
    const bulb = sphere(root, 0.1, M.lampGlow, x, H - 1.2, z); bulb.castShadow = false;
    const pl = new THREE.PointLight(0xffd9a0, 6, 6, 1.6);
    pl.position.set(x, H - 1.3, z); root.add(pl);
  });

  // karpet
  const rug = box(root, 5.2, 0.02, 4.2, M.rug, 1.2, 0.012, 0.8, false);
  rug.castShadow = false;
}

function plant(parent, x, z, scale = 1, potH = 0.55) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.scale.setScalar(scale);
  cyl(g, 0.3, 0.24, potH, parent.userData?.potMat || MPOT, 0, potH / 2, 0);
  const r = rand(Math.floor(x * 100 + z * 7) + 99);
  for (let i = 0; i < 16; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), i % 2 ? MPLANT : MPLANT2);
    leaf.scale.set(0.35, 0.08, 1);
    const a = (i / 16) * Math.PI * 2 + r();
    const tilt = 0.5 + r() * 0.6;
    leaf.position.set(Math.cos(a) * 0.22, potH + 0.3 + r() * 0.5, Math.sin(a) * 0.22);
    leaf.rotation.set(tilt * Math.sin(a), -a + Math.PI / 2, tilt);
    leaf.castShadow = true;
    g.add(leaf);
  }
  parent.add(g);
  return g;
}
let MPOT, MPLANT, MPLANT2;

function buildStaticDecor(root, M) {
  MPOT = M.pot; MPLANT = M.plant; MPLANT2 = M.plant2;
  plant(root, -4.9, 4.4, 1.25);
  plant(root, -1.9, 4.3, 1.0, 0.5);
  plant(root, -3.9, -4.2, 1.35, 0.6);
  plant(root, 3.9, -4.55, 0.55, 0.25).position.y = 0.95;        // tanaman di counter pantry
}

// ============================================================================
// Struktur statis tiap zona (lokal terhadap posisi zona)
// ============================================================================
function clothingRack(g, M, width = 2.4) {
  const hw = width / 2, h = 1.75;
  [-hw, hw].forEach((x) => {
    rod(g, [x, 0.05, -0.3], [x, h, 0], 0.025, M.black);
    rod(g, [x, 0.05, 0.3], [x, h, 0], 0.025, M.black);
    rod(g, [x, 0.05, -0.35], [x, 0.05, 0.35], 0.03, M.black);
  });
  rod(g, [-hw, h, 0], [hw, h, 0], 0.025, M.metal);
  box(g, width, 0.03, 0.55, M.woodDark, 0, 0.2, 0);
}

const STRUCTURES = {
  rack_left: (g, M) => clothingRack(g, M, 2.6),
  rack_back: (g, M) => clothingRack(g, M, 2.2),
  rack_front: (g, M) => clothingRack(g, M, 2.0),
  rack_side: (g, M) => clothingRack(g, M, 1.5),
  table_center: (g, M) => {
    box(g, 2.4, 0.08, 1.4, M.wood, 0, 0.92, 0);
    [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]].forEach(([x, z]) => box(g, 0.06, 0.9, 0.06, M.black, x, 0.45, z));
    box(g, 2.3, 0.04, 1.3, M.woodDark, 0, 0.35, 0);
    [-0.6, 0.6].forEach((x) => box(g, 0.5, 0.3, 0.5, M.grey, x, 0.52, -0.2));    // kotak penyimpanan
  },
  shelf_toys: (g, M) => {
    const w = 2.0;
    [0.05, 0.55, 1.05, 1.5].forEach((y) => box(g, w, 0.05, 0.5, M.wood, 0, y, 0));
    [-w / 2, w / 2].forEach((x) => box(g, 0.05, 1.55, 0.5, M.black, x, 0.78, 0));
    [-0.5, 0.2, 0.8].forEach((x) => box(g, 0.45, 0.35, 0.4, M.woodDark, x, 0.25, 0.03));   // keranjang bawah
  },
  kitchen: (g, M) => {
    box(g, 4.4, 0.9, 0.7, M.white, 0, 0.45, 0);
    box(g, 4.5, 0.06, 0.74, M.counter, 0, 0.93, 0.01);
    for (let i = 0; i < 6; i++) box(g, 0.02, 0.8, 0.01, M.grey, -2.2 + i * 0.73 + 0.36, 0.45, 0.36, false);
    box(g, 4.4, 0.95, 0.4, M.white, 0, 2.45, -0.15);                   // kabinet atas
    box(g, 1.5, 0.45, 0.36, M.wood, -0.3, 1.72, -0.16);                // rak terbuka
    for (let i = 0; i < 4; i++) cyl(g, 0.06, 0.05, 0.12, M.white, -0.8 + i * 0.3, 1.58, -0.1);
    const fr = new THREE.Group(); fr.position.set(3.1, 0, -0.02); g.add(fr);       // kulkas
    box(fr, 0.95, 2.1, 0.75, M.steel, 0, 1.05, 0);
    box(fr, 0.02, 1.2, 0.03, M.black, -0.28, 1.35, 0.39);
    box(fr, 0.02, 0.5, 0.03, M.black, -0.28, 0.45, 0.39);
    box(fr, 0.94, 0.02, 0.01, M.black, 0, 0.78, 0.38, false);
    box(g, 0.4, 0.5, 0.35, M.black, 1.9, 1.21, 0);                      // mesin kopi
    box(g, 0.3, 0.12, 0.2, M.metal, 1.9, 1.04, 0.1);
  },
  bar_counter: (g, M) => {
    box(g, 4.6, 0.07, 0.6, M.wood, 0, 1.08, 0.05);
    [-2.1, -0.7, 0.7, 2.1].forEach((x) => { box(g, 0.05, 1.05, 0.05, M.black, x, 0.52, 0.28); box(g, 0.05, 1.05, 0.05, M.black, x, 0.52, -0.2); });
    [-1.65, -0.55, 0.55, 1.65].forEach((x) => {                         // stool
      const s = new THREE.Group(); s.position.set(x, 0, 0.95); g.add(s);
      cyl(s, 0.22, 0.24, 0.02, M.metal, 0, 0.01, 0, 24);
      cyl(s, 0.03, 0.03, 0.72, M.metal, 0, 0.37, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 8, 24), M.metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.35; s.add(ring);
      cyl(s, 0.22, 0.2, 0.09, M.seat, 0, 0.77, 0, 24);
      box(s, 0.4, 0.22, 0.05, M.seat, 0, 0.93, -0.17);
    });
  },
  sign_board: (g, M) => {
    rod(g, [-0.35, 0, -0.25], [-0.3, 1.5, 0], 0.025, M.woodDark);
    rod(g, [0.35, 0, -0.25], [0.3, 1.5, 0], 0.025, M.woodDark);
    rod(g, [0, 0, 0.3], [0, 1.4, 0.02], 0.025, M.woodDark);
    const b = box(g, 0.8, 1.0, 0.04, M.sign, 0, 1.05, 0.05);
    b.rotation.x = -0.12;
  },
  floor_corner: (g, M) => {
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 36), M.white);
    plat.position.y = 0.04; plat.receiveShadow = true; g.add(plat);
  }
};

// ============================================================================
// Isi dinamis per zona — jumlah item mengikuti stok tersedia
// ============================================================================
const PALETTES = {
  tops: [0x1f2937, 0xf5f5f0, 0x334e7a, 0xe7dcc8, 0x2f3542, 0xd7d2c8, 0x445a78, 0x111827, 0xc9b79c, 0x6b7280],
  outer: [0x3f4a34, 0x9ca3af, 0x4b5563, 0xc8b69a, 0x1f2937, 0x5b6b4e, 0xd1ccc2, 0x374151],
  bags: [0x1e3a5f, 0xf2efe8, 0x8b5e3c, 0x2d3748, 0xc2410c, 0x0f766e, 0x7c3aed, 0xd4a373],
  toys: [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x14b8a6, 0xf97316]
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function hangGarments(g, M, n, width, kind, palette, empty) {
  const count = empty ? 2 : clamp(n, 1, Math.floor(width / 0.2));
  const gap = Math.min(0.22, (width - 0.3) / Math.max(1, count));
  for (let i = 0; i < count; i++) {
    const x = -((count - 1) * gap) / 2 + i * gap;
    const mat = M.cloth(empty ? 0xd1d5db : palette[i % palette.length]);
    const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 12, Math.PI), M.woodDark);
    hanger.position.set(x, 1.73, 0); hanger.rotation.y = Math.PI / 2; g.add(hanger);
    rod(g, [x, 1.66, -0.2], [x, 1.66, 0.2], 0.01, M.woodDark);
    const gm = new THREE.Mesh(garmentGeo(kind), mat);
    gm.position.set(x, 1.66, 0);
    gm.rotation.y = Math.PI / 2 + (i % 2 ? 0.05 : -0.05);
    gm.castShadow = true;
    g.add(gm);
  }
}

const FILLERS = {
  rack_left: (g, M, n, empty) => hangGarments(g, M, n, 2.6, 'tee', PALETTES.tops, empty),
  rack_back: (g, M, n, empty) => hangGarments(g, M, n, 2.2, 'hoodie', PALETTES.outer, empty),
  rack_side: (g, M, n, empty) => hangGarments(g, M, n, 1.5, 'pants', [0x1e3a5f, 0x27406b, 0x324c78, 0x1b2f4f], empty),
  rack_front: (g, M, n, empty) => {
    // tas & aksesori tergantung di rak depan + beberapa celana
    const count = empty ? 2 : clamp(n, 1, 8);
    for (let i = 0; i < count; i++) {
      const x = -0.8 + (i * 1.6) / Math.max(1, count - 1 || 1);
      const mat = M.cloth(empty ? 0xd1d5db : PALETTES.bags[i % PALETTES.bags.length]);
      rod(g, [x - 0.08, 1.75, 0], [x, 1.45, 0], 0.01, M.black);
      rod(g, [x + 0.08, 1.75, 0], [x, 1.45, 0], 0.01, M.black);
      const bag = box(g, 0.32, 0.3, 0.14, mat, x, 1.3, 0);
      bag.rotation.y = (i % 3 - 1) * 0.15;
    }
    for (let i = 0; i < Math.min(3, count); i++) box(g, 0.34, 0.08, 0.3, M.cloth(PALETTES.tops[i]), -0.6 + i * 0.6, 0.26, 0);
  },
  table_center: (g, M, n, empty) => {
    const count = empty ? 1 : clamp(n, 1, 10);
    // sepatu di rak bawah & atas meja
    for (let i = 0; i < count; i++) {
      const onTop = i < 6;
      const x = onTop ? -0.9 + (i % 3) * 0.9 : -0.8 + ((i - 6) % 4) * 0.55;
      const z = onTop ? (i < 3 ? -0.35 : 0.3) : 0.35;
      const y = onTop ? 0.96 : 0.37;
      const col = empty ? 0xd1d5db : [0xf5f5f5, 0x111827, 0x1e3a8a, 0xf9a8d4, 0xe5e7eb, 0x7c2d12][i % 6];
      [-0.07, 0.07].forEach((dz) => {
        const shoe = new THREE.Group(); shoe.position.set(x, y, z + dz); g.add(shoe);
        box(shoe, 0.3, 0.05, 0.11, M.white, 0, 0.025, 0);
        const up = box(shoe, 0.22, 0.1, 0.1, M.cloth(col), -0.03, 0.1, 0);
        up.scale.y = 1;
        box(shoe, 0.08, 0.14, 0.1, M.cloth(col), -0.12, 0.12, 0);
      });
    }
    // topi + lipatan kaos
    if (!empty) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.cloth(0x374151));
      cap.position.set(0.85, 0.96, 0.05); cap.castShadow = true; g.add(cap);
      box(g, 0.14, 0.01, 0.16, M.cloth(0x374151), 0.95, 0.965, 0.18);
    }
  },
  shelf_toys: (g, M, n, empty) => {
    const count = empty ? 1 : clamp(n, 1, 12);
    for (let i = 0; i < count; i++) {
      const shelfY = [0.58, 1.08, 1.53][Math.floor(i / 4) % 3];
      const x = -0.75 + (i % 4) * 0.5;
      const col = empty ? 0xd1d5db : PALETTES.toys[i % PALETTES.toys.length];
      if (i % 2 === 0) {
        const bear = new THREE.Group(); bear.position.set(x, shelfY, 0.02); g.add(bear);
        const fur = M.cloth(empty ? 0xd1d5db : [0xb07b4f, 0x9ca3af, 0xd6a36a][i % 3]);
        sphere(bear, 0.12, fur, 0, 0.12, 0);
        sphere(bear, 0.09, fur, 0, 0.3, 0.02);
        sphere(bear, 0.035, fur, -0.07, 0.38, 0.02);
        sphere(bear, 0.035, fur, 0.07, 0.38, 0.02);
      } else {
        box(g, 0.32, 0.24, 0.24, M.cloth(col), x, shelfY + 0.12, 0.03);
      }
    }
  },
  kitchen: (g, M, n, empty) => {
    const count = empty ? 1 : clamp(n, 1, 10);
    for (let i = 0; i < count; i++) {
      const x = -1.8 + i * 0.35;
      if (i % 3 === 2) cyl(g, 0.09, 0.09, 0.22, M.jar, x, 1.07, 0.05);
      else {
        cyl(g, 0.055, 0.06, 0.26, empty ? M.grey : M.amber, x, 1.09, 0.05);
        cyl(g, 0.02, 0.03, 0.08, M.black, x, 1.26, 0.05);
      }
    }
  },
  bar_counter: (g, M, n, empty) => {
    // gadget di atas meja bar: laptop, headphone, kamera, ponsel
    const count = empty ? 1 : clamp(n, 1, 8);
    for (let i = 0; i < count; i++) {
      const x = -2.0 + i * 0.55;
      const y = 1.12;
      const k = i % 4;
      if (k === 0) { box(g, 0.42, 0.02, 0.3, M.grey, x, y, 0.08); const s = box(g, 0.42, 0.28, 0.02, M.black, x, y + 0.14, -0.06); s.rotation.x = -0.2; }
      else if (k === 1) { const hp = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 20, Math.PI), M.black); hp.position.set(x, y + 0.02, 0.05); hp.rotation.x = Math.PI / 2; g.add(hp); sphere(g, 0.045, M.black, x - 0.1, y + 0.03, 0.05); sphere(g, 0.045, M.black, x + 0.1, y + 0.03, 0.05); }
      else if (k === 2) { box(g, 0.2, 0.13, 0.1, M.black, x, y + 0.065, 0.05); cyl(g, 0.045, 0.045, 0.08, M.metal, x, y + 0.065, 0.13).rotation.x = Math.PI / 2; }
      else { const ph = box(g, 0.08, 0.16, 0.01, M.black, x, y + 0.08, 0.02); ph.rotation.x = -0.25; }
    }
  },
  sign_board: (g, M, n, empty) => {
    // voucher / kartu kecil di kaki papan
    const count = empty ? 0 : clamp(n, 1, 5);
    for (let i = 0; i < count; i++) box(g, 0.2, 0.01, 0.12, M.cloth([0xf59e0b, 0x10b981, 0x3b82f6, 0xef4444, 0x8b5cf6][i]), -0.3 + i * 0.15, 0.02 + i * 0.012, 0.35);
  },
  floor_corner: (g, M, n, empty) => {
    // skuter listrik
    const col = empty ? M.grey : M.black;
    const sc = new THREE.Group(); sc.position.y = 0.08; g.add(sc);
    box(sc, 0.9, 0.06, 0.18, col, 0, 0.12, 0);
    [-0.42, 0.45].forEach((x) => { const w = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 10, 20), M.black); w.position.set(x, 0.12, 0); sc.add(w); });
    rod(sc, [0.45, 0.12, 0], [0.38, 1.1, 0], 0.025, col);
    rod(sc, [0.38, 1.1, -0.25], [0.38, 1.1, 0.25], 0.02, col);
    if (n > 1 && !empty) { const b = box(g, 0.5, 0.35, 0.35, M.grey, -0.2, 0.26, 0.5); b.rotation.y = 0.4; }
  }
};
