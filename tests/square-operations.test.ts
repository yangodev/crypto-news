import './setup.ts';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {fromTelegram} from '../packages/backend/src/sources/web-list.ts';
import {officialSource,primaryLinks,tracePrimarySources} from '../packages/backend/src/square/trace.ts';
import {imageFailure} from '../packages/backend/src/square/images.ts';
import {BudgetExceededError,ReceiptUnknownError} from '../packages/backend/src/providers/receipts.ts';
import {automaticBlocks} from '../packages/backend/src/square/auto.ts';
import {manualBlock,manualSnapshot} from '../packages/backend/src/square/manual.ts';
import {digest} from '../packages/backend/src/square/policy.ts';
import {closeDb} from '../packages/backend/src/db.ts';
after(closeDb);
test('official links enforce origin and path boundaries and deduplicate tracking URLs',()=>{
 const sources=[{id:'official',config:{evidenceUrlPrefixes:['https://example.com/news']}}];
 for(const u of ['http://example.com/news/a','https://example.com.evil.org/news/a','https://example.com/newspaper/a','https://user@example.com/news/a','https://example.com:8443/news/a','https://example.com/news/../private'])assert.equal(officialSource(u,sources),null,u);
 assert.equal(officialSource('https://example.com/news/a',sources)?.id,'official');
 assert.deepEqual(primaryLinks('<a href="https://example.com/news/a?utm_source=x#part">A</a><a href="https://example.com/news/a">A</a><a href="https://evil.org">bad</a>','https://media.test/story',sources),[{url:'https://example.com/news/a',sourceId:'official'}]);
});
test('public Telegram adapter ignores forwarded, wrong-channel and undated posts',()=>{
 const post=(id:string,extra='',date='2026-09-30T01:00:00+00:00')=>`<div class="tgme_widget_message" data-post="${id}">${extra}<div class="tgme_widget_message_text">An official protocol announcement with enough complete text.<script>bad()</script><a href="javascript:alert(1)">bad link</a></div><a class="tgme_widget_message_date"><time datetime="${date}"></time></a></div>`;
 const rows=fromTelegram(post('official/1')+post('other/2')+post('official/3','<div class="tgme_widget_message_forwarded_from">Forward</div>')+post('official/4','','2026-09-30'),'https://t.me/s/official');
 assert.equal(rows.length,1);assert.equal(rows[0]!.url,'https://t.me/official/1');assert.equal(rows[0]!.bodyStatus,'ok');assert.doesNotMatch(rows[0]!.bodyHtml!,/script|javascript|bad\(\)/);assert.equal(rows[0]!.publishedAt!.toISOString(),'2026-09-30T01:00:00.000Z');
 assert.throws(()=>fromTelegram('', 'https://t.me/private'),/public channel/);
});
test('collection kill switch blocks automatic tracing without a request',async()=>{
 process.env.COLLECT_ENABLED='false';let calls=0;
 assert.deepEqual(await tracePrimarySources(undefined,async()=>{calls++;throw Error('unexpected')}),{disabled:true});assert.equal(calls,0);
});
test('image failures disclose only safe diagnostics and only pre-call budget exhaustion retries',()=>{
 assert.equal(imageFailure(new BudgetExceededError('image','hour',60)).retrySeconds,60);
 assert.equal(imageFailure(new ReceiptUnknownError(1,'private response')).code,'unknown');
 assert.equal(imageFailure(new Error('Image provider HTTP 429')).code,'http_429');
 assert.equal(imageFailure(new DOMException('secret','TimeoutError')).code,'timeout');
 assert.equal(imageFailure(new Error('token-secret https://secret.example')).retrySeconds,null);
 assert.doesNotMatch(JSON.stringify(imageFailure(new Error('token-secret https://secret.example'))),/secret/);
 assert.equal(imageFailure(new Error('font failed'),true).code,'render');
});
test('diagnostics report multiple blockers and fail closed on missing evidence',()=>{
 assert.deepEqual(automaticBlocks({}),['证据缺失或格式错误']);
 const d={evidence:{material:'',quote:'',stage:'rumor'},body:'body',title:'title',content_hash:'wrong'};
 const reasons=automaticBlocks(d);assert.ok(reasons.length>=7);assert.ok(reasons.includes('证据缺失或冲突'));assert.ok(reasons.includes('正文版本不一致'));
});
test('manual review binds all evidence, source and image changes and rejects unsafe/stale content',()=>{
 const body='标题\n协议升级已经完成。';const d={id:1,status:'review',evidence:{material:'official evidence',quote:'official',stage:'executed'},source_enabled:true,article_revision:1,current_revision:1,eligible:true,current_body_status:'ok',body_text:'official evidence',body,title:'标题',content_hash:digest(body),expires_at:new Date(Date.now()+60000),cover_key:'cover'};
 assert.equal(manualBlock(d),null);const snap=manualSnapshot(d,'imagehash');
 for(const change of [{body:'changed'},{current_revision:2},{source_enabled:false},{current_fact_id:42},{evidence:{...d.evidence,quote:'changed'}},{cover_key:'other'}])assert.notEqual(manualSnapshot({...d,...change},'imagehash'),snap);
 assert.notEqual(manualSnapshot(d,'otherhash'),snap);
 assert.equal(manualSnapshot({...d,evidence:{...d.evidence,manualApproval:{operator:'admin'}}},'imagehash'),snap);
 assert.match(manualBlock({...d,source_enabled:false})!,/停用/);
 assert.match(manualBlock({...d,expires_at:new Date(0)})!,/两小时/);assert.equal(manualBlock({...d,expires_at:new Date(0)},true),null);
});

