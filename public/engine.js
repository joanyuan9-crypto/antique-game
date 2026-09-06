/* Shared, deterministic-rule puzzle engine. No browser or network dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Antique = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const ALL_PLANTS = {
    plum: { name: "梅花", value: 3, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><circle cx="20" cy="14" r="6" fill="#f8bbd0"/><circle cx="12" cy="22" r="6" fill="#f8bbd0"/><circle cx="28" cy="22" r="6" fill="#f8bbd0"/><circle cx="16" cy="30" r="6" fill="#f8bbd0"/><circle cx="24" cy="30" r="6" fill="#f8bbd0"/><circle cx="20" cy="22" r="4" fill="#ffeb3b"/></svg>' },
    orchid: { name: "兰花", value: 8, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><path d="M20 8 L20 32" stroke="#81c784" stroke-width="2"/><ellipse cx="20" cy="12" rx="8" ry="5" fill="#ce93d8"/><ellipse cx="12" cy="18" rx="6" ry="4" fill="#e1bee7"/><ellipse cx="28" cy="18" rx="6" ry="4" fill="#e1bee7"/><ellipse cx="20" cy="24" rx="7" ry="4" fill="#ce93d8"/></svg>' },
    bamboo: { name: "竹子", value: 5, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><rect x="18" y="6" width="4" height="28" fill="#81c784"/><line x1="18" y1="14" x2="22" y2="14" stroke="#558b2f" stroke-width="2"/><line x1="18" y1="22" x2="22" y2="22" stroke="#558b2f" stroke-width="2"/><line x1="18" y1="30" x2="22" y2="30" stroke="#558b2f" stroke-width="2"/><path d="M22 10 L30 8 M22 18 L30 16 M22 26 L30 24" stroke="#81c784" stroke-width="2" fill="none"/></svg>' },
    chrysanthemum: { name: "菊花", value: 1, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><g fill="#ffcc80"><circle cx="20" cy="12" r="4"/><circle cx="28" cy="16" r="4"/><circle cx="30" cy="24" r="4"/><circle cx="24" cy="30" r="4"/><circle cx="16" cy="30" r="4"/><circle cx="10" cy="24" r="4"/><circle cx="12" cy="16" r="4"/></g><circle cx="20" cy="22" r="5" fill="#ff8f00"/></svg>' },
    peony: { name: "牡丹", value: 6, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><g fill="#f48fb1"><circle cx="20" cy="14" r="5"/><circle cx="13" cy="19" r="5"/><circle cx="27" cy="19" r="5"/><circle cx="16" cy="26" r="5"/><circle cx="24" cy="26" r="5"/></g><circle cx="20" cy="20" r="4" fill="#ffeb3b"/></svg>' },
    lotus: { name: "荷花", value: 4, svg: '<svg class="plant-icon" viewBox="0 0 40 40"><ellipse cx="20" cy="16" rx="10" ry="6" fill="#81d4fa"/><ellipse cx="14" cy="22" rx="6" ry="4" fill="#b3e5fc"/><ellipse cx="26" cy="22" rx="6" ry="4" fill="#b3e5fc"/><ellipse cx="20" cy="26" rx="7" ry="4" fill="#81d4fa"/><circle cx="20" cy="20" r="3" fill="#ffeb3b"/></svg>' }
};

const ALL_RELICS = {
    vase: { name: "青花龙纹瓶", material: "瓷", type: "容器", beast: "青龙", element: "木", fortune: "瑞兽", icon: "🏺", beastIcon: "🐉", texture: "porcelain" },
    furnace: { name: "铜铸玄武炉", material: "铜", type: "容器", beast: "玄武", element: "水", fortune: "瑞兽", icon: "🪔", beastIcon: "🐢", texture: "bronze" },
    plaque: { name: "麒麟玉佩牌", material: "玉", type: "饰器", beast: "麒麟", element: "土", fortune: "瑞兽", icon: "🎴", beastIcon: "🦄", texture: "jade" },
    mirror: { name: "朱雀菱花镜", material: "铜", type: "饰器", beast: "朱雀", element: "火", fortune: "瑞兽", icon: "🪞", beastIcon: "🔥", texture: "copper" },
    ding: { name: "饕餮青铜鼎", material: "铜", type: "容器", beast: "饕餮", element: "金", fortune: "凶兽", icon: "🍶", beastIcon: "👹", texture: "bronze" },
    paper: { name: "白虎玉镇纸", material: "玉", type: "文房", beast: "白虎", element: "金", fortune: "瑞兽", icon: "📜", beastIcon: "🐯", texture: "paper" }
};

const DIFFICULTIES = {
  relaxed: { name: '入门', attempts: 8, hints: 3, detail: '8 次机会 · 3 条提示 · 标出正确位置' },
  standard: { name: '雅集', attempts: 6, hints: 2, detail: '6 次机会 · 2 条提示 · 汇总试答反馈' },
  expert: { name: '问鼎', attempts: 4, hints: 1, detail: '4 次机会 · 1 条提示 · 更多关系推理' }
};
function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function permutations(keys, length = 4) {
  const result = [];
  function visit(order) {
    if (order.length === length) { result.push(order); return; }
    for (const key of keys) if (!order.includes(key)) visit([...order, key]);
  }
  visit([]);
  return result;
}
function matches(rule, order, level) {
  const catalog = level === 1 ? ALL_PLANTS : ALL_RELICS;
  const get = i => catalog[order[i]][rule.field];
  switch (rule.kind) {
    case 'sum': return order.reduce((sum, key) => sum + catalog[key].value, 0) === rule.value;
    case 'descending': return order.every((key, i) => !i || catalog[order[i - 1]].value > catalog[key].value);
    case 'position': return get(rule.index) === rule.value;
    case 'gap': return get(rule.a) - get(rule.b) === rule.value;
    case 'before': return order.findIndex(key => catalog[key][rule.field] === rule.first) >= 0 &&
      order.findIndex(key => catalog[key][rule.field] === rule.first) < order.findIndex(key => catalog[key][rule.field] === rule.second);
    case 'count': return order.filter(key => catalog[key][rule.field] === rule.value).length === rule.count;
    case 'same': return (get(rule.a) === get(rule.b)) === rule.value;
    default: return false;
  }
}
function generate(level = 1, difficulty = 'standard', random = Math.random) {
  if (![1, 2].includes(level) || !Object.hasOwn(DIFFICULTIES, difficulty)) throw new Error('无效关卡或难度');
  const catalog = level === 1 ? ALL_PLANTS : ALL_RELICS;
  const allKeys = Object.keys(catalog);
  let answer = shuffle(allKeys, random).slice(0, 4);
  if (level === 1 && difficulty !== 'expert') answer.sort((a, b) => catalog[b].value - catalog[a].value);
  const pool = [];
  const add = (rule, text, owner) => pool.push({ ...rule, text, owner });
  if (level === 1) {
    add({kind:'sum', value:answer.reduce((sum, k) => sum + catalog[k].value, 0)},
      `四张邮票的面值之和为 ${answer.reduce((sum, k) => sum + catalog[k].value, 0)} 分。`, 'shopkeeper');
    if (difficulty !== 'expert') add({kind:'descending'}, '从左至右，面值依次减小。', 'shopkeeper');
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const value = catalog[answer[a]].value - catalog[answer[b]].value;
      add({kind:'gap', field:'value', a, b, value},
        `第 ${value > 0 ? a + 1 : b + 1} 位比第 ${value > 0 ? b + 1 : a + 1} 位多 ${Math.abs(value)} 分。`, 'shopkeeper');
    }
  } else {
    for (const field of ['element', 'fortune', 'material', 'type']) {
      for (const value of new Set(allKeys.map(k => catalog[k][field]))) {
        const count = answer.filter(k => catalog[k][field] === value).length;
        const label = field === 'element' ? `${value}属性` : value;
        add({kind:'count',field,value,count}, `四件古物中，${label}恰好有 ${count} 件。`, ['element','fortune'].includes(field) ? 'accountant' : 'shopkeeper');
      }
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      add({kind:'before',field:'element',first:catalog[answer[a]].element,second:catalog[answer[b]].element},
        `${catalog[answer[a]].element}属性与${catalog[answer[b]].element}属性都入阵，前者在后者左边。`, 'accountant');
      add({kind:'same',field:'material',a,b,value:catalog[answer[a]].material === catalog[answer[b]].material},
        `第 ${a+1} 位和第 ${b+1} 位的材质${catalog[answer[a]].material === catalog[answer[b]].material ? '相同' : '不同'}。`, 'shopkeeper');
    }
    for (let i = 0; i < 4; i++) for (const field of ['element', 'material', 'type']) {
      const value = catalog[answer[i]][field];
      add({kind:'position',field,index:i,value}, `第 ${i+1} 位的${field === 'element' ? '五行' : field === 'material' ? '材质' : '器型'}是${value}。`, field === 'element' ? 'accountant' : 'shopkeeper');
    }
  }
  // Only true clues enter the pool. Each selected clue strictly narrows the candidates.
  const truePool = shuffle(pool.filter(rule => matches(rule, answer, level)), random);
  let candidates = permutations(allKeys);
  const rules = [];
  function take(rule) {
    rules.push(rule);
    candidates = candidates.filter(order => matches(rule, order, level));
  }
  if (level === 1) {
    take(pool[0]);
    if (difficulty !== 'expert') take(pool[1]);
  } else {
    // Both players must bring a useful clue to the table.
    for (const owner of ['accountant', 'shopkeeper']) {
      const rule = truePool.find(r => r.owner === owner && candidates.some(o => !matches(r, o, level)));
      if (rule) take(rule);
    }
  }
  while (candidates.length > 1) {
    const choices = truePool.filter(r => !rules.includes(r)).map(rule => ({
      rule, remaining: candidates.filter(o => matches(rule, o, level)).length
    })).filter(item => item.remaining > 0 && item.remaining < candidates.length);
    // Prefer relations in expert mode; other modes favor fewer, clearer clues.
    choices.sort((a, b) => {
      if (difficulty === 'expert') {
        const cost = r => r.kind === 'position' ? 1 : 0;
        if (cost(a.rule) !== cost(b.rule)) return cost(a.rule) - cost(b.rule);
      }
      return a.remaining - b.remaining;
    });
    if (!choices.length) throw new Error('谜题规则不能确定唯一答案');
    take(choices[0].rule);
  }
  const hints = answer.map((key, index) => ({
    kind:'position', field:'name', index, value:catalog[key].name,
    text:`第 ${index+1} 位是${catalog[key].name}。`, owner:'both'
  }));
  return { level, difficulty, allKeys, answer, rules, hints:shuffle(hints, random) };
}
function createGame(level, difficulty, random = Math.random) {
  return { puzzle:generate(level, difficulty, random), seq:[null,null,null,null], history:[], undo:[], revealed:[], status:'playing', revision:0 };
}
function feedback(seq, answer) {
  const positions = seq.map((key, index) => key === answer[index]);
  return { correct:positions.filter(Boolean).length, included:seq.filter(key => answer.includes(key)).length, positions };
}
function act(game, action) {
  if (game.status !== 'playing') return {error:'本局已经结束，可以再开一局。'};
  const {puzzle} = game;
  const settings = DIFFICULTIES[puzzle.difficulty];
  const remember = () => { game.undo.push([...game.seq]); if (game.undo.length > 40) game.undo.shift(); };
  switch (action.type) {
    case 'place': {
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3 || !puzzle.allKeys.includes(action.key)) return {error:'请选择有效位置和古物。'};
      const old = game.seq.indexOf(action.key);
      if (old === action.index) return {};
      remember();
      if (old >= 0) game.seq[old] = game.seq[action.index];
      game.seq[action.index] = action.key;
      break;
    }
    case 'remove':
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3 || !game.seq[action.index]) return {};
      remember(); game.seq[action.index] = null; break;
    case 'clear':
      if (!game.seq.some(Boolean)) return {};
      remember(); game.seq = [null,null,null,null]; break;
    case 'restore':
      if (!Number.isInteger(action.index) || !game.history[action.index]) return {error:'试答记录不存在。'};
      remember(); game.seq = [...game.history[action.index].seq]; break;
    case 'undo':
      if (game.undo.length) game.seq = game.undo.pop(); else return {};
      break;
    case 'hint':
      if (game.revealed.length >= settings.hints) return {error:'本局提示已用完。'};
      game.revealed.push(puzzle.hints[game.revealed.length]); break;
    case 'submit': {
      if (game.seq.some(key => !key)) return {error:'请先放满四个位置。'};
      if (game.history.some(row => row.seq.every((key,i) => key === game.seq[i]))) return {error:'这一组已经试过，不消耗机会。试着调整一下。'};
      const result = feedback(game.seq, puzzle.answer);
      game.history.push({seq:[...game.seq], correct:result.correct, included:result.included,
        ...(puzzle.difficulty === 'relaxed' ? {positions:result.positions} : {})});
      if (result.correct === 4) game.status = 'won';
      else if (game.history.length >= settings.attempts) game.status = 'lost';
      break;
    }
    default: return {error:'未知操作'};
  }
  game.revision++;
  return {changed:true};
}
function view(game, role, practice = false) {
  const {puzzle} = game;
  return {level:puzzle.level, difficulty:puzzle.difficulty, allKeys:puzzle.allKeys,
    rules:puzzle.rules.filter(rule => practice || rule.owner === role).map(({text,owner}) => ({text,owner})),
    seq:[...game.seq], history:game.history, revealed:game.revealed.map(({text}) => text), status:game.status,
    remaining:DIFFICULTIES[puzzle.difficulty].attempts - game.history.length,
    hintsRemaining:DIFFICULTIES[puzzle.difficulty].hints - game.revealed.length,
    canUndo:game.undo.length > 0, revision:game.revision,
    ...(game.status !== 'playing' ? {answer:puzzle.answer} : {})};
}
return {plants:ALL_PLANTS, relics:ALL_RELICS, difficulties:DIFFICULTIES, shuffle, permutations, matches, generate, createGame, act, feedback, view};
});
