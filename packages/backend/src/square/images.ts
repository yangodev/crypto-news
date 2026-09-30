import { shutdownSignal } from '../jobs/queue.ts';
import { sql } from '../db.ts';
import { config } from '../config.ts';
import { requestIllustration } from '../providers/image.ts';
import { completeReceipt } from '../providers/receipts.ts';
import { coverKey, renderCover } from './cover.ts';

export async function generateSquareImages(manualId?:number){
 if(shutdownSignal.signal.aborted)return {stopped:true};
 if(!config.modelCallsEnabled||process.env.SQUARE_IMAGE_ENABLED!=='true')return {disabled:true};
 // A stopped worker cannot silently leave a draft stuck or issue another paid attempt.
 await sql`UPDATE square_drafts SET cover_status='fallback',cover_error='生成中断，使用模板图',cover_updated_at=now() WHERE cover_status='generating' AND cover_updated_at<now()-interval '10 minutes'`;
 const [d]=await sql`UPDATE square_drafts SET cover_status='generating',cover_updated_at=now()
 WHERE id=(SELECT id FROM square_drafts WHERE cover_status='pending' AND (${manualId??null}::bigint IS NULL OR id=${manualId??null}) AND ((status='review' AND expires_at>now()) OR (${manualId??null}::bigint=id AND status IN ('review','expired') AND evidence ? 'manualSelection')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
 if(!d)return {generated:0};
 const key=coverKey(d.id,d.title,d.evidence);
 try{
  if(shutdownSignal.signal.aborted){await sql`UPDATE square_drafts SET cover_status='pending' WHERE id=${d.id} AND cover_status='generating'`;return {stopped:true};}
  const result=await requestIllustration(String(d.id),d.title);
  const image=Buffer.from((result.response as {image:string}).image,'base64');
  await renderCover(key+'-ai',d.title,d.evidence.sourceName,d.evidence.publishedAt,image);
  await completeReceipt(sql,result.receiptId);
  await sql`UPDATE square_drafts SET cover_status='generated',cover_key=${key},cover_error=NULL,cover_updated_at=now() WHERE id=${d.id} AND title=${d.title} AND evidence=${sql.json(d.evidence)} AND cover_status='generating'`;
  return {generated:1};
 }catch{
  // Provider details stay in receipts. Never return secrets or repeat a possibly billed generation.
  await sql`UPDATE square_drafts SET cover_status='fallback',cover_error='生图未完成或额度不足，使用模板图；详情见调用记录',cover_updated_at=now() WHERE id=${d.id} AND cover_status='generating'`;
  return {fallback:1};
 }
}
