import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('plugin.json'));
const pkg = JSON.parse(read('package.json'));
const provider = manifest.extensions['net.codewhale'].providers.lmm;
const issuer = 'https://api.lmm.best';

test('one native provider has matching package identity and no fixed account model', () => {
  assert.equal(manifest.name, 'codewhale-lmm-provider');
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(Object.keys(manifest.extensions), ['net.codewhale']);
  assert.deepEqual(Object.keys(manifest.extensions['net.codewhale']), ['providers']);
  assert.deepEqual(Object.keys(manifest.extensions['net.codewhale'].providers), ['lmm']);
  assert.deepEqual(Object.keys(provider).sort(), ['base_url', 'oauth']);
  assert.equal(provider.base_url, `${issuer}/api/oauth2/openai/v1`);
});

test('one public OAuth client owns catalog and inference authorization', () => {
  assert.deepEqual(provider.oauth, {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth2/authorize`,
    token_endpoint: `${issuer}/api/oauth2/token`,
    client_id: 'lmm-codewhale',
    scopes: ['catalog:read', 'balance:read', 'usage:read', 'models:invoke'],
    resource: `${issuer}/api/oauth2`,
    callback_path: '/oauth/lmm/callback',
  });
});

test('all public endpoints share the reviewed HTTPS issuer without credentials', () => {
  for (const endpoint of [provider.base_url, provider.oauth.issuer,
    provider.oauth.authorization_endpoint, provider.oauth.token_endpoint, provider.oauth.resource]) {
    const url = new URL(endpoint);
    assert.equal(url.origin, issuer);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  assert(!JSON.stringify(manifest).includes('X-LMM-Group'));
  assert(!JSON.stringify(manifest).includes('client_secret'));
});

test('package has no executable entry, runtime dependency or install hook', () => {
  for (const key of ['bin', 'main', 'exports', 'dependencies', 'optionalDependencies', 'bundledDependencies']) {
    assert.equal(pkg[key], undefined, key);
  }
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['check', 'pack:check', 'test']);
  assert.deepEqual(pkg.files, ['plugin.json', 'skills', 'README.md', 'LICENSE']);
});

test('old companion runtime and environment workflow are removed, not hidden', () => {
  for (const path of ['src', 'test/native-host.mjs', '.github/workflows/windows-environment.yml']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  assert(!read('.github/workflows/ci.yml').includes('test:host'));
});

test('README names actual dependencies, one login and local-only logout', () => {
  const readme = read('README.md');
  for (const text of ['/login lmm', '/logout lmm', '尚未发布到 npm',
    'https://github.com/codewhale-hq/Codewhale/pull/6805',
    'https://github.com/LIghtJUNction/Codewhale/pull/1',
    'https://github.com/TokenNotIncluded/api.lmm.best/pull/672']) assert(readme.includes(text), text);
  assert(readme.includes('403'));
  assert(!/^codewhale-lmm /m.test(readme));
  assert(!/^npm install/m.test(readme));
});

test('guidance never asks the model to manage user credentials', () => {
  const skill = read('skills/lmm/SKILL.md');
  assert(skill.includes('Do not read host or old companion credentials.'));
  assert(skill.includes('model requests can create charges.'));
  assert(skill.includes('guidance only'));
});

test('published tarball contains only the native bundle, not tests or old runtime', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [pack] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
  }));
  assert.deepEqual(pack.files.map(file => file.path).sort(),
    ['LICENSE', 'README.md', 'package.json', 'plugin.json', 'skills/lmm/SKILL.md'].sort());
  assert(pack.files.every(file => file.size > 0));
});
