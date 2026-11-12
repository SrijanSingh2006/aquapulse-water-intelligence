import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, Database, Fingerprint, FlaskConical, GitBranch,
  LoaderCircle, Play, RefreshCw, ShieldCheck, SlidersHorizontal, Square,
  Target, Waves,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Analysis, Reading } from '../server/types';
import type { AssuranceReport } from '../server/insights';
import type { PlanInput, RecoveryAction, RecoveryPlan } from '../server/planner';
import './advanced.css';

type AdvancedView = 'assurance' | 'planner' | 'replay' | 'audit';
type Props = { view: AdvancedView; siteId: string; hours: number; onDataChange: () => void };
type AuditEvent = {
  id: string; sequence: number; at: string; type: string; entityId: string;
  note: string; metadata: Record<string, unknown>; previousHash: string; hash: string;
};
type AuditReport = {
  events: AuditEvent[];
  integrity: { valid: boolean; checkedEvents: number; headHash: string; message: string };
  legacyNote: string;
};
type ReplayFrame = { sequence: number; reading: Reading; analysis: Analysis };
type ReplayStatus = 'idle' | 'connecting' | 'running' | 'stopped' | 'complete' | 'error';
const number = (value: number, digits = 0) => Number.isFinite(value)
  ? value.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const title = (value: string) => value.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const money = (value: number) => `₹${number(value)}`;
const tone = (status: string) => status === 'stable' || status === 'normal' ? 'green'
  : status === 'shifted' || status === 'critical' ? 'red'
  : status === 'watch' || status === 'warning' ? 'amber' : 'neutral';
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Status({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`advanced-status advanced-status-${tone(status)}`}><i />{children || title(status)}</span>;
}
function PanelTitle({ eyebrow, title: heading, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="advanced-panel-title"><div><span>{eyebrow}</span><h2>{heading}</h2></div>{children}</div>;
}
function Loading({ text = 'Inspecting the operating signals…' }: { text?: string }) {
  return <div className="advanced-loading" role="status"><LoaderCircle className="spin" size={24} /><span>{text}</span></div>;
}
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="advanced-error" role="alert"><CircleHelp size={18} /><p>{message}</p>{retry && <button className="button button-secondary" onClick={retry}>Try again</button>}</div>;
}
function Note({ children }: { children: ReactNode }) {
  return <div className="advanced-note"><CircleHelp size={16} /><div>{children}</div></div>;
}
function Metric({ label, value, detail, icon: Icon = Activity }: { label: string; value: string; detail: string; icon?: typeof Activity }) {
  return <div className="advanced-metric"><div><span>{label}</span><Icon size={18} /></div><strong>{value}</strong><p>{detail}</p></div>;
}

export default function Advanced({ view, siteId, hours, onDataChange }: Props) {
  return <div className="advanced-root">{
    view === 'assurance' ? <Assurance siteId={siteId} hours={hours} />
      : view === 'planner' ? <Planner siteId={siteId} />
      : view === 'replay' ? <Replay siteId={siteId} onDataChange={onDataChange} />
      : <Audit />
  }</div>;
}

