// 3D terrain around a site (version 2): NASA LOLA terrain from the browser tiles, at true scale, on
// the curved Moon, lit by the Sun from the engine's own position for the time cursor, with cast
// shadows. Two meshes: fine terrain within 6 km of the site, and 160 m terrain out to 60 km so that
// distant ridges cast their shadows. Sun and Earth are drawn as symbols in their directions.
// Loaded on demand (three.js is a large library).

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MOON_RADIUS_M, llToXY } from '../engine/raymarch';
import type { TileTerrain } from '../engine/tileTerrain';
import { loadTerrain } from '../state/tiles';

interface Props {
  lat: number;
  lon: number;
  heightM: number;
  sunAz: number;
  sunEl: number;
  earthAz: number;
  earthEl: number;
  /** Shown above the view: what time and site. */
  caption: string;
}

const NEAR_HALF = 6000, NEAR_STEP = 30;
const FAR_HALF = 60000, FAR_STEP = 300;
const DEG = Math.PI / 180;

/** Direction in the scene (x east, y up, z south) for an azimuth (clockwise from north) and elevation. */
function dirOf(azDeg: number, elDeg: number): THREE.Vector3 {
  const a = azDeg * DEG, e = elDeg * DEG;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function discTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function Terrain3D({ lat, lon, heightM, sunAz, sunEl, earthAz, earthEl, caption }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ light: THREE.DirectionalLight; sun: THREE.Sprite; earth: THREE.Sprite; render(): void; view(mode: 'above' | 'lander'): void } | null>(null);
  const [status, setStatus] = useState('Loading terrain tiles...');
  const [mode, setMode] = useState<'above' | 'lander'>('above');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    (async () => {
      const pole = lat > 0 ? 'north' as const : 'south' as const;
      const [sx, sy] = llToXY(lat, lon, pole);
      const [fine10, fine20, far] = await Promise.all([
        loadTerrain(10, sx, sy, NEAR_HALF, pole), loadTerrain(20, sx, sy, NEAR_HALF, pole), loadTerrain(160, sx, sy, FAR_HALF, pole),
      ]);
      if (disposed) return;
      const near: TileTerrain | null = fine10 ?? fine20;
      if (!near && !far) { setStatus('No terrain tiles cover this site (tiles cover 80° to each pole).'); return; }
      const lam = lon * DEG, cl = Math.cos(lam), sl = Math.sin(lam);
      const heightAt = (x: number, y: number) => {
        let h = near ? near.sample(x, y) : NaN;
        if (Number.isNaN(h) && far) h = far.sample(x, y);
        return h;
      };
      const z0 = heightAt(sx, sy);
      const ground = Number.isNaN(z0) ? 0 : z0;

      // A square grid in local east/north around the site, sampled from the polar-plane terrain.
      const build = (half: number, step: number, sample: (x: number, y: number) => number, sink: number) => {
        const n = Math.round((2 * half) / step) + 1;
        const pos = new Float32Array(n * n * 3);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const e = -half + i * step, no = half - j * step;
          // local east/north to polar-plane offsets. South plane: e = dx cos - dy sin, n = dx sin + dy cos;
          // north plane (y = -rho cos lon): e = dx cos + dy sin, n = -dx sin + dy cos.
          const dx = pole === 'north' ? e * cl - no * sl : e * cl + no * sl;
          const dy = pole === 'north' ? e * sl + no * cl : -e * sl + no * cl;
          let h = sample(sx + dx, sy + dy);
          if (Number.isNaN(h)) h = ground - 500;
          const inNear = sink > 0 && Math.abs(e) < NEAR_HALF - step && Math.abs(no) < NEAR_HALF - step;
          const k = (j * n + i) * 3;
          pos[k] = e;
          pos[k + 1] = h - ground - (e * e + no * no) / (2 * MOON_RADIUS_M) - (inNear ? sink : 0);
          pos[k + 2] = -no;
        }
        const idx: number[] = [];
        for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const W = el.clientWidth, H = 460;
      renderer.setSize(W, H);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.innerHTML = '';
      el.appendChild(renderer.domElement);
      cleanups.push(() => renderer.dispose());

      const sc = new THREE.Scene();
      sc.background = new THREE.Color(0x05070a);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 1, metalness: 0 });
      const farGeo = build(FAR_HALF, FAR_STEP, (x, y) => (far ? far.sample(x, y) : NaN), near ? 25 : 0);
      const farMesh = new THREE.Mesh(farGeo, mat);
      farMesh.receiveShadow = true; farMesh.castShadow = true;
      sc.add(farMesh);
      if (near) {
        const nearMesh = new THREE.Mesh(build(NEAR_HALF, NEAR_STEP, heightAt, 0), mat);
        nearMesh.receiveShadow = true; nearMesh.castShadow = true;
        sc.add(nearMesh);
      }
      const lander = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 120, 16), new THREE.MeshBasicMaterial({ color: 0xff5a5f }));
      lander.position.set(0, 60, 0);
      sc.add(lander);

      sc.add(new THREE.AmbientLight(0xffffff, 0.05));
      const light = new THREE.DirectionalLight(0xffffff, 3.2);
      light.castShadow = true;
      light.shadow.mapSize.set(4096, 4096);
      const sh = light.shadow.camera as THREE.OrthographicCamera;
      sh.left = -FAR_HALF; sh.right = FAR_HALF; sh.top = FAR_HALF; sh.bottom = -FAR_HALF; sh.near = 1000; sh.far = 400000;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 30;
      sc.add(light, light.target);

      const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#fff3c4', 'rgba(255,176,32,0)'), depthWrite: false }));
      const earth = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#9cc9ff', 'rgba(77,163,255,0)'), depthWrite: false }));
      sun.scale.setScalar(9000); earth.scale.setScalar(12000);
      sc.add(sun, earth);

      const cam = new THREE.PerspectiveCamera(50, W / H, 1, 600000);
      const controls = new OrbitControls(cam, renderer.domElement);
      controls.enableDamping = true;
      const render = () => renderer.render(sc, cam);
      controls.addEventListener('change', render);
      cleanups.push(() => controls.dispose());

      const view = (m: 'above' | 'lander') => {
        const d = sun.position.clone().setY(0).normalize();
        if (m === 'above') {
          cam.fov = 50;
          cam.position.set(-d.x * 9000, 4500, -d.z * 9000);
          controls.target.set(0, 0, 0);
          controls.enableZoom = true; controls.enablePan = true;
          controls.minDistance = 500; controls.maxDistance = 120000;
        } else {
          cam.fov = 70;
          const eye = new THREE.Vector3(0, heightM, 0);
          cam.position.copy(eye).addScaledVector(d, -2);
          controls.target.copy(eye);
          controls.enableZoom = false; controls.enablePan = false;
          controls.minDistance = 0.1; controls.maxDistance = 5;
        }
        cam.updateProjectionMatrix();
        controls.update();
        render();
      };

      let raf = 0;
      const loop = () => { raf = requestAnimationFrame(loop); if (controls.update()) render(); };
      loop();
      cleanups.push(() => cancelAnimationFrame(raf));
      const onResize = () => { const w = el.clientWidth; renderer.setSize(w, H); cam.aspect = w / H; cam.updateProjectionMatrix(); render(); };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      scene.current = { light, sun, earth, render, view };
      setStatus('');
      place();
      view('above');
    })().catch((e) => setStatus(`The 3D view could not start: ${e instanceof Error ? e.message : String(e)}`));
    return () => { disposed = true; cleanups.forEach((f) => f()); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, heightM]);

  function place() {
    const s = scene.current;
    if (!s) return;
    const sd = dirOf(sunAz, sunEl), ed = dirOf(earthAz, earthEl);
    s.light.position.copy(sd).multiplyScalar(200000);
    s.light.target.position.set(0, 0, 0);
    s.light.intensity = sunEl > -1 ? 3.2 : 0;
    s.sun.position.copy(sd).multiplyScalar(300000);
    s.earth.position.copy(ed).multiplyScalar(300000);
    s.render();
  }
  useEffect(place, [sunAz, sunEl, earthAz, earthEl]);
  useEffect(() => { scene.current?.view(mode); }, [mode]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-ink2">{caption}</span>
        <span className="w-2" />
        {(['above', 'lander'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-md border px-2.5 py-1 ${mode === m ? 'border-ink2 text-ink' : 'border-line text-ink2'}`}>
            {m === 'above' ? 'From above' : `From the lander, ${heightM} m up`}
          </button>
        ))}
      </div>
      <div ref={host} className="w-full overflow-hidden rounded-md border border-line" style={{ height: 460 }} role="img" aria-label={`3D terrain around the site, lit by the Sun at ${sunEl.toFixed(1)} degrees elevation`} />
      {status && <p className="mt-1 text-sm text-ink2">{status}</p>}
      <p className="mt-1 text-xs text-ink2">
        True scale, on the curved Moon. Fine terrain within 6 km of the site, 160 m terrain to 60 km. Drag to look around; scroll to zoom from above. The red post marks the site. The Sun and Earth are symbols, not to scale.
      </p>
    </div>
  );
}
