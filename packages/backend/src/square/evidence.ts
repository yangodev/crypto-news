import {sql,type Db} from '../db.ts';
import {officialSource} from './trace.ts';
import {digest} from './policy.ts';
export {TRUSTED_MEDIA} from '@aihot/industry/square';
type PrimaryRow={id:string;revision:number;url:string;title:string;material:string;body_status:string;published_at:Date|null;backfill_reason:string|null;source_id:string;source_name:string;enabled:boolean;first_party:boolean;tier:string;config:Record<string,any>;visibility:string|null};
export async function loadPrimary(id:string){
 const [p]=await sql<PrimaryRow[]>`SELECT a.id,a.revision,a.url,a.title,left(a.body_text,18000) AS material,a.body_status,a.published_at,
 a.backfill_reason,s.id AS source_id,s.name AS source_name,s.enabled,s.first_party,s.tier,s.config,p.visibility
 FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id WHERE a.id=${id}`;
 if(!p||!p.enabled||!p.first_party||p.tier!=='T1'||p.body_status!=='ok'||!p.material||p.visibility==='withdrawn'||!officialSource(p.url,[{id:p.source_id,config:p.config}]))return null;
 const {config,...value}=p;
 return {...value,fingerprint:digest(JSON.stringify([value.id,value.revision,value.url,value.material,value.published_at,value.backfill_reason,value.source_id,value.source_name,value.enabled,value.first_party,value.tier,config.evidenceUrlPrefixes]))};
}
export async function primaryCandidates(articleId:string){
 const [trace]=await sql`SELECT t.links FROM square_traces t JOIN articles a ON a.id=t.article_id AND a.revision=t.article_revision WHERE a.id=${articleId} AND t.status='done'`;
 const out=[];
 for(const link of (trace?.links??[]).slice(0,5)){
  if(link.status!=='collected'||!link.articleId||link.articleId===articleId)continue;
  const p=await loadPrimary(link.articleId);if(p)out.push(p);
 }
 return out;
}

export async function publicationConflict(id:number,db:Db=sql){
 const rows=await db`SELECT 1 FROM square_drafts d JOIN publications p ON p.article_id=d.article_id
 JOIN square_drafts x ON x.id<>d.id AND x.status IN ('submitting','unknown','published')
 JOIN publications xp ON xp.article_id=x.article_id
 WHERE d.id=${id} AND (x.article_id=d.article_id OR x.event_key=d.event_key
 OR (p.fact_id IS NOT NULL AND xp.fact_id=p.fact_id)
 OR x.article_id=d.evidence->'primary'->>'articleId'
 OR d.article_id=x.evidence->'primary'->>'articleId'
 OR (d.evidence->'primary'->>'articleId' IS NOT NULL AND d.evidence->'primary'->>'articleId'=x.evidence->'primary'->>'articleId')) LIMIT 1`;
 return rows.length>0;
}
