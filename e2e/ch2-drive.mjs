// 第二章の合戦を本物の入力（PC：キーとマウス）で采配する小道具。e2e/story-video.mjs の ch2a の部で使う。
// e2e/ieyasu-ch2.mjs の battleIO（PC の入力の分）と driveTactic の写し（中身は同じ決まり。ieyasu-ch2.mjs はこれを使っていない）。
//
// 確認の種類：
//   - 本物の入力：札のクリックで部隊を選ぶ・「移動」→ 地面のクリック・敵の体のクリック（攻撃）・「能力」・全軍撤退と確認のクリック。
//   - 開発用の口（読むだけ・画面を寄せるだけ）：押す点を求める window.__battle.centerOn・screenOfGround・screenOf・labelHitAt、
//     命令の条件（chapter2/scripts.ts の作戦の行）をページの中で評価する。
//   - 早送り：合戦の待つ間だけ。指揮（一時停止）のまま window.__battle.fastForward(1) で 1 秒ずつ進める。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOVE_ECHO_GAP_MS = 650;

const bUi = (page) => page.evaluate(() => window.__battle.ui);
const bUnit = (page, id) => page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); return u && { id: u.id, name: u.name, x: u.x, z: u.z, status: u.status, order: u.order, strength: u.strength, start: u.startStrength, morale: u.morale, present: u.present }; }, id);
const bAb = (page, id) => page.evaluate((id) => { const r = window.__battle.state.abilities[id]; return r ? { usedAt: r.usedAt, until: r.until, targetId: r.targetId ?? null } : null; }, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
/** 押す前の控え（読むだけ）：能力の使用と、命令する部隊のほかの味方の命令 */
const cmdSnap = (page, id) => page.evaluate((id) => {
  const s = window.__battle.state;
  return {
    used: Object.fromEntries(s.abilityList.map((r) => [r.unitId, r.usedAt])),
    others: Object.fromEntries(s.units.filter((u) => u.side === 'ally' && u.id !== id).map((u) => [u.id, JSON.stringify(u.order)])),
  };
}, id);
const ordStr = (o) => (!o ? '?' : o.type === 'attack' ? `攻撃 ${o.targetId}` : o.type === 'move' ? `移動 (${o.x.toFixed(0)},${o.z.toFixed(0)})` : o.type);

/** PC の入力で合戦の命令を出す（ieyasu-ch2.mjs の battleIO と同じ。note は出力の関数） */
export function battleIO(page, note) {
  const names = {};
  let moveTapAt = 0;
  const D = { ground: 240, unit: 190 };
  const press = async (sel) => { await page.locator(sel).first().click(); await sleep(200); };
  const at = async (x, y) => { await page.mouse.click(x, y); await sleep(200); };
  const B = {
    counts: { move: 0, attack: 0, ability: 0, retreat: 0, hold: 0, allRetreat: 0 },
    issues: [],
    refused: [],
    async init() {
      Object.assign(names, Object.fromEntries(await page.evaluate(() => window.__battle.state.units.map((u) => [u.id, u.name]))));
    },
    async pause() {
      if ((await bUi(page)).paused) return;
      await page.keyboard.press('Space');
      await sleep(200);
      if (!(await bUi(page)).paused) throw new Error('指揮（一時停止）にできない');
    },
    async gap() {
      const d = Date.now() - moveTapAt;
      if (d < MOVE_ECHO_GAP_MS) await sleep(MOVE_ECHO_GAP_MS - d);
    },
    async select(id) {
      const u0 = await bUi(page);
      if (u0.selectedId === id && (u0.pending === 'none' || u0.pending === 'move')) return;
      await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
      await press(`.b-card[data-id="${id}"]`);
      const u = await bUi(page);
      if (u.selectedId !== id) throw new Error(`${names[id]} を札で選べない（${u.selectedId}）`);
    },
    async leaks(id, before, abilityOf = null) {
      const after = await cmdSnap(page, id);
      const bad = [];
      const usedDiff = Object.keys(after.used).filter((k) => after.used[k] !== before.used[k]);
      const want = abilityOf ? [abilityOf] : [];
      if (usedDiff.join() !== want.join()) bad.push(`能力の使用が変わった（${usedDiff.join(',') || 'なし'}）`);
      const od = Object.keys(before.others).filter((k) => after.others[k] !== before.others[k]);
      if (od.length) bad.push(`ほかの部隊の命令が変わった（${od.map((k) => `${k} → ${after.others[k]}`).join('・')}）`);
      if (bad.length) {
        B.issues.push(`${names[id]}：${bad.join('・')}`);
        note(`！${names[id]}：${bad.join('・')}`);
      }
    },
    /** 移動：札で選ぶ →「移動」→ 地面をクリック */
    async move(id, x, z) {
      const u0 = await bUnit(page, id);
      if (!u0 || u0.status !== 'ready') return true;
      await B.select(id);
      const before = await cmdSnap(page, id);
      if ((await bUi(page)).pending !== 'move') await press('.b-cmds .b-cmd:text-is("移動")');
      if ((await bUi(page)).pending !== 'move') {
        note(`${names[id]}：「移動」で移動先指定にならない（${(await bUi(page)).pending}）`);
        return false;
      }
      await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, D.ground]);
      await sleep(250);
      const g = await page.evaluate(([x, z]) => { const q = window.__battle.screenOfGround(x, z); const el = document.elementFromPoint(q.x, q.y); return { ...q, hit: String(el?.className ?? '') }; }, [x, z]);
      if (!g.hit.includes('b-input')) {
        note(`${names[id]}：地面 (${x}, ${z}) が画面の部品の下（${g.hit}）`);
        await press('.b-cmds .b-cmd:text-is("移動")');
        return false;
      }
      await B.gap();
      await at(g.x, g.y);
      moveTapAt = Date.now();
      const u = await bUnit(page, id);
      const now = await bUi(page);
      const tol = (await page.evaluate(async ([x, z]) => (await import('/src/battle/sim.ts')).passableAt(window.__battle.state, x, z), [x, z])) ? 4 : 25;
      if (u.order.type !== 'move' || Math.hypot(u.order.x - x, u.order.z - z) > tol) {
        const h = await hintText(page);
        B.refused.push(`${names[id]} 移動 (${x},${z}) → ${ordStr(u.order)}（${h}）`);
        note(`${names[id]} の移動が出なかった（${ordStr(u.order)}。${h}）`);
        if (now.pending === 'move') await press('.b-cmds .b-cmd:text-is("移動")');
        return false;
      }
      await B.leaks(id, before);
      B.counts.move++;
      return true;
    },
    /** 攻撃：札で選ぶ → 敵の体をクリック（ならなければ「攻撃」→ 体） */
    async attack(id, target) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      const tu = await bUnit(page, target);
      await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [tu.x, tu.z, D.unit]);
      await sleep(250);
      const ok = async () => { const o = (await bUnit(page, id)).order; return o.type === 'attack' && o.targetId === target; };
      const tries = [[0, 0], [0, 8], [10, 0], [-10, 0], [0, -8], [0, 14]];
      for (let k = 0; k < tries.length; k++) {
        const p = await page.evaluate(([t, dx, dy]) => {
          const q = window.__battle.screenOf(t);
          if (!q) return null;
          const x = q.x + dx;
          const y = q.y + dy;
          const el = document.elementFromPoint(x, y);
          return { x, y, hit: String(el?.className ?? ''), label: window.__battle.labelHitAt(x, y) };
        }, [target, ...tries[k]]);
        if (!p || !p.hit.includes('b-input') || p.label) continue;
        if (k > 0) {
          await B.select(id);
          await press('.b-cmds .b-cmd:text-is("攻撃")');
        }
        await B.gap();
        await at(p.x, p.y);
        if (await ok()) {
          await B.leaks(id, before);
          B.counts.attack++;
          return true;
        }
      }
      const o = (await bUnit(page, id)).order;
      B.refused.push(`${names[id]} → ${names[target]} 攻撃にならない（${ordStr(o)}。${await hintText(page)}）`);
      note(`${names[id]} → ${names[target]} の攻撃が出なかった（${ordStr(o)}。${await hintText(page)}）`);
      return false;
    },
    async ability(id, { target = null } = {}) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      const b0 = await bAb(page, id);
      await press('.b-abil-btn');
      await sleep(150);
      if (target) {
        if ((await bUi(page)).pending !== 'ability') return false;
        const tu = await bUnit(page, target);
        await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [tu.x, tu.z, D.unit]);
        await sleep(250);
        const p = await page.evaluate((t) => window.__battle.screenOf(t), target);
        await at(p.x, p.y);
      }
      const r = await bAb(page, id);
      if (!r || r.usedAt === null || (b0 && b0.usedAt !== null)) return false;
      await B.leaks(id, before, id);
      B.counts.ability++;
      return true;
    },
    async simple(id, label, type) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      await press(`.b-cmds .b-cmd:text-is("${label}")`);
      const u = await bUnit(page, id);
      if (u.order.type !== type) return false;
      await B.leaks(id, before);
      B.counts[type]++;
      return true;
    },
    retreat: (id) => B.simple(id, '撤退', 'retreat'),
    hold: (id) => B.simple(id, '防衛・待機', 'hold'),
    /** 全軍撤退（クリック）→ 確認の「撤退する」（クリック） */
    async allRetreat() {
      await press('.b-allret');
      await page.locator('.b-confirm').waitFor({ state: 'visible' });
      await sleep(300);
      await press('.b-confirm .b-btn:has-text("撤退する")');
      const ok = (await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null;
      if (ok) B.counts.allRetreat++;
      return ok;
    },
    summary() {
      const c = B.counts;
      return `移動 ${c.move}・攻撃 ${c.attack}・能力 ${c.ability}・撤退 ${c.retreat}・防衛 ${c.hold}・全軍撤退 ${c.allRetreat}`;
    },
  };
  return B;
}

