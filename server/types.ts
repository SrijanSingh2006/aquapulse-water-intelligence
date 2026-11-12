export interface Reading { timestamp: string; siteId: string; assetId: string; flowM3h: number; conductivityUsCm: number; temperatureC: number; ph: number; productionIndex: number; }
export interface Site { id: string; name: string; city: string; sector: string; baselineFlow: number; assetId: string; }
export interface Analysis { anomalyScore: number; isAnomaly: boolean; expectedFlowM3h: number; excessFlowM3h: number; drivers: string[]; severity: 'normal'|'warning'|'critical'; }
export interface ForecastPoint { timestamp: string; predictedM3h: number; lowerM3h: number; upperM3h: number; }
export interface Incident { id: string; siteId: string; assetId: string; title: string; severity: string; status: 'open'|'acknowledged'|'resolved'; createdAt: string; updatedAt: string; note: string; }
