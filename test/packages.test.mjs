// Synthetic validation cases only. The live swimming-clinic proof is authored by WorkBuddy after adapter reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, startApplication } from '../server.mjs';
import { createStore } from '../store.mjs';
import { EVENT_FIELDS } from '../workflow.mjs';
import { runAdapter } from '../adapter.mjs';
const input = {proposal:'SYNTHETIC FIXTURE ONLY. Swim session needs water.',goal:'Draft in-kind support only.'};
const psource = [{source:'proposal',quote:'Swim session needs water.'}];
const questions = [
  {id:'q-needs',field:'supportQuantities',question:'What quantity?',reason:'Avoid guessed scale.'},
  {id:'q-benefits',field:'sponsorshipBenefits',question:'Which benefits are authorised?',reason:'Avoid promises.'},
  {id:'q-date',field:'date',question:'When is support due?',reason:'Plan delivery.'},
];
function prep() { return {facts:EVENT_FIELDS.map(field=>({field,value:field==='supportNeeds'?'Water':'',sources:field==='supportNeeds'?psource:[]})),summary:[{text:'Swim session needs water.',sources:psource}],questions,checklist:[{id:'c1',task:'Confirm quantities.',status:'not_started',dependsOnFields:['supportQuantities']}]}; }
function answers(expectedRevision=0) {return {expectedRevision,entries:[{questionId:'q-needs',state:'confirmed',value:'40 bottles of water.'},{questionId:'q-benefits',state:'confirmed',value:'No sponsor benefits are authorised.'},{questionId:'q-date',state:'not_confirmed',value:''}]};}
function continuation(answerRevision=1) {
  const event=prep();const as=[{source:'answer',questionId:'q-needs',revision:answerRevision,quote:'40 bottles of water.'}];
  event.facts.find(f=>f.field==='supportQuantities').value='40 bottles';event.facts.find(f=>f.field==='supportQuantities').sources=as;
  event.facts.find(f=>f.field==='sponsorshipBenefits').value='No sponsor benefits authorised';event.facts.find(f=>f.field==='sponsorshipBenefits').sources=[{source:'answer',questionId:'q-benefits',revision:answerRevision,quote:'No sponsor benefits are authorised.'}];
  event.questions=[questions[2]];
  return {answerRevision,event,resolutions:[{questionId:'q-needs',status:'resolved',reason:'Quantity supplied.',sources:as},{questionId:'q-benefits',status:'resolved',reason:'No benefits to promise.',sources:event.facts.find(f=>f.field==='sponsorshipBenefits').sources},{questionId:'q-date',status:'remaining',reason:'Deadline unconfirmed, but draft may be saved.',sources:[]}],packages:[{id:'pkg_water',title:'Water partner',contributionType:'products',items:[{description:'Bottled water',quantity:'40 bottles',sources:as}],amount:{value:'',sources:[]},currency:{value:'',sources:[]},deadline:{value:'',sources:[]},benefits:[],outstanding:['Deadline and permissions unconfirmed; not a commitment.'],draftStatus:'draft'}]};
}
async function fixture() {
  const root=join(APP_ROOT,'test','.temporary');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'packages-'));
  const store=createStore(directory);await store.init();const request=await store.create(input);await store.saveWorkflow(request.id,'plan',{steps:['Read source and save clarification questions.']});await store.saveWorkflow(request.id,'preparation',prep());return {directory,store,id:request.id};
}
test('Answer revisions preserve original source, not-confirmed values and stale/concurrent update rejection',async()=>{
  const {directory,store,id}=await fixture();
  const first=await store.saveAnswers(id,answers());assert.equal(first.answerRevision,1);assert.equal(first.answers.entries[2].value,'');
  await assert.rejects(store.saveAnswers(id,answers()),e=>e.status===409);
  const candidates=await Promise.allSettled([store.saveAnswers(id,answers(1)),createStore(directory).saveAnswers(id,answers(1))]);
  assert.equal(candidates.filter(r=>r.status==='fulfilled').length,1);
  const restored=await createStore(directory).get(id);assert.equal(restored.answerRevision,2);assert.equal(restored.answerHistory.length,2);assert.equal(restored.proposal,input.proposal);
  const bad=answers(2);bad.entries[2].value='Guess';await assert.rejects(store.saveAnswers(id,bad),e=>e.status===400);
});
test('In-kind continuation permits missing cash budget/currency, unknown deadline/permissions and checks answer sources/resolutions',async()=>{
  const {store,id}=await fixture();await store.saveAnswers(id,answers());
  for (const mutate of [c=>{c.event.summary[0].sources=[{source:'answer',questionId:'q-date',revision:1,quote:'Never supplied'}];},c=>{c.packages[0].items[0].sources[0].revision=999;},c=>{c.packages[0].currency={value:'MYR',sources:psource};},c=>{c.resolutions[2]={questionId:'q-date',status:'resolved',reason:'Guess',sources:psource};},c=>{c.packages[0].benefits=[{text:'Unapproved logo placement',sources:psource}];},c=>{c.packages[0].outstanding=[];}]) {
    const c=continuation();mutate(c);await assert.rejects(store.continueTask(id,c,1),e=>e.status===400);
  }
  const saved=await store.continueTask(id,continuation(),1);assert.equal(saved.packages.length,1);assert.equal(saved.packages[0].content.amount.value,'');
  assert.equal(saved.continuation.content.event.facts.find(f=>f.field==='approvals').value,'');
  assert.deepEqual((await store.continueTask(id,continuation(),1)).continuation,saved.continuation);
});
test('Package edit clears only affected review; answer changes invalidate all current reviews and reject stale edits',async()=>{
  const {store,id}=await fixture();await store.saveAnswers(id,answers());const c=continuation();c.packages.push({...structuredClone(c.packages[0]),id:'pkg_extra',title:'Alternative water draft'});await store.continueTask(id,c,1);
  const review=(expectedRevision,packageId)=>store.updatePackage(id,{expectedRevision,continuationRevision:1,packageId},true);
  await review(0,'pkg_water');const both=await review(1,'pkg_extra');assert.ok(both.packages.every(p=>p.reviewCurrent));
  const edited=structuredClone(both.packages[0].content);edited.title='Edited water draft';const save=await store.updatePackage(id,{expectedRevision:2,continuationRevision:1,packageId:'pkg_water',content:edited});
  assert.equal(save.packages[0].review,null);assert.equal(save.packages[1].reviewCurrent,true);assert.equal(save.packageHistory.length,3);
  await assert.rejects(review(1,'pkg_water'),e=>e.status===409);
  const newer=await store.saveAnswers(id,answers(1));assert.equal(newer.continuationStale,true);assert.ok(newer.packages.every(p=>!p.reviewCurrent));
  await assert.rejects(review(3,'pkg_extra'),e=>e.status===409);
  await assert.rejects(store.continueTask(id,continuation(1),1),e=>e.status===409);
});
test('Concurrent history reads return a valid revision-linked snapshot or a retry conflict',async()=>{
  const {store,id}=await fixture();
  const writer=(async()=>{for(let n=1;n<=3;n++){await store.saveAnswers(id,answers(n-1));await store.continueTask(id,continuation(n),n);await store.updatePackage(id,{expectedRevision:n-1,continuationRevision:n,packageId:'pkg_water'},true);}})();
  const readers=Array.from({length:12},async()=>{for(let n=0;n<4;n++){try{const saved=await store.get(id);if(saved.continuation)assert.ok(saved.answerHistory.some(a=>a.revision===saved.continuation.content.answerRevision));}catch(e){assert.equal(e.status,409,'Only a bounded retry conflict is permitted, never mixed-history 500.');}}});
  await Promise.all([writer,...readers]);const final=await store.get(id);assert.equal(final.answerRevision,3);assert.equal(final.continuationRevision,3);assert.equal(final.packages[0].reviewCurrent,true);
});
test('Malformed nested continuation and package-edit content are validation errors',async()=>{
  const {store,id}=await fixture();await store.saveAnswers(id,answers());
  for(const content of [null,undefined,[]])await assert.rejects(store.continueTask(id,content,1),e=>e.status===400);
  await store.continueTask(id,continuation(),1);
  for(const content of [null,undefined,[]])await assert.rejects(store.updatePackage(id,{expectedRevision:0,continuationRevision:1,packageId:'pkg_water',content}),e=>e.status===400);
  assert.equal((await store.get(id)).packageRevision,0);
});
test('HTTP roles and revision-bound read receipts; answer and package persistence across server restart',async(t)=>{
  const {directory,id}=await fixture();let app=await startApplication({directory,port:0});t.after(()=>new Promise(r=>{app.server.close(r);app.server.closeAllConnections();}));
  let baseUrl=`http://127.0.0.1:${app.server.address().port}`;const opts=()=>({baseUrl,keyFile:join(directory,'.agent-key')});
  const post=async(suffix,body,headers={})=>fetch(`${baseUrl}/api/requests/${id}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const before=await runAdapter(['read',id],opts());const token=(await(await fetch(`${baseUrl}/api/session`)).json()).token;
  assert.equal((await post('answers',answers())).status,403);
  const key=await readFile(join(directory,'.agent-key'),'utf8');assert.equal((await post('answers',answers(),{'X-Agent-Key':key})).status,403);
  assert.equal((await post('answers',answers(),{'X-Browser-Token':token})).status,200);
  await assert.rejects(runAdapter(['continuation',id,before.readReceipt,JSON.stringify(continuation())],opts()),/changed since read/);
  const read=await runAdapter(['read',id],opts());await runAdapter(['continuation',id,read.readReceipt,JSON.stringify(continuation())],opts());
  assert.equal((await post('package-review',{expectedRevision:0,continuationRevision:1,packageId:'pkg_water'},{'X-Agent-Key':key})).status,403);
  assert.equal((await post('package-review',{expectedRevision:0,continuationRevision:1,packageId:'pkg_water'},{'X-Browser-Token':token})).status,200);
  await new Promise(r=>{app.server.close(r);app.server.closeAllConnections();});app=await startApplication({directory,port:0});baseUrl=`http://127.0.0.1:${app.server.address().port}`;
  const restored=await runAdapter(['read',id],opts());assert.equal(restored.answerRevision,1);assert.equal(restored.packages[0].reviewCurrent,true);
  await assert.rejects(runAdapter(['continuation',id,read.readReceipt,JSON.stringify(continuation())],opts()),/receipt/i);
});
