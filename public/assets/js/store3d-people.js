// ============================================================================
// Toko 3D — animasi penjual & pembeli dengan bubble percakapan.
// Pembeli: masuk lewat pintu kaca → ke rak yang punya barang tersedia →
// mengomentari barang asli dari database → bayar di kasir → pulang bawa tas.
// Penjual: datang membawa kardus → titip jual di kasir → staf verifikasi → pulang.
// ============================================================================
import * as THREE from 'three';

// Titik jalan (x, z) di lantai; rute disusun agar tidak menembus perabot.
const DOOR = [-5.5, -2.5];
const HUB = [-3.2, -1.9];
const PAY = [-2.3, -2.95];                 // posisi pelanggan di depan meja kasir
const STAFF = [-2.3, -4.4];                // posisi staf di belakang meja kasir
const QUEUE = [[-3.6, -2.7], [-4.2, -2.1]];
const ROUTES = {
  rack_left: { path: [[-2.4, -0.4], [-2.4, 0.75]], look: [-2.4, 1.6] },
  bar_counter: { path: [[-3.7, -0.6], [-3.7, 0.6]], look: [-5.2, 0.6] },
  table_center: { path: [[-0.9, -1.4], [0.6, -0.75]], look: [0.6, 0.6] },
  rack_back: { path: [[0.4, -1.95]], look: [0.4, -2.9] },
  sign_board: { path: [[1.5, -1.5]], look: [2.3, -2.2] },
  shelf_toys: { path: [[1.7, -1.4], [2.5, -0.5]], look: [3.3, -0.5] },
  kitchen: { path: [[1.75, -1.7], [1.85, -3.5]], look: [1.85, -4.5] },
  rack_front: { path: [[-0.95, -0.6], [-0.95, 2.45], [1.0, 2.6]], look: [1.0, 3.4] },
  rack_side: { path: [[1.7, -1.4], [2.6, 0.4], [3.8, 1.2]], look: [4.6, 1.2] },
  floor_corner: { path: [[1.7, -1.4], [2.6, 0.4], [2.9, 2.4], [3.6, 2.9]], look: [4.4, 3.6] }
};
const SHIRTS = [0x2563eb, 0xf97316, 0x10b981, 0xe11d48, 0x7c3aed, 0xf59e0b, 0x0ea5e9, 0x64748b, 0xec4899];
const PANTS = [0x1f2937, 0x334155, 0x1e3a5f, 0x3f3f46, 0x57534e];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x1f1b16, 0x3b2a1a, 0x5a3825, 0x111111];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const short = (s, n = 26) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

