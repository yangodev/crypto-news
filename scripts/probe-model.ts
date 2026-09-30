// One budgeted compatibility probe. Does not print prompts, provider response bodies or credentials.
import {z} from 'zod';
import {chatJson} from '../packages/backend/src/providers/llm.ts';
import {completeReceipt} from '../packages/backend/src/providers/receipts.ts';
import {closeDb,sql} from '../packages/backend/src/db.ts';
try {
 const r=await chatJson({model:'default',purpose:'deployment.probe',subject:'gpt5-compatibility',promptVersion:'v1',system:'Return a JSON object with ok set to true.',user:'Connection test. Return {"ok":true}.',schema:z.object({ok:z.boolean()}),maxTokens:600,timeoutMs:45000});
 await completeReceipt(sql,r.receiptId);
 console.log(JSON.stringify({ok:r.data.ok,model:r.model,receiptId:r.receiptId}));
}catch(e){console.log(JSON.stringify({ok:false,error:String((e as Error).message).replace(/cr_[a-zA-Z0-9]+/g,'[redacted]').slice(0,350)}));process.exitCode=1;}finally{await closeDb();}
