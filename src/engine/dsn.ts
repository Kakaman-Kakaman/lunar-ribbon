// Direct-to-Earth contact through NASA's Deep Space Network (DSN).
//
// A link needs two things at once: Earth in view from the lander (the visibility series), and the
// Moon above the elevation limit of an antenna at one of the three DSN complexes. Station positions
// and limits are from the DSN Telecommunications Link Design Handbook, 810-005, module 301 Rev. N
// (JPL, 2022): Table 5 (geodetic coordinates, WGS 84) and section 2.2. One antenna represents each
// complex (the 70 m dish); the handbook notes that visibility differences between antennas at a
// complex are insignificant. Local terrain masks at the complexes, refraction, and antenna
// scheduling are not modelled.

import * as Astronomy from 'astronomy-engine';

export interface DsnComplex {
  id: 'goldstone' | 'canberra' | 'madrid';
  name: string;
  antenna: string;
  latDeg: number;
  /** East-positive, -180..180. */
  lonDeg: number;
  heightM: number;
}

const dms = (d: number, m: number, s: number, sign = 1) => sign * (d + m / 60 + s / 3600);
const east = (deg: number) => (deg > 180 ? deg - 360 : deg);

/** Handbook 810-005 module 301 Rev. N, Table 5. Southern latitudes are negative (table note 3). */
export const DSN_COMPLEXES: DsnComplex[] = [
  { id: 'goldstone', name: 'Goldstone, California', antenna: 'DSS 14 (70 m)', latDeg: dms(35, 25, 33.24312), lonDeg: east(dms(243, 6, 37.66244)), heightM: 1001.39 },
  { id: 'canberra', name: 'Canberra, Australia', antenna: 'DSS 43 (70 m)', latDeg: dms(35, 24, 8.72724, -1), lonDeg: east(dms(148, 58, 52.56231)), heightM: 688.867 },
  { id: 'madrid', name: 'Madrid, Spain', antenna: 'DSS 63 (70 m)', latDeg: dms(40, 25, 52.3551), lonDeg: east(dms(355, 45, 7.16924)), heightM: 864.816 },
];

/** Receive: the mechanical elevation limit, "approximately six degrees" (section 2.2.2). */
export const DSN_RECEIVE_MIN_EL_DEG = 6;
/** Transmit: "in general, there is no transmission allowed below 10.2-10.5 degrees" (section 2.2.1); the upper value is used. */
export const DSN_TRANSMIT_MIN_EL_DEG = 10.5;

/** Geometric (no refraction) elevation of the Moon's centre seen from a complex, degrees. */
export function moonElevationDeg(c: DsnComplex, ms: number): number {
  const obs = new Astronomy.Observer(c.latDeg, c.lonDeg, c.heightM);
  const t = Astronomy.MakeTime(new Date(ms));
  const eq = Astronomy.Equator(Astronomy.Body.Moon, t, obs, true, true);
  return Astronomy.Horizon(t, obs, eq.ra, eq.dec).altitude;
}

export interface DsnSeries {
  startMs: number;
  stepMs: number;
  n: number;
  /** Moon elevation at each complex, same order as DSN_COMPLEXES. */
  moonElDeg: Float32Array[];
}

export function computeDsnSeries(startMs: number, stepMs: number, n: number): DsnSeries {
  const moonElDeg = DSN_COMPLEXES.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const ms = startMs + i * stepMs;
    DSN_COMPLEXES.forEach((c, k) => (moonElDeg[k][i] = moonElevationDeg(c, ms)));
  }
  return { startMs, stepMs, n, moonElDeg };
}

/**
 * Bit mask of the complexes that see the Moon at or above minElDeg at sample i (bit k = DSN_COMPLEXES[k]).
 * Zero means no complex can hear the lander at that moment.
 */
export function complexesInView(d: DsnSeries, i: number, minElDeg = DSN_RECEIVE_MIN_EL_DEG): number {
  let bits = 0;
  for (let k = 0; k < d.moonElDeg.length; k++) if (d.moonElDeg[k][i] >= minElDeg) bits |= 1 << k;
  return bits;
}

/**
 * Contact at each sample: Earth at least `earthThreshold` visible from the lander (fraction of its
 * disc above the skyline) and at least one complex above the limit. Series must share start and step.
 */
export function contactSeries(earthFrac: ArrayLike<number>, d: DsnSeries, earthThreshold = 0.5, minElDeg = DSN_RECEIVE_MIN_EL_DEG): Uint8Array {
  const out = new Uint8Array(d.n);
  for (let i = 0; i < d.n; i++) out[i] = earthFrac[i] >= earthThreshold && complexesInView(d, i, minElDeg) !== 0 ? 1 : 0;
  return out;
}
