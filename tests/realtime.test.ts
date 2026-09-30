import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import http from 'node:http';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {archiveOutsideRealtime} from '@aihot/backend/content/realtime';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {processArticle,queueProcessing} from '@aihot/backend/jobs/content';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {extractArticleBody} from '@aihot/backend/content/extract';
import {paidRequest,BudgetExceededError} from '@aihot/backend/providers/receipts';
const source='realtime-'+tag();
await sql`INSERT INTO sources(id,name,kind) VALUES(${source},'Realtime test','rss')`;
async function article(date:Date|null){return (await upsertMaterial({sourceId:source,url:'https://example.com/'+tag(),title:'Network news',bodyText:'Network news with evidence '.repeat(20),bodyStatus:'ok',publishedAt:date,via:'fetch',backfill:'first-import'})).articleId;}
after(async()=>{delete process.env.REALTIME_NEWS_ONLY;await stopBoss();await closeDb();});
test('archive gate blocks already queued stale jobs without erasing materials or prior analysis',async()=>{
 process.env.REALTIME_NEWS_ONLY='true';
 const old=await article(new Date(Date.now()-3*3600000));
 assert.deepEqual(await processArticle(old),{state:'archived'});
 assert.equal(await queueProcessing(old),null);
 const [r]=await sql`SELECT body_text,processing_state FROM articles WHERE id=${old}`;
 assert.equal(r.processing_state,'skipped');assert.ok(r.body_text);
 await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${old}`;
 await archiveOutsideRealtime(old);assert.equal((await sql`SELECT processing_state FROM articles WHERE id=${old}`)[0]!.processing_state,'analyzed');
 const fresh=await article(new Date());assert.equal(await archiveOutsideRealtime(fresh),false);
 const unknown=await article(null);assert.equal(await archiveOutsideRealtime(unknown),true);
 await sql`UPDATE articles SET published_at=now()+interval '10 minutes' WHERE id=${fresh}`;
 assert.equal(await archiveOutsideRealtime(fresh),true);
 process.env.REALTIME_NEWS_ONLY='false';assert.equal(await archiveOutsideRealtime(old),false);
});
test('unconfigured body fallback records unconfirmed instead of retrying a missing credential',async()=>{
 let hits=0;const server=http.createServer((_req,res)=>{hits++;res.writeHead(403);res.end('unavailable');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const prev=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
 const key=process.env.JINA_API_KEY;delete process.env.JINA_API_KEY;
 try{
  const {articleId}=await upsertMaterial({sourceId:source,url:`http://127.0.0.1:${port}/news`,title:'Feed headline',excerpt:'Only an excerpt is available.',bodyStatus:'pending',publishedAt:new Date(),via:'fetch'});
  assert.equal(await extractArticleBody(articleId),'unconfirmed');assert.equal(hits,1);
  assert.equal((await sql`SELECT body_status FROM articles WHERE id=${articleId}`)[0]!.body_status,'unconfirmed');
 }finally{config.allowPrivateNetworkFetch=prev;if(key)process.env.JINA_API_KEY=key;await new Promise<void>(r=>server.close(()=>r()));}
});
test('non-draft calls cannot use the last ten hourly slots reserved for drafts',async()=>{
 const [saved]=await sql`SELECT * FROM budgets WHERE service='llm'`;
 const [c]=await sql`SELECT count(*) FILTER(WHERE started_at>now()-interval '1 minute')::int AS minute,count(*) FILTER(WHERE started_at>now()-interval '1 hour')::int AS hour,count(*)::int AS day FROM receipt_attempts WHERE service='llm' AND origin='live' AND started_at>now()-interval '1 day'`;
 process.env.REALTIME_NEWS_ONLY='true';let hits=0;
 const send=async()=>{hits++;return {response:{ok:true}};};
 try{
  await sql`UPDATE budgets SET per_minute=${c.minute+100},per_hour=${c.hour+10},per_day=${c.day+1000} WHERE service='llm'`;
  await assert.rejects(paidRequest({service:'llm',purpose:'score_article',identity:tag()},send),BudgetExceededError);
  assert.equal(hits,0);
  await paidRequest({service:'llm',purpose:'square.draft',identity:tag()},send);assert.equal(hits,1);
 }finally{await sql`UPDATE budgets SET per_minute=${saved.per_minute},per_hour=${saved.per_hour},per_day=${saved.per_day} WHERE service='llm'`;process.env.REALTIME_NEWS_ONLY='false';}
});
