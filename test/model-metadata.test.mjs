import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelsDevCatalog } from '../src/models-dev-cache.mjs';
import { parseCatalog } from '../src/provider.mjs';

test('fuzzy public metadata enriches every authorized route without changing identity or account prices', () => {
  const group = { id: Buffer.from('default').toString('base64url'), name: 'default' };
  const session = { resource: 'https://lmm.test/api/oauth2', scope: `group:${group.id}` };
  const model = upstream_model => ({
    id: `lmm:${group.id}:${Buffer.from(upstream_model).toString('base64url')}`,
    group_id: group.id, group: group.name, name: upstream_model, upstream_model,
    apis: ['openai-completions'], pricing: { input: 3, output: 7, cache_write: null },
  });
  const known = { ...model('gateway/NEBULA_Pro.1'), metadata: { context_window: 64000, tool_call: false, source: 'server' } };
  const unknown = model('unlisted-private-model');
  const references = new ModelsDevCatalog({ example: { id: 'example', models: { 'nebula-pro-1': {
    id: 'nebula-pro-1', name: 'Nebula Pro 1', limit: { context: 256000, output: 16000 },
    modalities: { input: ['text', 'image'], output: ['text'] }, reasoning: true, tool_call: true,
    cost: { input: 99, output: 99 },
  } } } });
  const models = parseCatalog({ schema_version: 1, resource: session.resource,
    groups: [{ ...group, scope: session.scope }], models: [known, unknown] }, session, references);
  assert.equal(models.length, 2);
  assert.equal(models[0].id, known.id);
  assert.equal(models[0].upstream_model, known.upstream_model);
  assert.deepEqual(models[0].pricing, known.pricing);
  assert.equal(models[0].metadata.context_window, 64000);
  assert.equal(models[0].metadata.max_output_tokens, 16000);
  assert.equal(models[0].metadata.tool_call, false);
  assert.deepEqual(models[0].metadata.input_modalities, ['text', 'image']);
  assert.match(models[0].metadata_reference.source, /^https:\/\/models.dev\//);
  assert.deepEqual(models[1], unknown);
});
