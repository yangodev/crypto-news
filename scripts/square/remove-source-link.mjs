// Apply the public-body source policy to an unpublished draft; retain evidence.url.
import {sql,closeDb} from '../../packages/backend/src/db.ts';
import {digest} from '../../packages/backend/src/square/policy.ts';
const id=process.argv[2];
try{
 if(!/^\d+$/.test(id??''))throw Error('Draft id required');
 const [d]=await sql`SELECT * FROM square_drafts WHERE id=${id} AND status IN ('review','expired')`;
 if(!d)throw Error('Draft must be unpublished');
 const suffix='\n'+d.evidence.url;
 if(!d.body.endsWith(suffix))throw Error('Expected source suffix missing; inspect instead of guessing');
 const body=d.body.slice(0,-suffix.length);
 const [result]=await sql`UPDATE square_drafts SET body=${body},content_hash=${digest(body)},verified_at=NULL,verified_by=NULL,updated_at=now() WHERE id=${id} AND body=${d.body} AND status IN ('review','expired') RETURNING id,content_hash`;
 if(!result)throw Error('Draft changed');
 console.log(JSON.stringify(result));
}finally{await closeDb();}
