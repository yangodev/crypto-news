import { useEffect } from 'react';
import { useRevalidator } from 'react-router';
import type { Route } from './+types/square';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
type Draft={auto_review?:{passed:boolean;reason:string}|null;cover_status:string;cover_error:string|null;cover_updated_at:string|null;id:number;article_id:string;title:string;body:string;status:string;review_reasons:string[];platform_url:string|null;evidence:{sourceName:string;url:string;quote:string;stage:string;occurredAt:string|null};created_at:string};
type Overview={autoEnabled:boolean;hourlyLimit:number;dailyLimit:number;autoStartedAt:string|null;imageEnabled:boolean;publishEnabled:boolean;paused:boolean;modelEnabled:boolean;rows:Draft[]};
export async function loader({request}:Route.LoaderArgs){return adminGet<Overview>(request,'/api/admin/square');}
export default function Square({loaderData:d}:Route.ComponentProps){
 const {run,pending}=useAdminAction();const revalidator=useRevalidator();
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible'&&revalidator.state==='idle')void revalidator.revalidate();},20000);return()=>clearInterval(t);},[revalidator]);
 const labels:Record<string,string>={review:'待核验',ready:'待发布',submitting:'提交中',published:'已发布',unknown:'结果待核实，禁止重试',failed:'失败',expired:'已过时',rejected:'不采用'};
 return <main className="mx-auto max-w-5xl space-y-6 p-6">
 <h1 className="text-2xl font-bold">广场候选稿</h1>
 <p>当前：{d.publishEnabled&&d.autoEnabled&&!d.paused?'限量自动发布已启用':'仅生成候选稿，发布关闭'} · 模型{d.modelEnabled?'已启用':'未启用'} · AI 配图{d.imageEnabled?'已启用':'未启用，使用模板'}</p>
 <button className="rounded border px-4 py-2" disabled={!!pending} onClick={()=>run('POST','/api/admin/square/pause',{}, {success:'发布已暂停'})}>暂停后续发布</button>
 <p className="text-sm">一手信源、完整正文与新鲜事件通过独立图文审核后自动发布；每小时最多 {d.hourlyLimit} 条、滚动 24 小时最多 {d.dailyLimit} 条。旧稿不补发，未通过的稿件留待人工处理。未知发布结果会自动暂停后续发送。</p>
 {!d.rows.length&&<p>暂无符合条件的候选稿。可在“内容诊断”和“信源”中查看采集情况；超过两小时的旧消息不会进入候选队列；首次抓到的新鲜消息会标注后进入审阅。</p>}
 {d.rows.map(r=><article key={r.id} className="space-y-3 rounded border p-5">
 <div className="flex justify-between gap-4"><h2 className="font-bold">{r.title}</h2><span>{labels[r.status]??r.status}</span></div>
 <p className="whitespace-pre-wrap">{r.body}</p>
 <img className="max-w-xs rounded" src={`/api/admin/square/${r.id}/cover?v=${encodeURIComponent(r.cover_updated_at??r.cover_status)}`} alt="快讯配图预览" loading="lazy" />
 <p className="text-sm">配图：{({pending:'等待生成，暂用模板',generating:'生成中，暂用模板',generated:'AI 示意图，请检查图文一致性',fallback:'使用模板图'} as Record<string,string>)[r.cover_status]}{r.cover_error?' · '+r.cover_error:''}</p>
 {r.auto_review&&<p className="text-sm">自动审核：{r.auto_review.passed?'通过':'未放行'} · {r.auto_review.reason}</p>}
 <p className="text-sm">核验事项：{r.review_reasons.join('；')}</p>
 <details><summary>证据与事件阶段</summary><blockquote className="my-3 whitespace-pre-wrap">{r.evidence.quote}</blockquote><p>阶段：{r.evidence.stage} · 事件时间：{r.evidence.occurredAt??'未确认'}</p></details>
 <div className="flex gap-4"><a className="underline" href={r.evidence.url} target="_blank" rel="noreferrer">查看原始来源</a><a className="underline" href={`/admin/content/${r.article_id}`}>查看完整处理记录</a>{r.platform_url&&<a href={r.platform_url} target="_blank" rel="noreferrer">已发布链接</a>}</div>
 </article>)}
 </main>;
}
