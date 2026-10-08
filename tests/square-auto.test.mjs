import {stub,tag} from './setup.ts';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sql,closeDb} from '../packages/backend/src/db.ts';
import {upsertMaterial} from '../packages/backend/src/content/materials.ts';
import {digest} from '../packages/backend/src/square/policy.ts';
import {coverKey,renderCover,generatedCover} from '../packages/backend/src/square/cover.ts';
import {automaticBlock,reviewAutomaticDrafts,loadAutomaticDraft} from '../packages/backend/src/square/auto.ts';
import {deliverSquareDrafts} from '../packages/backend/src/square/deliver.ts';
import {sendAutomaticDraft} from '../scripts/square/send.mjs';
let rejectReview=false,badTitle=false,reviewHook=null;
let revisionHook=null;
const provider=await stub(async(_hit,req)=>{
 const parts=JSON.parse(req.body).messages[1].content;
 if(typeof parts==='string'){
  if(revisionHook)await revisionHook();
  return {choices:[{message:{content:JSON.stringify({repairable:true,title:'协议完成升级',summary:'协议公告确认本次升级已经执行，具体内容以原始公告为准。'})}}]};
 }
 assert.match(parts[1].image_url.url,/^data:image\/png;base64,/);
 const d=JSON.parse(parts[0].text);
 if(reviewHook)await reviewHook();
 return {choices:[{message:{content:JSON.stringify({factsSupported:!rejectReview,stageCorrect:true,recentEvent:true,noAdvice:true,imageMatches:true,imageClean:true,observedTitle:badTitle?'另一个标题':d.title,reason:rejectReview?'原文不能支持结论':'原文与图文一致',categoryCorrect:true,announcementTimeValid:true})}}]};
});
Object.assign(process.env,{LLM_BASE_URL:provider.url,LLM_API_KEY:'mock',LLM_MODEL:'auto-test',SQUARE_AUTO_ENABLED:'true',SQUARE_PUBLISH_ENABLED:'true'});
const ids=[];let source;
before(async()=>{
 source='auto-'+tag();await sql`INSERT INTO sources(id,name,kind,tier,first_party) VALUES(${source},'官方测试','rss','T1',true)`;
 await sql`UPDATE square_control SET paused=false,auto_started_at=now()-interval '1 minute',hourly_limit=1,daily_limit=5`;
});
after(async()=>{await sql`DELETE FROM square_drafts WHERE article_id IN (SELECT id FROM articles WHERE source_id=${source})`;await sql`UPDATE square_control SET paused=true,auto_started_at=NULL`;await provider.close();await closeDb();});
async function draft(){
 const t=tag(),time=new Date(Date.now()-10000),material='The upgrade was executed. Official details of the protocol change are now available. '+t;
 const {articleId}=await upsertMaterial({sourceId:source,url:'https://example.com/'+t,title:'升级',bodyText:material,bodyStatus:'ok',publishedAt:time,via:'fetch'});
 const [fact]=await sql`INSERT INTO facts(public_id,title) VALUES(${t},'升级') RETURNING id`;
 await sql`INSERT INTO publications(article_id,eligible,selected,title,summary,source_id,channel,first_party,url,published_at,discovered_at,timeline_at,sort_at,fact_id) VALUES(${articleId},true,true,'升级','已完成',${source},'news',true,${'https://example.com/'+t},${time},${time},${time},${time},${fact.id})`;
 const [a]=await sql`SELECT revision FROM articles WHERE id=${articleId}`;
 const title='协议完成升级',body=title+'\n\n协议公告确认升级已经执行。\n\n来源：官方测试';
 const evidence={material,quote:'The upgrade was executed.',bodyStatus:'ok',sourceName:'官方测试',publishedAt:time.toISOString(),occurredAt:time.toISOString(),stage:'executed',conflict:false,url:'https://example.com/'+t};
 const [d]=await sql`INSERT INTO square_drafts(event_key,article_id,article_revision,title,body,content_hash,evidence,expires_at) VALUES(${'fact:'+fact.id},${articleId},${a.revision},${title},${body},${digest(body)},${sql.json(evidence)},${new Date(Date.now()+600000)}) RETURNING id`;
 const key=coverKey(d.id,title,evidence);await renderCover(key+'-ai',title,'官方测试',time.toISOString());
 await sql`UPDATE square_drafts SET cover_status='generated',cover_key=${key} WHERE id=${d.id}`;
 ids.push(d.id);return Number(d.id);
}
async function clearAttempt(id){await sql`UPDATE square_drafts SET attempted_at=now()-interval '25 hours' WHERE id=${id}`;}
test('auto review binds the image, single review claim and single bounded publication',async()=>{
 const id=await draft();const before=provider.hits();await Promise.all([reviewAutomaticDrafts(),reviewAutomaticDrafts()]);assert.equal(provider.hits(),before+1);
 assert.equal((await loadAutomaticDraft(id)).status,'ready');let sends=0;
 const transport=id=>sendAutomaticDraft(id,'mock',{uploadImage:async(_k,_file,bytes)=>{assert.ok(bytes.length);return 'https://example.com/i'},publish:async()=>{sends++;return {id:'90001',shareLink:'https://www.binance.com/square/post/90001'}}});
 await Promise.all([deliverSquareDrafts(transport),deliverSquareDrafts(transport)]);assert.equal(sends,1);
 const next=await draft();await reviewAutomaticDrafts();await deliverSquareDrafts(transport);assert.equal(sends,1,'one per rolling hour');
 await clearAttempt(id);await sql`UPDATE square_drafts SET status='rejected' WHERE id=${next}`;
});
test('policy rejects old/backfilled/media/incomplete/changed drafts and model rejects stay unapproved',async()=>{
 const id=await draft();const d=await loadAutomaticDraft(id);assert.equal(automaticBlock(d),null);
 for(const patch of [{first_party:false},{current_body_status:'unconfirmed'},{current_revision:999},{selected:false},{current_fact_id:null},{created_at:new Date(0)},{source_time:new Date(0)},{evidence:{...d.evidence,conflict:true}},{evidence:{...d.evidence,initialImport:true}}])assert.ok(automaticBlock({...d,...patch}));
 rejectReview=true;await reviewAutomaticDrafts();rejectReview=false;
 const reviewed=await loadAutomaticDraft(id);assert.equal(reviewed.status,'review');assert.equal(reviewed.auto_review.passed,false);
 const hits=provider.hits();await reviewAutomaticDrafts();assert.equal(provider.hits(),hits);
});
test('changed cover and pause during upload prevent any post request',async()=>{
 const id=await draft();await reviewAutomaticDrafts();const cover=await generatedCover(id);await writeFile(cover.file,'changed');let posts=0;
 await deliverSquareDrafts(async()=>{posts++;throw Error('should not send')});assert.equal(posts,0);
 await writeFile(cover.file,cover.bytes);await sql`UPDATE square_drafts SET status='rejected' WHERE id=${id}`;
 const next=await draft();await reviewAutomaticDrafts();
 await deliverSquareDrafts(id=>sendAutomaticDraft(id,'mock',{uploadImage:async()=>{await sql`UPDATE square_control SET paused=true`;return 'https://example.com/i'},publish:async()=>{posts++;return {}}}));
 assert.equal(posts,0);assert.equal((await loadAutomaticDraft(next)).status,'review');await clearAttempt(next);await sql`UPDATE square_control SET paused=false`;
});
test('OCR mismatch and source edits during review never approve; duplicate facts never send',async()=>{
 const id=await draft();badTitle=true;await reviewAutomaticDrafts();badTitle=false;
 assert.equal((await loadAutomaticDraft(id)).auto_review.passed,false);
 const edited=await draft();const d=await loadAutomaticDraft(edited);
 reviewHook=async()=>{await sql`UPDATE articles SET revision=revision+1 WHERE id=${d.article_id}`};
 await reviewAutomaticDrafts();reviewHook=null;assert.equal((await loadAutomaticDraft(edited)).status,'review');
 const duplicate=await draft();const old=await loadAutomaticDraft(ids[0]);const next=await loadAutomaticDraft(duplicate);
 await sql`UPDATE publications SET fact_id=${old.current_fact_id} WHERE article_id=${next.article_id}`;
 await reviewAutomaticDrafts();let sends=0;await deliverSquareDrafts(async()=>{sends++;return {}});assert.equal(sends,0);
 const hits=provider.hits();process.env.SQUARE_AUTO_ENABLED='false';await reviewAutomaticDrafts();await deliverSquareDrafts(async()=>{sends++;return {}});
 assert.equal(provider.hits(),hits);assert.equal(sends,0);process.env.SQUARE_AUTO_ENABLED='true';
});
test('daily ceiling includes earlier attempts and unknown outcomes pause all future publication',async()=>{
 const id=await draft();await reviewAutomaticDrafts();
 // Five previous attempts consume the rolling day allowance, regardless of successful publication.
 for(const previous of ids.filter(n=>n!==id).slice(0,5))await sql`UPDATE square_drafts SET attempted_at=now()-interval '2 hours' WHERE id=${previous}`;
 let calls=0;await deliverSquareDrafts(async()=>{calls++;return {}});assert.equal(calls,0);
 for(const previous of ids)await clearAttempt(previous);
 await deliverSquareDrafts(async()=>{calls++;return {id:null}});assert.equal(calls,1);
 assert.equal((await loadAutomaticDraft(id)).status,'unknown');assert.equal((await sql`SELECT paused FROM square_control`)[0].paused,true);
 await deliverSquareDrafts(async()=>{calls++;return {}});assert.equal(calls,1);
});

