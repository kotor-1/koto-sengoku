/**
 * 軍議の背景の見せ方（Version 26：表示の倍率で決める・1.25 倍を超える画面は範囲を限る）の確かめ（開発サーバー。本物の素材 manifest.gen.json）。
 *
 *   BASE=http://127.0.0.1:8743 node e2e/council-bg-v26.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     SIZES=1920x1080@1,1920x1080@2,2560x1440@1,1366x768@1,1280x720@1,1024x1366@2,844x390@2,844x390@3,667x375@2,568x320@2,390x844@2,390x844@3,412x915@3,360x640@2
 *                幅x高さ@端末の画素の比。高さ 430 以下・幅 480 以下はタッチ（hasTouch・isMobile）。それ以外はマウスとキー
 *     MODES=default,artoff   default … 何も付けない（Version 26）、artoff … ?artOff=council（背景だけ外す＝Version 24 と同じ軍議の画面。比べの元）
 *     PAR=3                  同時に動かすブラウザの数
 *     CONTRAST=1             文字を隠した写真（-notext.jpg）も撮る（文字の後ろの明るさを測る写真。四角は report.json の同じ行。測る道具はリポジトリに入れていない）
 *
 * 流れ（第一章）：タイトル → はじめから → 演出のスキップ → 織田の使者 → 城門の忠勝 → 「軍議を開く」→ 軍議（地の文・忠勝・家康・酒井・石川・方針の選択肢）。
 *   選択肢は決めない（並びを撮るだけ）。
 * 入力の記録（report.json の steps）：タイトルのボタン・演出のスキップ・話す（E／「話す」のタップ）・行送り（Enter／枠のタップ）・選択肢（クリック／タップ）は本物の入力。
 *   開発用の操作（__game・__p3）：相手の前への teleport・3D の手動の描画（render=manual の renderNow）・読むだけの数え上げ。
 *   背景の寸法は開発ビルドだけの .g-council-bg の data-probe（本番には無い）。
 * 確かめ：
 *   - default：どの画面でも背景を出す（端末の比で外さない）。表示の倍率 ＝ min(画面を埋める倍率, 1.25)。縦横同じ倍率（引き伸ばさない）。
 *     1.25 を超える画面は、画面より小さく真ん中に描く（周りは暗い地）。canvas の画素は元の画像の画素まで。canvas の四角は記録どおり。
 *   - default と artoff で、台詞の枠・名前・台詞・選択肢・軍議の見出し・立ち絵・台詞の枠の顔の四角が同じ（背景で立ち絵・顔・文字の大きさが変わらない）。
 *   - artoff：背景の要素が無い・画像を読まない。どちらもページの誤りが無い。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8743';
const OUT = resolve(process.argv[2] || 'e2e-out/council-bg-v26');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = list(process.env.SIZES, '1920x1080@1,1920x1080@2,2560x1440@1,1366x768@1,1280x720@1,1024x1366@2,844x390@2,844x390@3,667x375@2,568x320@2,390x844@2,390x844@3,412x915@3,360x640@2');
const MODES = list(process.env.MODES, 'default,artoff');
const PAR = Math.max(1, Number(process.env.PAR || 3));
const CONTRAST = process.env.CONTRAST === '1';
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const POLL = { timeout: 600000, polling: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const checks = [];
const check = (ok, what, detail) => {
    checks.push({ ok: !!ok, what, detail });
    if (!ok) console.log(`  NG ${what}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
};
const manifest = JSON.parse(readFileSync(new URL('../proto3d/src/art/manifest.gen.json', import.meta.url), 'utf8')).assets;
/** ui/artCanvas.ts の COUNCIL_ART と同じ値（ここで別に計算して比べる） */
const S_MAX = 1.25;
const MAX_CROP_Y = 0.18;

/** 画面を埋める（cover・上下 18% まで切る）のに要る表示の倍率（councilArtLayout の need と同じ式） */
function needScale(vw, vh) {
    const e = manifest['bg.council'];
    const keep = 1 - 2 * MAX_CROP_Y;
    return Math.min(Math.max(vw / e.w, vh / e.h), vh / (e.h * keep));
}

