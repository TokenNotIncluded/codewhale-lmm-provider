import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { CALLBACK_PATH, CLIENT_ID, SCOPES } from '../src/oauth.mjs';
import { exportNativePlugin, UPSTREAM_PR } from '../src/native.mjs';
import { fixture } from './fixture.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const encoded = value => Buffer.from(value).toString('base64url');
async function setup(t, { issuer = 'https://api.lmm.best', group = 'default', model = 'example-model' } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'lmm-native-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const groupID = encoded(group), id = `lmm:${groupID}:${encoded(model)}`;
  const session = { issuer, client_id: CLIENT_ID, resource: `${issuer}/api/oauth2`,
    scope: [...SCOPES, `group:${groupID}`].join(' '), access: 'lmm_at_NEVER_EXPORT', refresh: 'lmm_rt_NEVER_EXPORT' };
  const raw = { schema_version: 1, resource: session.resource,
    groups: [{ id: groupID, name: group, scope: `group:${groupID}` }],
    models: [{ id, group_id: groupID, group, upstream_model: model, name: model,
      apis: ['openai-completions'], pricing: { input: null, output: null } }] };
  let reads = 0;
  const store = { oauth: { issuer, resource: session.resource, async request(path, options) {
    assert.equal(path, '/api/oauth2/catalog');
    assert.equal(options.access, session.access);
    return structuredClone(raw);
  } }, async access() { reads++; return session; } };
  const output = join(home, 'bundle');
  return { home, output, store, raw, session, id, groupID, reads: () => reads };
}
async function readBundle(result) {
  const manifest = JSON.parse(await readFile(join(result.directory, 'plugin.json'), 'utf8'));
  return { manifest, provider: manifest.extensions['net.codewhale'].providers[result.provider] };
}

test('exports exact wire model/group and the registered public OAuth contract', async t => {
  const f = await setup(t);
  const result = await exportNativePlugin(f.store, f.id, f.output);
  const { manifest, provider } = await readBundle(result);
  assert.equal(manifest.version, packageInfo.version);
  assert.equal(manifest.homepage, UPSTREAM_PR);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/plugin.json');
  assert.match(result.provider, /^lmm-[a-f0-9]{32}$/);
  assert.equal(manifest.name, result.plugin);
  assert.deepEqual(provider, {
    base_url: 'https://api.lmm.best/v1', model: 'example-model', models: ['example-model'],
    http_headers: { 'X-LMM-Group': f.groupID },
    oauth: { issuer: 'https://api.lmm.best', authorization_endpoint: 'https://api.lmm.best/api/oauth2/authorize',
      token_endpoint: 'https://api.lmm.best/api/oauth2/token', client_id: CLIENT_ID,
      scopes: SCOPES, resource: 'https://api.lmm.best/api/oauth2', callback_path: CALLBACK_PATH },
  });
  assert.equal(result.catalog_id, f.id);
  assert.equal(result.model, 'example-model');
  assert.deepEqual((await readdir(f.output)).sort(), ['README.md', 'plugin.json']);
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.output)).mode & 0o077, 0);
    assert.equal((await stat(join(f.output, 'plugin.json'))).mode & 0o077, 0);
  }
});

test('bundle contains no credentials, prices, executable hooks or trust receipts', async t => {
  const f = await setup(t);
  Object.assign(f.raw.models[0], { api_key: 'DO_NOT_COPY', oauth: { client_secret: 'DO_NOT_COPY' }, context_window: 999999 });
  const result = await exportNativePlugin(f.store, f.id, f.output);
  const manifest = await readFile(join(f.output, 'plugin.json'), 'utf8');
  assert.doesNotMatch(manifest, /NEVER_EXPORT|DO_NOT_COPY|api_key|client_secret|pricing|context_window|refresh_token|access_token/);
  assert.deepEqual(Object.keys(JSON.parse(manifest).extensions['net.codewhale']), ['providers']);
  const readme = await readFile(join(f.output, 'README.md'), 'utf8');
  assert.ok(readme.includes(UPSTREAM_PR));
  assert.ok(readme.includes(`auth plugin-login --provider ${result.provider}`));
  assert.match(readme, /does NOT revoke/);
  assert.match(readme, /never writes trust receipts/);
  assert.doesNotMatch(readme, /NEVER_EXPORT|DO_NOT_COPY/);
});

test('model text is data, never interpolated into shell instructions', async t => {
  const model = '$(touch should-not-exist)`unsafe`';
  const f = await setup(t, { model });
  const result = await exportNativePlugin(f.store, f.id, f.output);
  assert.equal((await readBundle(result)).provider.model, model);
  assert.ok(!(await readFile(join(f.output, 'README.md'), 'utf8')).includes(model));
});

test('re-export is deterministic and retains a group identity when changing its model', async t => {
  const f = await setup(t);
  const first = await exportNativePlugin(f.store, f.id, f.output);
  const next = await exportNativePlugin(f.store, f.id, join(f.home, 'next'));
  assert.deepEqual(await readBundle(first), await readBundle(next));
  const other = await setup(t, { model: 'another-model' });
  const changed = await exportNativePlugin(other.store, other.id, other.output);
  assert.equal(changed.provider, first.provider);
  assert.notDeepEqual((await readBundle(changed)).manifest, (await readBundle(first)).manifest);
});

test('provider identity binds issuer and preserves case-sensitive group identities', async t => {
  const ids = [];
  for (const options of [{ group: 'A' }, { group: 'a' }, { group: 'A', issuer: 'https://other.example' }]) {
    const f = await setup(t, options);
    const result = await exportNativePlugin(f.store, f.id, f.output);
    ids.push(result.provider);
    assert.equal((await readBundle(result)).provider.http_headers['X-LMM-Group'], f.groupID);
  }
  assert.equal(new Set(ids).size, 3);
});

