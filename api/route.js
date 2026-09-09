const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const buckets = new Map();

const OFFERS = [
  { provider: 'runpod', gpu: 'H200', variant: 'Pods', vram_gb: 141, hourly_price_usd: 4.59, source: 'https://www.runpod.io/pricing' },
  { provider: 'runpod', gpu: 'B200', variant: 'Pods', vram_gb: 180, hourly_price_usd: 6.79, source: 'https://www.runpod.io/pricing' },
  { provider: 'lambda', gpu: 'H100', variant: 'PCIe 1x', vram_gb: 80, hourly_price_usd: 3.29, source: 'https://lambda.ai/pricing' },
  { provider: 'lambda', gpu: 'H100', variant: 'SXM 1x', vram_gb: 80, hourly_price_usd: 4.29, source: 'https://lambda.ai/pricing' },
  { provider: 'lambda', gpu: 'B200', variant: 'SXM6 1x', vram_gb: 180, hourly_price_usd: 6.99, source: 'https://lambda.ai/pricing' }
];

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || req.socket?.remoteAddress || 'unknown')).split(',')[0].trim();
}

function rateAllowed(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const cur = buckets.get(ip);
  if (!cur || now - cur.start >= RATE_WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }
  cur.count += 1;
  return { ok: cur.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - cur.count) };
}

function authorized(req) {
  const configured = (process.env.GIUELVY_API_KEYS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (configured.length === 0) return { ok: true, mode: 'public-beta' };
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return { ok: configured.includes(token), mode: 'key-required' };
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const rl = rateAllowed(req);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) return res.status(429).json({ error: 'rate_limited', retry_after_seconds: 60 });

  const auth = authorized(req);
  if (!auth.ok) return res.status(401).json({ error: 'unauthorized', hint: 'Use Authorization: Bearer <api-key>' });

  const body = req.method === 'POST' ? (req.body || {}) : req.query;
  const gpu = String(body.gpu || '').trim().toUpperCase();
  const count = Math.min(64, Math.max(1, Number(body.count || 1)));
  const hours = Math.min(720, Math.max(0.01, Number(body.hours || 1)));
  const priority = String(body.priority || 'lowest_cost');

  if (!gpu) return res.status(400).json({ error: 'gpu_required', example: { gpu: 'H100', count: 2, hours: 6, priority: 'lowest_cost' } });
  if (!Number.isFinite(count) || !Number.isFinite(hours)) return res.status(400).json({ error: 'invalid_numeric_input' });

  const matches = OFFERS.filter(o => o.gpu.toUpperCase() === gpu)
    .map(o => ({
      ...o,
      gpu_count: count,
      hours,
      estimated_total_usd: Number((o.hourly_price_usd * count * hours).toFixed(2)),
      pricing_note: 'Listed/public price; availability, taxes, storage and other fees may vary.'
    }))
    .sort((a, b) => a.estimated_total_usd - b.estimated_total_usd);

  if (matches.length === 0) return res.status(404).json({ error: 'gpu_not_found', supported_gpus: [...new Set(OFFERS.map(o => o.gpu))] });

  return res.status(200).json({
    service: 'giuelvy-ai-compute-router',
    version: 'v1-beta',
    auth_mode: auth.mode,
    priority,
    currency: 'USD',
    query: { gpu, count, hours },
    routes: matches,
    generated_at: new Date().toISOString(),
    terms: 'https://giuelvy.it/agent-policy.html',
    docs: 'https://giuelvy.it/agent-api.html'
  });
}
