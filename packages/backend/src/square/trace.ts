// Follow only links embedded in the collected article and explicitly mapped to official sources.
// A match is a research lead, never confirmation that the linked page supports a claim.
import * as cheerio from 'cheerio';
import {sql} from '../db.ts';
import {guardedFetch} from '../lib/http-fetch.ts';
import {readable} from '../content/extract.ts';
import {upsertMaterial} from '../content/materials.ts';
import {jsonLdPublished} from '../sources/web-list.ts';
import {shutdownSignal} from '../jobs/queue.ts';

type Official={id:string;config:Record<string,any>;cursor?:{initializedAt?:string}};
export function officialSource(url:string,sources:Official[]):Official|null{
 try{
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return null;
  return sources.find(s=>(s.config.evidenceUrlPrefixes??[]).some((prefix:string)=>{
   const p=new URL(prefix);
   return u.origin===p.origin&&(u.pathname===p.pathname||u.pathname.startsWith(p.pathname.endsWith('/')?p.pathname:p.pathname+'/'));
  }))??null;
 }catch{return null;}
}
export function primaryLinks(html:string,base:string,sources:Official[]){
 const $=cheerio.load(html);const seen=new Set<string>();const links:{url:string;sourceId:string}[]=[];
 for(const a of $('a[href]').toArray()){
  try{
   const u=new URL($(a).attr('href')!,base);u.hash='';
   for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);
   const source=officialSource(u.href,sources);
   if(!source||seen.has(u.href)||u.href===base)continue;
   seen.add(u.href);links.push({url:u.href,sourceId:source.id});
   if(links.length===5)break;
  }catch{/* invalid links are not fetched */}
 }
 return links;
}
export function evidenceTerms(text:string):string[]{
 const stop=new Set(['the','this','that','with','from','have','will','were','been','into','their','they','said','says','news','crypto','cryptocurrency','million','billion','market','would','which','about','after','before','more','than','also','could']);
 const terms=[...text.matchAll(/\b[A-Z][A-Za-z0-9-]{2,24}\b/g)].map(m=>m[0].toLowerCase()).filter(t=>!stop.has(t));
 return [...new Set(terms)].slice(0,16);
}
export async function storedOfficialLeads(a:{id:string;title:string;body_text:string},sources:Official[]){
 const terms=evidenceTerms(a.title+' '+String(a.body_text??'').slice(0,4000));
 if(!terms.length)return [];
 const patterns=terms.map(t=>'%'+t+'%');
 const rows=await sql<{id:string;title:string;url:string;source_id:string;published_at:Date;material:string}[]>`SELECT a.id,a.title,a.url,a.source_id,a.published_at,left(a.body_text,5000) AS material
 FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN publications p ON p.article_id=a.id
 WHERE s.enabled AND s.first_party AND s.tier='T1' AND a.body_status='ok' AND a.id<>${a.id}
 AND a.published_at BETWEEN now()-interval '6 hours' AND now()
 AND COALESCE(p.visibility,'visible')<>'withdrawn'
 AND (a.title ILIKE ANY(${patterns}::text[]) OR left(a.body_text,5000) ILIKE ANY(${patterns}::text[]))
 ORDER BY a.published_at DESC LIMIT 60`;
 return rows.filter(r=>officialSource(r.url,sources)?.id===r.source_id)
 .map(r=>({...r,matches:terms.filter(t=>(r.title+' '+r.material).toLowerCase().includes(t)).length}))
 .sort((a,b)=>b.matches-a.matches).slice(0,5)
 .map(r=>({url:r.url,sourceId:r.source_id,status:'collected',articleId:r.id,title:r.title,publishedAt:r.published_at,reason:'从已采集官方公告中匹配的线索，尚需独立审核是否支持本条报道'}));
}
export async function tracePrimarySources(articleId?:string,fetchPage=guardedFetch){
 if(shutdownSignal.signal.aborted)return {stopped:true};
 if(!articleId&&process.env.COLLECT_ENABLED==='false')return {disabled:true};
 const [a]=await sql`SELECT a.id,a.revision,a.url,a.body_html,a.title,a.body_text FROM articles a JOIN publications p ON p.article_id=a.id
 JOIN sources s ON s.id=a.source_id
 WHERE p.visibility<>'withdrawn' AND p.eligible
 AND (${articleId??null}::text IS NULL OR a.id=${articleId??null})
 AND (${articleId??null}::text IS NOT NULL OR (NOT s.first_party AND p.score>=60 AND p.published_at BETWEEN now()-interval '6 hours' AND now()))
 AND NOT EXISTS(SELECT 1 FROM square_traces t WHERE t.article_id=a.id AND t.article_revision=a.revision AND t.trace_version=2 AND (t.status='running' AND t.updated_at>now()-interval '5 minutes' OR t.status<>'running' AND (jsonb_array_length(t.links)>0 OR t.updated_at>now()-interval '15 minutes')))
 ORDER BY p.selected DESC,p.score DESC,p.published_at DESC LIMIT 1`;
 if(!a)return {traced:0};
 const claimed=await sql`INSERT INTO square_traces(article_id,article_revision,status,trace_version) VALUES(${a.id},${a.revision},'running',2)
 ON CONFLICT(article_id) DO UPDATE SET article_revision=EXCLUDED.article_revision,status='running',trace_version=2,links='[]',note=NULL,updated_at=now()
 WHERE square_traces.article_revision<>EXCLUDED.article_revision OR square_traces.trace_version<2 OR (square_traces.status<>'running' AND jsonb_array_length(square_traces.links)=0 AND square_traces.updated_at<now()-interval '15 minutes') OR (square_traces.status='running' AND square_traces.updated_at<now()-interval '5 minutes') RETURNING article_id`;
 if(!claimed.length)return {traced:0};
 try{
  const sources=await sql<Official[]>`SELECT id,config,cursor FROM sources WHERE enabled AND first_party AND tier='T1'`;
  const candidates=primaryLinks(a.body_html??'',a.url,sources);const links:Record<string,unknown>[]=[];
  for(const candidate of candidates){
   if(shutdownSignal.signal.aborted)break;
   try{
    const r=await fetchPage(candidate.url,{timeoutMs:15000,maxBytes:2_000_000,maxRedirects:3});
    const source=officialSource(r.url,sources);
    if(r.status!==200||!source||source.id!==candidate.sourceId||!/html/i.test(r.headers.get('content-type')??'')){
     links.push({...candidate,status:'unconfirmed',reason:'页面不可读，或跳转后不属于已核验的一手来源'});continue;
    }
    const html=r.text(),body=readable(html,r.url),$=cheerio.load(html);
    const title=($('meta[property="og:title"]').attr('content')||$('h1').first().text()||$('title').text()).trim().slice(0,300);
    if(!body||!title){links.push({...candidate,status:'unconfirmed',reason:'无法完整提取原文'});continue;}
    const time=$('meta[property="article:published_time"]').attr('content')??jsonLdPublished($,html);
    const publishedAt=time&&/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(time)&&Number.isFinite(Date.parse(time))?new Date(time):null;
    // The new material goes through the ordinary relevance, scoring, grouping and freshness gates.
    const imported=await upsertMaterial({sourceId:source.id,url:r.url,title,bodyHtml:body.html,bodyText:body.text,bodyStatus:'ok',publishedAt,backfill:source.cursor?.initializedAt?null:'first-import',via:'ingest',raw:{discoveredVia:a.id}});
    links.push({...candidate,url:r.url,status:'collected',articleId:imported.articleId,title,publishedAt,reason:publishedAt?'已采集，等待独立判断；尚不代表原报道已证实':'已采集，原文无精确发布时间，仅供人工研究'});
   }catch{links.push({...candidate,status:'unconfirmed',reason:'读取失败或链接被安全检查拒绝'});}
  }
  if(links.filter(l=>l.status==='collected').length<5){
   for(const lead of await storedOfficialLeads(a as any,sources))if(!links.some(l=>l.articleId===lead.articleId)&&links.filter(l=>l.status==='collected').length<5)links.push(lead);
  }
  await sql`UPDATE square_traces SET status='done',links=${sql.json(links as never)},note=${links.length?'已检查原文链接及官方公告库，线索仍需核验是否支持报道':'原文链接及现有官方公告库均无匹配证据；需补充官方来源'},updated_at=now() WHERE article_id=${a.id} AND article_revision=${a.revision}`;
  return {traced:1,collected:links.filter(x=>x.status==='collected').length};
 }catch{
  await sql`UPDATE square_traces SET status='failed',note='追溯未完成，请检查运行记录',updated_at=now() WHERE article_id=${a.id} AND article_revision=${a.revision}`;
  return {traced:1,failed:true};
 }
}
