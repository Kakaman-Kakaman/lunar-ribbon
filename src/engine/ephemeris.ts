// Sun and Earth as seen from a point on the lunar surface.
//
// astronomy-engine has no observer-on-the-Moon function, so this builds one:
// take the Earth and Sun vectors from the Moon's centre, rotate them into the
// Moon's body-fixed frame with the IAU rotation model, then express them in the
// site's east/north/up basis. Subtracting the site position before taking the
// angles gives the Earth parallax for free (it is up to 0.28 degrees).
//
// Checked against JPL Horizons in tests/ephemeris.test.ts.

import * as Astronomy from 'astronomy-engine';

export const MOON_RADIUS_KM = 1737.4;
export const SUN_RADIUS_KM = 695700;
export const EARTH_RADIUS_KM = 6378.137;

const AU_KM = 149597870.7;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Vec3 = [number, number, number];

/** Earth and Sun positions relative to the Moon's centre, body-fixed frame, km. */
export interface MoonFrame {
  earth: Vec3;
  sun: Vec3;
}

/** Local basis of a surface site, in the Moon's body-fixed frame. */
export interface SiteBasis {
  up: Vec3;
  east: Vec3;
  north: Vec3;
  /** Distance of the observer from the Moon's centre, km. */
  radiusKm: number;
}

export interface SkyPosition {
  /** Degrees clockwise from north. */
  az: number;
  /** Degrees above the plane perpendicular to the local vertical (no terrain). */
  el: number;
  /** Distance from the observer, km. */
  distKm: number;
}

type Mat3 = [Vec3, Vec3, Vec3];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const mul = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

const matMul = (a: Mat3, b: Mat3): Mat3 =>
  a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as Mat3;

// Frame rotations (rotate the axes, not the vector).
const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
};
const rotX = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
};

/**
 * Earth and Sun vectors in the Moon's body-fixed frame at one instant.
 * Compute once per time step and reuse for every site.
 */
export function moonFrame(date: Date): MoonFrame {
  const t = Astronomy.MakeTime(date);
  const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, t); // ra in hours, dec and spin in degrees
  // J2000 equatorial -> body-fixed
  const m = matMul(
    matMul(rotZ(axis.spin * D2R), rotX(Math.PI / 2 - axis.dec * D2R)),
    rotZ(Math.PI / 2 + axis.ra * 15 * D2R),
  );
  const gm = Astronomy.GeoMoon(t);
  const gs = Astronomy.GeoVector(Astronomy.Body.Sun, t, false);
  const moon: Vec3 = [gm.x * AU_KM, gm.y * AU_KM, gm.z * AU_KM];
  const sun: Vec3 = [gs.x * AU_KM, gs.y * AU_KM, gs.z * AU_KM];
  return {
    earth: mul(m, [-moon[0], -moon[1], -moon[2]]),
    sun: mul(m, [sun[0] - moon[0], sun[1] - moon[1], sun[2] - moon[2]]),
  };
}

/**
 * @param lonDeg east-positive longitude
 * @param latDeg latitude (on a sphere, planetocentric and geodetic are the same)
 * @param heightKm height of the observer above the 1737.4 km reference sphere
 */
export function siteBasis(lonDeg: number, latDeg: number, heightKm = 0): SiteBasis {
  const lo = lonDeg * D2R, la = latDeg * D2R;
  return {
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    radiusKm: MOON_RADIUS_KM + heightKm,
  };
}

/** Azimuth and elevation of a body, given its vector from the Moon's centre. */
export function skyPosition(site: SiteBasis, body: Vec3): SkyPosition {
  const d: Vec3 = [
    body[0] - site.radiusKm * site.up[0],
    body[1] - site.radiusKm * site.up[1],
    body[2] - site.radiusKm * site.up[2],
  ];
  const dist = Math.hypot(d[0], d[1], d[2]);
  const az = Math.atan2(dot(site.east, d), dot(site.north, d)) * R2D;
  return {
    az: (az + 360) % 360,
    el: Math.asin(dot(site.up, d) / dist) * R2D,
    distKm: dist,
  };
}

/** Apparent angular radius of a sphere of the given radius at the given distance, degrees. */
export const angularRadiusDeg = (radiusKm: number, distKm: number) => Math.asin(radiusKm / distKm) * R2D;
