import {sql} from '../db.ts';
import {SELECTION} from '@aihot/industry/selection';
import {automaticBlocks} from './auto.ts';

export function draftBlockers(d:any,now=Date.now()){
 if(['published','rejected'].includes(d.status))return [];
 if(d.status==='unknown')return ['平台结果未确认，已暂停后续发送，禁止直接重试'];
 if(d.status==='submitting')return ['正在提交，等待平台返回结果'];
 const reasons=automaticBlocks(d,now);
 if(d.paused)reasons.push('自动发布已暂停');
 if(d.cover_status!=='generated')reasons.push(d.cover_error??(d.cover_status==='generating'?'配图正在生成':'等待生成可发布的配图'));
 if(d.auto_review?.passed===false)reasons.push(d.auto_review.reason);
 else if(!d.auto_review)reasons.push('尚未完成独立图文审核');
 return [...new Set(reasons)];
}

export async function squareDiagnostics(){
 const [[funnel],samples,jobs,commands,sources,[acceptance]]=await Promise.all([
  sql`SELECT count(DISTINCT a.id)::int AS collected,
   count(DISTINCT a.id) FILTER(WHERE a.backfill_reason='first-import')::int AS initial_import,
   count(DISTINCT a.id) FILTER(WHERE a.body_status='ok')::int AS fulltext,
   count(DISTINCT a.id) FILTER(WHERE a.processing_state='analyzed')::int AS analyzed,
   count(DISTINCT a.id) FILTER(WHERE p.eligible)::int AS eligible,
   count(DISTINCT a.id) FILTER(WHERE p.selected)::int AS selected,
   count(DISTINCT a.id) FILTER(WHERE d.id IS NOT NULL AND NOT COALESCE((d.evidence->>'testOnly')::boolean,false))::int AS drafted,
   count(DISTINCT a.id) FILTER(WHERE d.status='published')::int AS published
   FROM articles a LEFT JOIN publications p ON p.article_id=a.id LEFT JOIN square_drafts d ON d.article_id=a.id
   WHERE a.discovered_at>now()-interval '24 hours'`,
  sql`SELECT p.article_id,p.title,p.score,p.selected,p.published_at,p.eligible,a.body_status,a.backfill_reason,
   s.name AS source_name,s.tier,s.first_party,an.reason_zh AS reason,
   t.status AS trace_status,t.note AS trace_note,coalesce(t.links,'[]') AS trace_links,
   (SELECT d.id FROM square_drafts d WHERE d.article_id=a.id AND NOT COALESCE((d.evidence->>'testOnly')::boolean,false) ORDER BY d.id DESC LIMIT 1) AS draft_id
   FROM publications p JOIN articles a ON a.id=p.article_id JOIN sources s ON s.id=a.source_id
   LEFT JOIN analyses an ON an.id=p.analysis_id LEFT JOIN square_traces t ON t.article_id=a.id AND t.article_revision=a.revision
   WHERE p.eligible AND p.visibility<>'withdrawn' AND a.discovered_at>now()-interval '24 hours'
   ORDER BY p.score DESC NULLS LAST,p.published_at DESC LIMIT 20`,
  sql`SELECT DISTINCT ON (job) job,status,started_at,finished_at FROM job_runs WHERE job LIKE 'square.%' ORDER BY job,started_at DESC`,
  sql`SELECT id,kind,subject,status,result,created_at,finished_at FROM square_commands ORDER BY id DESC LIMIT 20`,
  sql`SELECT id,name,health,fail_count,last_ok_at FROM sources WHERE enabled AND health IN ('degraded','failing') ORDER BY fail_count DESC LIMIT 10`,
  sql`SELECT min(published_at) AS first_auto_published_at,count(*)::int AS automatic_published FROM square_drafts WHERE status='published' AND verified_by IN ('square-auto-v1','square-auto-v2')`,
 ]);
 return {asOf:new Date().toISOString(),funnel,samples:samples.map(s=>({...s,threshold:SELECTION.thresholds[s.tier]??null})),jobs,commands,sources,acceptance};
}