test('traced primary pages are independent materials, preserve missing time and do not promote media',async()=>{
 const {sql}=await import('../packages/backend/src/db.ts');const {upsertMaterial}=await import('../packages/backend/src/content/materials.ts');
 const key='trace-'+Date.now(),media=key+'-media',official=key+'-official';
 await sql`INSERT INTO sources(id,name,kind,tier,first_party,config,cursor) VALUES(${media},'Media','rss','T2',false,'{}','{}'),(${official},'Official','rss','T1',true,${sql.json({evidenceUrlPrefixes:['https://official.example/'+key]})},${sql.json({initializedAt:new Date().toISOString()})})`;
 const material=await upsertMaterial({sourceId:media,url:'https://media.example/'+key,title:'Media story',bodyHtml:`<p>A media story <a href="https://official.example/${key}/release">official announcement</a></p>`,bodyText:'A media story with an official announcement link.',bodyStatus:'ok',publishedAt:new Date(),via:'fetch'});
 const id=material.articleId;
 await sql`INSERT INTO publications(article_id,eligible,selected,title,summary,source_id,channel,first_party,url,published_at,discovered_at,timeline_at,sort_at) VALUES(${id},true,false,'Media','Summary',${media},'news',false,${'https://media.example/'+key},now(),now(),now(),now())`;
 let calls=0;
 const html='<html><head><title>Official release</title></head><body><article><h1>Official release</h1><p>'+('The protocol upgrade has been completed with the following implementation details. '.repeat(15))+'</p></article></body></html>';
 const result=await tracePrimarySources(id,async(url)=>{calls++;return {url:String(url),status:200,headers:new Headers({'content-type':'text/html'}),text:()=>html} as any;});
 assert.deepEqual(result,{traced:1,collected:1});assert.equal(calls,1);
 const [imported]=await sql`SELECT source_id,published_at,body_status FROM articles WHERE url=${'https://official.example/'+key+'/release'}`;
 assert.equal(imported.source_id,official);assert.equal(imported.published_at,null);assert.equal(imported.body_status,'ok');
 assert.equal((await sql`SELECT selected,first_party FROM publications WHERE article_id=${id}`)[0]!.selected,false);
 assert.deepEqual(await tracePrimarySources(id,async()=>{throw Error('must not repeat')}),{traced:0});
 const [trace]=await sql`SELECT links FROM square_traces WHERE article_id=${id}`;assert.match(trace.links[0].reason,/无精确发布时间/);
});
