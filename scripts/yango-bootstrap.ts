import {sql,closeDb} from '../packages/backend/src/db.ts';
// Initial trial request caps. Operators' later changes are preserved via a one-time marker.
await sql.begin(async tx=>{
 const [found]=await tx`SELECT 1 FROM settings WHERE key='yango_trial_initialized'`;
 if(found)return;
 await tx`UPDATE budgets SET per_minute=10,per_hour=60,per_day=200,note='岩歌试运行请求次数上限；非金额预算' WHERE service='llm'`;
 await tx`INSERT INTO settings(key,value) VALUES('yango_trial_initialized','true'::jsonb)`;
});
await closeDb();
