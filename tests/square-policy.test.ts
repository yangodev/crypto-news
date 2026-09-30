import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eventKey,freshness,reviewReasons,confirmedPublication} from '../packages/backend/src/square/policy.ts';
const now=Date.parse('2026-09-29T08:00:00Z');
test('freshness rejects old, absent, malformed and future time',()=>{
 assert.equal(freshness('2026-09-29T07:00:00Z',now),true);
 for(const t of [null,'bad','2026-09-29T05:59:59Z','2026-09-29T08:00:01Z'])assert.equal(freshness(t,now),false);
});
test('dedup uses event identity or canonical URL without tracking',()=>{
 assert.equal(eventKey(42,'https://example.com/a'),eventKey(42,'https://example.com/b'));
 assert.equal(eventKey(null,'https://example.com/a?utm_source=x#top'),eventKey(null,'https://example.com/a'));
 assert.notEqual(eventKey(null,'https://example.com/a?id=2'),eventKey(null,'https://example.com/a?id=3'));
 assert.throws(()=>eventKey(null,'javascript:alert(1)'));
});
test('source-backed draft still requires operator review during trial',()=>{
 const reasons=reviewReasons({title:'公告',summary:'协议完成升级',quote:'completed upgrade',material:'The network completed upgrade today.',firstParty:true,occurredAt:'2026-09-29T07:30:00Z',publishedAt:new Date('2026-09-29T07:40:00Z'),backfill:false,conflict:false,stage:'executed'},now);
 assert.deepEqual(reasons,['待作者核验事实与表达']);
});
test('bad evidence, rumor, media and invented positions remain flagged',()=>{
 const reasons=reviewReasons({title:'我买了这个币',summary:'稳赚',quote:'not in material',material:'Unknown',firstParty:false,occurredAt:null,publishedAt:null,backfill:true,conflict:true,stage:'rumor'},now);
 assert.equal(reasons.length,8);
});
test('504-style success, missing id, missing link and external links are not confirmation',()=>{
 for(const v of [null,{publishStatus:'success_without_post_id'},{id:42},{id:42,shareLink:'https://evil.example/a'},{id:'unavailable',shareLink:'https://www.binance.com/a'}])assert.equal(confirmedPublication(v),null);
 assert.deepEqual(confirmedPublication({id:'42',shareLink:'https://www.binance.com/a'}),{id:'42',url:'https://www.binance.com/a'});
});
