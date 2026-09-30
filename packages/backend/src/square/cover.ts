import { createHash } from 'node:crypto';
import { sql } from '../db.ts';
import { digest } from './policy.ts';
import sharp from 'sharp';
import { mkdir, readFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function wrapCoverTitle(title:string):string[]{
 const tokens=Array.from(new Intl.Segmenter('zh',{granularity:'word'}).segment(title),s=>s.segment).flatMap(t=>t.length>24?Array.from(t):[t]);
 const width=(text:string)=>Array.from(text.trim()).reduce((n,c)=>n+(/[\x00-\x7f]/.test(c)?0.65:1),0);
 const costs=Array(tokens.length+1).fill(Infinity);const next=Array(tokens.length).fill(0);costs[tokens.length]=0;
 // Balance all lines, including the last, so a lone final character is not stranded.
 for(let i=tokens.length-1;i>=0;i--){
  let line='';
  for(let j=i;j<tokens.length;j++){
   line+=tokens[j];const w=width(line);if(w>16)break;
   const cost=(16-w)**2+costs[j+1];
   if(w>0&&cost<costs[i]){costs[i]=cost;next[i]=j+1;}
  }
 }
 const lines:string[]=[];
 for(let i=0;i<tokens.length;){const end=next[i]||i+1;const line=tokens.slice(i,end).join('').trim();if(line)lines.push(line);i=end;}
 return lines;
}

export async function renderCover(id:string,title:string,_source:string,_time:string,illustration?:Buffer):Promise<string>{
 if(!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid cover id');
 const dir=path.join(config.dataDir,'square-covers');await mkdir(dir,{recursive:true});
 const lines=wrapCoverTitle(title);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#f6f2e9"/><rect x="80" y="100" width="65" height="8" fill="#226557"/><g font-family="Noto Sans CJK SC,sans-serif" fill="#182822"><text x="80" y="175" font-size="35">岩歌 · 快讯</text>${lines.map((s,i)=>`<text x="80" y="${310+i*85}" font-size="52" font-weight="700">${escape(s)}</text>`).join('')}</g></svg>`;
 let output=Buffer.from(svg);
 if(illustration){
  const art=await sharp(illustration,{limitInputPixels:25_000_000}).resize(920,400,{fit:'contain',background:'#f6f2e9'}).png().toBuffer();
  // Keep the public card focused on the headline and illustration.
  const composed=svg.replace(/y="(310|395|480|565|650)" font-size="52"/g,(_,y)=>`y="${680+(Number(y)-310)/85*68}" font-size="52"`);
  output=await sharp(Buffer.from(composed)).composite([{input:art,left:80,top:200}]).png().toBuffer();
 }
 const file=path.join(dir,`${id}.png`);const temp=file+`.${crypto.randomUUID()}.tmp`;
 await sharp(output).png().toFile(temp);await rename(temp,file);return file;
}

export function coverKey(id:number,title:string,evidence:any):string{return `${id}-${digest(JSON.stringify([title,evidence.sourceName,evidence.publishedAt])).slice(0,16)}`;}

export async function draftCoverPath(id:number):Promise<string|null>{
 if(!Number.isSafeInteger(id)||id<1)return null;
 const [d]=await sql`SELECT title,evidence,cover_status,cover_key FROM square_drafts WHERE id=${id}`;
 if(!d)return null;
 const key=coverKey(id,d.title,d.evidence);
 if(d.cover_status==='generated'&&d.cover_key===key){try{const file=path.join(config.dataDir,'square-covers',`${key}-ai.png`);await access(file);return file}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 const file=path.join(config.dataDir,'square-covers',`${key}.png`);
 try{await access(file);return file}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 return renderCover(key,d.title,d.evidence.sourceName,d.evidence.publishedAt);
}

export async function draftCover(id:number):Promise<Buffer|null>{const file=await draftCoverPath(id);return file?readFile(file):null;}

/** Publication never uses the preview fallback. Approval binds the exact bytes uploaded. */
export async function generatedCover(id:number, expectedHash?:string){
 const [d]=await sql`SELECT title,evidence,cover_status,cover_key FROM square_drafts WHERE id=${id}`;
 if(!d||d.cover_status!=='generated'||d.cover_key!==coverKey(id,d.title,d.evidence))throw Error('Service-generated cover required');
 const file=path.join(config.dataDir,'square-covers',`${d.cover_key}-ai.png`);
 const bytes=await readFile(file).catch(()=>{throw Error('Approved cover missing');});
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(expectedHash!==undefined&&hash!==expectedHash)throw Error('Approved cover changed');
 return {file,bytes,hash};
}
