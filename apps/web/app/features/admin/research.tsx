import {useState} from 'react';
import {useAdminAction} from './action';
export type ResearchRow={id:number;title:string;pillar:string;brief:string;needs:string;status:string;body:string|null;note:string|null;version:number;sources:{id:string;title:string;url:string;published_at:string}[]};
const states:Record<string,string>={queued:'待准备',drafting:'写稿中',needs_sources:'待补资料',review:'待作者审稿',approved:'已审稿，未发布',skipped:'暂不采用',failed:'写稿未完成'};
const pillars:Record<string,string>={method:'方法内容',core:'核心资产', 'next-alpha':'NEXT ALPHA'};
function ResearchItem({r}:{r:ResearchRow}){
 const {run,pending}=useAdminAction();const [editing,setEditing]=useState(false),[body,setBody]=useState(r.body??'');
 return <article className="space-y-2 border-t pt-3"><div className="flex justify-between gap-4"><h3 className="font-medium">{r.title}</h3><span className="shrink-0 text-sm">{states[r.status]}</span></div><p className="text-sm">{pillars[r.pillar]} · {r.brief}</p>
 <p className="text-sm opacity-75">所需资料：{r.needs}</p>{r.note&&<p className="text-sm">{r.note}</p>}
 {editing?<textarea aria-label="研究稿正文" className="min-h-64 w-full rounded border p-3" value={body} onChange={e=>setBody(e.target.value)} maxLength={20000}/>:r.body&&<p className="whitespace-pre-wrap rounded bg-black/5 p-3">{r.body}</p>}
 {r.sources.length>0&&<details><summary>写稿参考资料（须核验适用时间与结论）</summary>{r.sources.map(s=><p key={s.id} className="text-sm"><a className="underline" target="_blank" rel="noreferrer" href={s.url}>{s.title}</a> · {new Date(s.published_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>)}</details>}
 {r.status!=='drafting'&&<div className="flex flex-wrap gap-3 text-sm">{!editing?<button className="rounded border px-3 py-1" onClick={()=>{setBody(r.body??'');setEditing(true);}}>编辑正文</button>:<><button className="rounded border px-3 py-1" disabled={!!pending||body.trim().length<20} onClick={async()=>{if(await run('PATCH',`/api/admin/square/research/${r.id}`,{version:r.version,body,status:'review'},{success:'已保存，仍待审稿'}))setEditing(false);}}>保存草稿</button><button onClick={()=>setEditing(false)}>取消</button></>}
 {!editing&&r.body&&r.status!=='approved'&&<button className="rounded border px-3 py-1" disabled={!!pending} onClick={()=>run('PATCH',`/api/admin/square/research/${r.id}`,{version:r.version,body:r.body,status:'approved'},{success:'已标记审稿完成；尚未发布'})}>确认审稿完成</button>}
 {r.status!=='skipped'&&<button disabled={!!pending} onClick={()=>run('PATCH',`/api/admin/square/research/${r.id}`,{version:r.version,body:r.body??'',status:'skipped'},{success:'已移出待准备队列'})}>暂不采用</button>}</div>}
 </article>;
}
export function ResearchQueue({rows,enabled}:{rows:ResearchRow[];enabled:boolean}){
 const {run,pending}=useAdminAction();
 const [title,setTitle]=useState(''),[pillar,setPillar]=useState('method'),[brief,setBrief]=useState(''),[needs,setNeeds]=useState(''),[terms,setTerms]=useState('');
 return <section className="space-y-4 rounded border p-4"><h2 className="font-bold">固定研究内容 · 作者审稿</h2><p className="text-sm">{enabled?'每天北京时间 9 点尝试准备一篇':'自动准备未启用'}。资料不足会列出缺口。这里的稿件独立于新闻快讯，确认审稿也不会自动发布；发布前仍需核对事实、完善配图。</p>
 <details><summary>添加研究选题</summary><form className="mt-3 grid gap-3" onSubmit={async e=>{e.preventDefault();if(await run('POST','/api/admin/square/research',{title,pillar,brief,needs,terms:terms.split(',').map(s=>s.trim()).filter(Boolean)},{success:'选题已加入队列',label:'research-add:'+title+brief+needs+terms})){setTitle('');setBrief('');setNeeds('');setTerms('');}}}>
 <label>工作题目<input className="block w-full rounded border p-2" required minLength={2} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>栏目<select className="ml-3 rounded border p-2" value={pillar} onChange={e=>setPillar(e.target.value)}>{Object.entries(pillars).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>要回答的问题<textarea className="block w-full rounded border p-2" required minLength={10} maxLength={2000} value={brief} onChange={e=>setBrief(e.target.value)}/></label>
 <label>需要哪些资料<textarea className="block w-full rounded border p-2" required minLength={5} maxLength={1000} value={needs} onChange={e=>setNeeds(e.target.value)}/></label>
 <label>查找官方资料的英文关键词，用逗号分隔<input className="block w-full rounded border p-2" value={terms} onChange={e=>setTerms(e.target.value)} placeholder="例如 bitcoin, ethereum"/></label><button className="justify-self-start rounded border px-4 py-2" disabled={!!pending}>加入队列</button></form></details>
 {rows.map(r=><ResearchItem key={r.id+':'+r.version} r={r}/>)}{!rows.length&&<p>暂无研究选题。</p>}</section>;
}
