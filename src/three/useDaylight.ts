import { useMemo } from 'react';
import { daylight, solarPosition, type Daylight } from '../lib/sun';
import { useScene } from '../store/sceneStore';

/** Daylight for the scene's time of day, or null when the scene has no time setting. */
export function useDaylight(): Daylight | null {
  const tod = useScene((s) => s.doc?.settings.timeOfDay);
  const horizon = useScene((s) => s.doc?.settings.fog.color ?? '#a1afbd');
  return useMemo(() => {
    if (!tod) return null;
    const [y, m, d] = tod.date;
    const { elevation, azimuth } = solarPosition({ y, m, d }, tod.hour, tod.lat, tod.lon, tod.tz);
    return daylight(elevation, azimuth, horizon);
  }, [tod, horizon]);
}