/** 一番上の会話の層の四角と背景の記録（読むだけ） */
function probe() {
    const R = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const vbox = (e) => {
        if (!e || e.hidden) return null;
        const cs = getComputedStyle(e);
        if (cs.display === 'none') return null;
        return R(e);
    };
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    const d = L.querySelector('.g-dialog');
    const ch = L.querySelector('.g-choices');
    const head = L.querySelector('.g-council-head');
    const bg = L.querySelector('.g-council-bg');
    const base = bg?.querySelector('canvas.g-council-bg-base') ?? null;
    const pc = L.querySelector('canvas.g-portrait');
    const pShown = !!pc && !pc.hidden && pc.classList.contains('on');
    const f = d.querySelector('canvas.g-face');
    const fShown = !!f && !f.hidden && getComputedStyle(f).display !== 'none';
    return {
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        speaker: d.dataset.speaker,
        council: L.classList.contains('council'),
        dialog: R(d),
        name: R(d.querySelector('.name')),
        text: R(d.querySelector('.text')),
        textFont: getComputedStyle(d.querySelector('.text')).fontSize,
        choices: vbox(ch),
        choiceRects: ch && !ch.hidden ? [...ch.querySelectorAll('.g-choice')].map((b) => ({ id: b.dataset.id, ...R(b) })) : [],
        head: vbox(head),
        headH2: head ? R(head.querySelector('h2')) : null,
        headP: head ? R(head.querySelector('p')) : null,
        portrait: pShown ? { id: pc.dataset.artId, ...R(pc) } : null,
        face: fShown ? { id: f.dataset.artId, compact: f.classList.contains('compact'), ...R(f) } : null,
        bg: bg
            ? {
                  hidden: bg.hidden,
                  on: bg.classList.contains('on'),
                  first: L.firstElementChild === bg,
                  bgColor: getComputedStyle(bg).backgroundColor,
                  probe: bg.dataset.probe ? JSON.parse(bg.dataset.probe) : null,
                  base: base ? { id: base.dataset.artId, px: [base.width, base.height], rect: R(base) } : null,
                  front: !!bg.querySelector('canvas.g-council-bg-front'),
              }
            : null,
        gArt: L.classList.contains('g-art'),
        bodyArt: document.body.classList.contains('g-council-art'),
    };
}

async function newPage(browser, size, mode) {
    const [wh, dprS] = size.split('@');
    const [w, h] = wh.split('x').map(Number);
    const dpr = Number(dprS || 1);
    const touch = h <= 430 || w <= 480;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    await ctx.addInitScript(() => performance.setResourceTimingBufferSize(100000));
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    const art = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/GPU stall|GL Driver/.test(m.text())) errors.push(m.text());
    });
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (/^\/art\//.test(p)) art.push(p);
    });
    const q = ['render=manual', mode === 'artoff' ? 'artOff=council' : ''].filter(Boolean).join('&');
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, touch, errors, art, w, h, dpr };
}

const report = { base: BASE, sizes: SIZES, modes: MODES, sMax: S_MAX, runs: [] };

