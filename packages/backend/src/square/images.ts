import { shutdownSignal } from '../jobs/queue.ts';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { requestIllustration } from '../providers/image.ts';
import { BudgetExceededError, ReceiptBusyError, ReceiptUnknownError, completeReceipt } from '../providers/receipts.ts';
import { coverKey, renderCover } from './cover.ts';

export function imageFailure(error:unknown,rendering=false){
 if(error instanceof BudgetExceededError)return {code:'budget',message:'配图请求额度暂时用尽，额度恢复且稿件未过期时继续',retrySeconds:error.retryAfterSeconds};
 if(error instanceof ReceiptBusyError)return {code:'in_flight',message:'同一配图请求仍在处理中，请查看调用记录',retrySeconds:null};
 if(error instanceof ReceiptUnknownError)return {code:'unknown',message:'上次配图调用结果不明，需先在调用记录核实',retrySeconds:null};
 if(rendering)return {code:'render',message:'已收到图片，但封面排版失败；可重试复用已有图片',retrySeconds:null};
 const e=error instanceof Error?error:null;
 const status=/^Image provider HTTP (\d{3})$/.exec(e?.message??'')?.[1];
 if(status)return {code:'http_'+status,message:`生图接口返回 HTTP ${status}，请查看调用记录`,retrySeconds:null};
 if(e?.name==='TimeoutError'||e?.name==='AbortError')return {code:'timeout',message:'生图调用超时，结果未确认，请查看调用记录',retrySeconds:null};
 if(e?.message==='Image provider not configured')return {code:'config',message:'生图接口配置不完整',retrySeconds:null};
 if(/^Image stream failed|^Image response|^No complete valid image/.test(e?.message??''))return {code:'response',message:'生图接口未返回完整有效图片，请查看调用记录',retrySeconds:null};
 return {code:'connection',message:'生图连接或响应处理失败，请查看调用记录',retrySeconds:null};
}

export async function generateSquareImages(manualId?:number){
 if(shutdownSignal.signal.aborted)return {stopped:true};
 if(!config.modelCallsEnabled||process.env.SQUARE_IMAGE_ENABLED!=='true')return {disabled:true};
 // A stopped worker cannot silently leave a draft stuck or issue another paid attempt.
 await sql`UPDATE square_drafts SET cover_status='fallback',cover_error_code='interrupted',cover_error='配图生成中断，需核实调用结果',cover_updated_at=now() WHERE cover_status='generating' AND cover_updated_at<now()-interval '10 minutes'`;
 const [d]=await sql`UPDATE square_drafts SET cover_status='generating',cover_updated_at=now()
 WHERE id=(SELECT id FROM square_drafts WHERE cover_status='pending' AND (cover_retry_at IS NULL OR cover_retry_at<=now()) AND (${manualId??null}::bigint IS NULL OR id=${manualId??null}) AND ((status='review' AND expires_at>now()) OR (${manualId??null}::bigint=id AND status IN ('review','expired'))) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
 if(!d)return {generated:0};
 const key=coverKey(d.id,d.title,d.evidence);
 let rendering=false;
 try{
  if(shutdownSignal.signal.aborted){await sql`UPDATE square_drafts SET cover_status='pending' WHERE id=${d.id} AND cover_status='generating'`;return {stopped:true};}
  const result=await requestIllustration(String(d.id),d.title);
  rendering=true;
  const image=Buffer.from((result.response as {image:string}).image,'base64');
  await renderCover(key+'-ai',d.title,d.evidence.sourceName,d.evidence.publishedAt,image);
  await completeReceipt(sql,result.receiptId);
  await sql`UPDATE square_drafts SET cover_status='generated',cover_key=${key},cover_error=NULL,cover_error_code=NULL,cover_retry_at=NULL,cover_updated_at=now() WHERE id=${d.id} AND title=${d.title} AND evidence=${sql.json(d.evidence)} AND cover_status='generating'`;
  return {generated:1};
 }catch(error){
  // Provider details stay in receipts. Never return secrets or repeat a possibly billed generation.
  const failure=imageFailure(error,rendering);
  const retryAt=failure.retrySeconds?new Date(Date.now()+failure.retrySeconds*1000):null;
  const waiting=!!retryAt&&retryAt<new Date(d.expires_at);
  await sql`UPDATE square_drafts SET cover_status=${waiting?'pending':'fallback'},cover_error=${failure.message},cover_error_code=${failure.code},cover_retry_at=${waiting?retryAt:null},cover_updated_at=now() WHERE id=${d.id} AND cover_status='generating'`;
  return waiting?{waiting:1}:{fallback:1};
 }
}
