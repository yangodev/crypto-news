// Explicit additive rollout step; never overwrite an operator's existing trust mapping.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {REPO_ROOT} from '../../packages/backend/src/config.ts';
import {sql,closeDb} from '../../packages/backend/src/db.ts';
const {sources}=JSON.parse(readFileSync(join(REPO_ROOT,'industry/sources.json'),'utf8'));
try{
 let updated=0;
 for(const source of sources){
  const prefixes=source.config.evidenceUrlPrefixes;
  if(!prefixes?.length)continue;
  const rows=await sql`UPDATE sources SET config=config||${sql.json({evidenceUrlPrefixes:prefixes})}
   WHERE id=${source.id} AND first_party AND tier='T1' AND NOT config ? 'evidenceUrlPrefixes' RETURNING id`;
  updated+=rows.length;
 }
 console.log(`Primary-source mappings added: ${updated}`);
}finally{await closeDb();}
