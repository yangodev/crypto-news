// Worker-only automatic publication; tests inject a local transport and never call Binance.
import {pathToFileURL} from 'node:url';
import {closeDb} from '../../packages/backend/src/db.ts';
import {publish,uploadImage} from './upstream-lib.mjs';
import {approvedAutomaticDraft} from '../../packages/backend/src/square/auto.ts';
import {confirmedPublication} from '../../packages/backend/src/square/policy.ts';
export async function sendAutomaticDraft(id,key,transport={publish,uploadImage}){
 let submitted=false;
 try{
  if(!key)throw Error('Missing publication credential');
  const {d,cover}=await approvedAutomaticDraft(id);
  if(d.status!=='submitting'||!d.verified_at||!d.verified_by)throw Error('Not claimed');
  const image=await transport.uploadImage(key,cover.file,cover.bytes);
  const current=await approvedAutomaticDraft(id);
  if(current.d.status!=='submitting'||current.d.auto_review.snapshot!==d.auto_review.snapshot)throw Error('Approval changed');
  submitted=true;
  const result=await transport.publish(key,{contentType:1,bodyTextOnly:d.body,imageList:[image]});
  if(!confirmedPublication(result))throw Error('Unknown publication outcome');
  return result;
 }catch(error){if(!submitted)return {notSubmitted:true};throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(url,opts={})=>originalFetch(url,{...opts,signal:AbortSignal.any([...(opts.signal?[opts.signal]:[]),AbortSignal.timeout(45000)])});
 console.log=()=>{};console.error=()=>{};
 try{process.stdout.write(JSON.stringify(await sendAutomaticDraft(Number(process.env.SQUARE_DRAFT_ID),process.env.BINANCE_SQUARE_OPENAPI_KEY)));}
 catch{process.exitCode=1;}finally{await closeDb();}
}
