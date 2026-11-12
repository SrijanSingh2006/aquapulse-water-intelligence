import type {Reading} from './types';
import {SITES} from './demo';
export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
const numeric: Record<string,[number,number]>={flowM3h:[0,250],conductivityUsCm:[10,15000],temperatureC:[0,80],ph:[0,14],productionIndex:[0,2]};
export function validateReadings(input:unknown):Reading[]{
 if(!Array.isArray(input)||!input.length||input.length>5000)throw new HttpError(400,'Provide between 1 and 5,000 hourly readings.');
 const seen=new Set<string>();
 const readings=input.map((raw,i)=>{
  if(!raw||typeof raw!=='object')throw new HttpError(400,`Row ${i+1}: expected a reading object.`);
  const r=raw as Record<string,unknown>,site=SITES.find(s=>s.id===r.siteId);
  if(!site||r.assetId!==site.assetId)throw new HttpError(400,`Row ${i+1}: siteId and assetId must match a supported site.`);
  if(typeof r.timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/.test(r.timestamp)||!Number.isFinite(Date.parse(r.timestamp)))throw new HttpError(400,`Row ${i+1}: timestamp must be an ISO UTC hour, such as 2026-11-12T18:00:00Z.`);
  const timestamp=new Date(r.timestamp).toISOString();
  if(timestamp.replace('.000','')!==r.timestamp.replace('.000',''))throw new HttpError(400,`Row ${i+1}: invalid calendar date.`);
  for(const [key,[min,max]]of Object.entries(numeric))if(typeof r[key]!=='number'||!Number.isFinite(r[key])||(r[key] as number)<min||(r[key] as number)>max)throw new HttpError(400,`Row ${i+1}: ${key} must be a finite number between ${min} and ${max}.`);
  const key=`${site.id}|${timestamp}`;if(seen.has(key))throw new HttpError(400,`Row ${i+1}: duplicate asset timestamp.`);seen.add(key);
  return {timestamp,siteId:site.id,assetId:site.assetId,...Object.fromEntries(Object.keys(numeric).map(k=>[k,r[k]]))} as Reading;
 }).sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.siteId.localeCompare(b.siteId));
 for(const site of SITES){const rows=readings.filter(r=>r.siteId===site.id);for(let i=1;i<rows.length;i++)if(Date.parse(rows[i].timestamp)-Date.parse(rows[i-1].timestamp)!==3600000)throw new HttpError(400,`${site.id}: readings must be consecutive hourly samples with no gaps.`);}
 return readings;
}
export function queryScope(url:URL){const siteId=url.searchParams.get('siteId')||'all',hours=Number(url.searchParams.get('hours')||24);if(siteId!=='all'&&!SITES.some(s=>s.id===siteId))throw new HttpError(400,'Unknown siteId.');if(![24,168].includes(hours))throw new HttpError(400,'hours must be 24 or 168.');return {siteId,hours};}
