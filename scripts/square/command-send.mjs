// Worker-only bridge: API approval contains no platform credential.
import {sql,closeDb} from '../../packages/backend/src/db.ts';
import {publishApprovedDraft} from './manual.mjs';
const id=Number(process.argv[2]);
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,opts={})=>originalFetch(url,{...opts,signal:AbortSignal.any([...(opts.signal?[opts.signal]:[]),AbortSignal.timeout(45000)])});
console.log=()=>{};console.error=()=>{};
try{
 const [command]=await sql`SELECT * FROM square_commands WHERE id=${id} AND kind='publish' AND status='running'`;
 if(!command)throw Error('Approval request missing');
 const p=command.payload;
 const result=await publishApprovedDraft({id:Number(command.subject),hash:p.contentHash,coverHash:p.coverHash,snapshot:p.snapshot,
  operator:command.actor,acceptStale:p.acceptStale===true,enforceRuntime:true,key:process.env.BINANCE_SQUARE_OPENAPI_KEY});
 process.stdout.write(JSON.stringify(result));
}catch(e){
 const known={
  'Publication paused':'发布已暂停，未提交',
  'Publication limit reached':'已达到发布频率上限，稍后需重新确认',
  'Unresolved publication outcome':'存在尚未核实的发布结果，禁止继续发送',
  'Approved evidence changed':'审批后的原文或图文已变化，请重新预览',
  'Publication outcome uncertain':'平台结果尚未确认，自动发布已暂停，禁止重试',
 };
 const message=known[e.message]??'发布未完成，请核对稿件状态和审批版本；不要直接重复发送';
 await sql`UPDATE square_commands SET result=${sql.json({message})} WHERE id=${id}`;
 process.stdout.write(JSON.stringify({failed:true}));
}finally{await closeDb();}
