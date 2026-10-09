import {stub,tag} from './setup.ts';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '../packages/backend/src/db.ts';
import {seedResearchTopics,prepareDailyResearch,editResearch,addResearch,researchOverview} from '../packages/backend/src/square/research.ts';
const provider=await stub(()=>({choices:[{message:{content:JSON.stringify({sufficient:true,body:'方法解释：长期判断与短期交易使用不同时间尺度。以下是假设情景，不代表实际持仓。'.repeat(5),gaps:[]})}}]}));
Object.assign(process.env,{LLM_BASE_URL:provider.url,LLM_API_KEY:'mock',LLM_MODEL:'research-test',SQUARE_RESEARCH_ENABLED:'true'});
after(async()=>{await sql`DELETE FROM square_research_days`;await sql`DELETE FROM square_research`;await provider.close();await closeDb();});
test('daily research is bounded, seed is idempotent, edits are versioned and approval cannot publish',async()=>{
 await seedResearchTopics();await seedResearchTopics();assert.equal((await researchOverview()).length,7);
 const [before]=await sql`SELECT count(*)::int AS n FROM square_drafts`;
 await Promise.all([prepareDailyResearch(),prepareDailyResearch()]);assert.equal(provider.hits(),1);
 const rows=await researchOverview(),d=rows.find(r=>r.status==='review');assert.ok(d);
 assert.equal((await sql`SELECT count(*)::int AS n FROM square_research_days`)[0].n,1);
 await prepareDailyResearch();assert.equal(provider.hits(),1);
 await editResearch(Number(d.id),{version:d.version,body:d.body,status:'approved'},'test');
 await assert.rejects(editResearch(Number(d.id),{version:d.version,body:d.body,status:'review'},'test'),/变化/);
 assert.equal((await sql`SELECT count(*)::int AS n FROM square_drafts`)[0].n,before.n);
 await sql`DELETE FROM square_research_days`;
 const hits=provider.hits();assert.deepEqual(await prepareDailyResearch(),{prepared:0,needsSources:1});assert.equal(provider.hits(),hits);
});
test('topic creation is idempotent and cannot reuse a request key for different content',async()=>{
 const key='request-'+tag(),t={title:'方法研究测试',pillar:'method',brief:'这是新的分析方法研究问题，需要明确假设和观察条件。',needs:'方法说明与实际记录。',terms:[]};
 const [a,b]=await Promise.all([addResearch(t,'test',key),addResearch(t,'test',key)]);assert.equal(a.id,b.id);
 await assert.rejects(addResearch({...t,title:'不同选题'},'test',key),/请求编号已使用/);
 await assert.rejects(addResearch({...t,terms:['%']},'test','another-'+tag()));
});
test('research kill switch issues no model call',async()=>{
 process.env.SQUARE_RESEARCH_ENABLED='false';const n=provider.hits();assert.deepEqual(await prepareDailyResearch(),{disabled:true});assert.equal(provider.hits(),n);
});
