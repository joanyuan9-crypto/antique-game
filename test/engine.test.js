'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine');
function random(seed) {return () => {seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;};}
for (const level of [1,2]) for (const difficulty of Object.keys(E.difficulties)) {
  test(`关卡 ${level} / ${difficulty}：250 个种子的规则、唯一解和提示一致`,()=>{
    const all = E.permutations(Object.keys(level===1?E.plants:E.relics));
    for(let seed=1;seed<=250;seed++){
      const p=E.generate(level,difficulty,random(seed));
      const solutions=all.filter(order=>p.rules.every(rule=>E.matches(rule,order,level)));
      assert.deepEqual(solutions,[p.answer],`seed=${seed}`);
      assert.ok(p.hints.every(hint=>E.matches(hint,p.answer,level)));
      if(level===2)assert.equal(new Set(p.rules.map(r=>r.owner)).size,2);
      if(level===1&&difficulty!=='expert')assert.ok(p.answer.every((k,i)=>!i||E.plants[p.answer[i-1]].value>E.plants[k].value));
    }
  });
}
test('替换、交换、移除、撤销保留其他位置；禁止重复古物',()=>{
  const g=E.createGame(1,'standard',random(6));
  for(const [index,key] of ['plum','orchid','bamboo','lotus'].entries())E.act(g,{type:'place',index,key});
  E.act(g,{type:'place',index:1,key:'plum'});
  assert.deepEqual(g.seq,['orchid','plum','bamboo','lotus']);
  E.act(g,{type:'remove',index:1});
  assert.deepEqual(g.seq,['orchid',null,'bamboo','lotus']);
  E.act(g,{type:'undo'});assert.deepEqual(g.seq,['orchid','plum','bamboo','lotus']);
  const before=[...g.seq];
  assert.ok(E.act(g,{type:'place',index:-1,key:'plum'}).error);
  assert.ok(E.act(g,{type:'place',index:0,key:'unknown'}).error);
  assert.deepEqual(g.seq,before);
});
test('空位与重复答案不扣机会；失败保留排列；历史可恢复',()=>{
  const g=E.createGame(1,'expert',random(2));
  assert.ok(E.act(g,{type:'submit'}).error);assert.equal(g.history.length,0);
  const wrong=E.permutations(g.puzzle.allKeys).filter(o=>E.feedback(o,g.puzzle.answer).correct<4);
  g.seq=[...wrong[0]];E.act(g,{type:'submit'});
  assert.deepEqual(g.seq,wrong[0]);assert.equal(g.history.length,1);
  assert.ok(E.act(g,{type:'submit'}).error);assert.equal(g.history.length,1);
  E.act(g,{type:'clear'});E.act(g,{type:'restore',index:0});assert.deepEqual(g.seq,wrong[0]);
  for(let i=1;i<4;i++){g.seq=[...wrong[i]];E.act(g,{type:'submit'});}
  assert.equal(g.status,'lost');assert.equal(E.view(g,'shopkeeper').remaining,0);
  const revision=g.revision;assert.ok(E.act(g,{type:'clear'}).error);assert.equal(g.revision,revision);
  assert.deepEqual(E.view(g,'shopkeeper').answer,g.puzzle.answer);
});
test('获胜锁定操作；提示总预算和双角色信息边界',()=>{
  const g=E.createGame(2,'relaxed',random(52));
  assert.equal(E.view(g,'shopkeeper').answer,undefined);
  assert.ok(E.view(g,'accountant').rules.every(r=>r.owner==='accountant'));
  for(let i=0;i<3;i++)assert.equal(E.act(g,{type:'hint'}).changed,true);
  assert.ok(E.act(g,{type:'hint'}).error);assert.equal(g.revealed.length,3);
  for(const [index,key] of g.puzzle.answer.entries())E.act(g,{type:'place',index,key});
  E.act(g,{type:'submit'});assert.equal(g.status,'won');
  assert.deepEqual(E.view(g,'shopkeeper').history[0].positions,[true,true,true,true]);
  assert.ok(E.act(g,{type:'undo'}).error);
});