async function run(browser, size, mode) {
    const rec = { size, mode, steps: [], lines: [], shots: [] };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${mode} ${size} ${how}: ${what}`);
    };
    const { ctx, page, touch, errors, art } = await newPage(browser, size, mode);
    const tag = `${mode}-${size.replace('@', 'at')}`;
    const press = async (loc) => {
        if (touch) await loc.tap();
        else await loc.click();
    };
    const shot = async (name) => {
        await page.evaluate(() => window.__p3?.renderNow?.());
        await sleep(250);
        const file = `${SHOTS}/${tag}-${name}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 80, timeout: 600000 });
        rec.shots.push(file);
        if (CONTRAST) {
            // 文字を隠した写真（文字の後ろの明るさを測る。四角は rec.lines の同じ行）
            await page.addStyleTag({ content: '.g-council-head h2,.g-council-head p,.g-dialog .name,.g-dialog .text,.g-choice,.g-choice *{color:transparent!important;text-shadow:none!important}' }).then((h) => h.evaluate((e) => e.setAttribute('data-hide', '1')));
            await sleep(120);
            const f2 = `${SHOTS}/${tag}-${name}-notext.jpg`;
            await page.screenshot({ path: f2, type: 'jpeg', quality: 95, timeout: 600000 });
            await page.evaluate(() => document.querySelectorAll('style[data-hide]').forEach((e) => e.remove()));
            rec.shots.push(f2);
        }
    };
    await sleep(450);
    await press(page.locator('.g-btn[data-id="new:ieyasu1570"]'));
    step('real', 'はじめから（歴史分岐）');
    await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(600);
    const talkTo = async (id) => {
        const cast = await page.evaluate(() => window.__game.cast);
        const c = cast.find((x) => x.id === id);
        if (!c) throw new Error(`${id} が城下に居ない`);
        let ok = false;
        for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0]]) {
            await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x + dx, c.z + dz]);
            ok = await page.waitForFunction((t) => window.__game.prompt === t, id, { timeout: 15000, polling: 100 }).then(() => true, () => false);
            if (ok) break;
        }
        if (!ok) throw new Error(`${id} の「話す」が出ない`);
        step('dev API', `__game.teleport で ${id} の前へ`);
        await sleep(450);
        if (touch) await page.locator('.g-talk').tap();
        else await page.keyboard.press('KeyE');
        step('real', `話す（${touch ? '「話す」をタップ' : 'E キー'}）`);
        await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
    };
    const settle = async () => {
        // 立ち絵の読み込み・出入りの重ね変わり（140ms）・背景の出る 220ms を待つ
        await page
            .waitForFunction(
                () => {
                    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                    const sp = L?.querySelector('.g-dialog')?.dataset.speaker;
                    const want = { hero: 'ieyasu', tadakatsu: 'tadakatsu', sakai: 'sakai', ishikawa: 'ishikawa' }[sp];
                    if (!want || /artOff=[^&]*portrait|art=(v24|old)/.test(location.search)) return true;
                    return performance.getEntriesByType('resource').some((e) => e.name.includes(`/art/portraits/${want}_v2.webp`));
                },
                null,
                { timeout: 6000, polling: 100 },
            )
            .catch(() => {});
        await sleep(450);
    };
    const readScript = async (label, shotAt = {}) => {
        const id = (await page.evaluate(() => window.__game.ui?.id)) ?? '?';
        const seen = new Set();
        for (let k = 0; k < 80; k++) {
            await sleep(200);
            const u = await page.evaluate(() => window.__game.ui);
            if (u?.kind !== 'script' || u.id !== id) break;
            await settle();
            const p = await page.evaluate(probe);
            const sk = `${p.speaker}${u.choices?.length ? '+choices' : ''}`;
            const line = { script: id, index: u.index, key: sk, ...p };
            rec.lines.push(line);
            if (shotAt[sk] && !seen.has(sk)) {
                seen.add(sk);
                await shot(`${label}-${shotAt[sk]}`);
            }
            if (u.choices?.length) break;
            if (touch) await page.locator('.g-layer[data-kind="script"] .g-dialog').last().tap();
            else await page.keyboard.press('Enter');
        }
        step('real', `${label}（${id}）を ${touch ? '枠のタップ' : 'Enter'} で進めた`);
        return id;
    };
    const choose = async (cid) => {
        await sleep(450);
        await press(page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${cid}"]`).last());
        step('real', `選ぶ ${cid}（${touch ? 'タップ' : 'クリック'}）`);
    };
    await talkTo('oda_envoy');
    await readScript('envoy');
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(400);
    await talkTo('tadakatsu');
    await readScript('gate');
    await choose('open_council');
    await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council', null, POLL);
    await sleep(600);
    await readScript('council', { narration: 'narration', sakai: 'sakai', ishikawa: 'ishikawa', 'tadakatsu+choices': 'choices', 'hero+choices': 'choices', 'ishikawa+choices': 'choices', 'sakai+choices': 'choices' });
    rec.art = [...new Set(art)];
    rec.errors = errors.filter((e) => !/\[art\]/.test(e));
    await ctx.close();
    return rec;
}

