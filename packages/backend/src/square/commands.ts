import {z} from 'zod';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sql} from '../db.ts';
import {audit} from '../admin/auth.ts';
import {REPO_ROOT,config} from '../config.ts';
import {shutdownSignal} from '../jobs/queue.ts';
import {manualPreview} from './manual.ts';
import {generateSquareDrafts} from './drafts.ts';
import {generateSquareImages} from './images.ts';
import {tracePrimarySources} from './trace.ts';
const exec=promisify(execFile);
const Approval=z.object({snapshot:z.string().regex(/^[a-f0-9]{64}$/),contentHash:z.string().regex(/^[a-f0-9]{64}$/),coverHash:z.string().regex(/^[a-f0-9]{64}$/),
 confirmed:z.literal(true),acceptStale:z.boolean(),reason:z.string().trim().min(5).max(500)});
const Request=z.object({kind:z.enum(['prepare','trace','image','publish']),subject:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),payload:z.unknown().optional()});
const fail=(message:string)=>Object.assign(Error(message),{statusCode:409});

export async function requestSquareCommand(input:unknown,actor:string,key:string){
 const request=Request.parse(input);
 if(['publish','image'].includes(request.kind)&&(!/^\d+$/.test(request.subject)||!Number.isSafeInteger(Number(request.subject))||Number(request.subject)<1))throw Object.assign(Error('无效稿件编号'),{statusCode:400});
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw Object.assign(Error('缺少有效请求编号'),{statusCode:400});
 const [existing]=await sql`SELECT id,status,kind,subject,payload FROM square_commands WHERE actor=${actor} AND request_key=${key}`;
 if(existing){
  if(existing.kind!==request.kind||existing.subject!==request.subject||(request.kind==='publish'&&JSON.stringify(Approval.parse(existing.payload))!==JSON.stringify(Approval.parse(request.payload))))throw fail('请求编号已经用于其他操作');
  return {id:existing.id,status:existing.status};
 }
 let payload:Record<string,unknown>={};
 if(request.kind==='publish'){
  const approval=Approval.parse(request.payload);const preview=await manualPreview(Number(request.subject));
  if(preview.snapshot!==approval.snapshot||preview.contentHash!==approval.contentHash||preview.coverHash!==approval.coverHash)throw fail('预览已变化，请刷新后重新核验');
  if(preview.stale&&!approval.acceptStale)throw fail('原始消息已超过分类时效，需明确确认');
  const [c]=await sql`SELECT paused FROM square_control WHERE id=true`;
  if(process.env.SQUARE_PUBLISH_ENABLED!=='true'||c?.paused)throw fail('发布已暂停');
  payload=approval;
 }else if(request.kind==='prepare'||request.kind==='trace'){
  const [a]=await sql`SELECT a.id FROM articles a JOIN publications p ON p.article_id=a.id WHERE a.id=${request.subject} AND p.eligible AND p.visibility<>'withdrawn'`;
  if(!a)throw fail('需要先取得可用正文及中文摘要');
  if(request.kind==='prepare'&&!config.modelCallsEnabled)throw fail('模型调用未启用');
 }else{
  const [d]=await sql`SELECT id FROM square_drafts WHERE id=${Number(request.subject)||0} AND status IN ('review','expired') AND cover_status='fallback' AND NOT COALESCE((evidence->>'testOnly')::boolean,false)`;
  if(!d)throw fail('仅可重试尚未发布的配图失败稿件');
  if(!config.modelCallsEnabled||process.env.SQUARE_IMAGE_ENABLED!=='true')throw fail('配图生成未启用');
 }
 const rows=await sql`INSERT INTO square_commands(kind,subject,actor,request_key,payload) VALUES(${request.kind},${request.subject},${actor},${key},${sql.json(payload as never)}) ON CONFLICT DO NOTHING RETURNING id,status`;
 const [active]=rows.length?rows:await sql`SELECT id,status FROM square_commands WHERE kind=${request.kind} AND subject=${request.subject} AND status IN ('queued','running')`;
 if(!active)throw fail('请求状态已变化，请刷新');
 if(rows.length)await audit(actor,'square.'+request.kind,request.subject,typeof payload.reason==='string'?payload.reason:null,null,{commandId:active.id,snapshot:payload.snapshot??null},key);
 return {id:active.id,status:active.status};
}

export async function runSquareCommands(){
 if(shutdownSignal.signal.aborted)return {stopped:true};
 // A crashed publication must never be replayed. The delivery recovery marks its draft unknown.
 await sql`UPDATE square_commands SET status='failed',result='{"message":"操作中断，请检查稿件及调用记录；没有自动重试"}',finished_at=now() WHERE status='running' AND started_at<now()-interval '10 minutes'`;
 const [c]=await sql`UPDATE square_commands SET status='running',started_at=now() WHERE id=(SELECT id FROM square_commands WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
 if(!c)return {processed:0};
 try{
  let result:unknown;
  if(c.kind==='prepare'){
   result=await generateSquareDrafts({articleId:c.subject,requestedBy:c.actor});
   const [d]=await sql`SELECT id,status FROM square_drafts WHERE article_id=${c.subject} AND NOT COALESCE((evidence->>'testOnly')::boolean,false) ORDER BY id DESC LIMIT 1`;
   if(d&&['review','expired'].includes(d.status))await generateSquareImages(Number(d.id));
   result={...result as object,draftId:d?.id??null};
  }
  else if(c.kind==='trace')result=await tracePrimarySources(c.subject);
  else if(c.kind==='image'){
   if(!config.modelCallsEnabled||process.env.SQUARE_IMAGE_ENABLED!=='true')throw Error('image disabled');
   const rows=await sql`UPDATE square_drafts SET cover_status='pending',cover_retry_at=NULL,auto_review=NULL,verified_at=NULL,verified_by=NULL WHERE id=${Number(c.subject)} AND status IN ('review','expired') AND cover_status='fallback' RETURNING id`;
   if(!rows.length)throw Error('draft changed');
   result=await generateSquareImages(Number(c.subject));
  }else{
   const {stdout}=await exec(process.execPath,[`${REPO_ROOT}/scripts/square/command-send.mjs`,String(c.id)],{timeout:210000,maxBuffer:16384,env:process.env});
   result=JSON.parse(stdout);
   if((result as any).failed)throw Error('publish failed');
  }
  await sql`UPDATE square_commands SET status='done',result=${sql.json(result as never)},finished_at=now() WHERE id=${c.id} AND status='running'`;
  return {processed:1};
 }catch{
  await sql`UPDATE square_commands SET status='failed',result=coalesce(result,'{"message":"操作未完成，请检查稿件状态及调用记录"}'),finished_at=now() WHERE id=${c.id} AND status='running'`;
  return {processed:1,failed:true};
 }
}
