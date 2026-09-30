import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";
import { endSession, sessionPrincipal } from "@aihot/backend/admin/auth";
import Fastify from "fastify";

config.adminUsername = "research-admin";
config.adminPassword = "test-password-long-enough";
config.siteUrl = "https://news.example.test";
config.devAdmin = null;
const app = Fastify();
registerAdminAuth(app);
after(async () => { await app.close(); await closeDb(); });

test("login requires both credentials, protects session and rejects old password-only requests", async () => {
  for (const [username, password] of [["", config.adminPassword!], ["wrong", config.adminPassword!], [config.adminUsername, "wrong"], ["Research-admin", config.adminPassword!]]) {
    const res = await app.inject({ method: "POST", url: "/api/auth/password", payload: { username, password } });
    assert.equal(res.statusCode, 303);
    assert.match(String(res.headers.location), /error=wrong/);
    assert.equal(res.headers["set-cookie"], undefined);
  }
  const res = await app.inject({ method: "POST", url: "/api/auth/password", payload: { username: config.adminUsername, password: config.adminPassword, return: "/admin/square" } });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/square");
  const cookie = String(res.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(await sessionPrincipal(cookie));
  await endSession(cookie);
  assert.equal(await sessionPrincipal(cookie), null);
  for (let i = 0; i < 6; i++) {
    const rejected = await app.inject({ method: "POST", url: "/api/auth/password", payload: { username: "wrong", password: "wrong" } });
    if (i === 5) assert.match(String(rejected.headers.location), /error=too-many/);
  }
});

test("one abusive IP cannot lock out another, and distributed bursts have bounded admission", async () => {
 const login = (ip: string, good=false) => app.inject({method:"POST",url:"/api/auth/password",remoteAddress:ip,payload:{username:good?config.adminUsername:"wrong",password:good?config.adminPassword:"wrong"}});
 for(let i=0;i<60;i++) await login("198.51.100.10");
 const good=await login("198.51.100.11",true);
 assert.equal(good.headers.location,"/admin");await endSession(String(good.headers["set-cookie"]));
 const started=Date.now();
 const burst=await Promise.all(Array.from({length:50},(_,i)=>login(`198.51.101.${i+1}`)));
 assert.ok(burst.filter(r=>String(r.headers.location).includes("too-many")).length>=14);
 assert.ok(Date.now()-started>=4000,"global queue must pace credential checks");
 const afterBurst=await login("198.51.100.12",true);
 assert.equal(afterBurst.headers.location,"/admin");await endSession(String(afterBurst.headers["set-cookie"]));
});
