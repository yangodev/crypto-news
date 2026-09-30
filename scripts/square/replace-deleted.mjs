// Rebuild a deleted post's cover from the service receipt, preserving its publication history.
import {sql,closeDb} from '../../packages/backend/src/db.ts';
import {coverKey,renderCover,draftCoverPath} from '../../packages/backend/src/square/cover.ts';
import {copyFile} from 'node:fs/promises';
const [id,deletedId]=process.argv.slice(2);
try{
 if(!/^\d+$/.test(id??'')||!/^\d+$/.test(deletedId??'')||!process.env.SQUARE_OPERATOR)throw Error('Draft, deleted platform ID and operator required');
 const [d]=await sql`SELECT * FROM square_drafts WHERE id=${id}`;
 if(!d||d.status!=='published'||d.platform_id!==deletedId)throw Error('Publication no longer matches; do not repeat');
 const [receipt]=await sql`SELECT id,response FROM receipts WHERE purpose='square.cover' AND subject=${id} AND status='completed' AND response ? 'image' ORDER BY id DESC LIMIT 1`;
 if(!receipt)throw Error('Original service illustration receipt missing');
 const previous=await draftCoverPath(Number(id));if(!previous)throw Error('Previous cover missing');
 await copyFile(previous,previous.replace('.png','-published-'+deletedId+'.png'));
 const key=coverKey(Number(id),d.title,d.evidence);
 await renderCover(key+'-ai',d.title,d.evidence.sourceName,d.evidence.publishedAt,Buffer.from(receipt.response.image,'base64'));
 const history=[...(d.evidence.previousPublications??[]),{id:d.platform_id,url:d.platform_url,publishedAt:d.published_at,approval:d.evidence.manualApproval,deletionReportedBy:process.env.SQUARE_OPERATOR,deletionReportedAt:new Date().toISOString(),reason:'用户已删帖，移除配图的AI示意图标签后重新发布'}];
 const evidence={...d.evidence,previousPublications:history,coverReceiptId:receipt.id};delete evidence.manualApproval;
 const [updated]=await sql`UPDATE square_drafts SET status='review',platform_id=NULL,platform_url=NULL,published_at=NULL,attempted_at=NULL,verified_at=NULL,verified_by=NULL,evidence=${sql.json(evidence)},cover_updated_at=now(),updated_at=now()
 WHERE id=${id} AND status='published' AND platform_id=${deletedId} RETURNING id,title,content_hash`;
 if(!updated)throw Error('Publication changed during rebuild');
 console.log(JSON.stringify(updated));
}finally{await closeDb();}
