import {loadAutomaticDraft} from './auto.ts';
import {generatedCover} from './cover.ts';
import {digest} from './policy.ts';

export function manualBlock(d:any,acceptStale=false):string|null{
 if(!d||!['review','expired'].includes(d.status))return '稿件已处理，请刷新';
 if(!d.evidence||typeof d.evidence.material!=='string')return '证据缺失或格式错误';
 if(!d.source_enabled)return '来源已停用';
 if(d.evidence.testOnly||/历史测试|内部流程测试/.test(d.body+d.title))return '测试稿不能发布';
 if(d.article_revision!==d.current_revision||d.visibility==='withdrawn'||!d.eligible)return '来源版本或入选资格已变化';
 if(d.current_body_status!=='ok'||d.evidence.material!==String(d.body_text??'').slice(0,18000))return '原始正文不完整或已变化';
 if(d.evidence.conflict||!d.evidence.quote?.trim()||!d.evidence.material?.includes(d.evidence.quote))return '证据缺失或冲突，需先修订稿件';
 if(digest(d.body)!==d.content_hash||!d.body.startsWith(d.title+'\n'))return '正文版本不一致';
 if(/https?:\/\/|\*\*|\]\(|我(买|卖|持有|加仓|开多|开空)|稳赚|必涨|必跌|保证收益|建议.{0,8}(买入|卖出|做多|做空)/i.test(d.body))return '正文含链接、格式残留或未经确认的交易表述';
 if(new Date(d.expires_at)<=new Date()&&!acceptStale)return '原始消息已过两小时，需明确确认作为非实时内容发布';
 return null;
}
export function manualSnapshot(d:any,coverHash:string){
 const {manualApproval,...evidence}=d.evidence;
 return digest(JSON.stringify([d.id,d.title,d.body,d.content_hash,evidence,d.article_revision,d.current_revision,
 d.current_body_status,d.body_text,d.source_time,d.expires_at,d.visibility,d.eligible,d.current_fact_id,d.source_enabled,d.first_party,d.tier,d.cover_key,coverHash]));
}
export async function manualPreview(id:number){
 const d=await loadAutomaticDraft(id);
 if(!d)throw Object.assign(Error('稿件不存在'),{statusCode:404});
 const block=manualBlock(d,true);
 if(block)throw Object.assign(Error(block),{statusCode:409});
 const cover=await generatedCover(id).catch(()=>{throw Object.assign(Error('需先生成可发布的配图'),{statusCode:409});});
 return {id,title:d.title,body:d.body,contentHash:d.content_hash,coverHash:cover.hash,snapshot:manualSnapshot(d,cover.hash),
  stale:new Date(d.expires_at)<=new Date(),source:d.evidence.sourceName,sourceUrl:d.evidence.url,quote:d.evidence.quote,
  eventTime:d.evidence.occurredAt,stage:d.evidence.stage,expiresAt:d.expires_at};
}
