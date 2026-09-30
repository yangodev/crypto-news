import {stub,tag} from './setup.ts';
import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {generateSquareDrafts,squareOverview} from '@aihot/backend/square/drafts';
import {deliverSquareDrafts} from '@aihot/backend/square/deliver';
import {buildApp} from '../apps/api/src/app.ts';
const source=`test-square-${tag()}`;
const now=new Date();
const provider=await stub((_hit,req)=>{assert.ok(req.body.includes('确认事故=confirmed_incident'));return ({choices:[{message:{content:JSON.stringify({title:'测试协议完成升级',summary:'协议公告确认升级已经执行，具体变更以原始公告为准。',quote:'The upgrade was executed.',occurredAt:now.toISOString(),stage:'executed',conflict:false})}}],usage:{prompt_tokens:1,completion_tokens:1}});});
Object.assign(process.env,{LLM_BASE_URL:provider.url,LLM_API_KEY:'test-key',LLM_MODEL:'stub-square',SQUARE_PUBLISH_ENABLED:'false'});
let id:string;
before(async()=>{
 await sql`UPDATE square_drafts SET cover_status='fallback' WHERE cover_status='pending'`;
 await sql`UPDATE budgets SET per_minute=100,per_hour=1000,per_day=10000 WHERE service='image'`;
 await sql`INSERT INTO sources(id,name,kind,tier,first_party) VALUES(${source},'Protocol test','rss','T1',true)`;
 ({articleId:id}=await upsertMaterial({sourceId:source,url:`https://example.com/${source}`,title:'Upgrade',bodyText:'The upgrade was executed. The official protocol release includes a detailed description of the network changes.',bodyStatus:'ok',publishedAt:now,via:'fetch'}));
 await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${id}`;
 await sql`INSERT INTO publications(article_id,eligible,selected,title,summary,source_id,channel,first_party,url,published_at,discovered_at,timeline_at,sort_at) VALUES(${id},true,true,'协议升级','已完成升级',${source},'news',true,${`https://example.com/${source}`},${now},${now},${now},${now})`;
});
after(async()=>{await sql`DELETE FROM square_drafts WHERE article_id=${id}`;await provider.close();await stopBoss();await closeDb();});
test('candidate generation is idempotent and never auto-approves a source-backed draft',async()=>{
 await sql`UPDATE articles SET backfill=true,backfill_reason='first-import',body_status='unconfirmed' WHERE id=${id}`;
 await sql`UPDATE publications SET backfill=true WHERE article_id=${id}`;
 await generateSquareDrafts();
 const [d]=await sql`SELECT * FROM square_drafts WHERE article_id=${id}`;
 assert.ok(d);assert.equal(d.evidence.initialImport,true);assert.ok(d.review_reasons.some((s:string)=>s.includes('正文未完整')));assert.ok(d.review_reasons.some((s:string)=>s.includes('首次抓取')));assert.equal(d.status,'review');assert.equal(d.verified_at,null);assert.ok(d.body.includes('来源：Protocol test'));assert.ok(!d.body.includes('https://'));assert.equal(d.evidence.url,`https://example.com/${source}`);
 const [before]=await sql`SELECT count(*)::int AS n FROM receipts WHERE purpose='square.draft' AND subject=${id}`; await generateSquareDrafts(); const [after]=await sql`SELECT count(*)::int AS n FROM receipts WHERE purpose='square.draft' AND subject=${id}`; assert.equal(after!.n,before!.n);
 assert.equal((await sql`SELECT * FROM square_drafts WHERE article_id=${id}`).length,1);
 assert.deepEqual(await deliverSquareDrafts(),{disabled:true});
});
test('image job is gated, deduplicated and served without another paid call',async()=>{
 await sql`UPDATE square_drafts SET cover_status='fallback' WHERE article_id<>${id} AND cover_status='pending'`;
 const {generateSquareImages}=await import('@aihot/backend/square/images');
 const {draftCover}=await import('@aihot/backend/square/cover');
 const sharp=(await import('sharp')).default;
 const png=await sharp({create:{width:64,height:64,channels:3,background:'#226557'}}).png().toBuffer();
 const realFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response([
  {type:'response.output_item.done',item:{type:'image_generation_call',status:'completed',result:png.toString('base64')}},
  {type:'response.completed',response:{status:'completed',id:'test-image'}}
 ].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});};
 try{
  process.env.SQUARE_IMAGE_ENABLED='false';assert.deepEqual(await generateSquareImages(),{disabled:true});assert.equal(calls,0);
  process.env.SQUARE_IMAGE_ENABLED='true';
  await Promise.all([generateSquareImages(),generateSquareImages()]);
  const [d]=await sql`SELECT * FROM square_drafts WHERE article_id=${id}`;
  assert.equal(d.cover_status,'generated');assert.equal(calls,1);
  assert.equal((await sharp((await draftCover(Number(d.id)))!).metadata()).width,1080);
  await generateSquareImages();await draftCover(Number(d.id));assert.equal(calls,1);
  await sql`UPDATE square_drafts SET title='更新后的标题' WHERE id=${d.id}`;
  const fallback=await draftCover(Number(d.id));assert.ok(fallback);assert.equal(calls,1);
 }finally{globalThis.fetch=realFetch;}
});
test('image failures fall back once and never silently repeat a paid request',async()=>{
 await sql`UPDATE square_drafts SET cover_status='fallback' WHERE article_id<>${id} AND cover_status='pending'`;
 const {generateSquareImages}=await import('@aihot/backend/square/images');
 const [d]=await sql`UPDATE square_drafts SET cover_status='pending',title='另一个测试主题' WHERE article_id=${id} RETURNING id`;
 const realFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('upstream failed',{status:502});};
 try{
  await generateSquareImages();await generateSquareImages();
  assert.equal(calls,1);assert.equal((await sql`SELECT cover_status FROM square_drafts WHERE id=${d.id}`)[0]!.cover_status,'fallback');
  await sql`UPDATE square_drafts SET cover_status='generating',cover_updated_at=now()-interval '11 minutes' WHERE id=${d.id}`;
  await generateSquareImages();assert.equal(calls,1);
  assert.equal((await sql`SELECT cover_status FROM square_drafts WHERE id=${d.id}`)[0]!.cover_status,'fallback');
 }finally{globalThis.fetch=realFetch;process.env.SQUARE_IMAGE_ENABLED='false';}
});
test('uncertain submissions recover as unknown even while publication is disabled',async()=>{
 await sql`UPDATE square_drafts SET status='submitting',attempted_at=now()-interval '10 minutes' WHERE article_id=${id}`;
 await deliverSquareDrafts();assert.equal((await sql`SELECT status FROM square_drafts WHERE article_id=${id}`)[0]!.status,'unknown');
 await deliverSquareDrafts();assert.equal((await sql`SELECT status FROM square_drafts WHERE article_id=${id}`)[0]!.status,'unknown');
 assert.equal((await squareOverview()).publishEnabled,false);
});
test('private draft evidence is inaccessible without admin authentication',async()=>{
 const app=await buildApp();
 try {const r=await app.inject({method:'GET',url:'/api/admin/square'});assert.equal(r.statusCode,401);}finally{await app.close();}
});
