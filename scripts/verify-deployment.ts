// Read-only authenticated smoke test. Reads admin password from env without printing it.
const base=process.env.SITE_URL??'http://localhost:3080';
const login=await fetch(base+'/api/auth/password',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:process.env.ADMIN_PASSWORD??'',return:'/admin/square'}),redirect:'manual'});
const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
if(!cookie||login.headers.get('location')!=='/admin/square')throw new Error('Admin login failed');
for(const p of ['/admin/square','/admin/sources','/admin/runs','/api/admin/square','/api/admin/sources','/api/admin/runs']){
 const r=await fetch(base+p,{headers:{cookie},redirect:'manual'});if(!r.ok)throw new Error(`${p}: ${r.status}`);
 if(p==='/api/admin/square'){const d=await r.json();if(d.publishEnabled||!d.paused)throw new Error('Publish safety gate unexpectedly enabled');console.log(JSON.stringify({path:p,status:r.status,publishEnabled:d.publishEnabled,paused:d.paused,modelEnabled:d.modelEnabled,drafts:d.rows.length}));}
 else console.log(`${p} ${r.status}`);
}
const anonymous=await fetch(base+'/api/admin/square');if(anonymous.status!==401)throw new Error('Private endpoint exposed');console.log('Private draft endpoint rejects anonymous access');
