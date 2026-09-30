import './setup.ts';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,readFile,writeFile,stat,utimes,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {config} from '@aihot/backend/config';
import {sql,closeDb} from '@aihot/backend/db';
import {submitFeedback,feedbackSourceHash,assertFeedbackCapacity} from '@aihot/backend/operations/feedback';
import {dailyRetention} from '@aihot/backend/operations/retention';
config.dataDir=await mkdtemp(path.join(tmpdir(),'feedback-security-'));
process.env.FEISHU_INTERNAL_ENABLED='false';
after(async()=>{await closeDb();await rm(config.dataDir,{recursive:true,force:true});});
const image=await sharp({create:{width:50,height:50,channels:3,background:'red'}}).png().toBuffer();
const input=(ip:string,data=image)=>({content:'安全测试反馈',ip,userAgent:'Chrome',screenshot:{mime:'image/png',data}});
test('reject fake images and pixel bombs; UA cannot evade IP quotas',async()=>{
 await assert.rejects(submitFeedback(input('192.0.2.71',Buffer.from('not an image'))),/无法读取/);
 const huge=await sharp({create:{width:5000,height:4000,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(submitFeedback(input('192.0.2.72',huge)),/无法读取/);
 assert.equal(feedbackSourceHash('192.0.2.73','Chrome'),feedbackSourceHash('192.0.2.73','Safari'));
 for(let i=0;i<5;i++)await submitFeedback({content:'反馈限流',ip:'192.0.2.73',userAgent:String(i)});
 await assert.rejects(submitFeedback({...input('192.0.2.73'),userAgent:'Firefox'}),/频繁/);
});
test('normalized images expire with forwarding disabled, including orphan files',async()=>{
 const {id}=await submitFeedback(input('192.0.2.74'));
 const [row]=await sql`SELECT screenshot_key FROM feedback WHERE id=${id}`;
 const file=path.join(config.dataDir,'feedback-screenshots',row!.screenshot_key.slice(6));
 assert.equal((await sharp(await readFile(file)).metadata()).format,'webp');
 assert.equal((await stat(file)).mode&0o777,0o600);
 const orphan=path.join(config.dataDir,'feedback-screenshots','orphan.png');await writeFile(orphan,'old');
 const past=new Date(Date.now()-32*86400000);await utimes(file,past,past);await utimes(orphan,past,past);
 await sql`UPDATE feedback SET created_at=${past} WHERE id=${id}`;
 await dailyRetention();
 await assert.rejects(stat(file),{code:'ENOENT'});await assert.rejects(stat(orphan),{code:'ENOENT'});
 assert.equal((await sql`SELECT screenshot_key FROM feedback WHERE id=${id}`)[0]!.screenshot_key,null);
});
test('disk reserve, global storage cap, IP byte budget and concurrent requests fail closed',async()=>{
 assert.throws(()=>assertFeedbackCapacity(0,1024**3,100),/存储/);
 assert.throws(()=>assertFeedbackCapacity(256*1024**2,10*1024**3,100),/存储/);
 const full=path.join(config.dataDir,'feedback-screenshots','capacity-test');const handle=await open(full,'w');await handle.truncate(256*1024**2);await handle.close();
 await assert.rejects(submitFeedback(input('192.0.2.75')),/存储/);await rm(full);
 const source=feedbackSourceHash('192.0.2.76','');
 await sql`INSERT INTO feedback(content,source_hash,screenshot_bytes) VALUES('byte budget',${source},${16*1024**2})`;
 await assert.rejects(submitFeedback(input('192.0.2.76')),/截图提交过多/);
 const results=await Promise.allSettled(Array.from({length:10},()=>submitFeedback(input('192.0.2.77'))));
 assert.ok(results.filter(r=>r.status==='fulfilled').length<=5);
 assert.ok(results.some(r=>r.status==='fulfilled'));
});

test('distributed feedback cannot exceed the daily global row budget',async()=>{
 const marker='global-budget-test';
 await sql`INSERT INTO feedback(content,source_hash,created_at) SELECT ${marker},'distributed',now()-interval '2 hours' FROM generate_series(1,1000)`;
 try { await assert.rejects(submitFeedback(input('192.0.2.78')),/频繁/); }
 finally { await sql`DELETE FROM feedback WHERE content=${marker}`; }
});
