import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrapCoverTitle} from '../packages/backend/src/square/cover.ts';
test('mixed Chinese and English cover title preserves names and decimal amounts',()=>{
 const title='【历史测试】NEAR Intents 拦截约 50.3 万美元 Bitget 黑客相关换币资金';
 const lines=wrapCoverTitle(title);
 assert.ok(lines.some(x=>x.includes('Intents')));assert.ok(lines.some(x=>x.includes('Bitget')));assert.ok(lines.some(x=>x.includes('50.3')));
 assert.equal(lines.join('').replace(/\s/g,''),title.replace(/\s/g,''));
 assert.equal(wrapCoverTitle('中'.repeat(70)).join(''),'中'.repeat(70));
});
test('formal news title has balanced lines and no orphan final character',()=>{
 const title='NEAR Intents 拦截约 50.3 万美元 Bitget 黑客相关换币资金';
 const lines=wrapCoverTitle(title);
 assert.ok(lines.some(line=>line.includes('拦截')));assert.ok(lines.length<=4);assert.ok(lines.at(-1)!.length>=5);
 assert.equal(lines.join('').replace(/\s/g,''),title.replace(/\s/g,''));
 assert.ok(lines.some(line=>line.includes('Intents')));assert.ok(lines.some(line=>line.includes('50.3')));
});