test('v2 negative review is revised only once, re-reviewed independently and never extends expiry',async()=>{
 await sql`UPDATE square_control SET paused=false`;
 const id=await draft();const d=await loadAutomaticDraft(id);
 await sql`UPDATE square_drafts SET evidence=${sql.json({...d.evidence,policyVersion:2,category:'other',timeBasis:'event'})} WHERE id=${id}`;
 rejectReview=true;const hits=provider.hits();
 await Promise.all([reviewAutomaticDrafts(),reviewAutomaticDrafts()]);
 const revised=await loadAutomaticDraft(id);
 assert.equal(revised.revision_attempts,1);assert.equal(revised.review_history.length,1);
 assert.equal(revised.auto_review,null);assert.equal(revised.status,'review');
 assert.equal(+revised.expires_at,+d.expires_at);assert.equal(provider.hits(),hits+2);
 await reviewAutomaticDrafts();
 const final=await loadAutomaticDraft(id);assert.equal(final.auto_review.passed,false);assert.equal(final.revision_attempts,1);
 const end=provider.hits();await reviewAutomaticDrafts();assert.equal(provider.hits(),end);
 rejectReview=false;await sql`UPDATE square_drafts SET status='rejected' WHERE id=${id}`;
});
test('corrupted text can be repaired once; changed source during correction cannot be approved',async()=>{
 const id=await draft();const d=await loadAutomaticDraft(id);const body=d.body+'\uFFFD';
 await sql`UPDATE square_drafts SET body=${body},content_hash=${digest(body)},evidence=${sql.json({...d.evidence,policyVersion:2,category:'other',timeBasis:'event'})} WHERE id=${id}`;
 revisionHook=async()=>{await sql`UPDATE articles SET revision=revision+1 WHERE id=${d.article_id}`};
 await reviewAutomaticDrafts();revisionHook=null;
 const row=await loadAutomaticDraft(id);assert.equal(row.revision_attempts,1);assert.equal(row.auto_review.passed,false);assert.equal(row.body,body);
 const hits=provider.hits();await reviewAutomaticDrafts();assert.equal(provider.hits(),hits);
 await sql`UPDATE square_drafts SET status='rejected' WHERE id=${id}`;
});

test('corrected draft still needs a fresh positive verdict; expired drafts never enter repair',async()=>{
 const id=await draft();const d=await loadAutomaticDraft(id);
 await sql`UPDATE square_drafts SET evidence=${sql.json({...d.evidence,policyVersion:2,category:'other',timeBasis:'event'})} WHERE id=${id}`;
 rejectReview=true;await reviewAutomaticDrafts();rejectReview=false;
 assert.equal((await loadAutomaticDraft(id)).status,'review');
 await reviewAutomaticDrafts();const ready=await loadAutomaticDraft(id);
 assert.equal(ready.status,'ready');assert.equal(ready.revision_attempts,1);assert.equal(ready.auto_review.passed,true);
 assert.notEqual(ready.auto_review.receiptId,ready.review_history[0].review.receiptId);
 await sql`UPDATE square_drafts SET status='rejected' WHERE id=${id}`;
 const old=await draft();await sql`UPDATE square_drafts SET expires_at=now()-interval '1 minute' WHERE id=${old}`;
 const hits=provider.hits();await reviewAutomaticDrafts();assert.equal(provider.hits(),hits);assert.equal((await loadAutomaticDraft(old)).revision_attempts,0);
});
