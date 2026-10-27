import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
test('CLI direct entrypoint prints help without touching account credentials', () => {
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /codewhale-lmm login/);
});
test('npm-style symlink entrypoint actually executes the CLI', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codewhale-bin-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'codewhale-lmm');
  await symlink(cli, bin);
  assert.match(execFileSync(bin, ['--help'], { encoding: 'utf8' }), /codewhale-lmm login/);
});
test('models CLI preserves full authorized catalog metadata for unsupported protocols', async t => {
  const f = await fixture(t);
  await f.store.login(f.approve);
  const session = await f.store.access();
  const raw = await f.oauth.request('/api/oauth2/catalog', { access: session.access });
  f.state.models = [{ ...raw.models[0], apis: ['openai-responses'], native_cost: null,
    pricing: { input: null, output: 0.125, currency: 'USD', unit: 'per_1m_tokens' } }];
  const child = spawn(process.execPath, [cli, 'models', '--issuer', f.issuer], {
    env: { ...process.env, LMM_CODEWHALE_HOME: f.home }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, errors);
  assert.deepEqual(JSON.parse(output), f.state.models);
  assert.doesNotMatch(output + errors, /lmm_(?:at|rt)_/);
  assert.equal(f.state.invocations.length, 0);
});

test('unknown arguments fail without leaking argument values through exceptions', () => {
  const result = spawnSync(process.execPath, [cli, '--FAKE_SECRET_MUST_NOT_LEAK'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /FAKE_SECRET_MUST_NOT_LEAK/);
  assert.match(result.stderr, /No credential was printed/);
});
