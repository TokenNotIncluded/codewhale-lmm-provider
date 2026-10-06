import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { childEnvironment } from '../src/provider.mjs';

test('all casing variants of ambient provider settings are removed without changing the source', () => {
  const source = { PATH: '/keep/path', HOME: '/keep/home', HTTP_PROXY: 'http://127.0.0.1:1' };
  for (const prefix of ['CODEWHALE', 'DEEPSEEK', 'OPENAI']) {
    for (const field of ['API_KEY', 'BASE_URL', 'MODEL', 'DEFAULT_TEXT_MODEL', 'PROVIDER', 'PROFILE', 'HTTP_HEADERS', 'CONFIG_PATH', 'CONFIG_FILE']) {
      const key = `${prefix}_${field}`;
      for (const variant of [key, key.toLowerCase(), key[0] + key.slice(1).toLowerCase()]) source[variant] = 'must-not-inherit';
    }
  }
  const before = { ...source };
  const env = childEnvironment('/isolated/config.toml', 'local-bridge-only', Object.freeze(source));
  assert.deepEqual(source, before);
  assert.deepEqual(env, {
    PATH: '/keep/path', HOME: '/keep/home', HTTP_PROXY: 'http://127.0.0.1:1',
    CODEWHALE_CONFIG_PATH: '/isolated/config.toml', LMM_CODEWHALE_BRIDGE_TOKEN: 'local-bridge-only',
  });
});

test('a real child process cannot see mixed-case profile overrides', () => {
  const env = childEnvironment('/isolated/config.toml', 'local-bridge-only', {
    ...process.env, CodeWhale_Profile: 'personal', DeepSeek_Profile: 'personal',
    codewhale_profile: 'personal', deepseek_profile: 'personal',
  });
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    assert.equal(Object.keys(process.env).some(key => /^(codewhale|deepseek)_profile$/i.test(key)), false);
    assert.equal(process.env.CODEWHALE_CONFIG_PATH, '/isolated/config.toml');
    assert.equal(process.env.LMM_CODEWHALE_BRIDGE_TOKEN, 'local-bridge-only');
    console.log('isolated');
  `], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.trim(), 'isolated');
});
