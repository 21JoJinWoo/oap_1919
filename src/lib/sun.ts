// Solar position (NOAA / Meeus approximation) and a daylight model used to
// drive the scene's time-of-day control.

const rad = Math.PI / 180;

function julianDay(y: number, m: number, d: number, hourUtc: number): number {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5 + hourUtc / 24;
}

/**
 * Sun elevation and azimuth (degrees; azimuth clockwise from north) for a local
 * clock time. `tz` is the UTC offset of that clock in hours.
 */
export function solarPosition(
  date: { y: number; m: number; d: number },
  localHour: number,
  lat: number,
  lon: number,
  tz: number,
): { elevation: number; azimuth: number } {
  const T = (julianDay(date.y, date.m, date.d, localHour - tz) - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const yv = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    (4 / rad) *
    (yv * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * yv * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * yv * yv * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad));
  const trueSolarMin = (((localHour * 60 + eqTime + 4 * lon - 60 * tz) % 1440) + 1440) % 1440;
  const ha = trueSolarMin / 4 - 180;
  const cosZen = Math.sin(lat * rad) * Math.sin(dec * rad) + Math.cos(lat * rad) * Math.cos(dec * rad) * Math.cos(ha * rad);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen))) / rad;
  const cosAz = (Math.sin(lat * rad) * Math.cos(zen * rad) - Math.sin(dec * rad)) / (Math.cos(lat * rad) * Math.sin(zen * rad));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { elevation: 90 - zen, azimuth: az };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];

const toHex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

const fromHex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

export interface Daylight {
  elevation: number;
  azimuth: number;
  /** Unit vector towards the sun (world: -Z north, +X east). */
  direction: [number, number, number];
  /** Sky / ambient brightness factor, 0.04 (night) .. 1 (full day). */
  sky: number;
  /** Direct sunlight factor, 0 below the horizon .. 1. */
  sun: number;
  sunColor: string;
  /** Fog colour derived from the base horizon colour. */
  fogColor: string;
}

/**
 * Lighting for a sun elevation: sky light fades through civil twilight
 * (0° to -6°), direct light fades out near the horizon, and colours warm
 * towards sunrise / sunset. An artistic model, not a radiometric one.
 */
export function daylight(elevation: number, azimuth: number, horizonColor: string): Daylight {
  const el = elevation * rad;
  const az = azimuth * rad;
  const sky = 0.04 + 0.96 * smooth(-6, 20, elevation);
  const sun = smooth(-1, 10, elevation);
  const warmth = 1 - smooth(2, 30, elevation);
  const sunColor = toHex(mix([255, 243, 226], [255, 150, 80], warmth));
  const fog = mix(fromHex(horizonColor), [235, 160, 120], warmth * 0.6).map((v) => v * sky) as [number, number, number];
  return {
    elevation,
    azimuth,
    direction: [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)],
    sky,
    sun,
    sunColor,
    fogColor: toHex(fog),
  };
}
