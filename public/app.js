/* Presentation and input controller. Online rules are enforced by the server. */
'use strict';
const E = window.Antique;
const $ = id => document.getElementById(id);
const config = {level:1, difficulty:'standard', role:'shopkeeper'};
const names = {accountant:'沈砚', shopkeeper:'阿棠'};
let mode = null, localGame = null, game = null, room = null, socket = null;
let selected = 0, busy = false, queueing = false, leaving = false;
let lastRound = null, lastStatus = null, lastHistory = 0, lastMessages = '';
let feedbackText = '', toastTimer, confirmAction;
function storage(kind, key, value) {
  try {
    if (value === undefined) return window[kind].getItem(key);
    if (value === null) window[kind].removeItem(key); else window[kind].setItem(key, value);
  } catch (_) { /* Playing remains available when storage is disabled. */ }
}
function toast(text) {
  $('toast').textContent = text; $('toast').classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5000);
}
function confirm(title, description, action) {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description;
  confirmAction = action; $('confirm-dialog').showModal();
}
function showPage(id) {
  for (const page of ['lobby','waiting','game']) $(page).classList.toggle('hidden', page !== id);
}
function updateSetup() {
  for (const btn of document.querySelectorAll('[data-level]')) {
    const on = Number(btn.dataset.level) === config.level;
    btn.classList.toggle('selected', on); btn.setAttribute('aria-pressed', String(on));
  }
  for (const btn of document.querySelectorAll('[data-difficulty]')) {
    const on = btn.dataset.difficulty === config.difficulty;
    btn.classList.toggle('selected', on); btn.setAttribute('aria-pressed', String(on));
  }
  for (const btn of document.querySelectorAll('[data-role]')) {
    const on = btn.dataset.role === config.role;
    btn.classList.toggle('selected', on); btn.setAttribute('aria-pressed', String(on));
  }
  $('difficulty-description').textContent = E.difficulties[config.difficulty].detail;
  $('pass-badge').textContent = storage('localStorage','level1Passed') === 'true' ? '已通关' : '';
}
function resetPresentation() {
  selected = 0; feedbackText = ''; lastStatus = null; lastHistory = 0; lastMessages = '';
  $('history-details').open = false;
}
function startPractice() {
  mode = 'practice'; room = null; busy = false; queueing = false;
  localGame = E.createGame(config.level, config.difficulty);
  resetPresentation(); refreshPractice(); showPage('game'); window.scrollTo({top:0});
}
function refreshPractice() {game = E.view(localGame, config.role, true); renderGame();}
function catalogData() {return config.level === 1 ? E.plants : E.relics;}
function icon(key) {
  const item = catalogData()[key];
  return config.level === 1 ? item.svg : `<span class="item-icon" aria-hidden="true">${item.icon}</span>`;
}
function canOperate() {return game?.status === 'playing' && config.role === 'shopkeeper' && !busy && onlineReady();}
function onlineReady() {return mode === 'practice' || (!!socket?.connected && room?.players.length === 2 && room.players.every(p => p.connected));}
function button(id, disabled) {$(id).disabled = !!disabled;}
async function request(name, data = {}) {
  if (!socket?.connected) return {error:'连接尚未就绪，请稍后重试。'};
  return new Promise(resolve => socket.timeout(8000).emit(name, data, (error, response) => resolve(error ? {error:'请求超时，请检查连接后重试。'} : response || {})));
}
async function ensureSocket() {
  if (typeof window.io !== 'function') {toast('联机服务未加载，仍可独自练习。刷新后可重试联机。'); return false;}
  if (!socket) {
    socket = io({autoConnect:false, reconnection:true, reconnectionDelay:1000, timeout:12000});
    socket.on('room-state', incoming => {
      mode = 'online'; queueing = false; room = incoming;
      Object.assign(config, {level:room.level, difficulty:room.difficulty, role:room.role});
      storage('sessionStorage','antiqueRoom', JSON.stringify({id:room.id,token:room.token}));
      if (!room.game) {renderWaiting(); return;}
      if (room.round !== lastRound) {lastRound = room.round; resetPresentation();}
      game = room.game; renderGame(); showPage('game');
    });
    socket.on('queue-state', data => {
      if (!room) {queueing = true; mode = 'online'; renderWaiting();
        $('queue-detail').textContent = `同身份有 ${data.same} 人等待 · 只匹配相同关卡与难度`;
      }
    });
    socket.on('room-ended', data => {
      const silent = leaving; returnToLobby(); if (!silent) toast(data.reason);
    });
    socket.on('disconnect', () => {
      if (mode !== 'online') return;
      if (room?.game) renderGame();
      else if (queueing) {queueing = false; returnToLobby(); toast('匹配连接已断开，请重新寻找同伴。');}
      else if (room) {$('waiting-detail').textContent = '连接中断，正在尝试恢复房间…';}
    });
    socket.on('connect', async () => {
      const saved = storage('sessionStorage','antiqueRoom');
      if (!saved || leaving) return;
      let info; try { info = JSON.parse(saved); } catch (_) {storage('sessionStorage','antiqueRoom',null); return;}
      const result = await request('room-resume', info);
      if (result.error) {returnToLobby(); toast(result.error);}
    });
  }
  if (socket.connected) return true;
  toast('正在唤醒小馆的联机服务…');
  socket.connect();
  return new Promise(resolve => {
    const timeout = setTimeout(() => finish(false), 15000);
    const done = () => finish(true);
    const error = () => finish(false);
    function finish(ok) {
      clearTimeout(timeout); socket.off('connect', done); socket.off('connect_error', error);
      if (!ok) toast('联机暂未连上，可以先独自练习，稍后再试。');
      resolve(ok);
    }
    socket.once('connect', done); socket.once('connect_error', error);
  });
}
async function beginOnline(type) {
  if (busy) return;
  const id = $('room-code').value.trim();
  if (type === 'join' && !/^\d{4}$/.test(id)) {toast('请输入四位数字房间号。'); return;}
  busy = true;
  const lobbyButtons = [...$('lobby').querySelectorAll('button')]; lobbyButtons.forEach(b => b.disabled = true);
  try {
    if (!(await ensureSocket())) return;
    mode = 'online';
    const event = type === 'create' ? 'room-create' : type === 'join' ? 'room-join' : 'match-join';
    const result = await request(event, type === 'join' ? {id,role:config.role} : {...config});
    if (result.error) {toast(result.error); if (!room) mode = null;}
  } finally {busy = false; lobbyButtons.forEach(b => b.disabled = false); if (game && room?.game) renderGame();}
}
function renderWaiting() {
  showPage('waiting'); $('room-number').textContent = room?.id || '';
  $('waiting-title').textContent = room ? '邀一位伙伴入局' : '正在寻找同伴';
  $('waiting-detail').textContent = `第${config.level === 1 ? '一' : '二'}回 · ${E.difficulties[config.difficulty].name} · 你是${names[config.role]}`;
  $('copy-room').classList.toggle('hidden', !room);
  $('queue-detail').textContent = room ? `把房间号告诉伙伴，请对方选择${names[config.role === 'accountant' ? 'shopkeeper' : 'accountant']}。` : '暂时没有伙伴？随时可以返回，独自练习。';
}
function returnToLobby() {
  storage('sessionStorage','antiqueRoom',null);
  mode = null; room = null; game = null; localGame = null; queueing = false; busy = false; leaving = false; lastRound = null;
  resetPresentation(); updateSetup(); showPage('lobby'); window.scrollTo({top:0});
}
async function leave() {
  leaving = true;
  if (mode === 'online') {
    // Clear the resume token before disconnecting so this tab cannot rejoin accidentally.
    storage('sessionStorage','antiqueRoom',null);
    if (socket?.connected) await request(room ? 'room-leave' : 'match-cancel');
    socket?.disconnect();
  }
  returnToLobby();
}
async function action(data) {
  if (!game || busy || !onlineReady()) return;
  if (data.type !== 'hint' && config.role !== 'shopkeeper') return;
  let result;
  busy = true;
  if (mode === 'practice') result = E.act(localGame, data);
  else result = await request('game-action', {round:room.round,revision:game.revision,action:data});
  busy = false;
  if (result.error) {feedbackText = result.error; toast(result.error);}
  else if (data.type === 'place') {
    const seq = mode === 'practice' ? localGame.seq : game.seq;
    const empty = seq.indexOf(null); selected = empty >= 0 ? empty : selected;
    feedbackText = '';
  } else if (data.type !== 'submit') feedbackText = '';
  if (mode === 'practice') refreshPractice(); else if (game) renderGame();
}
function renderGame() {
  if (!game) return;
  const oldFocus = document.activeElement;
  const focusKey = oldFocus?.dataset?.key, focusSlot = oldFocus?.dataset?.slot;
  const operator = config.role === 'shopkeeper', practice = mode === 'practice', ready = onlineReady();
  const catalog = catalogData();
  $('game-eyebrow').textContent = `${practice ? '独自练习' : `双人协作 · 房间 ${room.id}`} / ${E.difficulties[config.difficulty].name}`;
  $('game-title').textContent = config.level === 1 ? '第一回 · 面值密码锁' : '第二回 · 瑞兽镇阵';
  $('player-portrait').src = `/assets/${config.role}.svg`;
  $('player-portrait').alt = `${names[config.role]}的角色插画`;
  $('portrait-seal').textContent = operator ? '解锁' : '执册';
  $('player-name').textContent = names[config.role];
  $('player-identity').textContent = operator ? '你的身份 · 店堂伙计' : '你的身份 · 账房先生';
  $('notebook-jump').textContent = practice ? '翻阅另一半线索 ↓' : '与伙伴传音 ↓';
  $('player-task').textContent = operator ? '你掌握机关规则，负责选择古物、摆放顺序。' : '你掌握古物底册，负责观察资料、传递线索。';
  $('switch-role').classList.toggle('hidden', !practice);
  $('switch-role').textContent = operator ? '切换为沈砚' : '切换为阿棠';
  $('attempt-count').textContent = game.remaining + ' 次';
  $('hint-count').textContent = game.hintsRemaining + ' 条';
  $('game-status').textContent = game.status === 'won' ? '已解开' : game.status === 'lost' ? '待复盘' : !ready ? '等待重连' : '推敲中';
  $('connection-banner').classList.toggle('hidden', ready);
  $('connection-banner').textContent = socket?.connected ? '伙伴暂时离线。房间保留一分钟，重连后继续，本局不会扣除机会。' : '连接中断，正在重连。局面由小馆保留一分钟，请稍候。';
  $('restart-banner').classList.toggle('hidden', !room?.restart);
  if (room?.restart) {
    const own = room.restart === config.role;
    $('restart-text').textContent = own ? '已邀请伙伴换一道新谜题，等待回应。' : '伙伴想换一道新谜题。重开将结束当前这局。';
    $('accept-restart').classList.toggle('hidden', own); $('decline-restart').classList.toggle('hidden', own);
  }
  $('clue-title').textContent = config.level === 1 ? (operator ? '机关规制' : '账房的任务') : (operator ? '博古架规制' : '神兽规制');
  $('clue-tag').textContent = practice ? '完整资料可翻阅' : '与你的伙伴交流';
  const rules = game.rules.filter(r => r.owner === config.role);
  $('clues').replaceChildren();
  if (!rules.length) {
    for (const text of ['查看六张邮票的面值，把它们告诉阿棠。','阿棠知道密码规则。一起确定四张邮票及顺序。']) {
      const li = document.createElement('li'); li.textContent = text; $('clues').append(li);
    }
  } else for (const rule of rules) {const li = document.createElement('li'); li.textContent = rule.text; $('clues').append(li);}
  $('revealed-hints').replaceChildren();
  for (const text of game.revealed) {const p = document.createElement('p'); p.textContent = '提示 · ' + text; $('revealed-hints').append(p);}
  $('mechanism-title').textContent = operator ? (config.level === 1 ? '四位密码锁' : '镇阵博古架') : '伙伴正在摆放';
  $('placement-help').textContent = operator ? '点击位置可替换' : '位置实时同步';
  $('slots').replaceChildren();
  const latest = game.history.at(-1);
  for (let i = 0; i < 4; i++) {
    const key = game.seq[i], el = document.createElement('button');
    el.type = 'button'; el.className = 'slot' + (selected === i && operator ? ' active' : '');
    if (latest?.positions?.[i] && latest.seq[i] === key) el.classList.add('correct-slot');
    el.dataset.slot = i;
    el.setAttribute('aria-label', `第${i+1}位：${key ? catalog[key].name : '空位'}${operator ? '，点击选中以替换' : ''}`);
    el.setAttribute('aria-pressed', String(operator && selected === i));
    el.innerHTML = `<span class="slot-number">${['壹','贰','叁','肆'][i]}</span>${key ? icon(key) + `<small>${catalog[key].name}</small>` : '<span class="empty-icon">＋</span><small>待放入</small>'}`;
    el.disabled = !canOperate(); el.onclick = () => {selected = i; feedbackText = ''; renderGame();};
    $('slots').append(el);
  }
  if (game.history.length > lastHistory) {
    if (latest) feedbackText = `第 ${game.history.length} 次试答：选对 ${latest.included} 件，位置正确 ${latest.correct} 位。${game.status === 'playing' ? '排列已保留，可继续调整。' : ''}`;
    lastHistory = game.history.length; $('history-details').open = true;
  }
  $('action-feedback').textContent = feedbackText || (operator ? `当前选中第 ${selected+1} 位 · 点选下方古物放入` : (practice ? '切换为阿棠，即可操作机关。' : '把发现告诉阿棠，配合对方解开机关。'));
  for (const id of ['remove-action','clear-action']) button(id, !canOperate() || (id === 'remove-action' ? !game.seq[selected] : !game.seq.some(Boolean)));
  button('undo-action', !canOperate() || !game.canUndo);
  $('catalog-title').textContent = config.level === 1 ? (operator ? '可选邮票' : '邮票面值底册') : (operator ? '可选古物' : '古物神兽底册');
  $('catalog-tip').textContent = operator ? '每件限用一次' : '点击卡片可分享资料';
  $('catalog').replaceChildren();
  for (const [index,key] of game.allKeys.entries()) {
    const item = catalog[key], el = document.createElement('button'), position = game.seq.indexOf(key);
    el.type = 'button'; el.className = 'item-card' + (position >= 0 ? ' selected-item' : '');
    el.dataset.key = key; el.dataset.position = position >= 0 ? `第${position+1}位` : '';
    el.innerHTML = `<span class="key-hint">${index+1}</span>${icon(key)}<strong>${item.name}</strong>`;
    const detail = document.createElement('small');
    detail.textContent = config.level === 1 ? (operator ? '' : `${item.value} 分`) : `${item.material} · ${item.type}`;
    el.append(detail);
    if (!operator && config.level === 2) {const meta = document.createElement('small');meta.textContent=`${item.beast} · ${item.element} · ${item.fortune}`;el.append(meta);}
    el.setAttribute('aria-label', `${item.name}${position >= 0 ? `，已在第${position+1}位` : ''}${operator ? '，点击放入或交换位置' : '，点击分享资料'}`);
    el.disabled = operator ? !canOperate() : (!ready || busy || game.status !== 'playing');
    el.onclick = () => operator ? action({type:'place',index:selected,key}) : shareItem(key);
    $('catalog').append(el);
  }
  button('submit-action', !canOperate() || game.seq.some(k => !k));
  button('hint-action', !ready || busy || game.status !== 'playing' || game.hintsRemaining <= 0);
  $('submit-action').classList.toggle('hidden', !operator);
  $('hint-action').textContent = `求一条线索 · ${game.hintsRemaining}`;
  renderNotebook(); renderHistory(); renderResult();
  const statusChanged = lastStatus !== game.status; lastStatus = game.status;
  if (statusChanged && game.status !== 'playing') $('result-panel').focus({preventScroll:false});
  else if (focusKey) document.querySelector(`[data-key="${focusKey}"]`)?.focus({preventScroll:true});
  else if (focusSlot !== undefined) document.querySelector(`[data-slot="${focusSlot}"]`)?.focus({preventScroll:true});
}
function shareItem(key) {
  const item = catalogData()[key];
  const text = config.level === 1 ? `${item.name}的面值是 ${item.value} 分。` : `${item.name}：${item.beast}，${item.element}属性，${item.fortune}；${item.material}质${item.type}。`;
  if (mode === 'practice') toast(text); else sendChat(text);
}
function renderNotebook() {
  const practice = mode === 'practice';
  $('practice-notes').classList.toggle('hidden', !practice);
  $('chat-area').classList.toggle('hidden', practice);
  $('notebook-title').textContent = practice ? '另一半线索' : '与伙伴传音';
  $('notebook-tag').textContent = practice ? '练习可翻阅' : '线索靠交流';
  if (!practice) {renderMessages(); return;}
  const notes = $('practice-notes'); notes.replaceChildren();
  const intro = document.createElement('p'); intro.className = 'note-intro';
  intro.textContent = '练习时可以翻阅双方资料。联机时，这一半线索由伙伴掌握。'; notes.append(intro);
  if (config.role === 'shopkeeper') for (const key of game.allKeys) {
    const item = catalogData()[key], row = document.createElement('div'); row.className='note-row';
    row.innerHTML = icon(key);
    const desc = document.createElement('div'); const name = document.createElement('strong'); name.textContent=item.name; desc.append(name);
    if (config.level === 2) {const small = document.createElement('small');small.textContent=`${item.beast} · ${item.element} · ${item.fortune}`;desc.append(small);}
    row.append(desc);
    if (config.level === 1) {const val=document.createElement('span');val.className='note-value';val.textContent=`${item.value} 分`;row.append(val);}
    notes.append(row);
  }
  for (const rule of game.rules.filter(r=>r.owner!==config.role)) {const p=document.createElement('p');p.className='note-clue';p.textContent=rule.text;notes.append(p);}
}
function renderMessages() {
  const signature = room.messages.map(m=>m.id).join(',');
  if (lastMessages !== signature || !$('messages').childNodes.length) {
    const atBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 60;
    $('messages').replaceChildren();
    if (!room.messages.length) {const p=document.createElement('p');p.className='chat-empty';p.textContent='传音筒已接通。先和伙伴分享一条线索吧。';$('messages').append(p);}
    for (const msg of room.messages) {
      const row=document.createElement('div');row.className='message'+(msg.role===config.role?' self':'');
      const label=document.createElement('small');label.textContent=names[msg.role]+(msg.role===config.role?' · 你':'');
      const text=document.createElement('p');text.textContent=msg.text;row.append(label,text);$('messages').append(row);
    }
    if (atBottom || room.messages.at(-1)?.role === config.role) $('messages').scrollTop=$('messages').scrollHeight;
    lastMessages=signature;
  }
  $('quick-messages').replaceChildren();
  const quick = config.role === 'accountant' ? ['请把机关规则告诉我。','等一下，我再核对线索。'] : ['请分享你的古物资料。','我准备验证这一组了。'];
  if (game.rules.length) quick.unshift('我的线索：'+game.rules[0].text);
  for (const text of quick) {const btn=document.createElement('button');btn.type='button';btn.textContent=text;btn.disabled=!onlineReady();btn.onclick=()=>sendChat(text);$('quick-messages').append(btn);}
  $('chat-input').disabled=!onlineReady();
  $('chat-form').querySelector('button').disabled=!onlineReady();
}
function renderHistory() {
  $('history-count').textContent=game.history.length; $('history').replaceChildren();
  if (!game.history.length) {const p=document.createElement('p');p.className='muted';p.textContent='提交后会记录每一次排列。重复提交同一组，不扣机会。';$('history').append(p);}
  [...game.history].reverse().forEach((row,reverseIndex)=>{
    const index=game.history.length-1-reverseIndex;
    const div=document.createElement('div');div.className='history-row';
    const text=document.createElement('div');text.textContent=`${index+1}. ${row.seq.map(k=>catalogData()[k].name).join(' → ')}`;
    const meta=document.createElement('p');meta.textContent=`选对 ${row.included} 件 · 位置正确 ${row.correct} 位`;text.append(meta);div.append(text);
    if (config.role==='shopkeeper' && game.status==='playing') {const btn=document.createElement('button');btn.className='quiet';btn.textContent='重新摆入';btn.disabled=!canOperate();btn.onclick=()=>action({type:'restore',index});div.append(btn);}
    $('history').append(div);
  });
}
function renderResult() {
  const ended=game.status!=='playing', won=game.status==='won';
  $('result-panel').classList.toggle('hidden',!ended);
  if (!ended) return;
  $('result-panel').classList.toggle('lost',!won);
  $('result-label').textContent=won?'旧物有声 · 谜底已明':'今夜暂歇 · 复盘有所得';
  $('result-title').textContent=won?(config.level===1?'咔哒，门开了。':'瑞兽归位，暗格已开。'):'差一点，再推敲一回。';
  $('result-description').textContent=won?`用了 ${game.history.length} 次验证、${game.revealed.length} 条提示。${mode==='practice'?'熟悉机关后，也可以邀朋友一起解谜。':'你们把彼此的线索，拼成了同一个答案。'}`:'机会已用尽，原来的排列和试答记录仍在。对照答案与线索，看看哪一步可以再想想。';
  $('result-answer').textContent='本局答案：'+game.answer.map(k=>catalogData()[k].name).join(' → ');
  $('next-level').classList.toggle('hidden',!(mode==='practice'&&config.level===1&&won));
  if (won && config.level===1) storage('localStorage','level1Passed','true');
}
async function sendChat(text) {
  if (!text.trim() || !onlineReady()) return false;
  const result=await request('chat',{text:text.trim()});
  if (result.error) {toast(result.error);return false;} return true;
}
async function restart() {
  if (mode==='practice') {
    if (game.status==='playing') confirm('换一道新谜题？','本局排列和试答记录将结束，新的一局会重新生成。',startPractice);
    else startPractice();
  } else {
    const result=await request('restart-request');if(result.error)toast(result.error);
  }
}
for(const btn of document.querySelectorAll('[data-level]')) btn.onclick=()=>{config.level=Number(btn.dataset.level);updateSetup();};
for(const btn of document.querySelectorAll('[data-difficulty]')) btn.onclick=()=>{config.difficulty=btn.dataset.difficulty;updateSetup();};
for(const btn of document.querySelectorAll('[data-role]')) btn.onclick=()=>{config.role=btn.dataset.role;updateSetup();};
$('practice-start').onclick=startPractice;
$('create-room').onclick=()=>beginOnline('create');
$('match-start').onclick=()=>beginOnline('match');
$('join-form').onsubmit=e=>{e.preventDefault();beginOnline('join');};
$('room-code').addEventListener('input',()=>{$('room-code').value=$('room-code').value.replace(/\D/g,'').slice(0,4);});
$('cancel-waiting').onclick=leave;
$('copy-room').onclick=async()=>{
  try {await navigator.clipboard.writeText(room.id);toast('房间号已复制，告诉伙伴就能入局。');}
  catch(_){toast(`房间号是 ${room.id}，可以长按复制上方数字。`);}
};
$('switch-role').onclick=()=>{config.role=config.role==='shopkeeper'?'accountant':'shopkeeper';feedbackText='';refreshPractice();};
$('leave-game').onclick=()=>confirm('离开本局？',mode==='online'?'离开会结束双方当前房间。你可以稍后重新组队。':'本局练习不会保留，通关记录仍会记在本机。',leave);
$('restart-game').onclick=restart;$('result-restart').onclick=restart;
$('next-level').onclick=()=>{config.level=2;startPractice();};
$('accept-restart').onclick=async()=>{const r=await request('restart-respond',{accept:true});if(r.error)toast(r.error);};
$('decline-restart').onclick=async()=>{const r=await request('restart-respond',{accept:false});if(r.error)toast(r.error);};
$('undo-action').onclick=()=>action({type:'undo'});
$('clear-action').onclick=()=>action({type:'clear'});
$('remove-action').onclick=()=>action({type:'remove',index:selected});
$('hint-action').onclick=()=>action({type:'hint'});
$('submit-action').onclick=()=>action({type:'submit'});
$('chat-form').onsubmit=async e=>{e.preventDefault();const input=$('chat-input'),text=input.value;if(await sendChat(text))if(input.value===text)input.value='';};
$('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-form').requestSubmit();}};
$('help-open').onclick=()=>$('help-dialog').showModal();
for(const btn of document.querySelectorAll('[data-close]'))btn.onclick=()=>$(btn.dataset.close).close();
$('confirm-yes').onclick=()=>{$('confirm-dialog').close();const fn=confirmAction;confirmAction=null;fn?.();};
document.addEventListener('keydown',e=>{
  if(e.isComposing||e.repeat||e.ctrlKey||e.metaKey||e.altKey||!game||!canOperate()||document.querySelector('dialog[open]'))return;
  if(e.target.closest('input,textarea,select,a,summary,[contenteditable="true"]'))return;
  if(/^[1-6]$/.test(e.key)){e.preventDefault();action({type:'place',index:selected,key:game.allKeys[Number(e.key)-1]});}
  else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();selected=(selected+(e.key==='ArrowLeft'?3:1))%4;renderGame();}
  else if(e.key==='Backspace'){e.preventDefault();action({type:'remove',index:game.seq[selected]?selected:game.seq.findLastIndex(Boolean)});}
  else if(e.key==='Enter' && (!e.target.closest('button') || e.target.closest('.slot,.item-card'))){e.preventDefault();action({type:'submit'});}
});
updateSetup();
if(storage('sessionStorage','antiqueRoom'))ensureSocket();
