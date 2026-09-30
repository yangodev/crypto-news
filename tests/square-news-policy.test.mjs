import {stub,tag} from './setup.ts';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '../packages/backend/src/db.ts';
import {upsertMaterial} from '../packages/backend/src/content/materials.ts';
import {generateSquareDrafts} from '../packages/backend/src/square/drafts.ts';
import {loadAutomaticDraft,automaticBlock,reviewAutomaticDrafts,approvedAutomaticDraft} from '../packages/backend/src/square/auto.ts';
import {loadPrimary,publicationConflict} from '../packages/backend/src/square/evidence.ts';
import {newsHours,newsTime,newsExpiry} from '../packages/backend/src/square/policy.ts';
import {coverKey,renderCover} from '../packages/backend/src/square/cover.ts';
import {deliverSquareDrafts} from '../packages/backend/src/square/deliver.ts';
import {sendAutomaticDraft} from '../scripts/square/send.mjs';
const official='policy-official-'+tag(),media='crypto-coindesk',articleIds=[];
let category='product',allowPrimary=true,allowCategory=true,allowAnnouncement=true;
const provider=await stub((_hit,req)=>{
 const user=JSON.parse(req.body).messages[1].content;
 if(Array.isArray(user)){
  const d=JSON.parse(user[0].text);
  return {choices:[{message:{content:JSON.stringify({factsSupported:true,stageCorrect:true,recentEvent:true,noAdvice:true,imageMatches:true,imageClean:true,observedTitle:d.title,reason:'Verified in stub',categoryCorrect:allowCategory,announcementTimeValid:allowAnnouncement,primarySupports:allowPrimary})}}]};
 }
 const d=JSON.parse(user),p=d.primary?.[0];
 return {choices:[{message:{content:JSON.stringify({title:'协议宣布推出新产品',summary:'官方公告宣布推出新产品，具体开放安排以公告为准。',quote:'A new product is announced.',occurredAt:null,stage:'announced',conflict:false,category,timeBasis:'announcement',primaryArticleId:p?.id??null,primaryQuote:p?'A new product is announced.':null})}}]};
});
Object.assign(process.env,{LLM_BASE_URL:provider.url,LLM_API_KEY:'mock',LLM_MODEL:'policy-test',SQUARE_AUTO_ENABLED:'true',SQUARE_PUBLISH_ENABLED:'true'});
before(async()=>{
 await sql`INSERT INTO sources(id,name,kind,tier,first_party,config,cursor) VALUES(${official},'Official policy test','rss','T1',true,${sql.json({evidenceUrlPrefixes:['https://official.example/news']})},${sql.json({initializedAt:new Date().toISOString()})})`;
 await sql`INSERT INTO sources(id,name,kind,tier,first_party) VALUES(${media},'CoinDesk','rss','T2',false) ON CONFLICT DO NOTHING`;
 await sql`UPDATE square_control SET paused=false,auto_started_at=now()-interval '1 minute',hourly_limit=1,daily_limit=5`;
});
after(async()=>{await sql`DELETE FROM square_drafts WHERE article_id IN ${sql(articleIds)}`;await sql`UPDATE square_control SET paused=true`;await provider.close();await closeDb();});
async function article(source,age=4,selected=true){
 const date=new Date(Date.now()-age*3600000),url=(source===official?'https://official.example/news/':'https://media.example/')+tag();
 const {articleId}=await upsertMaterial({sourceId:source,url,title:'New announcement',bodyText:'A new product is announced. Complete original terms and details are now available for the protocol.',bodyStatus:'ok',publishedAt:date,via:'fetch'});
 articleIds.push(articleId);await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${articleId}`;
 const [fact]=await sql`INSERT INTO facts(public_id,title) VALUES(${tag()},'New announcement') RETURNING id`;
 await sql`INSERT INTO publications(article_id,eligible,selected,title,summary,source_id,channel,first_party,url,published_at,discovered_at,timeline_at,sort_at,fact_id) VALUES(${articleId},true,${selected},'公告','公告',${source},'news',${source===official},${url},${date},now(),${date},${date},${fact.id})`;
 return articleId;
}
async function draftFor(id){await generateSquareDrafts();return (await sql`SELECT id FROM square_drafts WHERE article_id=${id}`)[0]?.id;}
async function cover(id){const d=await loadAutomaticDraft(Number(id));const key=coverKey(id,d.title,d.evidence);await renderCover(key+'-ai',d.title,d.evidence.sourceName,d.evidence.publishedAt);await sql`UPDATE square_drafts SET cover_status='generated',cover_key=${key} WHERE id=${id}`;}
async function reject(id){await sql`UPDATE square_drafts SET status='rejected',attempted_at=NULL WHERE id=${id}`;}
test('time policy keeps markets at two hours and never renews an old event with a recent report',()=>{
 const now=Date.now(),four=new Date(now-4*3600000).toISOString();
 const e={policyVersion:2,category:'product',timeBasis:'announcement',announcementAt:four};
 assert.equal(newsHours(e),6);assert.equal(newsHours({...e,category:'market'}),2);assert.equal(newsHours({...e,policyVersion:1}),2);
 assert.equal(newsExpiry(new Date(now-1000),e).getTime(),Date.parse(four)+6*3600000);
 assert.equal(newsTime({...e,timeBasis:'event',occurredAt:'2026-09-30'}),null);
});
test('four-hour official announcement passes with metadata time; auditor rejects wrong category and reused announcements',async()=>{
 const aid=await article(official),id=await draftFor(aid);assert.ok(id);const d=await loadAutomaticDraft(Number(id));
 assert.equal(d.evidence.occurredAt,null);assert.equal(automaticBlock(d),null);assert.equal(d.status,'review');await cover(id);
 allowCategory=false;await reviewAutomaticDrafts();assert.equal((await loadAutomaticDraft(Number(id))).status,'review');
 await reject(id);allowCategory=true;
 const second=await draftFor(await article(official));await cover(second);allowAnnouncement=false;await reviewAutomaticDrafts();assert.equal((await loadAutomaticDraft(Number(second))).auto_review.passed,false);allowAnnouncement=true;await reject(second);
 const third=await draftFor(await article(official));await cover(third);await reviewAutomaticDrafts();assert.equal((await loadAutomaticDraft(Number(third))).status,'ready');await reject(third);
 category='market';const market=await draftFor(await article(official));assert.equal((await loadAutomaticDraft(Number(market))).status,'expired');category='product';
});
test('trusted media needs traced official evidence, independent approval, immutable source and cross-route dedupe',async()=>{
 const primaryId=await article(official,4,false),mediaId=await article(media,1);const calls=provider.hits();
 assert.equal(await draftFor(mediaId),undefined);assert.equal(provider.hits(),calls,'no paid draft without primary evidence');
 const [a]=await sql`SELECT revision FROM articles WHERE id=${mediaId}`;
 await sql`INSERT INTO square_traces(article_id,article_revision,status,links) VALUES(${mediaId},${a.revision},'done',${sql.json([{status:'collected',articleId:primaryId}])})`;
 const id=await draftFor(mediaId);await cover(id);const d=await loadAutomaticDraft(Number(id));assert.equal(automaticBlock(d),null);
 assert.ok(automaticBlock({...d,source_id:'untrusted-media'}));assert.ok(automaticBlock({...d,primary_live:null}));
 allowPrimary=false;await reviewAutomaticDrafts();assert.equal((await loadAutomaticDraft(Number(id))).status,'review');allowPrimary=true;
 // Reset only a local stub verdict to exercise the passing and changed-source paths.
 await sql`UPDATE square_drafts SET auto_review=NULL WHERE id=${id}`;await reviewAutomaticDrafts();assert.equal((await loadAutomaticDraft(Number(id))).status,'ready');
 await sql`UPDATE articles SET revision=revision+1 WHERE id=${primaryId}`;await assert.rejects(approvedAutomaticDraft(Number(id)),/官方原文证据/);await sql`UPDATE articles SET revision=revision-1 WHERE id=${primaryId}`;
 await sql`UPDATE sources SET enabled=false WHERE id=${official}`;assert.equal(await loadPrimary(primaryId),null);await assert.rejects(approvedAutomaticDraft(Number(id)));await sql`UPDATE sources SET enabled=true WHERE id=${official}`;
 let posts=0;await deliverSquareDrafts(id=>sendAutomaticDraft(id,'mock',{uploadImage:async()=> 'https://example.com/image',publish:async()=>{posts++;return {id:'900123',shareLink:'https://www.binance.com/square/post/900123'}}}));assert.equal(posts,1);assert.equal((await loadAutomaticDraft(Number(id))).status,'published');
 await sql`UPDATE publications SET selected=true WHERE article_id=${primaryId}`;const duplicate=await draftFor(primaryId);assert.ok(duplicate);assert.equal(await publicationConflict(Number(duplicate)),true);await reject(duplicate);
});
