// Content manifest of persistent data, excluding only regenerable web caches.
import {readdir,readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.argv[2]||'/data';
const files={};
async function walk(relative=''){
 for(const name of (await readdir(path.join(root,relative))).sort()){
  const key=path.posix.join(relative,name);
  if(['imgcache','ogcache'].includes(key))continue;
  const st=await lstat(path.join(root,key));
  if(st.isSymbolicLink())throw Error('Unexpected symlink in persistent data');
  if(st.isDirectory())await walk(key);
  else if(st.isFile())files[key]=createHash('sha256').update(await readFile(path.join(root,key))).digest('hex');
 }
}
await walk();
process.stdout.write(JSON.stringify(files)+'\n');
