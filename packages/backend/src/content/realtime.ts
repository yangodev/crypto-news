import { sql, type Db } from '../db.ts';

// Trial mode: keep historical source material, spend automatic processing on fresh news only.
// Enqueue and execution both check this; previously queued jobs can expire while waiting.
export async function archiveOutsideRealtime(articleId:string,db:Db=sql):Promise<boolean>{
 if(process.env.REALTIME_NEWS_ONLY!=='true')return false;
 const [a]=await db`SELECT published_at FROM articles WHERE id=${articleId}`;
 if(!a)return false;
 const age=a.published_at?Date.now()-new Date(a.published_at).getTime():NaN;
 if(Number.isFinite(age)&&age>=0&&age<=6*3600000)return false;
 await db`UPDATE articles SET processing_state='skipped',processing_error='仅归档：超出六小时分析窗口或来源时间未确认',processing_queued_at=NULL,processing_retry_at=NULL WHERE id=${articleId} AND processing_state='new'`;
 return true;
}