test('requires an explicit exact catalog ID even when only one model exists', async t => {
  const f = await setup(t);
  for (const id of [undefined, '', 'example-model', 'lmm:wrong:model']) {
    await assert.rejects(exportNativePlugin(f.store, id, f.output));
  }
  assert.deepEqual(await readdir(f.home), []);
});

for (const apis of [['openai-responses'], ['anthropic-messages'], []]) {
  test(`refuses a model without Chat Completions: ${JSON.stringify(apis)}`, async t => {
    const f = await setup(t);
    f.raw.models[0].apis = apis;
    await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /not available/);
    assert.deepEqual(await readdir(f.home), []);
  });
}

test('rejects a group outside the current grant and a removed invoke permission', async t => {
  const f = await setup(t);
  f.session.scope = SCOPES.join(' ');
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /outside/);
  f.session.scope = `catalog:read group:${f.groupID}`;
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /no longer permits/);
  assert.deepEqual(await readdir(f.home), []);
});

test('rejects resource, issuer and client mismatches', async t => {
  for (const key of ['resource', 'issuer', 'client_id']) {
    const f = await setup(t);
    f.session[key] = 'https://wrong.example';
    await assert.rejects(exportNativePlugin(f.store, f.id, f.output));
    assert.deepEqual(await readdir(f.home), []);
  }
});

for (const model of ['a'.repeat(257), '界'.repeat(86), ' model', 'model ']) {
  test(`rejects native model limits (${Buffer.byteLength(model)} bytes, ${model.length} code units)`, async t => {
    const f = await setup(t, { model });
    await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /cannot be represented/);
    assert.deepEqual(await readdir(f.home), []);
  });
}

test('accepts the host 256-byte model boundary', async t => {
  const f = await setup(t, { model: '界'.repeat(85) + 'a' });
  const result = await exportNativePlugin(f.store, f.id, f.output);
  assert.equal(Buffer.byteLength((await readBundle(result)).provider.model), 256);
});

test('refuses existing directories and files before touching the catalog login', async t => {
  const f = await setup(t);
  await mkdir(f.output);
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /already exists/);
  const file = join(f.home, 'untouched');
  await writeFile(file, 'keep');
  await assert.rejects(exportNativePlugin(f.store, f.id, file), /already exists/);
  assert.equal(await readFile(file, 'utf8'), 'keep');
  assert.deepEqual(await readdir(f.output), []);
  assert.equal(f.reads(), 0);
});

test('refuses a symlink destination', { skip: process.platform === 'win32' }, async t => {
  const f = await setup(t);
  const elsewhere = join(f.home, 'elsewhere');
  await mkdir(elsewhere);
  await symlink(elsewhere, f.output);
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output), /already exists/);
  assert.deepEqual(await readdir(elsewhere), []);
  assert.equal(f.reads(), 0);
});

test('concurrent exporters cannot overwrite an existing bundle', async t => {
  const f = await setup(t);
  const results = await Promise.allSettled([
    exportNativePlugin(f.store, f.id, f.output), exportNativePlugin(f.store, f.id, f.output),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(JSON.parse(await readFile(join(f.output, 'plugin.json'), 'utf8')).version, packageInfo.version);
});

test('cancellation before or during catalog access leaves no bundle', async t => {
  const f = await setup(t);
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output, AbortSignal.abort()));
  assert.equal(f.reads(), 0);
  const controller = new AbortController();
  const request = f.store.oauth.request;
  f.store.oauth.request = async (...args) => { controller.abort(); return request(...args); };
  await assert.rejects(exportNativePlugin(f.store, f.id, f.output, controller.signal));
  assert.deepEqual(await readdir(f.home), []);
});

test('CLI validates native options before creating credentials or writing output', async t => {
  const f = await setup(t);
  const privateHome = join(f.home, 'not-created');
  for (const args of [
    ['export-plugin'], ['export-plugin', '--model', f.id], ['export-plugin', '--output', f.output],
    ['models', '--output', f.output], ['login', '--model', f.id],
    ['export-plugin', '--model', f.id, '--output', f.output, '--', 'exec', 'not-run'],
  ]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], {
      env: { ...process.env, LMM_CODEWHALE_HOME: privateHome },
    }));
  }
  assert.deepEqual(await readdir(f.home), []);
});

test('CLI exports from real HTTP OAuth/catalog without inference or credential transfer', async t => {
  const f = await fixture(t);
  await f.store.login(f.approve);
  const before = await readFile(join(f.home, 'session.json'), 'utf8');
  const output = join(f.home, 'export');
  const { stdout } = await exec(process.execPath, [cli, 'export-plugin', '--issuer', f.issuer, '--model', f.modelID, '--output', output], {
    env: { ...process.env, LMM_CODEWHALE_HOME: f.home },
  });
  const result = JSON.parse(stdout);
  const { provider } = await readBundle(result);
  assert.equal(provider.http_headers['X-LMM-Group'], f.groupID);
  assert.equal(provider.oauth.callback_path, CALLBACK_PATH);
  assert.equal(provider.base_url, `${f.issuer}/v1`);
  assert.equal(await readFile(join(f.home, 'session.json'), 'utf8'), before);
  assert.equal(f.state.invocations.length, 0);
  assert.equal(f.state.refreshes, 0);
  assert.doesNotMatch(stdout + await readFile(join(output, 'plugin.json'), 'utf8'), /lmm_at_|lmm_rt_/);
});
