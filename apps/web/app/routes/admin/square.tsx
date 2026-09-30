import {useEffect,useState} from 'react';
import {useRevalidator} from 'react-router';
import type {Route} from './+types/square';
import {adminGet} from '../../lib/admin.server';
import {useAdminAction} from '../../features/admin/action';
type TraceLink={url:string;title?:string;articleId?:string;reason:string;status:string};
type Draft={auto_review?:{passed:boolean;reason:string}|null;cover_status:string;cover_error:string|null;cover_error_code:string|null;cover_updated_at:string|null;id:number;article_id:string;title:string;body:string;status:string;review_reasons:string[];blockingReasons:string[];platform_url:string|null;image_receipt?:{id:number;status:string};primary_links?:TraceLink[];trace_note?:string;evidence:{sourceName:string;url:string;quote:string;stage:string;occurredAt:string|null;timeBasis?:string;announcementAt?:string|null;testOnly?:boolean};created_at:string};
type Sample={article_id:string;title:string;score:number|null;threshold:number|null;selected:boolean;source_name:string;body_status:string;reason:string;published_at:string|null;trace_links:TraceLink[];trace_note?:string;draft_id:number|null};
type Command={id:number;kind:string;subject:string;status:string;result?:{message?:string;draftId?:number}};
type Diagnostics={asOf:string;funnel:Record<string,number>;samples:Sample[];jobs:{job:string;status:string;started_at:string}[];commands:Command[];sources:{id:string;name:string;health:string;fail_count:number}[];acceptance:{automatic_published:number;first_auto_published_at:string|null}};
type Overview={autoEnabled:boolean;hourlyLimit:number;dailyLimit:number;autoStartedAt:string|null;imageEnabled:boolean;publishEnabled:boolean;paused:boolean;modelEnabled:boolean;rows:Draft[];diagnostics:Diagnostics};
type Preview={id:number;title:string;body:string;contentHash:string;coverHash:string;snapshot:string;stale:boolean;source:string;sourceUrl:string;quote:string;eventTime:string|null;timeBasis:string;stage:string};
export async function loader({request}:Route.LoaderArgs){return adminGet<Overview>(request,'/api/admin/square');}
const labels:Record<string,string>={review:'待核验',ready:'待发布',submitting:'提交中',published:'已发布',unknown:'结果待核实，禁止重试',failed:'失败',expired:'已过时',rejected:'不采用'};
const commandLabels:Record<string,string>={prepare:'准备图文',trace:'追溯一手来源',image:'重试配图',publish:'人工发布'};
const commandStates:Record<string,string>={queued:'排队中',running:'处理中',done:'处理完成',failed:'未完成'};
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未确认';
function TraceLinks({links,note}:{links?:TraceLink[];note?:string}){return <div className="space-y-1 text-sm">{note&&<p>{note}</p>}{links?.map(l=><p key={l.url}><a className="underline" href={l.url} target="_blank" rel="noreferrer">{l.title??l.url}</a> · {l.reason}{l.articleId&&<> · <a className="underline" href={`/admin/content/${l.articleId}`}>处理记录</a></>}</p>)}</div>;}
export default function Square({loaderData:d}:Route.ComponentProps){
 const {run,pending}=useAdminAction();const revalidator=useRevalidator();
 const [filter,setFilter]=useState('all'),[preview,setPreview]=useState<Preview|null>(null),[checked,setChecked]=useState(false),[acceptStale,setAcceptStale]=useState(false),[reason,setReason]=useState(''),[previewError,setPreviewError]=useState('');
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible'&&revalidator.state==='idle')void revalidator.revalidate();},20000);return()=>clearInterval(t);},[revalidator]);
 const command=async(kind:string,subject:string,payload?:unknown)=>run('POST','/api/admin/square/commands',{kind,subject,payload},{success:'已提交处理请求，进度将在下方更新',label:kind+':'+subject+':'+JSON.stringify(payload??{})});
 const openPreview=async(id:number)=>{
  setPreview(null);setPreviewError('');setChecked(false);setAcceptStale(false);setReason('');
  try{const r=await fetch(`/api/admin/square/${id}/preview`);const data=await r.json();if(!r.ok)throw Error(data.detail??'预览不可用');setPreview(data);}catch(e){setPreviewError(e instanceof Error?e.message:'预览加载失败');}
 };
 const rows=d.rows.filter(r=>filter==='all'||(filter==='active'?['review','ready','submitting','unknown','failed'].includes(r.status):r.status===filter));
 return <main className="mx-auto max-w-5xl space-y-6 p-6">
 <h1 className="text-2xl font-bold">广场候选稿</h1>
 <p>当前：{d.publishEnabled&&d.autoEnabled&&!d.paused?'限量自动发布已启用':'自动发布已关闭或暂停'} · 模型{d.modelEnabled?'已启用':'未启用'} · 配图{d.imageEnabled?'已启用':'未启用'}</p>
 <button className="rounded border px-4 py-2" disabled={!!pending} onClick={()=>run('POST','/api/admin/square/pause',{}, {success:'发布已暂停'})}>暂停后续发布</button>
 <p className="text-sm">官方一手消息，或可信媒体经独立官方原文佐证，通过完整正文与图文审核后自动发布。行情与其他消息限两小时，产品上线、监管公告、协议升级限六小时；每小时最多 {d.hourlyLimit} 条，滚动 24 小时最多 {d.dailyLimit} 条。首次回填与旧稿留待人工处理。</p>
 <section className="space-y-3 rounded border p-4">
  <h2 className="font-bold">最近 24 小时发现的内容</h2>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries({collected:'采集',fulltext:'完整正文',analyzed:'已分析',eligible:'可读内容',selected:'精选',drafted:'已成稿',published:'已发布'}).map(([key,label])=><div key={key}><div className="text-sm opacity-70">{label}</div><div className="text-xl font-semibold">{d.diagnostics.funnel[key]??0}</div></div>)}</div>
  <p className="text-sm opacity-70">按同一批文章统计，包含首次导入 {d.diagnostics.funnel.initial_import} 条；不代表日均产量。更新于 {time(d.diagnostics.asOf)}（北京时间）。</p>
  <p className="text-sm">{d.diagnostics.acceptance.automatic_published>0?`已确认 ${d.diagnostics.acceptance.automatic_published} 条自动发布，首条：${time(d.diagnostics.acceptance.first_auto_published_at)}`:'尚无新消息完成首条真实自动发布；任务运行正常不等于已经发布。'}</p>
  <details><summary>采集与处理健康</summary><div className="mt-2 space-y-1 text-sm">{d.diagnostics.jobs.map(j=><p key={j.job}>{({drafts:'生成稿件',images:'生成配图',review:'图文审核',deliver:'自动发送',commands:'人工操作',trace:'追溯来源'} as Record<string,string>)[j.job.replace('square.','')]??j.job}：{j.status==='ok'?'正常':j.status} · {time(j.started_at)}</p>)}{d.diagnostics.sources.map(s=><p key={s.id}><a className="underline" href={`/admin/sources/${s.id}`}>{s.name}</a>：连续失败 {s.fail_count} 次</p>)}</div></details>
 </section>
 {d.diagnostics.commands.length>0&&<details className="rounded border p-4" open={d.diagnostics.commands.some(c=>['queued','running'].includes(c.status))}><summary>最近的人工操作</summary><div className="mt-3 space-y-2 text-sm">{d.diagnostics.commands.map(c=><p key={c.id}>#{c.id} {commandLabels[c.kind]} · {commandStates[c.status]}{c.result?.message&&` · ${c.result.message}`}{c.result?.draftId&&<> · <a className="underline" href={`#draft-${c.result.draftId}`}>查看稿件</a></>}</p>)}</div></details>}
 <details className="space-y-3 rounded border p-4"><summary className="font-bold">筛选复核与一手来源追溯</summary><p className="text-sm">近期得分较高的内容。分数低于门槛不等于不值得研究；准备人工稿不会修改精选结果。追溯仅跟随原文中已核验域名的链接；媒体稿还需独立审核官方原文是否支持关键事实。</p>
 {d.diagnostics.samples.map(s=><article key={s.article_id} className="space-y-2 border-t pt-3"><a className="font-medium underline" href={`/admin/content/${s.article_id}`}>{s.title}</a><p className="text-sm">{s.source_name} · {s.selected?'已入选':`未入选：${s.score??'未评分'} / 门槛 ${s.threshold??'未配置'}`} · 正文{s.body_status==='ok'?'完整':'待补'} · {time(s.published_at)}</p>{s.reason&&<p className="text-sm">{s.reason}</p>}<TraceLinks links={s.trace_links} note={s.trace_note}/><div className="flex flex-wrap gap-3 text-sm"><button className="rounded border px-3 py-1" disabled={!!pending} onClick={()=>command('trace',s.article_id)}>查找一手来源</button>{s.draft_id?<a className="underline" href={`#draft-${s.draft_id}`}>查看已有稿件</a>:<button className="rounded border px-3 py-1" disabled={!!pending||!d.modelEnabled} onClick={()=>command('prepare',s.article_id)}>准备人工图文稿</button>}</div></article>)}
 </details>
 <label className="flex items-center gap-3">稿件范围<select className="rounded border p-2" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部记录</option><option value="active">需要处理</option><option value="published">已发布</option><option value="expired">已过时</option></select></label>
 {previewError&&<p role="alert" className="rounded border p-3">{previewError}</p>}
 {preview&&<section className="space-y-4 rounded border-2 p-5" aria-label="人工发布预览">
 <h2 className="text-lg font-bold">核对后发布这一篇</h2><p className="whitespace-pre-wrap">{preview.body}</p><img className="max-w-xs rounded" src={`/api/admin/square/${preview.id}/cover?v=${preview.coverHash}`} alt="本次确认的发布配图"/>
 <p className="text-sm"><a className="underline" href={preview.sourceUrl} target="_blank" rel="noreferrer">原始来源：{preview.source}</a> · {preview.timeBasis==='announcement'?'公告发布时间':'事件时间'}：{time(preview.eventTime)} · 阶段：{preview.stage}</p><blockquote className="border-l-2 pl-3 text-sm">{preview.quote}</blockquote>
 <label className="block"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> 我已核对原文、正文和配图，确认信息及归属准确</label>
 {preview.stale&&<label className="block"><input type="checkbox" checked={acceptStale} onChange={e=>setAcceptStale(e.target.checked)}/> 我确认作为非实时内容发布，正文未将旧事件写成刚刚发生</label>}
 <label className="block">核验记录<textarea className="mt-1 block w-full rounded border p-2" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="说明核对了哪些关键事实，至少 5 个字"/></label>
 <div className="flex gap-3"><button className="rounded border px-4 py-2" disabled={!!pending||!checked||reason.trim().length<5||(preview.stale&&!acceptStale)||d.paused||!d.publishEnabled} onClick={async()=>{const result=await command('publish',String(preview.id),{snapshot:preview.snapshot,contentHash:preview.contentHash,coverHash:preview.coverHash,confirmed:true,acceptStale,reason});if(result)setPreview(null);}}>确认并发布</button><button className="rounded border px-4 py-2" onClick={()=>setPreview(null)}>取消</button></div>
 </section>}
 {!rows.length&&<p>这个范围暂时没有稿件。可展开筛选复核查看内容停在哪一步。</p>}
 {rows.map(r=><article key={r.id} id={`draft-${r.id}`} className="scroll-mt-4 space-y-3 rounded border p-5">
 <div className="flex justify-between gap-4"><h2 className="font-bold">{r.title}</h2><span className="shrink-0">{labels[r.status]??r.status}</span></div>
 <p className="whitespace-pre-wrap">{r.body}</p><img className="max-w-xs rounded" src={`/api/admin/square/${r.id}/cover?v=${encodeURIComponent(r.cover_updated_at??r.cover_status)}`} alt="快讯配图预览" loading="lazy"/>
 <p className="text-sm">配图：{({pending:'等待生成',generating:'生成中',generated:'已生成',fallback:'仅有预览模板'} as Record<string,string>)[r.cover_status]}{r.cover_error&&` · ${r.cover_error}`}{r.image_receipt&&<> · <a className="underline" href="/admin/runs">调用 #{r.image_receipt.id}（{r.image_receipt.status}）</a></>}</p>
 {r.blockingReasons.length>0&&<div className="rounded bg-black/5 p-3 text-sm"><p className="font-medium">未自动发布的原因</p><ul className="mt-2 list-disc space-y-1 pl-5">{r.blockingReasons.map((b,i)=><li key={i}>{b}</li>)}</ul></div>}
 <TraceLinks links={r.primary_links} note={r.trace_note}/>
 <details><summary>原始核验事项与证据</summary><p className="mt-2 text-sm">{r.review_reasons.join('；')}</p><blockquote className="my-3 whitespace-pre-wrap">{r.evidence.quote}</blockquote><p>阶段：{r.evidence.stage} · 时间依据：{r.evidence.timeBasis==='announcement'?'公告发布':'事件发生'} · {time(r.evidence.timeBasis==='announcement'?r.evidence.announcementAt??null:r.evidence.occurredAt)}</p></details>
 <div className="flex flex-wrap gap-4 text-sm"><a className="underline" href={r.evidence.url} target="_blank" rel="noreferrer">原始来源</a><a className="underline" href={`/admin/content/${r.article_id}`}>完整处理记录</a>{r.platform_url&&<a className="underline" href={r.platform_url}>已发布链接</a>}
 {['review','expired'].includes(r.status)&&!r.evidence.testOnly&&<><button className="rounded border px-3 py-1" disabled={!!pending} onClick={()=>command('trace',r.article_id)}>查找一手来源</button>{r.cover_status==='fallback'&&<button className="rounded border px-3 py-1" disabled={!!pending||!d.imageEnabled} onClick={()=>command('image',String(r.id))}>重试配图</button>}{r.cover_status==='generated'&&<button className="rounded border px-3 py-1" disabled={!!pending} onClick={()=>openPreview(r.id)}>人工核验与发布</button>}</>}
 </div>
 </article>)}
 </main>;
}