/**
 * 第二章の作戦（chapter2/scripts.ts の CH2_TACTICS[policy] の id。揺らぎなし CH2_J0）の行を、ページの中で条件だけ評価し（読むだけ）、
 * 命令は画面の入力で出す（ieyasu-ch2.mjs の driveTactic と同じ決まり）。止めたまま 1 秒ずつ早送りする。
 */
export async function driveTactic(page, B, policy, tid, note, { maxSec = 900 } = {}) {
  const n = await page.evaluate(async ([policy, tid]) => {
    const m = await import('/src/campaign/ieyasu1570/chapter2/scripts.ts');
    const sim = await import('/src/battle/sim.ts');
    const t = m.CH2_TACTICS[policy].find((x) => x.id === tid);
    const setup = window.__battle.state.setup;
    const has = (id) => setup.units.some((u) => u.id === id);
    const use = t.steps(m.CH2_J0).filter(([, id, cmd]) => cmd === 'allRetreat' || has(id));
    const timed = use.filter((x) => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = use.filter((x) => typeof x[0] === 'function');
    const D = { timed, watch, fired: new Set(), cursor: 0 };
    const resolve = (label, id, cmd, s) => {
      if (cmd === 'allRetreat') return { label, kind: 'allRetreat' };
      if (cmd === 'nearest') {
        const o = m.nearestEnemyOrder(s, id);
        return o ? { label, id, kind: 'attack', target: o.targetId } : { label, id, kind: 'skip', why: '当てる敵が無い・今の相手が戦える' };
      }
      const u = sim.unitById(s, id);
      if (!u || !sim.isActive(u) || !u.arrived) return { label, id, kind: 'skip', why: '戦えない・まだ着いていない' };
      if (cmd === 'ability') return { label, id, kind: 'ability' };
      if (typeof cmd === 'object' && 'abilityOn' in cmd) return { label, id, kind: 'abilityOn', target: cmd.abilityOn };
      if (typeof cmd === 'object' && 'tap' in cmd) {
        const o = m.tapOrder(s, cmd.tap);
        return o.type === 'attack' ? { label, id, kind: 'attack', target: o.targetId } : { label, id, kind: 'move', x: o.x, z: o.z };
      }
      if (cmd.type === 'attack') {
        const tu = sim.unitById(s, cmd.targetId);
        if (!tu || !sim.isActive(tu) || (tu.side === 'enemy' && !tu.seenBy.ally)) return { label, id, kind: 'skip', why: `相手 ${cmd.targetId} が崩れた・見えていない` };
        return { label, id, kind: 'attack', target: cmd.targetId };
      }
      if (cmd.type === 'move') return { label, id, kind: 'move', x: cmd.x, z: cmd.z };
      return { label, id, kind: cmd.type };
    };
    D.next = () => {
      const s = window.__battle.state;
      while (D.timed.length && s.t >= D.timed[0][0] - 1e-9) {
        const [t, id, cmd] = D.timed.shift();
        return resolve(`${t}s`, id, cmd, s);
      }
      for (let i = D.cursor; i < D.watch.length; i++) {
        if (D.fired.has(i)) continue;
        if (!D.watch[i][0](s)) continue;
        D.fired.add(i);
        D.cursor = i + 1;
        return resolve(`見て#${i}`, D.watch[i][1], D.watch[i][2], s);
      }
      D.cursor = D.watch.length;
      return null;
    };
    window.__ch2drive = D;
    return use.length;
  }, [policy, tid]);
  note(`作戦 ${policy}/${tid} の行 ${n}（chapter2/scripts.ts。条件はページの中で評価・命令は画面の入力）`);
  const log = [];
  const skipped = [];
  let t = 0;
  let t0 = null;
  for (let i = 0; i < maxSec; i++) {
    const s0 = await page.evaluate(() => { const s = window.__battle.state; window.__ch2drive.cursor = 0; return { t: s.t, result: !!s.result }; });
    t = s0.t;
    if (t0 === null) t0 = t;
    if (s0.result) break;
    for (let k = 0; k < 60; k++) {
      const c = await page.evaluate(() => window.__ch2drive.next());
      if (!c) break;
      let ok = true;
      if (c.kind === 'skip') { skipped.push(`${t.toFixed(0)}s ${c.label} ${c.id}：${c.why}`); continue; }
      if (c.kind === 'move') ok = await B.move(c.id, c.x, c.z);
      else if (c.kind === 'attack') ok = await B.attack(c.id, c.target);
      else if (c.kind === 'ability') ok = await B.ability(c.id);
      else if (c.kind === 'abilityOn') ok = await B.ability(c.id, { target: c.target });
      else if (c.kind === 'allRetreat') ok = await B.allRetreat();
      else if (c.kind === 'retreat') ok = await B.retreat(c.id);
      else if (c.kind === 'hold') ok = await B.hold(c.id);
      log.push(`${t.toFixed(0)}s ${c.id ?? ''} ${c.kind}${c.kind === 'move' ? ` (${c.x.toFixed(0)},${c.z.toFixed(0)})` : c.target ? ` ${c.target}` : ''}${ok ? '' : '（出せず）'}`);
    }
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、止めたまま 1 秒ずつ進めた。命令（本物の入力）：${log.join('、')}`);
  if (skipped.length) note(`出さなかった行（台本と同じ決まり）：${skipped.join('、')}`);
  return { log, skipped };
}

/** 命令を出さずに（または出した後に）、止めたまま 1 秒ずつ結果まで早送りする */
export async function fastForwardToResult(page, note, what, maxSec = 900) {
  let t0 = null;
  let t = 0;
  for (let i = 0; i < maxSec; i++) {
    const s = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
    if (t0 === null) t0 = s.t;
    t = s.t;
    if (s.result) break;
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）${what}：合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、指揮（一時停止）のまま 1 秒ずつ進めた`);
}
