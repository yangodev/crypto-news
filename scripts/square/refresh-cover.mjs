// Re-render an existing illustration without changing or resending its publication.
import {sql,closeDb} from '../../packages/backend/src/db.ts';
import {coverKey,renderCover,draftCoverPath} from '../../packages/backend/src/square/cover.ts';
import {copyFile} from 'node:fs/promises';
const id=process.argv[2];
try{
 if(!/^\d+$/.test(id??''))throw Error('Draft id required');
 const [d]=await sql`SELECT * FROM square_drafts WHERE id=${id}`;
 if(!d||d.status==='submitting')throw Error('Draft unavailable or submitting');
 const [r]=await sql`SELECT id,response FROM receipts WHERE subject=${id} AND purpose='square.cover' AND status='completed' AND response ? 'image' ORDER BY id DESC LIMIT 1`;
 if(!r)throw Error('Service illustration receipt missing');
 const previous=await draftCoverPath(Number(id));if(!previous)throw Error('Cover missing');
 await copyFile(previous,previous.replace('.png','-before-layout12.png'));
 const key=coverKey(Number(id),d.title,d.evidence);
 await renderCover(key+'-ai',d.title,d.evidence.sourceName,d.evidence.publishedAt,Buffer.from(r.response.image,'base64'));
 await sql`UPDATE square_drafts SET cover_updated_at=now(),updated_at=now() WHERE id=${id} AND title=${d.title} AND status=${d.status}`;
 console.log(JSON.stringify({id:Number(id),status:d.status,platformId:d.platform_id,republished:false}));
}finally{await closeDb();}
