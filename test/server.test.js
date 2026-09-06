'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {io}=require('socket.io-client');
const {createGameServer}=require('../server');
const C={level:1,difficulty:'standard',role:'accountant'};
async function setup(t,options={}){
  const app=createGameServer(options), clients=[];
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const url=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{for(const s of clients)s.disconnect();await app.close();});
  async function connect(){const s=io(url,{transports:['websocket'],forceNew:true,reconnection:false});
    s.on('room-state',state=>s.state=state);s.on('room-ended',data=>s.ended=data);clients.push(s);await once(s,'connect');return s;}
  return {...app,connect,url};
}
const rpc=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(err,result)=>err?reject(err):resolve(result)));
async function waitFor(s,event,predicate=()=>true){
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(event,listener);reject(new Error('timeout '+event));},2000);
    function listener(value){if(predicate(value)){clearTimeout(timer);s.off(event,listener);resolve(value);}}s.on(event,listener);});
}
async function pair(app,hostRole='accountant',level=1){
  const a=await app.connect(),b=await app.connect();
  await rpc(a,'room-create',{...C,role:hostRole,level});
  const changed=waitFor(a,'room-state',state=>!!state.game);
  await rpc(b,'room-join',{id:a.state.id,role:hostRole==='accountant'?'shopkeeper':'accountant'});await changed;
  return {a,b,acc:hostRole==='accountant'?a:b,shop:hostRole==='shopkeeper'?a:b};
}
for(const hostRole of ['accountant','shopkeeper'])test(`任意角色建房，双方同题、正确同步及通关：${hostRole}`,async t=>{
  const app=await setup(t);const {a,b,acc,shop}=await pair(app,hostRole,2);
  assert.equal(a.state.round,b.state.round);assert.equal(a.state.game.level,2);
  assert.equal(a.state.game.answer,undefined);assert.equal(b.state.game.answer,undefined);
  const action=async payload=>rpc(shop,'game-action',{round:shop.state.round,revision:shop.state.game.revision,action:payload});
  const wrongRole=await rpc(acc,'game-action',{round:acc.state.round,revision:acc.state.game.revision,action:{type:'place',index:0,key:'vase'}});
  assert.ok(wrongRole.error);
  const answer=app.rooms.get(a.state.id).game.puzzle.answer;
  for(const [index,key] of answer.entries())assert.equal((await action({type:'place',index,key})).changed,true);
  const win=waitFor(acc,'room-state',state=>state.game.status==='won');
  await action({type:'submit'});await win;
  assert.equal(shop.state.game.status,'won');assert.deepEqual(acc.state.game.answer,answer);
});
test('同角色/房满/无效房号拦截；旁观连接不能操纵房间',async t=>{
  const app=await setup(t);const a=await app.connect(),b=await app.connect(),c=await app.connect();
  assert.ok((await rpc(a,'room-create',{...C,role:'bad'})).error);
  await rpc(a,'room-create',C);
  assert.ok((await rpc(b,'room-join',{id:a.state.id,role:'accountant'})).error);
  assert.ok((await rpc(b,'room-join',{id:'abcd',role:'shopkeeper'})).error);
  await rpc(b,'room-join',{id:a.state.id,role:'shopkeeper'});
  assert.ok((await rpc(c,'room-join',{id:a.state.id,role:'shopkeeper'})).error);
  assert.ok((await rpc(c,'game-action',{round:a.state.round,revision:0,action:{type:'hint'}})).error);
  const old=b.state.game.revision;await rpc(b,'game-action',{round:b.state.round,revision:old,action:{type:'hint'}});
  assert.ok((await rpc(b,'game-action',{round:b.state.round,revision:old,action:{type:'hint'}})).error);
});
test('客人请求重开，双方确认后才开始新题；旧局操作被拒绝',async t=>{
  const app=await setup(t);const {a,b}=await pair(app);
  const old=a.state.round;
  await rpc(b,'restart-request');assert.equal(b.state.round,old);assert.equal(b.state.restart,'shopkeeper');
  await rpc(a,'restart-respond',{accept:false});assert.equal(a.state.round,old);
  await rpc(b,'restart-request');const updated=waitFor(b,'room-state',s=>s.round!==old);
  await rpc(a,'restart-respond',{accept:true});await updated;
  assert.notEqual(a.state.round,old);assert.equal(a.state.round,b.state.round);
  assert.equal(a.state.game.history.length,0);assert.equal(a.state.game.remaining,6);
  assert.ok((await rpc(b,'game-action',{round:old,revision:0,action:{type:'submit'}})).error);
});
test('断线暂停操作，恢复相同角色、局面、聊天；失效 token 不可恢复',async t=>{
  const app=await setup(t);const {a,b}=await pair(app);
  await rpc(b,'game-action',{round:b.state.round,revision:0,action:{type:'place',index:0,key:'plum'}});
  await rpc(b,'chat',{text:'<img src=x onerror=alert(1)> 测试线索'});
  const snapshot=b.state, offline=waitFor(a,'room-state',s=>!s.players[1].connected);b.disconnect();await offline;
  assert.ok((await rpc(a,'game-action',{round:a.state.round,revision:a.state.game.revision,action:{type:'hint'}})).error);
  const replacement=await app.connect();assert.ok((await rpc(replacement,'room-resume',{id:snapshot.id,token:'fake'})).error);
  await rpc(replacement,'room-resume',{id:snapshot.id,token:snapshot.token});
  assert.equal(replacement.state.role,'shopkeeper');assert.equal(replacement.state.game.seq[0],'plum');
  assert.equal(replacement.state.messages[0].text,'<img src=x onerror=alert(1)> 测试线索');
});
test('匹配按关卡和难度分队；重复排队和换角色不会自我匹配',async t=>{
  const app=await setup(t);const a=await app.connect(),b=await app.connect();
  await rpc(a,'match-join',C);await rpc(a,'match-join',C);
  await rpc(b,'match-join',{...C,role:'shopkeeper',level:2});assert.equal(app.rooms.size,0);
  await rpc(b,'match-join',{...C,role:'shopkeeper',difficulty:'expert'});assert.equal(app.rooms.size,0);
  await rpc(a,'match-join',{...C,role:'shopkeeper'});assert.equal(app.rooms.size,0);
  await rpc(a,'match-join',C);
  const matched=waitFor(a,'room-state',s=>!!s.game);
  await rpc(b,'match-join',{...C,role:'shopkeeper'});await matched;
  assert.equal(a.state.id,b.state.id);assert.equal(app.rooms.size,1);
  await rpc(b,'room-leave');assert.equal(app.rooms.size,0);
});
test('重连超时销毁房间；静态服务只公开游戏资源',async t=>{
  const app=await setup(t,{graceMs:30});const {a,b}=await pair(app);
  const ended=waitFor(a,'room-ended');b.disconnect();await ended;assert.equal(app.rooms.size,0);
  for(const path of ['/server.js','/.git/config','/package-lock.json'])assert.equal((await fetch(app.url+path)).status,404);
  for(const path of ['/game.html','/engine.js','/app.js','/styles.css','/assets/accountant.svg','/assets/shopkeeper.svg','/socket.io/socket.io.js'])assert.equal((await fetch(app.url+path)).status,200);
});
