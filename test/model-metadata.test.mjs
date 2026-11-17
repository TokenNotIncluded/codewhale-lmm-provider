import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelsDevCatalog } from '../src/models-dev-cache.mjs';
import { parseCatalog, chatUnsupportedReason } from '../src/provider.mjs';

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


test('declared specialized models remain discoverable with an explicit text-chat limitation', () => {
  const group = { id: Buffer.from('default').toString('base64url'), name: 'default' };
  const session = { resource:'https://lmm.test/api/oauth2',scope:`group:${group.id}` };
  for (const type of ['embedding','reranking','transcription']) {
    const reference = new ModelsDevCatalog({ custom:{id:'custom',models:{future:{
      id:'future',name:'Future',type,limit:{context:128000,output:4096},
      modalities:{input:['text'],output:['text']},reasoning:false,tool_call:false,
    }}} });
    const upstream_model='custom/FUTURE';
    const row={id:`lmm:${group.id}:${Buffer.from(upstream_model).toString('base64url')}`,
      group_id:group.id,group:group.name,name:'Future',upstream_model,apis:['openai-completions']};
    const models=parseCatalog({schema_version:1,resource:session.resource,groups:[{...group,scope:session.scope}],models:[row]},session,reference);
    assert.equal(models.length,1);
    assert.equal(models[0].id,row.id);
    assert.match(models[0].chat_unsupported_reason,new RegExp(type));
    assert.equal(chatUnsupportedReason(models[0]),models[0].chat_unsupported_reason);
  }
});

test('public zero limits stay unknown without dropping an authorized route', () => {
  const group={id:Buffer.from('default').toString('base64url'),name:'default'};
  const session={resource:'https://lmm.test/api/oauth2',scope:`group:${group.id}`};
  const row={id:`lmm:${group.id}:${Buffer.from('future').toString('base64url')}`,
    group_id:group.id,group:group.name,name:'Future',upstream_model:'future',apis:['openai-completions']};
  const references=new ModelsDevCatalog({custom:{id:'custom',models:{future:{
    id:'future',name:'Future',limit:{context:0,output:0},modalities:{input:['text'],output:['text']},reasoning:false,tool_call:false,
  }}}});
  const models=parseCatalog({schema_version:1,resource:session.resource,groups:[{...group,scope:session.scope}],models:[row]},session,references);
  assert.equal(models.length,1);
  assert.equal(models[0].metadata.context_window,null);
  assert.equal(models[0].metadata.max_output_tokens,null);
  assert.equal(chatUnsupportedReason(models[0]),undefined);
});
