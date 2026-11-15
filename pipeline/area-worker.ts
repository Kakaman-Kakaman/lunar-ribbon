// Worker for build-area-maps.ts: skylines for a batch of lattice points, on grids in shared memory.
import { register } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`),
  import.meta.url,
);
const { horizonProfile, sampleDem, xyToLL } = await import('../src/engine/raymarch.ts');
const { quantiseElev, AREA_AZ_STEP_DEG } = await import('../src/engine/areaMap.ts');
type DemGrid = import('../src/engine/raymarch.ts').DemGrid;

interface SharedGrid { sab: SharedArrayBuffer; float: boolean; size: number; scaleM: number; dnToM: number; offsetPx: number }
const grids: DemGrid[] = (workerData.grids as SharedGrid[]).map((g) => ({
  data: g.float ? new Float32Array(g.sab) : new Int16Array(g.sab),
  size: g.size, scaleM: g.scaleM, dnToM: g.dnToM, offsetPx: g.offsetPx,
}));
const heights = workerData.heights as number[];
const nAz = 360 / AREA_AZ_STEP_DEG;

parentPort!.on('message', (job: { id: number; xy: [number, number][] }) => {
  const sky = heights.map(() => new Uint8Array(job.xy.length * nAz));
  const ground = new Int16Array(job.xy.length);
  job.xy.forEach(([x, y], k) => {
    const [lat, lon] = xyToLL(x, y);
    const hp = horizonProfile({ lat, lon, heightsM: heights, near: null, far: null, azStepDeg: AREA_AZ_STEP_DEG, grids: grids.map((grid) => ({ grid })) });
    const z = grids.map((g) => sampleDem(g, x, y)).find((v) => !Number.isNaN(v));
    ground[k] = Math.round(z ?? hp.groundElevM);
    heights.forEach((_, hi) => { for (let a = 0; a < nAz; a++) sky[hi][k * nAz + a] = quantiseElev(hp.horizonDeg[hi][a]); });
  });
  parentPort!.postMessage({ id: job.id, ground, sky }, [ground.buffer, ...sky.map((s) => s.buffer)]);
});
