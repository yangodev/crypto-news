import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sql} from '../db.ts';
import {REPO_ROOT} from '../config.ts';
import {shutdownSignal} from '../jobs/queue.ts';
import {confirmedPublication} from './policy.ts';
import {approvedAutomaticDraft} from './auto.ts';
const exec=promisify(execFile);
async function send(id:number){
 const {stdout}=await exec(process.execPath,[`${REPO_ROOT}/scripts/square/send.mjs`],{env:{...process.env,SQUARE_DRAFT_ID:String(id)},timeout:180000,maxBuffer:16384});
 return JSON.parse(stdout);
}
export async function deliverSquareDrafts(transport: (id:number)=>Promise<any> = send){
 await sql`UPDATE square_drafts SET status='unknown',updated_at=now() WHERE status='submitting' AND attempted_at<now()-interval '5 minutes'`;
 await sql`UPDATE square_control SET paused=true,updated_at=now() WHERE EXISTS(SELECT 1 FROM square_drafts WHERE status='unknown')`;
 await sql`UPDATE square_drafts SET status='expired',updated_at=now() WHERE status IN ('review','ready') AND expires_at<now()`;
 if(process.env.SQUARE_PUBLISH_ENABLED!=='true'||process.env.SQUARE_AUTO_ENABLED!=='true'||shutdownSignal.signal.aborted)return {disabled:true};
 const claim=await sql.begin(async tx=>{
  const [lock]=await tx`SELECT pg_try_advisory_xact_lock(72819452) AS held`;if(!lock!.held)return null;
  const [control]=await tx`SELECT * FROM square_control WHERE id=true FOR UPDATE`;
  if(control!.paused||!control!.auto_started_at)return null;
  const [usage]=await tx`SELECT count(*) FILTER(WHERE attempted_at>now()-interval '1 hour') AS hour,count(*) AS day
   FROM square_drafts WHERE attempted_at>now()-interval '24 hours'`;
  if(Number(usage!.hour)>=control!.hourly_limit||Number(usage!.day)>=control!.daily_limit)return null;
  const [d]=await tx`SELECT d.id FROM square_drafts d JOIN publications p ON p.article_id=d.article_id
   WHERE d.status='ready' AND d.expires_at>now() AND d.created_at>=${control!.auto_started_at}
   AND NOT EXISTS(SELECT 1 FROM square_drafts x WHERE x.status IN ('submitting','unknown'))
   AND NOT EXISTS(SELECT 1 FROM square_drafts x JOIN publications xp ON xp.article_id=x.article_id
    WHERE x.id<>d.id AND x.status='published' AND (x.article_id=d.article_id OR x.event_key=d.event_key OR (p.fact_id IS NOT NULL AND xp.fact_id=p.fact_id)))
   ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
  if(!d)return null;
  try{await approvedAutomaticDraft(Number(d.id));}
  catch{await tx`UPDATE square_drafts SET status='review',verified_at=NULL,verified_by=NULL,review_reasons=ARRAY['发布前条件或图文版本变化，需重新检查'] WHERE id=${d.id}`;return null;}
  const [row]=await tx`UPDATE square_drafts SET status='submitting',attempted_at=now(),updated_at=now() WHERE id=${d.id} AND status='ready' RETURNING id`;
  return row;
 });
 if(!claim)return {sent:0};
 try{
  const raw=await transport(Number(claim.id));
  if(raw?.notSubmitted===true){
   await sql`UPDATE square_drafts SET status='review',verified_at=NULL,verified_by=NULL,review_reasons=ARRAY['发送前检查失败，未发帖；需人工检查'],updated_at=now() WHERE id=${claim.id} AND status='submitting'`;
   return {sent:0,blocked:true};
  }
  const result=confirmedPublication(raw);if(!result)throw Error('Unconfirmed publication');
  await sql`UPDATE square_drafts SET status='published',platform_id=${result.id},platform_url=${result.url},published_at=now(),updated_at=now() WHERE id=${claim.id} AND status IN ('submitting','unknown')`;
  return {sent:1};
 }catch{
  await sql.begin(async tx=>{
   await tx`UPDATE square_drafts SET status='unknown',updated_at=now() WHERE id=${claim.id} AND status='submitting'`;
   await tx`UPDATE square_control SET paused=true,updated_at=now() WHERE id=true`;
  });
  return {unknown:1};
 }
}
