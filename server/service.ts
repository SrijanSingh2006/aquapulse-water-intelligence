import {SITES,demoReadings} from './demo';
import {analyzeReading,forecast,modelInfo} from './analytics';
import type {Reading,Incident} from './types';
import {HttpError,queryScope,validateReadings} from './validation';
export interface Env { DB:D1Database }
interface Workspace {readings:Reading[];incidents:Incident[];source:'synthetic'|'uploaded'}
interface Stored {payload:string;revision:number}
const round=(v:number)=>Math.round(v*100)/100;
function incidentsFor(readings:Reading[]):Incident[]{
 const incidents:Incident[]=[];
 for(const site of SITES){const rows=readings.filter(r=>r.siteId===site.id).slice(-24),flagged=rows.map(r=>({r,a:analyzeReading(r)})).filter(x=>x.a.isAnomaly);if(!flagged.length)continue;
 const last=flagged.at(-1)!,first=flagged[0];
 incidents.push({id:crypto.randomUUID(),siteId:site.id,assetId:site.assetId,title:last.a.drivers[0]||'Unusual water-system telemetry',severity:flagged.some(x=>x.a.severity==='critical')?'critical':'warning',status:'open',createdAt:first.r.timestamp,updatedAt:last.r.timestamp,note:''});
 }return incidents;
}
function seed():Workspace{const readings=demoReadings();return{readings,incidents:incidentsFor(readings),source:'synthetic'};}
async function identity(req:Request){const user=req.headers.get('oai-authenticated-user-id');if(user){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user));return {id:'user-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),cookie:undefined};}const old=req.headers.get('cookie')?.match(/(?:^|;\s*)aquapulse_workspace=([a-f0-9-]{36})(?:;|$)/)?.[1];const id=old&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(old)?old:crypto.randomUUID();return{id,cookie:old?undefined:`aquapulse_workspace=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(req.url).protocol==='https:'?'; Secure':''}`};}
async function load(db:D1Database,id:string):Promise<{state:Workspace;revision:number}>{let row=await db.prepare('SELECT payload, revision FROM workspaces WHERE id = ?').bind(id).first<Stored>();if(!row){const state=seed();await db.prepare('INSERT OR IGNORE INTO workspaces (id,payload,revision,updated_at) VALUES (?,?,0,?)').bind(id,JSON.stringify(state),new Date().toISOString()).run();row=await db.prepare('SELECT payload, revision FROM workspaces WHERE id = ?').bind(id).first<Stored>();}if(!row)throw new HttpError(503,'Workspace could not be initialized.');return {state:JSON.parse(row.payload),revision:row.revision};}
async function save(db:D1Database,id:string,state:Workspace,revision:number){const result=await db.prepare('UPDATE workspaces SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(state),new Date().toISOString(),id,revision).run();if(!result.meta.changes)throw new HttpError(409,'Workspace changed in another tab. Refresh and try again.');}
async function body(req:Request){if(!req.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Send application/json.');const length=Number(req.headers.get('content-length')||0);if(length>2000000)throw new HttpError(413,'Upload must be under 2 MB.');const reader=req.body?.getReader();if(!reader)throw new HttpError(400,'A JSON body is required.');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw new HttpError(413,'Upload must be under 2 MB.');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON.');}}
function filtered(readings:Reading[],siteId:string,hours:number){const selected=readings.filter(r=>siteId==='all'||r.siteId===siteId);const last=Math.max(...selected.map(r=>Date.parse(r.timestamp)));return selected.filter(r=>Date.parse(r.timestamp)>last-hours*3600000);}
function csv(readings:Reading[]){const columns:(keyof Reading)[]=['timestamp','siteId','assetId','flowM3h','conductivityUsCm','temperatureC','ph','productionIndex'];return[columns.join(','),...readings.map(r=>columns.map(c=>r[c]).join(','))].join('\n')+'\n';}
export async function api(req:Request,env:Env):Promise<Response>{let cookie:string|undefined;try{
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(method==='GET'&&path==='/api/health'){if(!env.DB)return Response.json({ok:false,database:'binding_unavailable'},{status:503});try{await env.DB.prepare('SELECT id FROM workspaces LIMIT 1').first();return Response.json({ok:true,service:'aquapulse',modelVersion:'1.0.0',database:'ready'});}catch{return Response.json({ok:false,database:'schema_unavailable'},{status:503});}}
 if(!env.DB)throw new HttpError(503,'Database binding is unavailable.');
 if(!['GET','POST'].includes(method))throw new HttpError(405,'Method not allowed.');
 if(method==='POST'){const origin=req.headers.get('origin');if(origin&&origin!==url.origin)throw new HttpError(403,'Cross-origin write requests are not allowed.');if(req.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-site write requests are not allowed.');}
 const session=await identity(req);cookie=session.cookie;
 const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
 if(method==='GET'&&path==='/api/model')return respond(modelInfo);
 const {state,revision}=await load(env.DB,session.id);
 if(method==='GET'&&(path==='/api/dashboard'||path==='/api/export')){
  const {siteId,hours}=queryScope(url),readings=filtered(state.readings,siteId,hours);
  if(path==='/api/export')return new Response(csv(readings),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="aquapulse-telemetry.csv"','cache-control':'no-store',...(cookie?{'set-cookie':cookie}:{})}});
  const analyzed=readings.map(r=>({...r,analysis:analyzeReading(r)})),incidents=state.incidents.filter(i=>siteId==='all'||i.siteId===siteId),forecasts=SITES.filter(s=>siteId==='all'||s.id===siteId).flatMap(s=>forecast(state.readings.filter(r=>r.siteId===s.id),24).map(p=>({...p,siteId:s.id})));
  const total=readings.reduce((v,r)=>v+r.flowM3h,0),expected=analyzed.reduce((v,r)=>v+r.analysis.expectedFlowM3h,0),excess=analyzed.reduce((v,r)=>v+r.analysis.excessFlowM3h,0);
  return respond({sites:SITES,readings:analyzed,incidents,model:modelInfo,dataset:{source:state.source,label:state.source==='synthetic'?'Synthetic replay · hourly samples':'Uploaded hourly telemetry',lastTimestamp:readings.at(-1)?.timestamp||'',count:state.readings.length},summary:{totalWaterM3:round(total),expectedWaterM3:round(expected),excessWaterM3:round(excess),activeAlerts:incidents.filter(i=>i.status!=='resolved').length,healthPercent:analyzed.length?round(100*analyzed.filter(r=>!r.analysis.isAnomaly).length/analyzed.length):100,waterCostInr:round(total*65)},forecasts});
 }
 if(method==='POST'&&path==='/api/ingest'){const data=await body(req),readings=validateReadings(data?.readings);await save(env.DB,session.id,{readings,incidents:incidentsFor(readings),source:'uploaded'},revision);return respond({accepted:readings.length});}
 if(method==='POST'&&path==='/api/reset'){await body(req);await save(env.DB,session.id,seed(),revision);return respond({ok:true});}
 if(method==='POST'&&/^\/api\/incidents\/[^/]+$/.test(path)){const data=await body(req),incident=state.incidents.find(i=>i.id===decodeURIComponent(path.split('/').at(-1)!));if(!incident)throw new HttpError(404,'Incident not found.');if(!['acknowledged','resolved'].includes(data?.status))throw new HttpError(400,'status must be acknowledged or resolved.');if(incident.status==='resolved')throw new HttpError(409,'Resolved incidents cannot be changed.');if(typeof data.note!=='string'||data.note.trim().length<3||data.note.length>1000)throw new HttpError(400,'Add an operator note between 3 and 1,000 characters.');incident.status=data.status;incident.note=data.note.trim();incident.updatedAt=new Date().toISOString();await save(env.DB,session.id,state,revision);return respond(incident);}
 throw new HttpError(404,'API endpoint not found.');
 }catch(error){if(!(error instanceof HttpError))console.error('AquaPulse API error:',error instanceof Error?error.message:'Unknown failure');return Response.json({error:error instanceof HttpError?error.message:'Unable to process this request. Please retry.'},{status:error instanceof HttpError?error.status:500,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});}}