const near = (a, b, tol = 0.6) => (a === null && b === null) || (!!a && !!b && ['l', 't', 'r', 'b'].every((k) => Math.abs(a[k] - b[k]) <= tol));

function verify(rec) {
    const tag = `${rec.mode} ${rec.size}`;
    check(rec.errors.length === 0, `${tag}：ページの誤りが無い`, rec.errors.slice(0, 3));
    const council = rec.lines.filter((l) => l.script === 'council');
    check(council.length >= 5, `${tag}：軍議の行を読んだ（${council.length} 行）`);
    for (const p of council) {
        const L = `${tag} council#${p.index + 1}(${p.key})`;
        check(p.textFont === `${p.vh <= 430 ? 15 : 16}px`, `${L} 台詞の字は ${p.vh <= 430 ? 15 : 16}px`, p.textFont);
        if (rec.mode === 'artoff') {
            check(!p.bg && !p.gArt && !p.bodyArt, `${L} ?artOff=council：背景の要素が無い（Version 24 の軍議の画面）`, p.bg);
            continue;
        }
        const need = needScale(p.vw, p.vh);
        const want = Math.min(need, S_MAX);
        const showing = !!p.bg && !p.bg.hidden && p.bg.on && p.gArt;
        check(showing, `${L} 背景を出す（画面を埋める倍率 ${need.toFixed(3)}・端末の比 ${p.dpr} でも外さない）`, p.bg);
        if (!showing) continue;
        const pr = p.bg.probe;
        check(!!pr, `${L} 開発用の記録（data-probe）がある`, p.bg);
        if (!pr) continue;
        const e = manifest['bg.council'];
        check(pr.file[0] === e.w && pr.file[1] === e.h, `${L} 元の画像は ${e.w}×${e.h}（一覧と同じ。1920 幅の原画ではない）`, pr.file);
        check(Math.abs(pr.need - need) < 0.002 && Math.abs(pr.scale - want) < 0.002, `${L} 表示の倍率 ${want.toFixed(3)}（埋める倍率 ${need.toFixed(3)}・上限 ${S_MAX}）`, pr);
        check(pr.limited === need > S_MAX + 1e-9, `${L} 範囲を限るのは埋める倍率が ${S_MAX} を超える画面だけ`, pr);
        const [sx, sy, sw, sh] = pr.src;
        const [dx, dy, dw, dh] = pr.css;
        check(Math.abs(dw / sw - dh / sh) < 0.003 && Math.abs(dw / sw - pr.scale) < 0.003, `${L} 縦横同じ倍率（引き伸ばさない）`, pr);
        check(sx >= -0.01 && sy >= -0.01 && sx + sw <= e.w + 0.01 && sy + sh <= e.h + 0.01, `${L} 切り出しは画像の中`, pr.src);
        check(dx >= -0.01 && dy >= -0.01 && dx + dw <= p.vw + 0.6 && dy + dh <= p.vh + 0.6, `${L} 描く所は画面の中`, pr.css);
        if (pr.limited) check(Math.abs(dx - (p.vw - dw) / 2) < 0.6 && Math.abs(dy - (p.vh - dh) / 2) < 0.6 && (dx > 0.5) === pr.feather[0] > 0 && (dy > 0.5) === pr.feather[1] > 0, `${L} 範囲を限った絵は真ん中で、帯のある向きの縁をなじませる`, pr);
        else check((dw >= p.vw - 0.6 && dh >= p.vh - 0.6) || (dx > 0 && dh >= p.vh - 0.6), `${L} 範囲を限らない画面は埋める（とても横長だけ左右に帯）`, pr);
        const b = p.bg.base;
        check(!!b && near(b.rect, { l: dx, t: dy, r: dx + dw, b: dy + dh }, 0.6), `${L} canvas の四角は記録どおり`, { rect: b?.rect, css: pr.css });
        check(!!b && b.px[0] <= Math.ceil(sw) + 1 && b.px[1] <= Math.ceil(sh) + 1, `${L} canvas の画素は元の画像の切り出しまで（${b?.px}・切り出し ${Math.round(sw)}×${Math.round(sh)}）`, b?.px);
        check(!!b && Math.abs(b.px[0] / b.px[1] - dw / dh) < 0.01, `${L} canvas の縦横の比は描く所と同じ`, b?.px);
        check(p.bg.first && p.bg.base?.id === 'bg.council', `${L} 背景は層のいちばん奥・昼の軍議所`, p.bg);
        check(/rgb\(14, 12, 10\)/.test(p.bg.bgColor), `${L} 周りの地は暗い色`, p.bg.bgColor);
    }
    if (rec.mode === 'artoff') check(!rec.art.some((x) => x.includes('/story/')), `${tag} ?artOff=council：背景の画像を読まない`, rec.art);
    else check(rec.art.includes('/art/story/council_day.webp'), `${tag} 背景の画像を読む`, rec.art);
}