function Assurance({ siteId, hours }: { siteId: string; hours: number }) {
  const [report, setReport] = useState<AssuranceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<AssuranceReport>(`/api/assurance?siteId=${encodeURIComponent(siteId)}&hours=${hours}`, { signal: controller.signal })
      .then(setReport)
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [siteId, hours, revision]);
  if (loading && !report) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={() => setRevision(v => v + 1)} />;
  if (!report) return null;
  const { quality, drift, model } = report;
  return <>
    <section className="advanced-intro advanced-assurance-intro">
      <span className="advanced-intro-icon"><ShieldCheck size={27} /></span>
      <div><span className="advanced-kicker">MODEL ASSURANCE</span><h2>Trust the signal.<br /><em>Then trust the insight.</em></h2><p>Check telemetry quality and distribution changes against the frozen healthy training reference.</p></div>
      <div className="advanced-intro-actions"><Status status={drift.status} /><button className="button button-secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh checks</button></div>
    </section>
    <div className="advanced-metrics">
      <Metric label="Data quality" value={`${number(quality.scorePercent, 1)}%`} detail="Server-calculated quality score" icon={ShieldCheck} />
      <Metric label="Completeness" value={`${number(quality.completenessPercent, 1)}%`} detail={`${number(report.totalRows)} of ${number(quality.expectedRows)} expected hourly readings`} icon={Database} />
      <Metric label="Missing hourly readings" value={number(quality.missingHours)} detail={`${number(quality.duplicateRows)} duplicate readings detected`} icon={Clock3} />
      <Metric label="Distribution status" value={title(drift.status)} detail={`At least ${drift.minSamples} samples per feature required`} icon={GitBranch} />
    </div>
    <div className="advanced-assurance-grid">
      <section className="card">
        <PanelTitle eyebrow="DATA HEALTH" title="Before the model runs"><span className="advanced-count">{quality.issues.length} {quality.issues.length === 1 ? 'issue' : 'issues'}</span></PanelTitle>
        <div className="advanced-quality-meta"><span>Selected window</span><strong>{date(quality.windowStart)} → {date(quality.lastTimestamp)} UTC</strong></div>
        {quality.issues.length ? <div className="advanced-issues">{quality.issues.map((issue, index) => <article key={`${issue.title}-${index}`}><span className={`advanced-issue-dot advanced-dot-${tone(issue.severity)}`} /><div><h3>{issue.title}</h3><p>{issue.detail}</p></div><Status status={issue.severity} /></article>)}</div>
          : <div className="advanced-clear"><CheckCheck size={29} /><h3>No quality issues reported.</h3><p>The selected records passed the implemented data checks. This does not verify physical sensor accuracy.</p></div>}
        <div className="advanced-quality-footer"><span><Clock3 size={13} /> {quality.staleSites.length} stale sites</span><span><Activity size={13} /> {quality.stuckSensors.length} stuck-sensor signals</span></div>
        {!!quality.stuckSensors.length && <details className="advanced-detail"><summary>Inspect stuck-sensor checks <ChevronDown size={14} /></summary><div className="advanced-table-scroll"><table><thead><tr><th>Site</th><th>Metric</th><th>Run hours</th></tr></thead><tbody>{quality.stuckSensors.map((sensor, i) => <tr key={i}><td>{sensor.siteId}</td><td>{title(sensor.metric)}</td><td>{sensor.runHours}</td></tr>)}</tbody></table></div></details>}
        {!!quality.staleSites.length && <p className="advanced-quiet advanced-padding">Stale sites: {quality.staleSites.join(', ')}. Staleness is measured against the dataset clock.</p>}
      </section>
      <section className="card advanced-reference">
        <PanelTitle eyebrow="FROZEN REFERENCE" title="A baseline that stays put"><Fingerprint size={22} /></PanelTitle>
        <dl><div><dt>Model version</dt><dd>{model.version}</dd></div><div><dt>Training rows</dt><dd>{number(model.trainingRows)}</dd></div><div><dt>Reference</dt><dd>{drift.referenceLabel}</dd></div><div><dt>Dataset clock</dt><dd>{date(report.scope.datasetClock)} UTC</dd></div></dl>
        <div className="advanced-hash"><span>MODEL ARTIFACT · SHA-256</span><code>{model.fingerprint}</code></div>
        <p className="advanced-quiet">{model.source}</p>
      </section>
    </div>
    <section className="card advanced-drift-section">
      <PanelTitle eyebrow="POPULATION STABILITY INDEX" title="Has the operating context shifted?"><Status status={drift.status} /></PanelTitle>
      <p className="advanced-description">Compare each selected feature with the healthy training distribution. PSI is a change indicator, not an anomaly probability.</p>
      <div className="advanced-drift-legend"><span><i className="advanced-hist-reference" />Healthy training reference</span><span><i className="advanced-hist-current" />Selected telemetry</span><span>PSI &lt; 0.10 stable · &lt; 0.25 watch · ≥ 0.25 shifted</span></div>
      <div className="advanced-feature-grid">{drift.features.map(feature => {
        const maximum = Math.max(1, ...feature.bins.flatMap(bin => [bin.referencePercent, bin.currentPercent]));
        return <article className="advanced-feature" key={feature.name}>
          <div className="advanced-feature-heading"><h3>{feature.label}</h3><Status status={feature.status} /></div>
          <div className="advanced-psi-value"><strong>{feature.psi === null ? '—' : number(feature.psi, 3)}</strong><span>PSI · {number(feature.samples)} samples</span></div>
          <div className="advanced-histogram" aria-hidden="true">{feature.bins.map((bin, index) => <div className="advanced-hist-bin" key={index} title={`${bin.from === null ? '−∞' : number(bin.from, 2)} to ${bin.to === null ? '+∞' : number(bin.to, 2)}: reference ${number(bin.referencePercent, 1)}%; current ${number(bin.currentPercent, 1)}%`}><i className="advanced-hist-reference" style={{ height: `${100 * bin.referencePercent / maximum}%` }} /><i className="advanced-hist-current" style={{ height: `${100 * bin.currentPercent / maximum}%` }} /></div>)}</div>
          <div className="advanced-feature-means"><span>Reference mean <b>{number(feature.referenceMean, 2)}</b></span><span>Current mean <b>{feature.currentMean === null ? '—' : number(feature.currentMean, 2)}</b></span></div>
          <details className="advanced-bin-detail"><summary>Inspect distribution bins</summary><div className="advanced-table-scroll"><table><thead><tr><th>Range</th><th>Reference</th><th>Current</th></tr></thead><tbody>{feature.bins.map((bin, index) => <tr key={index}><td>{bin.from === null ? '−∞' : number(bin.from, 2)} → {bin.to === null ? '+∞' : number(bin.to, 2)}</td><td>{number(bin.referencePercent, 1)}%</td><td>{number(bin.currentPercent, 1)}%</td></tr>)}</tbody></table></div></details>
        </article>;
      })}</div>
      <Note>{report.interpretation.map((statement, index) => <p key={index}>{statement}</p>)}</Note>
    </section>
  </>;
}

