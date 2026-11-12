import artifact from '../ml/model.json';
import readings from '../ml/demo-readings.json';
import type { Reading, Site } from './types';

export const SITES: Site[] = artifact.sites;
/** A copy protects deterministic fixtures from mutation by request handlers. */
export function demoReadings(): Reading[] {
  return readings.map(reading => ({ ...reading }));
}
