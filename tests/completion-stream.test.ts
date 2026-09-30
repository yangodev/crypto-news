import{test}from'node:test';import assert from'node:assert/strict';import{parseCompletionStream}from'../packages/backend/src/providers/stream.ts';
const frame=(o:unknown)=>`data: ${JSON.stringify(o)}\n\n`;
test('chat completion stream collects chunks only after stop',()=>{
 const r=parseCompletionStream(frame({id:'x',choices:[{index:0,delta:{content:'{"ok":'}}]})+frame({choices:[{index:0,delta:{content:'true}'},finish_reason:'stop'}]})+'data: [DONE]\n\n');
 assert.equal((r.choices as any)[0].message.content,'{"ok":true}');
});
test('responses completed event normalizes to the existing contract',()=>{
 const r=parseCompletionStream(frame({type:'response.completed',response:{id:'x',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}}));
 assert.equal((r.choices as any)[0].message.content,'{"ok":true}');
});
test('truncated, failed and token-limited streams never pass',()=>{
 for(const s of [frame({choices:[{delta:{content:'partial'}}]}),frame({type:'response.failed'}),frame({choices:[{finish_reason:'length'}]}),'data: {broken\n\n'])assert.throws(()=>parseCompletionStream(s));
});
