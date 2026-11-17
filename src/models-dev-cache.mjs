// Shared runtime source; sync with scripts/sync-provider-metadata.mjs.
// Model identities, capabilities and prices come from the public API, never a bundled allowlist.
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MODELS_DEV_URL = 'https://models.dev/api.json?type=all';
const DEFAULT_TTL = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;

const object = (value         )                       => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = (value         )                  => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stringArray = (value         )                    => Array.isArray(value) && value.every((item) => typeof item === 'string');

function modelRecord(provider        , key        , value         )                                {
  if (!object(value) || !object(value.limit) || !object(value.modalities)) return undefined;
  const limit = value.limit;
  if (!nonnegative(limit.context) || !nonnegative(limit.output) ||
      (limit.input !== undefined && !nonnegative(limit.input)) ||
      !stringArray(value.modalities.input) || !stringArray(value.modalities.output) ||
      typeof value.reasoning !== 'boolean' || typeof value.tool_call !== 'boolean') return undefined;
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : key;
  if (!id.trim()) return undefined;
  const result                    = {
    id, name: typeof value.name === 'string' && value.name.trim() ? value.name : id,
    provider, source: MODELS_DEV_URL + '#' + encodeURIComponent(provider) + '/' + encodeURIComponent(id),
    limit: { context: limit.context, output: limit.output },
    modalities: { input: [...value.modalities.input], output: [...value.modalities.output] },
    reasoning: value.reasoning, tool_call: value.tool_call,
  };
  if (nonnegative(limit.input)) result.limit.input = limit.input;
  if (typeof value.canonical_model_id === 'string' && value.canonical_model_id) result.canonical_model_id = value.canonical_model_id;
  if (typeof value.type === 'string') result.type = value.type;
  if (typeof value.temperature === 'boolean') result.temperature = value.temperature;
  if (value.interleaved === true) result.interleaved = true;
  else if (object(value.interleaved) && (value.interleaved.field === 'reasoning_content' || value.interleaved.field === 'reasoning_details')) result.interleaved = { field: value.interleaved.field };
  if (Array.isArray(value.reasoning_options)) {
    result.reasoning_options = value.reasoning_options.flatMap((item) => {
      if (!object(item)) return [];
      if (item.type === 'toggle') return [{ type: 'toggle'          }];
      if (item.type === 'effort' && Array.isArray(item.values) &&
          item.values.every((v) => v === null || typeof v === 'string')) {
        return [{ type: 'effort'         , values: [...item.values]                         }];
      }
      if (item.type === 'budget_tokens') {
        const option                                                              = { type: 'budget_tokens' };
        if (typeof item.min === 'number' && Number.isFinite(item.min) && item.min >= -1) option.min = item.min;
        if (nonnegative(item.max)) option.max = item.max;
        if (option.min !== undefined && option.max !== undefined && option.min > option.max) return [];
        return [option];
      }
      return [];
    });
  }
  if (object(value.cost) && nonnegative(value.cost.input) && nonnegative(value.cost.output)) {
    result.cost = { input: value.cost.input, output: value.cost.output };
    for (const field of ['cache_read', 'cache_write', 'reasoning', 'input_audio', 'output_audio']         ) {
      if (nonnegative(value.cost[field])) result.cost[field] = value.cost[field];
    }
  }
  return result;
}

