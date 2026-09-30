// Explicit operator smoke test: one budgeted image request, no news record or publication.
import {requestIllustration} from '../packages/backend/src/providers/image.ts';
import {renderCover} from '../packages/backend/src/square/cover.ts';
import {completeReceipt} from '../packages/backend/src/providers/receipts.ts';
import {sql,closeDb} from '../packages/backend/src/db.ts';
try {
 const r=await requestIllustration('image-integration-probe-v1','区块链网络中的信息传递与连接');
 const file=await renderCover('image-integration-probe-v1','AI 配图接入验收：区块链网络','验收样例，非真实新闻',new Date().toISOString(),Buffer.from((r.response as {image:string}).image,'base64'));
 await completeReceipt(sql,r.receiptId);
 console.log(JSON.stringify({ok:true,receiptId:r.receiptId,reused:r.reused,file}));
}finally{await closeDb();}
