// Normalize only fully completed SSE replies. Never treat a disconnected partial as a final answer.
export function parseCompletionStream(text: string): Record<string,unknown> {
 let content='';let id:unknown;let usage:unknown;let finish:string|null=null;
 for(const frame of text.split(/\r?\n\r?\n/)){
  const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!data || data==='[DONE]')continue;
  let event:any;try{event=JSON.parse(data)}catch{throw new Error('Malformed completion stream');}
  if(event.error || ['response.failed','response.incomplete','error'].includes(event.type))throw new Error('Completion stream failed or incomplete');
  if(event.type==='response.completed'){
   const r=event.response;
   if(r?.status!=='completed')throw new Error('Completion stream not completed');
   const output=(r.output??[]).flatMap((o:any)=>o.type==='message'?(o.content??[]):[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
   return {id:r.id,usage:r.usage,choices:[{message:{content:output},finish_reason:'stop'}]};
  }
  if(event.id)id=event.id;if(event.usage)usage=event.usage;
  const choice=event.choices?.find((c:any)=>c.index===0 || c.index===undefined);
  if(typeof choice?.delta?.content==='string')content+=choice.delta.content;
  if(choice?.finish_reason)finish=choice.finish_reason;
 }
 if(finish!=='stop')throw new Error('Completion stream ended without a complete answer');
 return {id,usage,choices:[{message:{content},finish_reason:finish}]};
}
