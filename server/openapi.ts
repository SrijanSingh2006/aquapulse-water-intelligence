const reading = {
  type: 'object', required: ['timestamp','siteId','assetId','flowM3h','conductivityUsCm','temperatureC','ph','productionIndex'],
  properties: {
    timestamp: { type: 'string', format: 'date-time', description: 'UTC hour, consecutive per asset, no duplicates.' },
    siteId: { type: 'string', enum: ['BLR-01','PUN-02','CHE-03'] }, assetId: { type: 'string' },
    flowM3h: { type: 'number', minimum: 0, maximum: 250 }, conductivityUsCm: { type: 'number', minimum: 10, maximum: 15000 },
    temperatureC: { type: 'number', minimum: 0, maximum: 80 }, ph: { type: 'number', minimum: 0, maximum: 14 },
    productionIndex: { type: 'number', minimum: 0, maximum: 2 },
  },
};
const json = (schema: unknown) => ({ 'application/json': { schema } });
const ok = { description: 'Successful response', content: json({ type: 'object' }) };
const errors = Object.fromEntries([400,403,404,409,413,415,503].map(code => [code, {
  description: ({400:'Invalid input',403:'Cross-origin writes forbidden',404:'Not found',409:'Conflict or workspace write limit',413:'Body exceeds 2 MB',415:'Send application/json',503:'Service unavailable'} as Record<number,string>)[code],
  content: json({ type: 'object', properties: { error: { type: 'string' } } }),
}]));
const scope = [
  { name: 'siteId', in: 'query', schema: { type: 'string', enum: ['all','BLR-01','PUN-02','CHE-03'], default: 'all' } },
  { name: 'hours', in: 'query', schema: { type: 'integer', enum: [24,168], default: 24 } },
];
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const telemetry = { type: 'object', required: ['readings'], properties: {
  readings: { type: 'array', minItems: 1, maxItems: 5000, items: { $ref: '#/components/schemas/Reading' } },
} };
const idempotency = { name: 'Idempotency-Key', in: 'header', description: 'Same key and canonical body returns the first result without another mutation. A different body conflicts.', schema: { type: 'string', pattern: '^[A-Za-z0-9:_-]{8,100}$' } };
export const openApi = {
  openapi: '3.1.0', info: { title: 'AquaPulse Operations API', version: '2.0.0', description: 'Independent synthetic-data portfolio application. Cookies isolate anonymous workspaces; trusted hosted identity takes precedence. All POST requests are same-origin. Responses include X-Request-Id, W3C traceparent and Server-Timing. Model and scenario outputs support review, not equipment control.' },
  servers: [{ url: '/' }],
  paths: {
    '/api/health': { get: { summary: 'Check all three SQL tables', responses: { 200: ok, 503: { description: 'Binding or schema unavailable', content: json({ type: 'object', properties: { ok: { type: 'boolean' }, database: { type: 'string' } } }) } } } },
    '/api/openapi.json': { get: { summary: 'Read this OpenAPI document', responses: { 200: ok } } },
    '/api/model': { get: { summary: 'Inspect model provenance and synthetic evaluation', responses: { 200: ok, ...errors } } },
    '/api/dashboard': { get: { summary: 'Read workspace telemetry, analyses, forecasts and incidents', parameters: scope, responses: { 200: ok, ...errors } } },
    '/api/assurance': { get: { summary: 'Assess data quality and PSI against the frozen training reference', parameters: scope, responses: { 200: ok, ...errors } } },
    '/api/export': { get: { summary: 'Download selected telemetry as CSV', parameters: scope, responses: { 200: { description: 'CSV readings', content: { 'text/csv': { schema: { type: 'string' } } } }, ...errors } } },
    '/api/ingest': { post: { summary: 'Replace telemetry; atomically append an audit event', parameters: [{ ...idempotency, required: false }], requestBody: body(telemetry), responses: { 200: ok, ...errors } } },
    '/api/reset': { post: { summary: 'Restore seed data while preserving the audit chain', requestBody: body({ type: 'object' }), responses: { 200: ok, ...errors } } },
    '/api/incidents/{id}': { post: { summary: 'Record an incident transition and append its operator note to the audit chain', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: body({ type: 'object', required: ['status','note'], properties: { status: { type: 'string', enum: ['acknowledged','resolved'] }, note: { type: 'string', minLength: 3, maxLength: 1000 } } }), responses: { 200: ok, ...errors } } },
    '/api/planner': { post: { summary: 'Exactly optimize hypothetical recovery actions under budget and crew limits', description: 'No writes. Maximizes horizon water value minus intervention cost, with at most one option per site.', requestBody: body({ type: 'object', required: ['budgetInr','crewHours','tariffInrM3','horizonDays'], properties: {
      siteId: { type: 'string', enum: ['all','BLR-01','PUN-02','CHE-03'], default: 'all' },
      budgetInr: { type: 'number', minimum: 0, maximum: 1000000 }, crewHours: { type: 'number', minimum: 0, maximum: 100 },
      tariffInrM3: { type: 'number', minimum: 0, maximum: 10000 }, horizonDays: { type: 'integer', minimum: 1, maximum: 365 },
    } }), responses: { 200: ok, ...errors } } },
    '/api/replay': { get: { summary: 'Stream bounded synthetic fault scenarios without modifying the workspace', parameters: [scope[0],
      { name: 'scenario', in: 'query', schema: { type: 'string', enum: ['healthy','leak','sensor_drift'], default: 'healthy' } },
      { name: 'steps', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 48, default: 24 } },
    ], responses: { 200: { description: 'SSE reading frames {sequence,reading,analysis}, then complete {count,scenario}. One hourly sample per site per step; 100 ms replay pacing per event. Close to stop. Automatic reconnection is not used by the UI.', content: { 'text/event-stream': { schema: { type: 'string' } } } }, ...errors } } },
    '/api/replay/commit': { post: { summary: 'Idempotently replace workspace data with reviewed synthetic replay', parameters: [{ ...idempotency, required: true }], requestBody: body({ ...telemetry, required: ['readings','scenario'], properties: { ...telemetry.properties, scenario: { type: 'string', enum: ['healthy','leak','sensor_drift'] } } }), responses: { 200: ok, ...errors } } },
    '/api/audit': { get: { summary: 'Read all recorded workspace events and verify the SHA-256 chain', description: 'Maximum 1,000 writes per workspace. The SQL history and stored workspace head are the trust boundary, not an independent public ledger.', responses: { 200: ok, ...errors } } },
  },
  components: { schemas: { Reading: reading } },
};
