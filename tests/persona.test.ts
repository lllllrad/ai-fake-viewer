import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../packages/storage.ts';
import { configSchema } from '../packages/config.ts';
import { PersonaService } from '../packages/persona/service.ts';
import { definitionSchema } from '../packages/persona/contracts.ts';
import type { GenerationRequest, PersonaGenerator } from '../packages/persona/generator.ts';

const config=configSchema.parse({database:':memory:',ai:{provider:'openai_api'}});
function fixtureDefinition(request:GenerationRequest){return definitionSchema.parse({schema_version:1,persona_id:request.persona_id,definition_version:1,template_revision_id:request.template.template_revision_id,locale:request.locale,display_name_suggestion:`Viewer ${request.persona_id.slice(0,5)}`,core:{viewing_motive:request.template.behavior_family,interests:[request.planning_brief.topic],disinterest:['repeated context'],observation_focus:['visible changes'],temperament:'Calm and curious',social_behavior:'Responds to other viewers with care'},knowledge:[{topic:request.planning_brief.topic,level:'basic',boundary:'Uses only directly available information'}],voice:{register:'casual',typical_length:'short',punctuation_tendency:'concise',laughter_tendency:'rare',allowed_variation:['observation'],avoid:['unsupported certainty']},participation:{base_propensity:0.3,topic_sensitivity:0.7,reply_propensity:0.2,speak_when:['new information appears'],stay_silent_when:['context is unclear']},examples:[{situation:'a visible outcome changes',action:'send',text:'Generated contribution A'},{situation:'unclear background',action:'skip'},{situation:'new detail appears',action:'send',text:'Generated contribution B'},{situation:'nothing changes',action:'skip'}],negative_examples:[{situation:'a past event',unacceptable_behavior:'claiming to have watched it'},{situation:'a private plan',unacceptable_behavior:'claiming hidden knowledge'}]});}
async function waitJob(service:PersonaService,id:string){for(let i=0;i<100;i++){const job=service.job(id);if(job.status!=='queued'&&job.status!=='running')return job;await new Promise(r=>setTimeout(r,5));}throw Error('job timeout');}

test('persona generation uses provider-created cards and never sends private production context',async()=>{
  const store=new Store(':memory:');store.ingestBatch([{platform:'youtube',channel:'c',author:'u',name:'Viewer',text:'hello'}]);
  const requests:GenerationRequest[]=[];const generator:PersonaGenerator=async(request)=>{requests.push(structuredClone(request));const definition=fixtureDefinition(request);definition.examples[0]={situation:'a visible outcome changes',action:'send',text:`Generated contribution ${request.persona_id}`};return{definition,inputTokens:100,outputTokens:200};};
  const service=new PersonaService(store,undefined,config,generator);const session=service.createBrief({session_title:'Test broadcast',topic:'Puzzle game',audience_intent:'Observe and react',public_context:'The audience can see the puzzle.',private_production_context:'secret phrase ORCHID-VAULT-DELTA',tone_policy:'Be natural',candidate_count:2,cast_size:1});
  const queued=service.createCandidates(session.id);const job=await waitJob(service,queued.id);assert.equal(job.status,'succeeded');assert.equal(job.result.length,2);assert.equal(requests.length,2);assert.equal(JSON.stringify(requests).includes('ORCHID-VAULT-DELTA'),false);assert.equal(JSON.stringify(job.result).includes('secret phrase'),false);assert.notEqual(job.result[0].definition.examples[0].text,job.result[1].definition.examples[0].text);assert.equal(job.result[0].provenance.generator,'openai_api');
  store.close();
});

test('persona generation rejects private context echoed by provider output',async()=>{
  const store=new Store(':memory:');store.ingestBatch([{platform:'youtube',channel:'c',author:'u',name:'Viewer',text:'hello'}]);
  const generator:PersonaGenerator=async(request)=>{const definition=fixtureDefinition(request);definition.core.viewing_motive='I know ORCHID-VAULT-DELTA';return{definition};};
  const service=new PersonaService(store,undefined,config,generator);const session=service.createBrief({session_title:'Test broadcast',topic:'Puzzle game',audience_intent:'Observe and react',public_context:'The audience can see the puzzle.',private_production_context:'secret phrase ORCHID-VAULT-DELTA',tone_policy:'Be natural',candidate_count:1,cast_size:1});
  const queued=service.createCandidates(session.id);const job=await waitJob(service,queued.id);assert.equal(job.status,'failed');assert.deepEqual(service.listCandidates(session.id),[]);
  store.close();
});