function compare(def, off) {
    const tag = `${def.size}`;
    const A = def.lines.filter((l) => l.script === 'council');
    const B = off.lines.filter((l) => l.script === 'council');
    check(A.length === B.length, `${tag} default と artoff で同じ行を通る（${A.length}・${B.length}）`);
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
        const a = A[i];
        const b = B[i];
        const L = `${tag} council#${a.index + 1}(${a.key})`;
        check(a.key === b.key, `${L} 同じ話し手`, [a.key, b.key]);
        for (const k of ['dialog', 'name', 'text', 'choices', 'head', 'headH2', 'headP']) check(near(a[k], b[k]), `${L} ${k} の四角が背景の有無で変わらない`, { def: a[k], off: b[k] });
        check(a.choiceRects.length === b.choiceRects.length && a.choiceRects.every((r, j) => near(r, b.choiceRects[j])), `${L} 選択肢の四角が背景の有無で変わらない`);
        check(near(a.portrait, b.portrait) && (a.portrait?.id ?? null) === (b.portrait?.id ?? null), `${L} 立ち絵の有無と四角が背景の有無で変わらない`, { def: a.portrait, off: b.portrait });
        check(near(a.face, b.face) && (a.face?.id ?? null) === (b.face?.id ?? null), `${L} 台詞の枠の顔の有無と四角が背景の有無で変わらない`, { def: a.face, off: b.face });
    }
}

const browser = await launchBrowser();
const jobs = [];
for (const size of SIZES) for (const mode of MODES) jobs.push({ size, mode });
const results = [];
let next = 0;
async function worker() {
    while (next < jobs.length) {
        const j = jobs[next++];
        log(`start ${j.mode} ${j.size}`);
        try {
            const rec = await run(browser, j.size, j.mode);
            results.push(rec);
            verify(rec);
        } catch (e) {
            check(false, `${j.mode} ${j.size}：最後まで進めた`, String(e?.stack || e).slice(0, 400));
        }
        log(`done ${j.mode} ${j.size}`);
    }
}
await Promise.all(Array.from({ length: PAR }, worker));
await browser.close();
for (const size of SIZES) {
    const d = results.find((r) => r.size === size && r.mode === 'default');
    const o = results.find((r) => r.size === size && r.mode === 'artoff');
    if (d && o) compare(d, o);
}
report.runs = results;
const table = SIZES.map((size) => {
    const d = results.find((r) => r.size === size && r.mode === 'default');
    const p = d?.lines.find((l) => l.script === 'council' && l.bg?.probe)?.bg?.probe ?? null;
    return { size, shown: !!p, need: p?.need ?? null, scale: p?.scale ?? null, limited: p?.limited ?? null, src: p?.src ?? null, css: p?.css ?? null, device: p?.device ?? null, deviceScale: p?.deviceScale ?? null, canvas: p?.canvas ?? null, feather: p?.feather ?? null };
});
report.table = table;
report.checks = checks;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const ng = checks.filter((c) => !c.ok);
log(`checks ${checks.length - ng.length}/${checks.length} OK`);
for (const t of table) log(`  ${t.size}: shown=${t.shown} need=${t.need} scale=${t.scale} limited=${t.limited} css=${JSON.stringify(t.css)} device=${JSON.stringify(t.device)} canvas=${JSON.stringify(t.canvas)}`);
process.exit(ng.length ? 1 : 0);