export function createPeople({ root, camera, container, getStats, getCategories }) {
  const layer = document.createElement('div');
  layer.className = 's3d-bubbles';
  container.appendChild(layer);

  const geo = {
    torso: new THREE.CylinderGeometry(0.17, 0.2, 0.55, 14),
    hips: new THREE.CylinderGeometry(0.19, 0.19, 0.14, 14),
    head: new THREE.SphereGeometry(0.13, 18, 14),
    hair: new THREE.SphereGeometry(0.137, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    limb: new THREE.CylinderGeometry(0.055, 0.05, 0.62, 10),
    arm: new THREE.CylinderGeometry(0.045, 0.04, 0.52, 10),
    shoe: new THREE.BoxGeometry(0.11, 0.07, 0.2),
    box: new THREE.BoxGeometry(0.42, 0.3, 0.32),
    bag: new THREE.BoxGeometry(0.26, 0.3, 0.12),
    item: new THREE.BoxGeometry(0.22, 0.14, 0.18)
  };
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

  // ---------- meja kasir + staf ----------
  const desk = new THREE.Group();
  desk.position.set(-2.3, 0, -3.75);
  root.add(desk);
  const deskMat = std(0xb8844f, { roughness: 0.55 });
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.66), std(0xf7f5f0, { roughness: 0.3 }));
  deskTop.position.y = 1.02; deskTop.castShadow = deskTop.receiveShadow = true; desk.add(deskTop);
  const deskBody = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.99, 0.6), deskMat);
  deskBody.position.y = 0.5; deskBody.castShadow = deskBody.receiveShadow = true; desk.add(deskBody);
  // papan "KASIR · QRIS"
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#123c56'; g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#fff'; g.font = '800 70px "Plus Jakarta Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('KASIR · QRIS', 256, 84);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  sign.position.set(0, 0.62, 0.305); desk.add(sign);
  const qr = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.02), std(0xffffff));
  qr.position.set(0.5, 1.18, 0.1); qr.rotation.x = -0.3; desk.add(qr);
  const pos = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.24), std(0x1c1f24, { metalness: 0.4 }));
  pos.position.set(-0.35, 1.07, -0.05); desk.add(pos);
  const droppedBoxes = [];

  const staff = makePerson({ shirt: 0x176f62, pants: 0x1f2937, skin: pick(SKIN), hair: pick(HAIR), apron: true });
  staff.group.position.set(STAFF[0], 0, STAFF[1]);
  staff.group.rotation.y = 0;
  root.add(staff.group);

  function makePerson({ shirt, pants, skin, hair, apron = false }) {
    const mats = [];
    const m = (color, o) => { const x = std(color, o); x.transparent = true; mats.push(x); return x; };
    const group = new THREE.Group();
    const shirtM = m(shirt), pantsM = m(pants), skinM = m(skin), hairM = m(hair, { roughness: 0.6 }), shoeM = m(0x111827);
    const mesh = (geom, mat, x, y, z, parent = group) => { const o = new THREE.Mesh(geom, mat); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const legs = [-0.09, 0.09].map((x) => {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.78, 0); group.add(pivot);
      mesh(geo.limb, pantsM, 0, -0.33, 0, pivot);
      mesh(geo.shoe, shoeM, 0, -0.73, 0.04, pivot);
      return pivot;
    });
    mesh(geo.hips, pantsM, 0, 0.82, 0);
    mesh(geo.torso, shirtM, 0, 1.13, 0);
    if (apron) { const a = mesh(new THREE.BoxGeometry(0.3, 0.5, 0.02), m(0xe3f3ef), 0, 1.02, 0.19); a.castShadow = false; }
    const arms = [-0.24, 0.24].map((x) => {
      const pivot = new THREE.Group(); pivot.position.set(x, 1.36, 0); group.add(pivot);
      mesh(geo.arm, shirtM, 0, -0.24, 0, pivot);
      mesh(new THREE.SphereGeometry(0.05, 10, 8), skinM, 0, -0.52, 0, pivot);
      return pivot;
    });
    mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skinM, 0, 1.44, 0);
    const head = mesh(geo.head, skinM, 0, 1.58, 0);
    mesh(geo.hair, hairM, 0, 1.6, -0.01);
    // mata kecil supaya jelas arah hadap
    [-0.045, 0.045].forEach((x) => mesh(new THREE.SphereGeometry(0.014, 6, 6), m(0x111111), x, 1.6, 0.12));
    const hand = new THREE.Group(); hand.position.set(0, 1.0, 0.3); group.add(hand);
    return { group, legs, arms, head, hand, mats, carry: null };
  }

  function setOpacity(p, o) { p.mats.forEach((x) => { x.opacity = o; x.depthWrite = o > 0.99; }); }

  // ---------- bubble percakapan ----------
  const bubbles = new Set();
  function say(person, text, ms, cls = '') {
    const el = document.createElement('div');
    el.className = 's3d-bubble ' + cls;
    el.textContent = text;
    layer.appendChild(el);
    const b = { el, person, until: performance.now() + ms };
    bubbles.add(b);
    return b;
  }
  const v = new THREE.Vector3();
  function placeBubbles(now) {
    const w = container.clientWidth, h = container.clientHeight;
    bubbles.forEach((b) => {
      if (now > b.until || !b.person.group.parent) { b.el.remove(); bubbles.delete(b); return; }
      b.person.head.getWorldPosition(v); v.y += 0.3;
      v.project(camera);
      b.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    });
  }

  // ---------- agen & skrip ----------
  const agents = [];
  let cashierBusy = null;
  let nextSpawn = 1.5, spawnCount = 0;

  function spawn() {
    const stats = getStats() || {};
    const zones = Object.entries(stats).filter(([z, s]) => ROUTES[z] && s.available > 0);
    const isSeller = spawnCount % 3 === 2 || !zones.length;
    spawnCount++;
    const p = makePerson({ shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), hair: pick(HAIR) });
    p.group.position.set(DOOR[0], 0, DOOR[1]);
    p.group.rotation.y = Math.PI / 2;
    setOpacity(p, 0);
    root.add(p.group);
    const agent = { p, steps: [], step: null, t: 0, walkPhase: Math.random() * 6 };
    agent.steps = isSeller ? sellerScript(agent) : buyerScript(agent, zones);
    agents.push(agent);
  }

  function carry(p, kind, color) {
    if (p.carry) { p.hand.remove(p.carry); p.carry = null; }
    if (!kind) return;
    const mat = std(color); mat.transparent = true; p.mats.push(mat);
    p.carry = new THREE.Mesh(geo[kind], mat);
    p.carry.castShadow = true;
    if (kind === 'bag') p.carry.position.set(0.3, -0.25, -0.25);
    p.hand.add(p.carry);
  }

  const walk = (pts) => ({ type: 'walk', pts: pts.map(([x, z]) => new THREE.Vector3(x, 0, z)) });
  const face = (x, z) => ({ type: 'face', x, z });
  const talk = (who, text, ms) => ({ type: 'say', who, text, ms });
  const wait = (ms) => ({ type: 'wait', ms });
  const run = (fn) => ({ type: 'call', fn });

  function buyerScript(a, zones) {
    const [zone, st] = pick(zones);
    const item = pick(st.items);
    const route = ROUTES[zone];
    const back = route.path.slice().reverse();
    const cond = item.condition_pct != null ? `kondisi ${item.condition_pct}%` : 'kondisinya oke';
    return [
      { type: 'fade', to: 1 },
      walk([[-4.6, -2.5], HUB, ...route.path]), face(...route.look),
      talk('me', pick([`Wah, ${short(item.name)} masih ada!`, `${short(item.name)}: ${cond}, mantap!`, `Ini dia yang aku cari 😍`]), 2600),
      wait(400),
      talk('me', pick(['Ambil yang ini deh 🛒', 'Oke, aku beli! 🙌', 'Langsung checkout ah']), 1800),
      run(() => carry(a.p, 'item', 0xd4a373)),
      walk([...back.slice(1), HUB]),
      { type: 'queue' },
      walk([PAY]), face(PAY[0], -5),
      talk('me', `Mau bayar ${short(item.name, 20)}, pakai QRIS ya`, 2400),
      talk('staff', `Siap! Totalnya ${rupiah(item.effective_price ?? item.price)}. Silakan scan 🙏`, 2800),
      talk('me', 'Sudah dibayar ✅', 1600),
      talk('staff', 'Terima kasih! Barangnya siap dibawa 🎉', 2200),
      run(() => carry(a.p, 'bag', pick([0x2eb59d, 0xf58a43, 0x123c56]))),
      run(() => { if (cashierBusy === a) cashierBusy = null; }),
      walk([HUB, [-4.6, -2.5], DOOR]),
      { type: 'fade', to: 0 }, { type: 'remove' }
    ];
  }

  function sellerScript(a) {
    const cats = (getCategories() || []).filter((c) => c.active !== false);
    const cat = cats.length ? pick(cats).name.toLowerCase() : 'barang';
    return [
      { type: 'fade', to: 1 },
      run(() => carry(a.p, 'box', 0xb07b4f)),
      walk([[-4.6, -2.5], HUB]),
      { type: 'queue' },
      walk([PAY]), face(PAY[0], -5),
      talk('me', `Halo, mau titip jual barang ${short(cat, 18)} nih 📦`, 2600),
      talk('staff', 'Boleh! Saya cek kondisinya dulu ya 🔍', 2400),
      run(() => {
        carry(a.p, null);
        const b = new THREE.Mesh(geo.box, std(0xb07b4f));
        b.position.set(-2.3 + (Math.random() - 0.5) * 0.6, 1.2, -3.7);
        b.castShadow = true; root.add(b);
        droppedBoxes.push({ mesh: b, until: performance.now() + 9000 });
      }),
      wait(900),
      talk('staff', 'Lolos verifikasi, segera tayang di katalog ✅', 2600),
      talk('me', pick(['Asiik, semoga cepat laku! 🙌', 'Makasih, Kak! 😊']), 2000),
      run(() => { if (cashierBusy === a) cashierBusy = null; }),
      walk([HUB, [-4.6, -2.5], DOOR]),
      { type: 'fade', to: 0 }, { type: 'remove' }
    ];
  }

  function turnTo(obj, tx, tz, k) {
    const target = Math.atan2(tx - obj.position.x, tz - obj.position.z);
    let d = target - obj.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    obj.rotation.y += d * Math.min(1, k);
  }
  function pose(p, swing, arms = swing) {
    p.legs[0].rotation.x = swing; p.legs[1].rotation.x = -swing;
    p.arms[0].rotation.x = -arms; p.arms[1].rotation.x = arms;
  }

  function stepAgent(a, dt, now) {
    const g = a.p.group;
    if (!a.step) {
      a.step = a.steps.shift();
      a.t = 0;
      if (!a.step) return false;
      if (a.step.type === 'say') {
        const who = a.step.who === 'staff' ? staff : a.p;
        a.bubble = say(who, a.step.text, a.step.ms + 60000);   // dihapus saat langkah bicara selesai
        if (a.step.who === 'staff') staff.talkUntil = now + a.step.ms;
      }
      if (a.step.type === 'call') { a.step.fn(); a.step = null; return true; }
    }
    const s = a.step;
    a.t += dt;
    let moving = false;
    switch (s.type) {
      case 'fade': {
        const o = Math.max(0, Math.min(1, s.to ? a.t / 0.5 : 1 - a.t / 0.5));
        setOpacity(a.p, o);
        if (a.t >= 0.5) a.step = null;
        break;
      }
      case 'walk': {
        const target = s.pts[0];
        if (!target) { a.step = null; break; }
        const dx = target.x - g.position.x, dz = target.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        const sp = 1.15 * dt;
        if (dist <= sp) { g.position.x = target.x; g.position.z = target.z; s.pts.shift(); }
        else { g.position.x += (dx / dist) * sp; g.position.z += (dz / dist) * sp; turnTo(g, target.x, target.z, dt * 10); }
        moving = true;
        break;
      }
      case 'face': turnTo(g, s.x, s.z, dt * 8); if (a.t > 0.5) a.step = null; break;
      case 'say': case 'wait': if (a.t * 1000 >= (s.ms || 0)) { a.step = null; a.bubble?.el.remove(); } break;
      case 'queue': {
        if (!cashierBusy || cashierBusy === a) { cashierBusy = a; a.step = null; break; }
        const idx = agents.filter((x) => x.step?.type === 'queue').indexOf(a);
        const q = QUEUE[Math.min(idx, QUEUE.length - 1)];
        const dx = q[0] - g.position.x, dz = q[1] - g.position.z, dist = Math.hypot(dx, dz);
        if (dist > 0.05) { g.position.x += (dx / dist) * Math.min(dist, 1.15 * dt); g.position.z += (dz / dist) * Math.min(dist, 1.15 * dt); turnTo(g, q[0], q[1], dt * 10); moving = true; }
        else turnTo(g, PAY[0], PAY[1], dt * 4);
        break;
      }
      case 'remove':
        if (cashierBusy === a) cashierBusy = null;
        root.remove(g);
        a.p.mats.forEach((m) => m.dispose());
        return false;
    }
    if (moving) {
      a.walkPhase += dt * 9;
      pose(a.p, Math.sin(a.walkPhase) * 0.55, a.p.carry && a.p.carry.geometry !== geo.bag ? 0 : Math.sin(a.walkPhase) * 0.45);
      g.position.y = Math.abs(Math.sin(a.walkPhase)) * 0.035;
    } else {
      pose(a.p, 0, 0);
      g.position.y = 0;
    }
    // tangan menahan kardus/barang di depan badan
    if (a.p.carry && a.p.carry.geometry !== geo.bag) { a.p.arms[0].rotation.x = a.p.arms[1].rotation.x = -1.1; }
    return true;
  }

  function update(dt, t) {
    // window.__s3dTimeScale hanya untuk pengujian otomatis (mempercepat skenario)
    const scale = Number(window.__s3dTimeScale) || 1;
    dt = Math.min(dt, 0.05) * scale;
    const now = performance.now();
    nextSpawn -= dt;
    if (nextSpawn <= 0 && agents.length < 3) { spawn(); nextSpawn = 5 + Math.random() * 4; }
    for (let i = agents.length - 1; i >= 0; i--) if (!stepAgent(agents[i], dt, now)) agents.splice(i, 1);
    // staf: bernapas & melambai saat bicara
    const talking = staff.talkUntil > now;
    staff.arms[1].rotation.x = talking ? -0.6 + Math.sin(t * 6) * 0.25 : 0;
    staff.arms[1].rotation.z = talking ? 0.5 : 0;
    staff.group.position.y = Math.sin(t * 2) * 0.008;
    for (let i = droppedBoxes.length - 1; i >= 0; i--) {
      if (now > droppedBoxes[i].until) { root.remove(droppedBoxes[i].mesh); droppedBoxes.splice(i, 1); }
    }
    placeBubbles(now);
  }

  return {
    update,
    dispose() { layer.remove(); agents.forEach((a) => root.remove(a.p.group)); root.remove(staff.group, desk); }
  };
}