const initialPlan: PlanInput = { budgetInr: 12000, crewHours: 12, tariffInrM3: 65, horizonDays: 30, siteId: 'all' };
function Planner({ siteId }: { siteId: string }) {
  const [input, setInput] = useState<PlanInput>({ ...initialPlan, siteId });
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const solve = useCallback(async (parameters: PlanInput) => {
    const revision = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<RecoveryPlan>('/api/planner', { method: 'POST', body: JSON.stringify(parameters) });
      if (revision === generation.current) setPlan(result);
    } catch (e) { if (revision === generation.current) setError((e as Error).message); }
    finally { if (revision === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const parameters = { ...initialPlan, siteId };
    setInput(parameters);
    setPlan(null);
    void solve(parameters);
    return () => { generation.current++; };
  }, [siteId, solve]);
  const update = (key: keyof Omit<PlanInput, 'siteId'>, value: string) => setInput(current => ({ ...current, [key]: value === '' ? 0 : Number(value) }));
  const dirty = plan && ['budgetInr', 'crewHours', 'tariffInrM3', 'horizonDays'].some(key => input[key as keyof PlanInput] !== plan.parameters[key as keyof PlanInput]);
  const selected = plan?.candidates.filter(candidate => plan.selectedIds.includes(candidate.id)) || [];
  const alternatives = plan?.candidates.filter(candidate => !plan.selectedIds.includes(candidate.id)) || [];
  return <>
    <section className="advanced-intro advanced-planner-intro"><span className="advanced-intro-icon"><Target size={27} /></span><div><span className="advanced-kicker">CONSTRAINED RECOVERY PLANNING</span><h2>Put your resources<br /><em>where they matter.</em></h2><p>Choose a feasible set of hypothetical recovery actions under a budget and a crew-hour limit.</p></div><span className="advanced-outline-tag">EXACT ENUMERATION<br /><b>Visible trade-offs</b></span></section>
    <form className="card advanced-planner-inputs" onSubmit={event => { event.preventDefault(); void solve(input); }}>
      <div className="advanced-input-grid">
        <label>Available budget<span><i>₹</i><input type="number" min="0" max="1000000" step="100" required value={input.budgetInr} onChange={e => update('budgetInr', e.target.value)} /></span></label>
        <label>Crew capacity<span><input type="number" min="0" max="100" step="0.5" required value={input.crewHours} onChange={e => update('crewHours', e.target.value)} /><i>hours</i></span></label>
        <label>Water tariff<span><i>₹</i><input type="number" min="0" max="10000" step="1" required value={input.tariffInrM3} onChange={e => update('tariffInrM3', e.target.value)} /><i>/ m³</i></span></label>
        <label>Planning horizon<span><input type="number" min="1" max="365" step="1" required value={input.horizonDays} onChange={e => update('horizonDays', e.target.value)} /><i>days</i></span></label>
      </div>
      <div className="advanced-planner-submit"><span>{siteId === 'all' ? 'All sites' : siteId} · Hypothetical actions, informed by current telemetry</span><button className="button button-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={15} /> : <SlidersHorizontal size={15} />} Optimize recovery plan</button></div>
    </form>
    {error && <ErrorNotice message={error} retry={() => void solve(input)} />}
    {loading && !plan ? <Loading text="Enumerating feasible recovery plans…" /> : plan && <div className={loading ? 'advanced-results advanced-refreshing' : 'advanced-results'} aria-busy={loading}>
      {dirty && <Note>Inputs have changed. Optimize again to update the results below.</Note>}
      <div className="advanced-plan-summary"><div><span className="advanced-kicker">SELECTED PLAN · {plan.parameters.horizonDays}-DAY HORIZON</span><h2>{selected.length ? `${selected.length} ${selected.length === 1 ? 'action' : 'actions'}. A focused recovery plan.` : 'Keeping resources uncommitted.'}</h2><p>{plan.algorithm.objective}</p></div><button className="button button-secondary" onClick={() => download(plan, 'aquapulse-recovery-plan.json')}><ArrowDownToLine size={15} /> Export plan</button></div>
      <div className="advanced-metrics"><Metric label="Planned cost" value={money(plan.summary.costInr)} detail={`of ${money(plan.parameters.budgetInr)} available`} icon={Target} /><Metric label="Crew time" value={`${number(plan.summary.crewHours, 1)} h`} detail={`of ${number(plan.parameters.crewHours, 1)} hours available`} icon={Clock3} /><Metric label="Potential water recovery" value={`${number(plan.summary.periodWaterM3, 1)} m³`} detail={`${number(plan.summary.dailyWaterM3, 1)} m³ per day × ${plan.parameters.horizonDays} days`} icon={Waves} /><Metric label="Estimated net value" value={money(plan.summary.netValueInr)} detail={`${money(plan.summary.periodValueInr)} water value less action cost`} icon={GitBranch} /></div>
      <div className="advanced-plan-grid"><section className="card advanced-selected-panel"><PanelTitle eyebrow="RESOURCE ALLOCATION" title="The selected actions"><Status status="stable">Feasible plan</Status></PanelTitle>
        <div className="advanced-resource-bars"><Resource label="Budget allocated" current={plan.summary.costInr} maximum={plan.parameters.budgetInr} format={money} /><Resource label="Crew allocated" current={plan.summary.crewHours} maximum={plan.parameters.crewHours} format={value => `${number(value, 1)} h`} /></div>
        {selected.length ? <div className="advanced-selected-list">{selected.map(action => <ActionCard key={action.id} action={action} selected />)}</div> : <div className="advanced-clear"><ShieldCheck size={29} /><h3>No action selected.</h3><p>The empty plan is feasible. Within these constraints and assumptions, no candidate combination improves the optimization objective.</p></div>}
        <div className="advanced-payback"><span>Simple payback</span><strong>{plan.summary.paybackDays === null ? 'Not applicable' : `${number(plan.summary.paybackDays, 1)} days`}</strong></div>
      </section><section className="card advanced-frontier"><PanelTitle eyebrow="COST & WATER TRADE-OFFS" title="The feasible frontier"><span className="advanced-count">{plan.frontier.length} plans</span></PanelTitle><p className="advanced-description">Each point is a server-returned non-dominated cost / water-recovery plan. The selected plan also accounts for the planning horizon.</p><Frontier plan={plan} /><div className="advanced-frontier-legend"><span><i />Feasible frontier</span><span><i className="advanced-chosen-dot" />Selected plan</span></div><div className="advanced-solver"><GitBranch size={17} /><div><strong>{plan.algorithm.name}</strong><p>{number(plan.algorithm.evaluatedPlans)} combinations evaluated · {number(plan.algorithm.feasiblePlans)} feasible plans</p></div></div></section></div>
      {!!alternatives.length && <details className="card advanced-alternatives"><summary><span>Considered alternatives <b>{alternatives.length}</b></span><ChevronDown size={16} /></summary><div className="advanced-alternative-grid">{alternatives.map(action => <ActionCard key={action.id} action={action} />)}</div></details>}
      <section className="card advanced-assumptions"><PanelTitle eyebrow="READ THE ASSUMPTIONS" title="A plan to investigate, not a promised saving" /><ul>{plan.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></section>
    </div>}
  </>;
}
function Resource({ label, current, maximum, format }: { label: string; current: number; maximum: number; format: (n: number) => string }) {
  return <div className="advanced-resource"><div><span>{label}</span><strong>{format(current)} <small>/ {format(maximum)}</small></strong></div><div className="advanced-progress"><i style={{ width: `${maximum ? Math.min(100, Math.max(0, current / maximum * 100)) : 0}%` }} /></div></div>;
}
function ActionCard({ action, selected = false }: { action: RecoveryAction; selected?: boolean }) {
  return <article className={`advanced-action ${selected ? 'advanced-action-selected' : ''}`}><div className="advanced-action-heading"><span>{action.siteId}</span>{selected && <span><Check size={12} /> Selected</span>}</div><h3>{action.title}</h3><p>{action.description}</p><div className="advanced-action-numbers"><span><strong>{money(action.costInr)}</strong>action cost</span><span><strong>{number(action.crewHours, 1)} h</strong>crew time</span><span><strong>{number(action.dailyWaterM3, 1)} m³</strong>daily recovery</span></div><div className="advanced-exclusive"><GitBranch size={12} />One choice per group: {action.exclusiveGroup}</div></article>;
}
function Frontier({ plan }: { plan: RecoveryPlan }) {
  const maximumX = Math.max(1, ...plan.frontier.map(point => point.costInr), plan.summary.costInr);
  const maximumY = Math.max(1, ...plan.frontier.map(point => point.dailyWaterM3), plan.summary.dailyWaterM3);
  const x = (value: number) => 62 + value / maximumX * 428;
  const y = (value: number) => 220 - value / maximumY * 172;
  return <div className="advanced-frontier-chart"><svg viewBox="0 0 530 275" role="img" aria-label="Recovery frontier. Horizontal axis is action cost in rupees; vertical axis is daily recovered water in cubic metres.">
    {[0, .25, .5, .75, 1].map(part => <g key={part}><line x1="62" y1={y(maximumY * part)} x2="490" y2={y(maximumY * part)} stroke="#e6eddf" strokeDasharray="3 4" /><text x="51" y={y(maximumY * part) + 4} textAnchor="end">{number(maximumY * part, 1)}</text><text x={x(maximumX * part)} y="243" textAnchor="middle">{number(maximumX * part)}</text></g>)}
    <text x="276" y="268" textAnchor="middle">Action cost (₹)</text><text transform="translate(16 140) rotate(-90)" textAnchor="middle">Water recovery (m³ / day)</text>
    {plan.frontier.length > 1 && <polyline points={[...plan.frontier].sort((a, b) => a.costInr - b.costInr).map(point => `${x(point.costInr)},${y(point.dailyWaterM3)}`).join(' ')} fill="none" stroke="#b8cda5" strokeWidth="1.5" />}
    {plan.frontier.map((point, index) => <circle key={index} cx={x(point.costInr)} cy={y(point.dailyWaterM3)} r="4" fill="#9dbb8d" stroke="#fff" strokeWidth="1.5" tabIndex={0} aria-label={`${money(point.costInr)} cost, ${number(point.dailyWaterM3, 1)} cubic metres recovered daily, ${number(point.crewHours, 1)} crew hours`}><title>{money(point.costInr)} · {number(point.dailyWaterM3, 1)} m³/day · {number(point.crewHours, 1)} crew h</title></circle>)}
    <circle cx={x(plan.summary.costInr)} cy={y(plan.summary.dailyWaterM3)} r="7" fill="#276e55" stroke="#d9e9b9" strokeWidth="3" tabIndex={0} aria-label={`Selected plan: ${money(plan.summary.costInr)}, ${number(plan.summary.dailyWaterM3, 1)} cubic metres recovered daily`}><title>Selected plan · {money(plan.summary.costInr)} · {number(plan.summary.dailyWaterM3, 1)} m³/day</title></circle>
  </svg></div>;
}

function Replay({ siteId, onDataChange }: { siteId: string; onDataChange: () => void }) {
  const [scenario, setScenario] = useState<'leak' | 'sensor_drift' | 'healthy'>('leak');
  const [status, setStatus] = useState<ReplayStatus>('idle');
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [committing, setCommitting] = useState(false);
  const source = useRef<EventSource | null>(null);
  const commitKey = useRef('');
  useEffect(() => () => { source.current?.close(); source.current = null; }, []);
  useEffect(() => {
    source.current?.close(); source.current = null;
    setFrames([]); setReceived(0); setStatus('idle'); setError(''); setSuccess(''); setConfirm(false); commitKey.current = '';
  }, [siteId]);
  const stop = () => { source.current?.close(); source.current = null; setStatus('stopped'); };
  const start = () => {
    source.current?.close();
    setFrames([]); setReceived(0); setError(''); setSuccess(''); setConfirm(false); setStatus('connecting'); commitKey.current = crypto.randomUUID();
    const stream = new EventSource(`/api/replay?siteId=${encodeURIComponent(siteId)}&scenario=${scenario}&steps=24`);
    source.current = stream;
    stream.onopen = () => { if (source.current === stream) setStatus('running'); };
    stream.addEventListener('reading', (event: MessageEvent<string>) => {
      if (source.current !== stream) return;
      try {
        const frame = JSON.parse(event.data) as ReplayFrame;
        setFrames(current => [...current, frame].slice(-72));
        setReceived(count => count + 1);
        setStatus('running');
      } catch {
        stream.close(); source.current = null; setStatus('error'); setError('The replay returned an unreadable frame. Start a new replay to try again.');
      }
    });
    stream.addEventListener('complete', (event: MessageEvent<string>) => {
      if (source.current !== stream) return;
      stream.close(); source.current = null;
      try { const result = JSON.parse(event.data) as { count: number }; setReceived(result.count); setStatus('complete'); }
      catch { setStatus('error'); setError('The replay completion message was invalid.'); }
    });
    stream.addEventListener('error', (event: Event) => {
      if (source.current !== stream) return;
      stream.close(); source.current = null; setStatus('error');
      let message = 'The replay connection ended before completion. Captured frames are retained; restart to run the full scenario.';
      if ('data' in event && typeof event.data === 'string') {
        try { message = (JSON.parse(event.data) as { error?: string }).error || message; } catch { /* Retain the safe transport error. */ }
      }
      setError(message);
    });
  };
  const commit = async () => {
    if (!frames.length || committing) return;
    setCommitting(true); setError('');
    try {
      await api('/api/replay/commit', {
        method: 'POST', headers: { 'Idempotency-Key': commitKey.current || (commitKey.current = crypto.randomUUID()) },
        body: JSON.stringify({ readings: frames.map(frame => frame.reading), scenario }),
      });
      setConfirm(false); setFrames([]); setReceived(0); setStatus('idle'); commitKey.current = '';
      setSuccess('Replay applied. The workspace now contains these synthetic readings and newly detected incidents.');
      onDataChange();
    } catch (e) { setError((e as Error).message); }
    finally { setCommitting(false); }
  };
  const active = status === 'connecting' || status === 'running';
  const chart = useMemo(() => {
    const values = new Map<string, { timestamp: string; flow: number; expected: number }>();
    for (const frame of frames) {
      const point = values.get(frame.reading.timestamp) || { timestamp: frame.reading.timestamp, flow: 0, expected: 0 };
      point.flow += frame.reading.flowM3h; point.expected += frame.analysis.expectedFlowM3h;
      values.set(frame.reading.timestamp, point);
    }
    return [...values.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [frames]);
  const anomalies = frames.filter(frame => frame.analysis.isAnomaly).length;
  return <>
    <section className="advanced-intro advanced-replay-intro"><span className="advanced-intro-icon"><FlaskConical size={27} /></span><div><span className="advanced-kicker">CONTROLLED FAULT REPLAY</span><h2>Introduce a fault.<br /><em>Watch the system respond.</em></h2><p>Stream a synthetic scenario through the actual analysis pipeline over Server-Sent Events.</p></div><span className="advanced-outline-tag">SYNTHETIC REPLAY<br /><b>No devices connected</b></span></section>
    <section className="card advanced-replay-controls"><div><label htmlFor="replay-scenario">Fault scenario</label><div className="advanced-select"><select id="replay-scenario" value={scenario} disabled={active || committing || !!frames.length} onChange={e => setScenario(e.target.value as typeof scenario)}><option value="leak">Leak / excess flow</option><option value="sensor_drift">Sensor drift</option><option value="healthy">Healthy operation</option></select><ChevronDown size={14} /></div></div><p>24 simulated hourly steps per site<br /><span>{siteId === 'all' ? 'All demonstration sites' : siteId} · accelerated stream</span></p><div className="advanced-replay-buttons">{active ? <button className="button button-secondary" onClick={stop}><Square size={13} /> Stop replay</button> : <button className="button button-primary" disabled={committing} onClick={start}><Play size={14} /> {frames.length ? 'Run new replay' : 'Start replay'}</button>}{!!frames.length && !active && <button className="button button-secondary" disabled={committing} onClick={() => { setFrames([]); setReceived(0); setStatus('idle'); setError(''); setConfirm(false); }}>Clear frames</button>}</div></section>
    {error && <ErrorNotice message={error} />}
    {success && <div className="advanced-success" role="status"><CheckCheck size={18} /><p>{success}</p></div>}
    <div className="advanced-metrics"><Metric label="Replay state" value={title(status)} detail={active ? 'Receiving synthetic frames over SSE' : 'Workspace data is unchanged until applied'} icon={active ? Activity : ShieldCheck} /><Metric label="Received frames" value={number(received)} detail="The latest 72 frames are retained for this run" icon={Database} /><Metric label="Flagged frames" value={number(anomalies)} detail="Model flags within retained frames" icon={Target} /><Metric label="Simulated period" value={`${chart.length} h`} detail={frames.length ? `Latest ${date(frames[frames.length - 1].reading.timestamp)} UTC` : '24 hourly steps planned per selected site'} icon={Clock3} /></div>
    <section className="card advanced-replay-chart"><PanelTitle eyebrow="REPLAY OBSERVATION" title="Measured signal versus learned baseline"><span className={`advanced-stream-status ${active ? 'advanced-stream-active' : ''}`}><i />{active ? 'Streaming replay' : title(status)}</span></PanelTitle><p className="advanced-description">Flow is summed across selected sites at each timestamp. Frames pass through the same model inference as uploaded telemetry.</p>{chart.length ? <div className="advanced-replay-plot"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{ top: 20, right: 16, left: -8, bottom: 5 }}><defs><linearGradient id="advanced-replay-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#448e6b" stopOpacity={.2} /><stop offset="100%" stopColor="#448e6b" stopOpacity={.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9eee2" strokeDasharray="3 4" /><XAxis dataKey="timestamp" tickFormatter={value => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })} tick={{ fontSize: 10, fill: '#99a78c' }} minTickGap={35} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#99a78c' }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={value => `${date(String(value))} UTC`} formatter={(value, name) => [`${number(Number(value), 1)} m³/h`, name]} contentStyle={{ border: '1px solid #dce6d1', borderRadius: 6, fontSize: 11 }} /><Area name="Simulated flow" dataKey="flow" type="monotone" stroke="#287b5b" strokeWidth={2.5} fill="url(#advanced-replay-gradient)" isAnimationActive={false} /><Line name="Expected flow" dataKey="expected" type="monotone" stroke="#a0b38d" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div> : <div className="advanced-clear"><Play size={28} /><h3>Ready when you are.</h3><p>Choose a fault scenario and start the replay. Your existing workspace stays unchanged.</p></div>}<div className="advanced-replay-legend"><span><i />Simulated flow</span><span><i />Model expected flow</span><span>UTC · hourly simulated samples</span></div></section>
    {!!frames.length && <section className="card advanced-frame-section"><PanelTitle eyebrow="LATEST STREAM FRAMES" title="Inspect the model response"><span className="advanced-count">{frames.length} retained frames</span></PanelTitle><div className="advanced-table-scroll"><table><thead><tr><th>Frame</th><th>Timestamp · UTC</th><th>Site</th><th>Flow · m³/h</th><th>Anomaly score</th><th>Signal</th></tr></thead><tbody>{[...frames].reverse().slice(0, 12).map((frame, index) => <tr key={`${frame.sequence}-${frame.reading.siteId}-${index}`}><td>{frame.sequence}</td><td>{date(frame.reading.timestamp)}</td><td>{frame.reading.siteId}</td><td>{number(frame.reading.flowM3h, 1)}</td><td>{number(frame.analysis.anomalyScore, 3)}</td><td><Status status={frame.analysis.severity}>{frame.analysis.isAnomaly ? 'Flagged' : 'Expected'}</Status></td></tr>)}</tbody></table></div><div className="advanced-table-footer">Showing the newest {Math.min(frames.length, 12)} retained frames. Anomaly scores are model scores, not probabilities.</div></section>}
    {!!frames.length && !active && <section className="advanced-commit card"><div><span className="advanced-kicker">OPTIONAL · REPLACE WORKSPACE DATA</span><h3>Take this replay into the workspace.</h3><p>Apply all {frames.length} retained frames as the new dataset. Existing telemetry and incident actions will be replaced; a replay audit event will be recorded.</p></div>{!confirm ? <button className="button button-primary" onClick={() => setConfirm(true)}>Review replacement <ArrowRight size={14} /></button> : <div className="advanced-confirm-replay"><p>This replaces the current workspace. Continue?</p><div><button className="button button-secondary" disabled={committing} onClick={() => setConfirm(false)}>Cancel</button><button className="button button-primary" disabled={committing} onClick={() => void commit()}>{committing ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Apply replay & replace data</button></div></div>}</section>}
    <Note>Replay is an accelerated simulation. It does not read from or control any equipment. Stopping closes the stream; incomplete runs retain only captured frames. Idempotency protection prevents retries of the same commit from creating duplicate audit entries.</Note>
  </>;
}

function Audit() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<AuditReport>('/api/audit', { signal: controller.signal }).then(setReport)
      .catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const eventTypes = [...new Set(report?.events.map(event => event.type) || [])];
  const events = [...(report?.events || [])].filter(event => filter === 'all' || event.type === filter).sort((a, b) => b.sequence - a.sequence);
  if (loading && !report) return <Loading text="Verifying the workspace audit chain…" />;
  if (error) return <ErrorNotice message={error} retry={() => setRevision(value => value + 1)} />;
  if (!report) return null;
  return <>
    <section className={`advanced-audit-integrity ${report.integrity.valid ? '' : 'advanced-audit-invalid'}`}><span className="advanced-intro-icon"><Fingerprint size={28} /></span><div><span className="advanced-kicker">SHA-256 EVENT CHAIN</span><h2>{report.integrity.valid ? 'A traceable record of action.' : 'The audit chain needs attention.'}</h2><p>{report.integrity.message}</p><span className="advanced-audit-checked"><ShieldCheck size={13} />{number(report.integrity.checkedEvents)} events checked · {report.integrity.valid ? 'Chain verified' : 'Integrity check failed'}</span></div><div className="advanced-audit-actions"><button className="button button-secondary" onClick={() => download(report, 'aquapulse-audit-proof.json')}><ArrowDownToLine size={14} /> Download proof</button><button className="button button-secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button></div></section>
    <div className="advanced-chain-head"><span>RETURNED HEAD HASH</span><code>{report.integrity.headHash || 'No chain head — no tracked events yet.'}</code></div>
    <section className="card advanced-audit-log"><PanelTitle eyebrow="APPEND-ONLY WORKSPACE HISTORY" title="Every change has a trail"><div className="advanced-select"><select value={filter} aria-label="Filter audit event type" onChange={e => setFilter(e.target.value)}><option value="all">All event types</option>{eventTypes.map(type => <option value={type} key={type}>{title(type)}</option>)}</select><ChevronDown size={13} /></div></PanelTitle><p className="advanced-description">Workspace-wide events, newest first. Server-owned records cannot be edited or removed through the application.</p>
      {events.length ? <ol className="advanced-timeline">{events.map(event => <li key={event.id}><span className="advanced-timeline-marker"><Check size={12} /></span><div className="advanced-event"><div className="advanced-event-top"><span className="advanced-event-type">{title(event.type)}</span><span>#{event.sequence} <i>·</i> {date(event.at)} UTC</span></div><h3>{event.note || title(event.type)}</h3><p className="advanced-event-entity">Entity <code>{event.entityId || 'Workspace'}</code><span>Event <code>{event.id}</code></span></p><details className="advanced-event-proof"><summary>Inspect event proof <ChevronDown size={14} /></summary><div><div className="advanced-proof-row"><span>Previous hash</span><code>{event.previousHash || '(genesis event)'}</code></div><div className="advanced-proof-row"><span>Event hash</span><code>{event.hash}</code></div><div className="advanced-proof-row"><span>Full timestamp</span><code>{event.at}</code></div><div className="advanced-event-metadata"><span>Server-recorded metadata</span><pre>{JSON.stringify(event.metadata, null, 2)}</pre></div></div></details></div></li>)}</ol> : <div className="advanced-clear"><Fingerprint size={29} /><h3>No events match this view.</h3><p>Ingest telemetry, update an incident, apply a replay, or reset the workspace to create a tracked action.</p></div>}
      <div className="advanced-table-footer">{number(events.length)} of {number(report.events.length)} tracked events shown.</div>
    </section>
    <Note><p>{report.legacyNote}</p><p>A hash chain makes changes detectable when checked against a trusted head. It is not an external signature or immutable third-party ledger. Downloaded proof captures the chain returned by the server at this moment.</p></Note>
  </>;
}
