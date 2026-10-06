import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';
import { startBridge, configuration, childEnvironment } from '../src/provider.mjs';

test('official Codewhale loads the isolated provider and refreshes the loopback model catalog', { timeout: 90_000 }, async t => {
  const binary = process.env.LMM_CODEWHALE_BIN;
  assert.ok(binary, 'Set LMM_CODEWHALE_BIN to the official native Codewhale executable');
  const f = await fixture(t);
  await f.store.login(f.approve);
  const bridge = await startBridge(f.store);
  t.after(() => bridge.close());
  const config = join(f.home, 'config.toml');
  await writeFile(config, configuration(bridge.baseURL, f.modelID), { mode: 0o600 });
  let catalogReads = 0;
  const request = f.oauth.request.bind(f.oauth);
  f.oauth.request = (path, options) => {
    if (path === '/api/oauth2/catalog') catalogReads++;
    return request(path, options);
  };
  const env = childEnvironment(config, bridge.secret, { ...process.env,
    HOME: f.home, USERPROFILE: f.home, CODEWHALE_HOME: f.home,
    CODEWHALE_PROFILE: 'must-not-be-loaded', DEEPSEEK_PROFILE: 'must-not-be-loaded',
    HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
  });
  async function run(args) {
    const child = spawn(binary, ['--config', config, ...args], { cwd: f.home, env,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, `Codewhale exited unsuccessfully: ${errors.slice(-2000)}`);
    assert.doesNotMatch(output + errors, /lmm_(?:at|rt)_|must-not-be-loaded/);
    return output;
  }
  console.log((await run(['--version'])).trim());
  const update = JSON.parse(await run(['models', '--update', '--provider', 'lmm', '--json']));
  assert.equal(update.failed, 0);
  assert.ok(catalogReads > 0, 'the official host must request the authenticated local model catalog');
  const listing = JSON.parse(await run(['models', '--provider', 'lmm', '--json']));
  assert.ok(JSON.stringify(listing).includes(f.modelID), 'the exact LMM group/model ID must survive native discovery');
  assert.equal(f.state.invocations.length, 0, 'this check must not perform inference');
});