function tokens(value        )           {
  return value.normalize('NFKC').toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? [];
}
function fingerprint(value        )         {
  const parts = tokens(value);
  // Preserve number boundaries: 4.1 and 4-1 agree; 41 is a different version.
  return parts.join('') + '|' + parts.filter((part) => /^\p{N}+$/u.test(part)).join('.');
}
function numericKey(value        )         {
  return tokens(value).filter((part) => /^\p{N}+$/u.test(part)).join('.');
}
function wordKey(value        )         {
  const parts = tokens(value);
  return parts.filter((part) => !/^\p{N}+$/u.test(part)).sort().join(' ') + '|' + numericKey(value);
}
function undated(value        )         {
  return value
    .replace(/[-_. ](?:latest)$/i, '')
    .replace(/[-_. ]20\d{2}[-_. ]?(?:0[1-9]|1[0-2])[-_. ]?(?:0[1-9]|[12]\d|3[01])$/, '')
    .replace(/[-_. ](?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, '');
}
const basename = (value        ) => value.split('/').at(-1) ?? value;

function add(index                      , key        , entry       )       {
  if (!key || key === '|') return;
  const values = index.get(key);
  if (values) { if (!values.includes(entry)) values.push(entry); }
  else index.set(key, [entry]);
}
function distance(left        , right        )         {
  let older           = [];
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      let value = Math.min(previous[j]  + 1, next[j - 1]  + 1, previous[j - 1]  + (left[i - 1] === right[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        value = Math.min(value, older[j - 2]  + 1);
      }
      next[j] = value;
    }
    older = previous;
    previous = next;
  }
  return previous[right.length] ;
}
function profileKey(model                   )         {
  return JSON.stringify([model.limit, model.modalities, model.reasoning, model.reasoning_options, model.interleaved, model.tool_call, model.temperature, model.type]);
}

/** Metadata lookup never changes or authorizes a gateway request model ID. */
export class ModelsDevCatalog {
           stats                                       ;
          exact = new Map                 ();
          reordered = new Map                 ();
          dated = new Map                 ();
          numeric = new Map                 ();
          providers = new Map                ();
          memo = new Map                                       ();

  constructor(raw          ) {
    const models                      = [];
    if (object(raw)) {
      const data = object(raw.providers) ? raw.providers : raw;
      for (const [provider, value] of Object.entries(data)) {
        if (!object(value) || !object(value.models)) continue;
        this.providers.set(fingerprint(provider), provider);
        if (typeof value.name === 'string') this.providers.set(fingerprint(value.name), provider);
        for (const [id, item] of Object.entries(value.models)) {
          const model = modelRecord(provider, id, item);
          if (model) models.push(model);
        }
      }
    }
    const canonical = new Set(models.flatMap((model) => model.canonical_model_id ? [fingerprint(model.canonical_model_id)] : []));
    const providerCount = new Set(models.map((model) => model.provider)).size;
    this.stats = { providers: providerCount, models: models.length };
    for (const model of models) {
      const qualified = model.id.startsWith(model.provider + '/') ? model.id : model.provider + '/' + model.id;
      const identity = model.canonical_model_id ?? qualified;
      const aliases = [...new Set([model.id, model.name, qualified, model.canonical_model_id].filter((v)              => !!v))];
      const entry        = { model, aliases, identity: fingerprint(identity), direct: canonical.has(fingerprint(qualified)) };
      for (const alias of aliases) {
        for (const variant of new Set([alias, basename(alias)])) {
          add(this.exact, fingerprint(variant), entry);
          add(this.reordered, wordKey(variant), entry);
          add(this.dated, wordKey(undated(variant)), entry);
          add(this.numeric, numericKey(undated(variant)), entry);
        }
      }
    }
  }

          choose(entries         , preferred         )                                {
    let candidates = entries;
    if (preferred) {
      const sameProvider = candidates.filter((entry) => entry.model.provider === preferred);
      if (sameProvider.length) candidates = sameProvider;
    }
    const direct = candidates.filter((entry) => entry.direct);
    if (direct.length) candidates = direct;
    if (new Set(candidates.map((entry) => entry.identity)).size !== 1) return undefined;
    if (new Set(candidates.map((entry) => profileKey(entry.model))).size !== 1) return undefined;
    const sorted = [...candidates].sort((a, b) => a.model.provider.localeCompare(b.model.provider) || a.model.id.localeCompare(b.model.id));
    const chosen = sorted[0]?.model;
    if (!chosen) return undefined;
    // Different hosting prices are not interchangeable; preserve capabilities without inventing a rate.
    if (new Set(candidates.map((entry) => JSON.stringify(entry.model.cost))).size > 1) {
      const { cost: _cost, ...withoutCost } = chosen;
      return withoutCost;
    }
    return chosen;
  }

  resolve(modelId        , providerHint         )                                {
    const cacheKey = (providerHint ?? '') + '\0' + modelId;
    if (this.memo.has(cacheKey)) return this.memo.get(cacheKey);
    const result = this.find(modelId, providerHint);
    this.memo.set(cacheKey, result);
    return result;
  }

          find(modelId        , providerHint         )                                {
    if (!modelId.trim()) return undefined;
    const prefix = modelId.includes('/') ? modelId.split('/')[0] : undefined;
    const preferred = this.providers.get(fingerprint(providerHint ?? prefix ?? ''));
    const variants = [...new Set([modelId, basename(modelId)])];
    for (const [index, key] of [
      [this.exact, fingerprint], [this.reordered, wordKey],
      [this.dated, (value        ) => wordKey(undated(value))],
    ]         ) {
      for (const variant of variants) {
        const entries = index.get(key(variant));
        if (entries?.length) return this.choose(entries, preferred);
      }
    }
    const query = undated(basename(modelId));
    const queryWords = tokens(query).filter((part) => !/^\p{N}+$/u.test(part)).sort();
    const queryLetters = queryWords.join('');
    if (queryLetters.length < 5) return undefined;
    const scored = new Map               ();
    for (const entry of this.numeric.get(numericKey(query)) ?? []) {
      for (const alias of entry.aliases) {
        const value = undated(basename(alias));
        if (numericKey(value) !== numericKey(query)) continue;
        const words = tokens(value).filter((part) => !/^\p{N}+$/u.test(part)).sort();
        if (words.length !== queryWords.length) continue;
        const different = words.filter((word, i) => word !== queryWords[i]).length;
        if (different !== 1) continue;
        const letters = words.join('');
        const edits = distance(queryLetters, letters);
        const score = 1 - edits / Math.max(queryLetters.length, letters.length);
        if (edits <= 2 && score >= 0.86) scored.set(entry, Math.max(scored.get(entry) ?? 0, score));
      }
    }
    if (!scored.size) return undefined;
    const best = Math.max(...scored.values());
    // A near-tie between different model identities is unknown, not an arbitrary winner.
    return this.choose([...scored].filter(([, score]) => best - score < 0.04).map(([entry]) => entry), preferred);
  }
}

export function parseModelsDev(raw         )                   { return new ModelsDevCatalog(raw); }

const stateSymbol = Symbol.for('lmm.models.dev.cache.v1');
const shared = globalThis                                                             ;
const states = shared[stateSymbol] ?? (shared[stateSymbol] = new Map               ());
const emptyCatalog = new ModelsDevCatalog();

function defaultCachePath()         {
  if (process.env.LMM_MODELS_DEV_CACHE) return process.env.LMM_MODELS_DEV_CACHE;
  const platformCache = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : join(homedir(), '.cache');
  return join(process.env.XDG_CACHE_HOME || platformCache, 'lmm', 'models-dev-v1.json');
}

export function peekModelsDev(cachePath = defaultCachePath())                   {
  return states.get(cachePath)?.catalog ?? emptyCatalog;
}
function ttl(options                      )         {
  const configured = options.ttlMs ?? (process.env.LMM_MODELS_DEV_TTL_MS ? Number(process.env.LMM_MODELS_DEV_TTL_MS) : DEFAULT_TTL);
  return nonnegative(configured) ? configured : DEFAULT_TTL;
}
async function persist(cachePath        , envelope               )                {
  const temporary = cachePath + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
    await rename(temporary, cachePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Fetch public metadata only. Failure preserves stale metadata or returns an empty reference catalogue. */
export async function loadModelsDev(options                       = {})                            {
  const cachePath = options.cachePath ?? defaultCachePath();
  let state = states.get(cachePath);
  if (!state) {
    state = { catalog: emptyCatalog, loaded: false, fetchedAt: 0, retryAt: 0 };
    states.set(cachePath, state);
  }
  if (state.pending) return state.pending;
  const now = options.now ?? Date.now;
  const current = now();
  if (state.loaded && (current < state.retryAt || (state.fetchedAt > 0 && current - state.fetchedAt < ttl(options)))) return state.catalog;
  const target = state;
  const pending = (async ()                            => {
    if (!target.loaded) {
      target.loaded = true;
      try {
        const disk          = JSON.parse(await readFile(cachePath, 'utf8'));
        if (object(disk) && disk.version === 1 && disk.source === MODELS_DEV_URL &&
            nonnegative(disk.fetchedAt) && disk.fetchedAt <= now()) {
          const catalog = parseModelsDev(disk.data);
          if (catalog.stats.models) {
            target.catalog = catalog;
            target.fetchedAt = disk.fetchedAt;
            target.envelope = { version: 1, source: MODELS_DEV_URL, fetchedAt: disk.fetchedAt, data: disk.data };
            if (typeof disk.etag === 'string' && !/[\r\n]/.test(disk.etag)) target.envelope.etag = disk.etag;
          }
        }
      } catch { /* Invalid or absent cache is not a model-discovery failure. */ }
      if (target.fetchedAt > 0 && now() - target.fetchedAt < ttl(options)) return target.catalog;
    }
    try {
      const headers                         = { accept: 'application/json', 'user-agent': 'lmm-model-metadata/1' };
      if (target.envelope?.etag) headers['if-none-match'] = target.envelope.etag;
      const response = await (options.fetch ?? globalThis.fetch)(MODELS_DEV_URL, {
        headers, signal: AbortSignal.timeout(options.timeoutMs ?? 6000), credentials: 'omit',
      });
      let envelope               ;
      if (response.status === 304 && target.envelope) {
        envelope = { ...target.envelope, fetchedAt: now() };
      } else {
        if (!response.ok) throw new Error('models.dev HTTP ' + response.status);
        const data          = await response.json();
        const catalog = parseModelsDev(data);
        if (!catalog.stats.models) throw new Error('models.dev returned no valid model records');
        envelope = { version: 1, source: MODELS_DEV_URL, fetchedAt: now(), data };
        const etag = response.headers.get('etag');
        if (etag && !/[\r\n]/.test(etag)) envelope.etag = etag;
        target.catalog = catalog;
      }
      target.envelope = envelope;
      target.fetchedAt = envelope.fetchedAt;
      target.retryAt = 0;
      await persist(cachePath, envelope).catch(() => {});
    } catch {
      target.retryAt = now() + RETRY_DELAY;
    }
    return target.catalog;
  })();
  target.pending = pending;
  try { return await pending; }
  finally { if (target.pending === pending) target.pending = undefined; }
}
