import { createHash } from 'node:crypto';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function sourceUrl(raw: string): string {
 const u = new URL(raw);
 if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('invalid source URL');
 u.hash=''; for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
 return u.toString();
}
export function eventKey(factId: number | null, url: string): string {
 return factId ? `fact:${factId}` : `url:${digest(sourceUrl(url))}`;
}
export function freshness(time: Date | string | null, now = Date.now()): boolean {
 if (!time) return false;
 const age=now-new Date(time).getTime();
 return Number.isFinite(age) && age>=0 && age<=2*60*60*1000;
}
export function reviewReasons(input: { title: string; summary: string; quote: string; material: string; firstParty: boolean; occurredAt: string | null; publishedAt: Date | null; backfill: boolean; conflict: boolean; stage: string }, now=Date.now()): string[] {
 const reasons=['待作者核验事实与表达'];
 if (input.backfill || !freshness(input.publishedAt,now)) reasons.push('旧消息或发布时间不明');
 if (!freshness(input.occurredAt,now)) reasons.push('事件发生时间不明或不在两小时内');
 if (!input.firstParty) reasons.push('媒体或社区来源，需追溯一手公告');
 if (!input.quote.trim() || !input.material.includes(input.quote)) reasons.push('证据引文无法在原始材料中定位');
 if (input.conflict) reasons.push('材料存在冲突');
 if (!['announced','effective','executed','confirmed_incident'].includes(input.stage)) reasons.push('事件阶段需要人工确认');
 if (/(我(买|卖|持有|加仓|减仓|开多|开空)|稳赚|必涨|必跌|保证收益)/.test(input.title+input.summary)) reasons.push('包含未经授权的持仓或收益表述');
 if (/\*\*|\]\(/.test(input.summary)) reasons.push('正文含不兼容的 Markdown 格式');
 return reasons;
}
export function confirmedPublication(value: unknown): {id:string;url:string} | null {
 const v=value as {id?:unknown;shareLink?:unknown}|null;
 if (!v || !['string','number'].includes(typeof v.id) || !/^\d+$/.test(String(v.id))) return null;
 if (typeof v.shareLink!=='string') return null;
 try {const u=new URL(v.shareLink); if(u.protocol!=='https:' || !(u.hostname==='binance.com'||u.hostname.endsWith('.binance.com'))) return null;}catch{return null;}
 return {id:String(v.id),url:v.shareLink};
}
