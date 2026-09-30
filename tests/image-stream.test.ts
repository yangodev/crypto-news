import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseImageStream} from '../packages/backend/src/providers/image.ts';
const event=(e:unknown)=>'data: '+JSON.stringify(e)+'\n\n';
const item=event({type:'response.output_item.done',item:{type:'image_generation_call',status:'completed',result:'aGVsbG8='}});
const end=event({type:'response.completed',response:{status:'completed',id:'probe',usage:{total_tokens:1}}});
test('image SSE accepts completed item when final response omits output',()=>{assert.equal(parseImageStream(item+end).image,'aGVsbG8=');});
test('image SSE rejects partial, failed, missing and malformed image responses',()=>{
 for(const raw of [item,end,item+event({type:'response.failed'}),item+'data: broken\n\n',event({type:'response.completed',response:{status:'incomplete'}})])assert.throws(()=>parseImageStream(raw));
});
