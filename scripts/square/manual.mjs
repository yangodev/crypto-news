// Operator-only worker command. Explicit single-draft approval; automatic delivery stays paused.
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {sql,closeDb} from '../../packages/backend/src/db.ts';
import {generateSquareDrafts} from '../../packages/backend/src/square/drafts.ts';
import {generateSquareImages} from '../../packages/backend/src/square/images.ts';
import {generatedCover,coverKey} from '../../packages/backend/src/square/cover.ts';
import {confirmedPublication,digest} from '../../packages/backend/src/square/policy.ts';
import {loadAutomaticDraft} from '../../packages/backend/src/square/auto.ts';
import {manualBlock,manualSnapshot} from '../../packages/backend/src/square/manual.ts';
import {uploadImage,publish} from './upstream-lib.mjs';

export async function publishApprovedDraft({id,hash,operator,acceptStale=false,key,coverHash,snapshot,enforceRuntime=false},transport={uploadImage,publish}){
 if(!Number.isSafeInteger(id)||id<1||!hash||!operator||!key)throw Error('Missing explicit draft approval or credential');
 const d=await loadAutomaticDraft(id);
 if(!d||!['review','expired'].includes(d.status)||d.evidence.testOnly||/历史测试|内部流程测试/.test(d.body+d.title))throw Error('Draft is not publishable');
 if(d.article_revision!==d.current_revision||d.visibility==='withdrawn'||!d.eligible||d.evidence.conflict||!d.evidence.material?.includes(d.evidence.quote)||!d.evidence.quote)throw Error('Evidence or revision check failed');
 if(hash!==d.content_hash||digest(d.body)!==hash||!d.body.startsWith(d.title+'\n'))throw Error('Approved content changed');
 if(new Date(d.expires_at)<=new Date()&&!acceptStale)throw Error('Explicit stale-source approval required');
 if(d.cover_status!=='generated'||d.cover_key!==coverKey(id,d.title,d.evidence))throw Error('Service-generated cover required');
 if(!/^[a-f0-9]{64}$/.test(coverHash??''))throw Error('Explicit cover hash approval required');
 const cover=await generatedCover(id,coverHash);
 if(enforceRuntime){const blocked=manualBlock(d,acceptStale);if(blocked)throw Error(blocked);if(!snapshot||manualSnapshot(d,cover.hash)!==snapshot)throw Error('Approved evidence changed');}
 const approval={operator,at:new Date().toISOString(),hash,coverHash,acceptStale};
 const claim=await sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(72819452)`;
  if(enforceRuntime){
   const [c]=await tx`SELECT * FROM square_control WHERE id=true FOR UPDATE`;
   const [usage]=await tx`SELECT count(*) FILTER(WHERE attempted_at>now()-interval '1 hour') AS hour,count(*) AS day FROM square_drafts WHERE attempted_at>now()-interval '24 hours'`;
   if(process.env.SQUARE_PUBLISH_ENABLED!=='true'||c.paused)throw Error('Publication paused');
   if(Number(usage.hour)>=c.hourly_limit||Number(usage.day)>=c.daily_limit)throw Error('Publication limit reached');
   if((await tx`SELECT 1 FROM square_drafts WHERE status IN ('unknown','submitting') LIMIT 1`).length)throw Error('Unresolved publication outcome');
  }
  const [row]=await tx`UPDATE square_drafts SET status='submitting',verified_by=${operator},verified_at=now(),attempted_at=now(),updated_at=now(),evidence=evidence||${tx.json({manualApproval:approval})}
  WHERE id=${id} AND status=${d.status} AND content_hash=${hash} AND body=${d.body} AND evidence=${tx.json(d.evidence)} AND cover_key=${d.cover_key}
  AND NOT EXISTS(SELECT 1 FROM square_drafts x JOIN publications xp ON xp.article_id=x.article_id WHERE x.id<>${id} AND x.status IN ('submitting','unknown','published') AND (x.article_id=${d.article_id} OR x.event_key=${d.event_key} OR (${d.current_fact_id??null}::bigint IS NOT NULL AND xp.fact_id=${d.current_fact_id??null})))
  AND NOT EXISTS(SELECT 1 FROM square_drafts WHERE status='submitting') RETURNING id`;
  return row;
 });
 if(!claim)throw Error('Already claimed, published, uncertain or changed');
 let submitted=false;
 try{
  const image=await transport.uploadImage(key,cover.file,cover.bytes);
  const [current]=await sql`SELECT d.status,d.content_hash,a.revision,p.visibility,p.eligible FROM square_drafts d JOIN articles a ON a.id=d.article_id JOIN publications p ON p.article_id=d.article_id WHERE d.id=${id}`;
  if(current?.status!=='submitting'||current.content_hash!==hash||current.revision!==d.article_revision||current.visibility==='withdrawn'||!current.eligible)throw Error('Source changed before submission');
  if(enforceRuntime){
   const latest=await loadAutomaticDraft(id);
   const [control]=await sql`SELECT paused FROM square_control WHERE id=true`;
   if(control.paused||process.env.SQUARE_PUBLISH_ENABLED!=='true'||manualSnapshot(latest,cover.hash)!==snapshot)throw Error('Approval changed before submission');
   const duplicates=await sql`SELECT 1 FROM square_drafts x JOIN publications xp ON xp.article_id=x.article_id WHERE x.id<>${id} AND (x.status='unknown' OR (x.status='published' AND (x.article_id=${d.article_id} OR x.event_key=${d.event_key} OR (${latest.current_fact_id??null}::bigint IS NOT NULL AND xp.fact_id=${latest.current_fact_id??null})))) LIMIT 1`;
   if(duplicates.length)throw Error('Duplicate or unknown publication');
  }
  submitted=true;
  const result=confirmedPublication(await transport.publish(key,{contentType:1,bodyTextOnly:d.body,imageList:[image]}));
  if(!result)throw Error('Publication outcome uncertain');
  await sql`UPDATE square_drafts SET status='published',platform_id=${result.id},platform_url=${result.url},published_at=now(),updated_at=now() WHERE id=${id} AND status IN ('submitting','unknown')`;
  return result;
 }catch(e){
  await sql`UPDATE square_drafts SET status=${submitted?'unknown':'failed'},updated_at=now() WHERE id=${id} AND status='submitting'`;
  if(submitted&&enforceRuntime)await sql`UPDATE square_control SET paused=true,updated_at=now() WHERE id=true`;
  throw e;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,subject,hash,coverHash]=process.argv.slice(2);
 const operator=process.env.SQUARE_OPERATOR;
 const originalFetch=globalThis.fetch;
 // Bound only publication HTTP calls; model/image providers have their own deadlines.
 try{
  if(!operator)throw Error('SQUARE_OPERATOR required');
  if(action==='prepare'){
   if(!subject)throw Error('article id required');
   await generateSquareDrafts({articleId:subject,requestedBy:operator});
   const [d]=await sql`SELECT id FROM square_drafts WHERE article_id=${subject} AND evidence ? 'manualSelection' AND NOT COALESCE((evidence->>'testOnly')::boolean,false) ORDER BY id DESC LIMIT 1`;
   if(!d)throw Error('No formal draft');
   await generateSquareImages(Number(d.id));
   const [final]=await sql`SELECT id,title,body,content_hash,status,cover_status,evidence->>'receiptId' AS receipt_id FROM square_drafts WHERE id=${d.id}`;
   process.stdout.write(JSON.stringify({...final,coverHash:(await generatedCover(Number(d.id))).hash})+'\n');
  }else if(action==='publish'){
   const key=(await readFile('/dev/stdin','utf8')).trim();
   globalThis.fetch=(url,opts={})=>originalFetch(url,{...opts,signal:AbortSignal.any([...(opts.signal?[opts.signal]:[]),AbortSignal.timeout(45000)])});
   console.log=()=>{};console.error=()=>{};
   const result=await publishApprovedDraft({id:Number(subject),hash,coverHash,operator,acceptStale:process.argv.includes('--accept-stale'),key});
   process.stdout.write(JSON.stringify(result)+'\n');
  }else throw Error('Expected prepare or publish');
 }catch(e){process.stderr.write(String(e.message).replace(/cr_[a-zA-Z0-9]+/g,'[redacted]')+'\n');process.exitCode=1;}
 finally{await closeDb();}
}
