import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { CALLBACK_PATH, CLIENT_ID, SCOPES, check, issuerURL, scopes, text } from './oauth.mjs';
import { catalog, selectModel } from './provider.mjs';

export const UPSTREAM_PR = 'https://github.com/codewhale-hq/Codewhale/pull/6805';

function instructions(name, provider) {
  // Only locally generated identifiers enter command examples, never catalog text.
  return `# LMM native provider\n\nRequires the provider capability added by ${UPSTREAM_PR}.\nCheck with: codewhale auth plugin-login --help\n\nThis bundle declares one selected Chat Completions model and one fixed group.\nReview the exact model, X-LMM-Group and OAuth endpoints in plugin.json.\nNo credentials or executable code are included.\n\nStart Codewhale in this directory, then use these session commands:\n\n\`\`\`text\n/plugin install .\n/plugin validate ${name}\n/plugin enable ${name}\n\`\`\`\n\nReview the bundle. Run the exact trust command printed by Codewhale, then\nrun /plugin enable ${name} again. This exporter never writes trust receipts.\nExit and start a new runtime after enabling or updating the provider.\n\nSign in from your terminal and use the declared default model:\n\n\`\`\`sh\ncodewhale auth plugin-login --provider ${provider}\ncodewhale --provider ${provider}\n\`\`\`\n\nCodewhale owns this separate login, token storage and refresh. No companion\nproxy, temporary config or codewhale-lmm run process is used for inference.\nThe catalog login used to export this bundle is not transferred to Codewhale.\nYou can revoke that separate companion login with codewhale-lmm logout.\nDo not copy session.json or tokens into this bundle.\n\nThe model list is a reviewed snapshot, not live LMM catalog discovery.\nExport again and review the update when changing the selected model or group.\nA model declaration is not a server-side model allowlist or a spending cap;\nthe LMM grant and current server permissions still govern each request.\nPrices, context length and unsupported protocols are not invented.\n\nLocal logout:\n\n\`\`\`sh\ncodewhale auth plugin-logout --provider ${provider}\n\`\`\`\n\nThis only removes Codewhale's local credential. It does NOT revoke the remote\nLMM grant. Use the server's authorization controls for remote revocation.\ncodewhale-lmm logout cannot revoke a separate host-owned login.\n`;
}

/** Export public declarations only; never install, trust, or transfer a login. */
export async function exportNativePlugin(store, modelID, output, signal) {
  check(typeof modelID === 'string' && modelID.length > 0, 'export-plugin requires --model <exact-catalog-id>.');
  check(typeof output === 'string' && output.trim().length > 0, 'export-plugin requires --output <new-directory>.');
  text(output);
  signal?.throwIfAborted();

  // Require a new leaf under an existing parent. Never overwrite an installed
  // bundle, repository, credential file, or symlink, including an empty directory.
  const requested = resolve(output);
  const directory = join(await realpath(dirname(requested)), basename(requested));
  const existing = await lstat(directory).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  check(!existing, 'Export destination already exists. Choose a new directory, then review the plugin update.');

  const issuer = issuerURL(store.oauth.issuer);
  check(store.oauth.resource === `${issuer}/api/oauth2`, 'LMM resource does not match the configured issuer.');
  const { session, models } = await catalog(store, signal);
  check(session.issuer === issuer && session.client_id === CLIENT_ID, 'Catalog login does not belong to this LMM client and issuer.');
  check(scopes(session.scope).includes('models:invoke'), 'This login no longer permits model invocation.');
  const selected = selectModel(models, modelID);
  const model = text(selected.upstream_model);
  // Codewhale bounds Rust strings in bytes, not JavaScript UTF-16 code units.
  check(model.trim() === model && Buffer.byteLength(model, 'utf8') <= 256,
    'The selected model ID cannot be represented by Codewhale native provider declarations.');
  check(Buffer.byteLength(selected.group_id, 'utf8') <= 4096, 'The selected group exceeds the native header limit.');

  // Base64url group IDs are case-sensitive and not valid lowercase provider names.
  // Include the issuer so separate deployments never share a provider identity.
  const digest = createHash('sha256').update(JSON.stringify([issuer, selected.group_id])).digest('hex').slice(0, 32);
  const provider = `lmm-${digest}`;
  const name = `codewhale-${provider}`;
  const manifest = {
    $schema: 'https://agent-plugins.org/schemas/plugin.json',
    name, version: packageInfo.version, license: packageInfo.license,
    description: 'One reviewed LMM model/group using Codewhale host-owned OAuth.',
    homepage: UPSTREAM_PR,
    extensions: {
      'net.codewhale': {
        providers: {
          [provider]: {
            base_url: `${issuer}/v1`, model, models: [model],
            http_headers: { 'X-LMM-Group': selected.group_id },
            oauth: {
              issuer, authorization_endpoint: `${issuer}/api/oauth2/authorize`,
              token_endpoint: `${issuer}/api/oauth2/token`, client_id: CLIENT_ID,
              scopes: [...SCOPES], resource: `${issuer}/api/oauth2`, callback_path: CALLBACK_PATH,
            },
          },
        },
      },
    },
  };
  signal?.throwIfAborted();
  // mkdir is exclusive; competing exporters cannot overwrite each other's files.
  await mkdir(directory, { mode: 0o700 });
  try {
    await writeFile(join(directory, 'README.md'), instructions(name, provider), { flag: 'wx', mode: 0o600, signal });
    // Publish the discoverable manifest last. On failure remove only our new leaf.
    await writeFile(join(directory, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600, signal });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, plugin: name, provider, group: selected.group, model, catalog_id: selected.id };
}
