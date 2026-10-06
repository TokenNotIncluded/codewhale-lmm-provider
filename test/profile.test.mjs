import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from '../src/provider.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
test('new and legacy profile overrides cannot replace the temporary provider configuration', () => {
  const source = { PATH: '/bin', CODEWHALE_PROFILE: 'personal', DEEPSEEK_PROFILE: 'legacy',
    CODEWHALE_HOME: '/private/home', CODEWHALE_CONFIG_FILE: '/personal/config.toml' };
  const env = childEnvironment('/private/run/config.toml', 'LOCAL', source);
  assert.equal(env.CODEWHALE_PROFILE, undefined);
  assert.equal(env.DEEPSEEK_PROFILE, undefined);
  assert.equal(env.CODEWHALE_CONFIG_FILE, undefined);
  assert.equal(env.CODEWHALE_CONFIG_PATH, '/private/run/config.toml');
  assert.equal(env.CODEWHALE_HOME, source.CODEWHALE_HOME);
  assert.equal(source.CODEWHALE_PROFILE, 'personal', 'the parent environment must not be mutated');
});
test('profile arguments fail before loading credentials, without exposing their values', () => {
  for (const args of [['--profile', 'PRIVATE_PROFILE'], ['--profile=PRIVATE_PROFILE']]) {
    const result = spawnSync(process.execPath, [cli, 'run', '--', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Do not override/);
    assert.doesNotMatch(result.stderr, /PRIVATE_PROFILE/);
  }
});
