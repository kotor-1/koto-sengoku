/**
 * 合戦の画面のつなぎ。import すると app/modes.ts に合戦の始め方（registerBattleRunner）を登録する。
 *
 *   const outcome = await getBattleRunner()!(setup);   // 章の進行（campaign）・開発の確認（?dev=battle）から
 *
 * 1 回の合戦（BattleRun）でしていること：
 * - 探索と同じ描画器で、別の場面（view.ts）を描く。場面に入る（enterMode('battle')）と探索の入力・描画は止まる。
 * - 合戦の計算（sim.ts）を進める。指揮（一時停止）中は進めない（命令は出せる）。速さ ×1・×2。
 * - 画面の部品（battleUi.ts）：部隊の札・命令のボタン・条件・知らせ・説明・確かめ・結果。
 * - 入力（docs/design-policy.md の入力の決まりにならう）：
 *   - 地図：1 本指・左ドラッグで動かす、2 本指・ホイール・ボタンで寄る／引く。押して離す（動かさない）と「押した」扱い。
 *   - 指を離した・キャンセル・捕捉が外れたら、その指の操作は終わり（触り直すまで再開しない）。
 *   - 画面を離れた（blur・visibilitychange・pagehide）ら、自動で指揮（一時停止）にして入力を離す。
 *   - キー：Space 指揮／再開、1〜8 部隊（札の順）、M 移動・A 攻撃・H 防衛・待機・R 撤退、Esc 取り消し、矢印で地図、+ − 0 で寄る・引く・全体。
 *     特殊能力のある合戦（歴史分岐・演習）は F（または「能力」）で選んだ部隊の能力を使う。援護・差配（対象を選ぶ能力）は、その後で味方の部隊・札を押す。
 *     不適切な対象は理由を出すだけで回数を減らさない（abilities.ts の useAbility が確かめる）。指揮中（一時停止）も使える。
 * - 特殊能力の発動 UI（設計 §4）：発動できる武将の名札を点滅させ（表示の時計 realT。一時停止中も）、点滅している名札の能力の印（◆号令など）を押すと、
 *   対象の要らない能力はその場で使い、対象の要る能力は対象選びに入る（その後で対象を押す。地面・Esc・同じ名札でやめる）。
 *   名札の当たり判定は見た目より少し広い（PC 36 px・スマホ 48 px 四方。隣の部隊の中心より外へは広げない。control.ts の labelHit）。
 *   名札を押した操作はその場で使い切り（地面の移動・部隊の選択に回さない）、使った直後 0.5 秒は同じ所のタップを何もしない（連打の 2 回目も漏らさない。続けて押す間は延ばす）。
 * - 選んでいる部隊は id の並び（selection。今は 0 か 1 部隊）で持ち、命令は control.ts の orderUnits で並びの部隊へ出す
 *   （複数の選択・部隊のまとまりは、この並びを広げれば足せる）。
 * - 戦前の約束（BattleSetup.pledge）：対象の部隊の名札を目立たせ、南の「味方の陣」を地図に描き、条件の欄に進み具合、結果の画面に勝敗と別に結果を出す。
 * - 合戦場のデータの戦場（fields/ の buildBattleSetup）：目標の区域・援軍の出る所・狭い正面を地図に描き（view.ts）、名札（control.ts の mapLabels）、
 *   目標の欄に進み具合、結果の画面に主目標・副目標を勝敗・約束と別の行で出す。
 * - 結果を出し、「続ける」で後片付け（形・材質・画像・DOM・listener）をして探索へ戻り（exitMode）、結果を返す。
 * - 生成イラスト素材の地面（Version 22。groundArt.ts）：表示を作った後で、その戦場の素材（FIELD_ART）を 4 枚とも読めたら view.setGroundArt で使う。
 *   旧表示（?art=old）・素材の一覧に無い・1 枚でも読めないときは何もしない（Version 21 と同じ地面・同じ開始のボタンの時）。
 *   素材は木が済んでから ART_WAIT_MS まで待ち、開始のボタンを出した後に届いた物は使わない（合戦の途中で地面を差し替えない）。
 *   合戦の計算・押す判定には関わらない。
 */
import { appContext, enterMode, exitMode, registerBattleRunner, type AppContext, type Mode } from '../app/modes';
import { audio } from '../audio';
import { loadModel } from '../app/models';
import type { BattleOutcome, BattleRunHooks, BattleSetup, Order } from './types';
import { canCommand, createBattle, elevationAt, isActive, issueOrder, meleeUnreachable, orderAllRetreat, stepBattle, unitById, waitReason, type BattleEvent, type BattleState } from './sim';
import { BattleView } from './view';
import { ART_WAIT_MS, BriefingGate, fieldArtWanted, loadFieldArt, takeGroundArt } from './groundArt';
import { nightLabels } from './night';
import { withdrawalNote } from './objectives';
import { BattleUi, type CommandKind } from './battleUi';
import { abilityEffectTargets, abilityInfo, useAbility } from './abilities';
import {
    RESULT_LABEL,
    LABEL_HIT_PX,
    TAP_GUARD_SEC,
    abilitiesUsedText,
    abilityBlink,
    abilityEndText,
    abilityNoticeModel,
    abilityPanelModel,
    armDecision,
    armLive,
    commandableIds,
    eventTone,
    fmtClock,
    guardTap,
    moveEchoDecision,
    MOVE_ECHO_SEC,
    type MoveEcho,
    labelAbilityModel,
    labelHit,
    labelTapCandidates,
    labelTopAt,
    leadOf,
    mapLabels,
    objectiveResultModel,
    objectiveUnitMarks,
    orderUnits,
    orderUnitsText,
    pledgeResultModel,
    pruneSelection,
    refusalText,
    resolveLabelTap,
    resolveTap,
    faceOrder,
    resultRows,
    scenarioTexts,
    selectOnly,
    selectedOf,
    unitMarksText,
    type AbilityArm,
    type LabelBox,
    type LabelCover,
    type MapLabel,
    type Pending,
    type ScreenMark,
    type Selected,
    type TapGuard,
    type TapTarget,
} from './control';

/** 木の読み込みを待つ最長（これを過ぎたら円すいの木のまま始められる） */
const TREE_TIMEOUT_MS = 12000;
/** 押したとみなす指・マウスの動きの上限（px） */
const TAP_SLOP = { touch: 12, mouse: 6 };
/**
 * 部隊「そのもの」を押したとみなす最小の半径（px。隊列の広がりが画面でこれより大きければ、そちら）。
 * これより外で、押しやすくするための余白（タッチ 30 px・マウス 20 px）の中は「すぐ近く」（control.ts の resolveTap の near）。
 */
const TAP_EXACT_PX = { touch: 16, mouse: 10 };
/** 確かめの 2 回目を「同じ所」とみなす、押した所の下の地面のずれの上限（m）。地図を動かした後の同じ画面の点は別の所として扱う */
const ARM_SAME_GROUND_M = 4;
/** カメラの距離が「全体」のこの割合より遠いとき、名札を小さく薄くする（兵士の群れを覆いすぎないように） */
const LABELS_FAR_RATIO = 0.8;

let current: BattleRun | null = null;

/**
 * 合戦を始めて、「続ける」を押したら結果を返す。
 * 勝ち負けが決まった時（結果の画面を出す前）に hooks.onDecided を 1 回だけ呼び、返った文（保存の結果）を結果の画面に出す。
 */
export function runBattle(setup: BattleSetup, hooks: BattleRunHooks = {}): Promise<BattleOutcome> {
    if (current) return Promise.reject(new Error('合戦はすでに始まっています'));
    return new Promise<BattleOutcome>((resolve, reject) => {
        try {
            current = new BattleRun(setup, hooks, (o) => {
                current = null;
                resolve(o);
            });
        } catch (e) {
            current = null;
            reject(e);
        }
    });
}
registerBattleRunner(runBattle);

interface Ptr {
    id: number;
    type: string;
    button: number;
    sx: number;
    sy: number;
    x: number;
    y: number;
    moved: boolean;
}

class BattleRun implements Mode {
    readonly s: BattleState;
    readonly view: BattleView;
    readonly ui: BattleUi;
    private readonly ctx: AppContext;
    paused = true;
    started = false;
    speed: 1 | 2 = 1;
    /** 開発時の確認用の早回し（本番では 1 のまま） */
    devScale = 1;
    /** 選んでいる部隊（id の並び。今は 0 か 1 部隊） */
    selection: string[] = [];
    pending: Pending = 'none';
    private realT = 0;
    /** 利用者がカメラを動かした（画面の大きさが変わっても「全体」に戻さない） */
    private camTouched = false;
    /** 確認用（開発時の window.__battle.camera） */
    get camTouchedNow(): boolean {
        return this.camTouched;
    }
    private endAt = -1;
    resultShown = false;
    /** 勝ち負けが決まった知らせ（hooks.onDecided）を送った後の、その返事（保存の結果）。まだ送っていなければ undefined */
    decidedNote: { ok: boolean; text: string } | null | undefined = undefined;
    private finished = false;
    private readonly off: (() => void)[] = [];
    private readonly ptrs = new Map<number, Ptr>();
    private pinch: { d: number; mx: number; my: number } | null = null;
    /** 2 本指になった・動かした：指をすべて離すまで「押した」にしない */
    private gesture = false;
    private readonly panKeys = new Set<string>();
    script: ((s: BattleState) => void) | null = null;
    private scriptAcc = 0;
    /** 知らせに出した出来事の数（止めている間に使った能力の知らせを 1 回だけ出すため） */
    private seenEvents = 0;
    private readonly terrainLabels: MapLabel[];
    /** 目標が指す部隊の名札の印（救出・守る・崩す） */
    private readonly unitMarks: Map<string, string>;
    /** 能力を使った・名札を押した直後の守り（この点の近くのタップを少しの間なにもしない。実時間 performance.now() の秒で。realT は 1 フレーム 0.1 秒で頭打ちなので使わない） */
    private tapGuard: TapGuard | null = null;
    /** 移動先指定で行き先を押した直後の印（素早い 2 回目を、選び直し・能力の発動にしない。control.ts の moveEchoDecision） */
    private moveEcho: MoveEcho | null = null;
    /** 点滅している武将の名札の名前・部隊の体を押した後の確かめ（もう一度押すと使う。実時間の秒。control.ts の ABILITY_ARM） */
    private arm: AbilityArm | null = null;
    /** 対象選びに入った：次のフレームで、持ち主と選べる対象が画面の部品に隠れていれば、見える所へ地図を動かす */
    private frameTargetsFor: string | null = null;

    constructor(
        setup: BattleSetup,
        private readonly hooks: BattleRunHooks,
        private readonly done: (o: BattleOutcome) => void,
    ) {
        this.ctx = appContext();
        this.s = createBattle(setup);
        this.view = new BattleView(this.s, { low: this.ctx.low, touch: this.ctx.touch });
        this.ui = new BattleUi(this.ctx.app, this.s, {
            start: () => this.start(),
            togglePause: () => this.togglePause(),
            setSpeed: (k) => (this.speed = k),
            command: (c) => this.command(c),
            ability: () => this.ability(),
            cancelPending: () => (this.pending = 'none'),
            allRetreat: () => void this.askAllRetreat(),
            selectUnit: (id) => this.selectFromCard(id),
            zoom: (d) => this.zoomButton(d),
            continueAfterResult: () => this.finish(),
        }, { touch: this.ctx.touch });
        // 夜（第4群）は篝火の区域の名札も足す（夜でない合戦では何も足さない）
        this.terrainLabels = [...mapLabels(this.s), ...nightLabels(this.s.setup)];
        this.unitMarks = objectiveUnitMarks(this.s);

        enterMode('battle', this);
        this.bindInput();
        const c = this.ctx.renderer.domElement;
        this.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
        this.ui.showBriefing(`合戦「${this.s.map.name}」（${scenarioTexts(this.s).titleNote}）`, setup.briefing, false);
        this.loadTrees();
        if (import.meta.env.DEV) exposeDev(this);
    }

    // ---------------------------------------------------------------- 準備

    private loadTrees(): void {
        // 開始のボタン：木（Version 21 と同じ。12 秒で打ち切り）と、地面の素材（Version 22。素材のある戦場で一覧に載っているときだけ。
        // 木が済んでから ART_WAIT_MS まで待つ）。素材を読みに行かない戦場・旧表示・一覧に無いときは、Version 21 と同じ時に出す
        const wantArt = fieldArtWanted(this.s.map.id);
        const gate = new BriefingGate({
            treeTimeoutMs: TREE_TIMEOUT_MS,
            artWaitMs: ART_WAIT_MS,
            wantArt,
            onReady: () => {
                if (!this.finished) this.ui.setBriefingReady(true);
            },
        });
        this.off.push(() => gate.dispose());
        loadModel('tree_pine_far')
            .then((g) => {
                if (this.finished) return;
                this.view.setTrees(g.scene);
                gate.treesDone();
            })
            .catch((e: unknown) => {
                // 読めなければ円すいの木のまま（見た目だけの問題。合戦はできる）
                console.warn('林の木を読み込めませんでした（円すいの木で続けます）', e);
                gate.treesDone();
            });
        if (wantArt) this.loadGroundArt(gate);
    }

    /**
     * 地面の素材（Version 22）：表示を作った後で読む（読めなければ今までの地面のまま）。開始のボタンを出す前に届いたときだけ使う。
     * 出した後・合戦が始まった後・終わった後に届いたら、合戦の途中で地面を差し替えないように使わずに捨てる
     * （読んだ画像と型紙は覚えているので、次の合戦では待たずに使える）。低い画質（?q=low）では anisotropy 1・草地は 1 回だけ読む
     */
    private loadGroundArt(gate: BriefingGate): void {
        const low = this.ctx.low;
        const aniso = low ? 1 : this.ctx.renderer.capabilities.getMaxAnisotropy();
        loadFieldArt(this.s.map, { anisotropy: aniso, low })
            .then((set) => {
                takeGroundArt(set, !(gate.settled || this.started || this.finished), (a) => this.view.setGroundArt(a));
                gate.artDone();
            })
            .catch((e: unknown) => {
                console.warn('地面の素材を使えませんでした（今までの地面で続けます）', e);
                gate.artDone();
            });
    }

    /** 主に選んでいる部隊（selection の先頭） */
    get selectedId(): string | null {
        return leadOf(this.selection);
    }

    /** 1 部隊だけを選ぶ（null で外す） */
    select(id: string | null): void {
        this.selection = selectOnly(id);
        // 確かめ（もう一度押すと使う）は、その武将を選んでいる間だけ。札・キーなどでほかを選び直したら消す
        if (this.arm && this.arm.id !== id) this.arm = null;
    }

    start(): void {
        if (this.started || this.finished) return;
        this.started = true;
        this.paused = false;
        this.ui.closeModal();
        this.ui.toast('合戦が始まった。部隊を選んで命令を出す（指揮で一時停止）', 'info');
        // 音：始まりの法螺と太鼓
        audio()?.battleCue('start');
    }

    /** 掛け声（声の台詞の表の id）：声を出せたら、同じ文を字幕に出す（音が無い・日本語の声が無い端末では何もしない） */
    private shout(id: string): void {
        const a = audio();
        a?.sayId(id, (v) => this.ui.voiceCaption(a.speakerName(v.speaker), v.text));
    }

    // ---------------------------------------------------------------- 毎フレーム

    frame(dt: number): void {
        if (this.finished) return;
        this.realT += dt;
        if (this.panKeys.size) {
            const k = this.view.cam.dist * 0.9 * dt;
            let dx = 0;
            let dz = 0;
            if (this.panKeys.has('ArrowLeft')) dx -= k;
            if (this.panKeys.has('ArrowRight')) dx += k;
            if (this.panKeys.has('ArrowUp')) dz -= k;
            if (this.panKeys.has('ArrowDown')) dz += k;
            this.view.centerOn(this.view.cam.tx + dx, this.view.cam.tz + dz);
            this.camTouched = true;
        }
        if (this.started && !this.paused && !this.s.result) {
            const sim = dt * this.speed * this.devScale;
            let events: BattleEvent[];
            if (this.script) {
                events = [];
                this.scriptAcc += sim;
                while (this.scriptAcc >= 0.1 - 1e-9 && !this.s.result) {
                    this.scriptAcc -= 0.1;
                    this.script(this.s);
                    events.push(...stepBattle(this.s, 0.1));
                }
            } else events = stepBattle(this.s, sim);
            this.onEvents(events);
        }
        // 音：斬り合い・射撃をしている部隊の数から刃・矢の音（発音数と 1 秒あたりの数を制限。倍速では間引く。止めている間は鳴らさない）
        audio()?.battleFrame(dt, this.s, this.speed, this.started && !this.paused && !this.s.result);
        if (this.s.result && this.endAt < 0) {
            this.endAt = this.realT;
            this.pending = 'none';
            audio()?.battleCue('end');
            // 勝ち負けが決まった：すぐに章の進行へ知らせる（結果の反映と戦後の自動保存。結果の画面を出す前）
            this.decide();
        }
        if (this.endAt >= 0 && !this.resultShown && this.realT - this.endAt > 1.6) this.showResult();
        // 見えなくなった敵・戦場を離れた敵の選択は外す
        const pruned = pruneSelection(this.s, this.selection);
        if (pruned !== this.selection) this.selection = [...pruned];
        const sel = this.selectedId ? unitById(this.s, this.selectedId) : undefined;
        if (sel && sel.side === 'ally' && this.pending !== 'ability' && !canCommand(this.s, sel)) this.pending = 'none';
        // 援護の対象選び：選んだ部隊の能力が使えなくなったら（崩れた・合戦が終わった）やめる
        if (this.pending === 'ability' && !(sel && abilityPanelModel(this.s, sel.id)?.usable)) this.pending = 'none';

        this.view.update(this.s, dt, { selectedId: this.selectedId, pending: this.pending, speed: this.speed });
        this.placeLabels();
        this.ui.update(this.s, { selectedId: this.selectedId, selection: this.selection, pending: this.pending, paused: this.paused, started: this.started, speed: this.speed });
        if (this.frameTargetsFor) {
            if (this.pending === 'ability' && this.selectedId === this.frameTargetsFor) this.frameTargets(this.frameTargetsFor);
            this.frameTargetsFor = null;
        }
        this.view.render(this.ctx.renderer);
    }

    resize(w: number, h: number): void {
        if (this.finished) return;
        this.view.resize(w, h);
        this.view.fit(this.ui.insets(), this.camTouched);
        // スマホの縦画面：止めて、横向きの案内（CSS）を出す
        const portrait = this.ctx.touch && h > w;
        if (portrait && this.started && !this.paused && !this.s.result) {
            this.releaseInput();
            this.paused = true;
        }
    }

    private onEvents(events: BattleEvent[]): void {
        this.seenEvents = this.s.events.length;
        for (const e of events) {
            // 音：ぶつかり・敗走の太鼓（見えていない敵の出来事は鳴らさない）
            if (!e.unseen) audio()?.battleEvent(e.kind, this.speed);
            const tone = eventTone(this.s, e);
            if (tone) this.ui.toast(e.text, tone, e.unitId);
            // 味方の能力の効果が切れた：上の真ん中に短く（「〇〇の効果が切れた」）
            if (e.kind === 'ability_end' && e.ability && e.unitId && unitById(this.s, e.unitId)?.side === 'ally') {
                this.ui.abilityNotice('end', abilityEndText(e.ability), unitById(this.s, e.unitId)?.name ?? '');
            }
        }
    }

    private placeLabels(): void {
        const s = this.s;
        const hasAbilities = s.abilityList.length > 0;
        const pledgeId = s.pledge?.targetId ?? null;
        const blink = abilityBlink(this.realT);
        const armedId = armLive(this.arm, performance.now() / 1000);
        // 引いた画面（全体に近い）：名札を小さく薄くして、部隊（兵士の群れ）を覆いすぎないように（battle.css の .b-labels.far）
        this.ui.setLabelsFar(this.view.zoomRatio() > LABELS_FAR_RATIO);
        // 同じ所で着くのを待つ味方（援軍）の名札は、上へ積んで重ならないように
        const waitingAt = new Map<string, number>();
        for (let i = 0; i < s.units.length; i++) {
            const u = s.units[i];
            const a = this.view.labelAnchor(i);
            if (a.shown) {
                const p = this.view.project(a.x, a.y, a.z);
                let extra = u.status === 'routed' ? ' 敗走' : ` ${Math.round(u.strength)}`;
                // 特殊能力が効いている印（号令・踏みとどまる・退路の守り・援護など）
                if (hasAbilities) {
                    const marks = unitMarksText(s, u.id);
                    if (marks) extra += `［${marks}］`;
                }
                this.ui.label(u.id, u.name, u.side, p.x, p.y, !p.off, extra);
            } else if (u.side === 'ally' && !u.arrived && u.status === 'ready') {
                const p = this.view.project(u.x, 4, u.z);
                const key = `${Math.round(u.x)},${Math.round(u.z)}`;
                const k = waitingAt.get(key) ?? 0;
                waitingAt.set(key, k + 1);
                this.ui.label(u.id, u.name, 'ally', p.x, p.y - k * 18, !p.off, ` 到着まで ${Math.max(0, Math.ceil(u.arriveAt - s.t))} 秒`);
            } else this.ui.label(u.id, '', u.side, 0, 0, false);
            this.ui.markLabel(u.id, 'sel', this.selection.includes(u.id));
            // 能力の印（点滅・効果中の残り秒・対象選びの選べる／選べない）。点滅は表示の時計で（一時停止中も）
            if (hasAbilities) this.ui.labelAbility(u.id, labelAbilityModel(s, u.id, this.pending, this.selectedId, armedId), blink);
            this.ui.markLabel(u.id, 'routed', u.status === 'routed');
            if (pledgeId) this.ui.markLabel(u.id, 'pledge', pledgeId === u.id);
            if (this.unitMarks.size) this.ui.labelMark(u.id, u.status === 'ready' ? (this.unitMarks.get(u.id) ?? '') : '');
            // 名札の優先表示の「重要な武将」：武将のいる部隊・本陣・約束の対象・目標の印の付いた部隊（labelLayout.ts）
            if (hasAbilities) this.ui.labelImportant(u.id, !!(u.generalId || u.leaderId) || u.isHq || pledgeId === u.id || !!this.unitMarks.get(u.id));
        }
        for (const t of this.terrainLabels) {
            const p = this.view.project(t.x, t.y, t.z);
            this.ui.label(t.id, t.text, 'terrain', p.x, p.y, !p.off);
        }
        // 特殊能力のある合戦：部隊の名札の重なりをほどき、密集したら優先の低い名札を小さく・一時的に隠す（点滅する印が別の名札に隠れないように。
        // 優先は 選んだ > 点滅 > 重要な武将 > 画面の中央に近い。labelLayout.ts）。架空の第一章は Version 12 のまま
        this.ui.declutterLabels(hasAbilities);
        // 上の知らせが選んでいる名札・点滅している名札を覆うなら畳む（第4群）
        this.ui.tuckNotices();
    }

    // ---------------------------------------------------------------- 命令

    private selected(): Selected | null {
        return selectedOf(this.s, this.selection);
    }

    /** 命令を部隊の並びへ出す（今は選んでいる 1 部隊）。1 部隊でも出せたら命令の途中（移動・攻撃）を終える */
    /** note：出せたときに知らせに添える案内（resolveTap の note） */
    private order(unitIds: readonly string[], o: Order, note?: string): boolean {
        const r = orderUnits(this.s, unitIds, o);
        const ok = r.issued.length > 0;
        this.ui.flash(orderUnitsText(this.s, o, r) + (ok && note ? `（${note}）` : ''));
        if (ok) this.pending = 'none';
        return ok;
    }

    /** 選んでいる部隊のうち命令を出せるもの（今は 1 部隊。命令できなければ先頭の部隊＝断る理由を出すため） */
    private orderTargets(): string[] {
        const ids = commandableIds(this.s, this.selection);
        return ids.length ? ids : this.selection.slice(0, 1);
    }

    private command(c: CommandKind): void {
        if (this.s.result) return;
        const sel = this.selected();
        if (!sel || sel.side !== 'ally') {
            this.ui.flash('先に味方の部隊を選んでください');
            return;
        }
        if (!sel.commandable) {
            this.ui.flash(refusalText(this.s, sel.id, { type: 'hold' }));
            return;
        }
        if (c === 'move' || c === 'attack' || c === 'face') this.pending = this.pending === c ? 'none' : c;
        else this.order(this.orderTargets(), { type: c });
    }

    /** 「能力」・F：選んだ味方の部隊の特殊能力を使う（援護は対象選びへ。使えなければ理由を出すだけで回数は減らない） */
    private ability(): void {
        if (this.s.result || !this.started) return;
        const sel = this.selectedId ? unitById(this.s, this.selectedId) : undefined;
        if (!sel) {
            this.ui.flash('先に味方の部隊を選んでください');
            return;
        }
        if (sel.side !== 'ally') {
            const em = abilityPanelModel(this.s, sel.id);
            this.ui.flash(em ? `「${em.name}」は敵方の武将の能力。操作できない（敵の考えが使う）` : '敵の部隊は操作できない（先に味方の部隊を選んでください）', 2600);
            return;
        }
        const m = abilityPanelModel(this.s, sel.id);
        if (!m) {
            this.ui.flash(`${sel.name}には特殊能力がない（率いる武将のいない部隊）`);
            return;
        }
        if (this.pending === 'ability') {
            // もう一度押すと取り消し
            this.pending = 'none';
            this.ui.flash('援護の対象選びをやめた');
            return;
        }
        if (!m.usable) {
            this.ui.flash(`「${m.name}」は使えない：${m.reason || m.stateText}`, 2600);
            return;
        }
        if (m.info.target === 'ally_unit') {
            this.pending = 'ability';
            this.frameTargetsFor = sel.id;
            return;
        }
        this.useAbilityOn(sel.id, undefined);
    }

    /**
     * 対象選びの持ち主と選べる対象（部隊の体・名札）が、画面の部品（能力の欄・下の案内の帯・札など）に隠れていれば、
     * それらの真ん中が部品に隠れない所の中心に来るように地図を動かす（寄り・引きは変えない）。隠れていなければ何もしない
     */
    private frameTargets(userId: string): void {
        const info = abilityInfo(this.s, userId);
        if (!info) return;
        const c = this.ctx.renderer.domElement.getBoundingClientRect();
        const W = c.width;
        const H = c.height;
        const blockers = this.ui.blockerRects().map((r) => ({ l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top }));
        const hit = (a: { l: number; t: number; r: number; b: number }) => blockers.some((b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t);
        const pts: { x: number; y: number }[] = [];
        let hidden = false;
        for (const id of [userId, ...info.validTargets]) {
            const i = this.s.units.findIndex((u) => u.id === id);
            const m = i >= 0 ? this.view.unitCenter(i) : null;
            if (!m || !m.shown) continue;
            const p = this.view.project(m.x, m.y, m.z);
            pts.push(p);
            if (p.off || p.x < 0 || p.x > W || p.y < 0 || p.y > H || hit({ l: p.x - 6, t: p.y - 6, r: p.x + 6, b: p.y + 6 })) hidden = true;
            const r = this.ui.labelRect(id);
            if (r && hit({ l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top })) hidden = true;
        }
        if (!hidden || pts.length === 0) return;
        // 隠れない所：上下右は「全体」と同じ余白。左は左の列（能力の欄など）の右、下は案内の帯の上
        const ins = this.ui.insets();
        let left = ins.left;
        let bottom = H - ins.bottom;
        for (const b of blockers) {
            if (b.l < W * 0.4 && b.r < W * 0.6 && b.b > ins.top + 20 && b.t < H * 0.7) left = Math.max(left, b.r + 8);
            if (b.t > H * 0.5 && b.l < W / 2 && b.r > W / 2) bottom = Math.min(bottom, b.t - 8);
        }
        const cx = (left + W - ins.right) / 2;
        const cy = (ins.top + bottom) / 2;
        const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        this.view.panByScreen(mx, my, cx, cy);
        this.camTouched = true;
    }

    /**
     * 能力を使う（userId の部隊の能力。targetId は対象の要る能力の対象）。使えたら、発動の知らせ（能力名・武将・対象）を出す。
     * 断られたら理由を出す（対象選びは続ける。回数は減らない）。使えたかを返す
     */
    private useAbilityOn(userId: string, targetId: string | undefined): boolean {
        const user = unitById(this.s, userId);
        if (!user) return false;
        const pm = abilityPanelModel(this.s, user.id);
        const name = pm?.name ?? '能力';
        const r = useAbility(this.s, user.id, targetId);
        if (r.ok) {
            this.pending = 'none';
            const tgt = targetId ? unitById(this.s, targetId)?.name : null;
            const how = pm?.info.id === 'nagamasa_support' ? 'を援護' : 'へ差配';
            this.ui.flash(`${user.name}：「${name}」${tgt ? `— ${tgt}${how}` : ''}${this.paused ? '（再開すると時間が進む）' : ''}`, 2400);
            const note = abilityNoticeModel(this.s, user.id);
            // 武将の顔（家康・忠勝の素材が読めたときだけ）は自軍の発動だけに添える
            if (note) this.ui.abilityNotice('use', `${note.general}${note.title}`, `対象：${note.target}`, undefined, user.side === 'ally' ? note.generalId : null);
            // 音：能力の発動の太鼓と、武将の掛け声（味方の武将だけ）
            audio()?.battleCue('ability', this.speed);
            if (user.side === 'ally' && pm) this.shout(`battle.ability.${pm.info.id}`);
            // 使った知らせ（sim が記録した ability の出来事）をすぐ出す（止めている間も）
            this.onEvents(this.s.events.slice(this.seenEvents));
            return true;
        }
        this.ui.flash(`${targetId ? '対象にできない' : '使えない'}：${r.reason ?? ''}`, 2600);
        return false;
    }

    private selectFromCard(id: string): void {
        if (this.pending === 'ability' && this.selectedId) {
            // 能力の対象選びの途中：札（1〜8 キー）でも対象を選べる
            this.useAbilityOn(this.selectedId, id);
            return;
        }
        if (this.selectedId === id) {
            this.focusUnit(id);
            return;
        }
        this.select(id);
        this.pending = 'none';
    }

    private focusUnit(id: string): void {
        const i = this.s.units.findIndex((u) => u.id === id);
        if (i < 0) return;
        const u = this.s.units[i];
        const p = this.view.unitPos(i);
        if (u.side === 'enemy' && !p.shown) return;
        this.camTouched = true;
        this.view.centerOn(p.shown ? p.x : u.x, p.shown ? p.z : u.z);
    }

    private async askAllRetreat(): Promise<void> {
        if (this.s.result || !this.started || this.s.allRetreatAt !== null || this.ui.modalOpen) return;
        const was = this.paused;
        this.paused = true;
        // 第4群：全軍撤退も退き口の判定に入る戦場（endRules.allRetreat 'count'）は、目標に数えることを添える
        const counting = this.s.setup.endRules?.allRetreat === 'count';
        const body = counting
            ? '味方の全部隊が退き口へ下がります。退き口から離れた部隊は主目標に数え、味方が戦場からいなくなるまで合戦は続きます（要る数が離れれば勝利の撤収。途中で部隊が崩れて要る数に届かなくなれば、主目標の失敗で敗北）。'
            : '味方の全部隊が南の退き口へ下がります。戦場を離れると合戦は「撤退」で終わります（兵は残ります）。';
        const yes = await this.ui.confirm('全軍撤退しますか？', body, '撤退する', 'やめる');
        if (this.finished) return;
        if (yes && orderAllRetreat(this.s)) {
            this.pending = 'none';
            this.paused = false;
            this.shout('battle.retreat');
        } else this.paused = was;
    }

    togglePause(): void {
        if (!this.started) {
            if (this.ui.modalOpen === 'briefing') this.ui.modalKey('primary');
            return;
        }
        if (this.s.result || this.ui.modalOpen) return;
        this.paused = !this.paused;
    }

    private autoPause(): void {
        this.releaseInput();
        if (this.started && !this.s.result) this.paused = true;
    }

    private zoomButton(d: 1 | -1 | 0): void {
        if (d === 0) {
            this.camTouched = false;
            this.view.fit(this.ui.insets());
            return;
        }
        const r = this.ctx.renderer.domElement.getBoundingClientRect();
        // 「全体」のまま寄るとき：両軍の部隊の真ん中（前線のあたり）を画面の真ん中へ動かしてから寄る（空いた原へ寄らないように）
        if (d > 0 && !this.camTouched) {
            const f = this.frontPoint();
            if (f) this.view.panByScreen(f.x, f.y, r.width / 2, r.height / 2);
        }
        this.camTouched = true;
        this.view.zoomAt(d > 0 ? 0.7 : 1 / 0.7, r.width / 2, r.height / 2);
    }

    /** 戦場にいて戦える部隊（敵は見えているものだけ）の画面の点の真ん中（両軍の真ん中＝前線のあたり）。どれも無ければ null */
    private frontPoint(): { x: number; y: number } | null {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let i = 0; i < this.s.units.length; i++) {
            const u = this.s.units[i];
            if (!u.present || u.status !== 'ready' || (u.side === 'enemy' && !u.seenBy.ally)) continue;
            const m = this.view.unitCenter(i);
            if (!m.shown) continue;
            const p = this.view.project(m.x, m.y, m.z);
            if (p.off) continue;
            sx += p.x;
            sy += p.y;
            n++;
        }
        return n ? { x: sx / n, y: sy / n } : null;
    }

    // ---------------------------------------------------------------- 結果

    /** 勝ち負けが決まったことを 1 回だけ知らせる（章の進行が結果を反映して保存する）。保存の結果は結果の画面に出す */
    private decide(): void {
        if (this.decidedNote !== undefined || !this.s.result) return;
        this.decidedNote = null;
        try {
            this.decidedNote = this.hooks.onDecided?.(this.s.result) ?? null;
        } catch (e) {
            console.error(e);
            this.decidedNote = { ok: false, text: `結果を保存できませんでした：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    private showResult(): void {
        const o = this.s.result!;
        this.decide();
        this.resultShown = true;
        this.releaseInput();
        const { rows, lost, start } = resultRows(this.s, o);
        const sc = scenarioTexts(this.s);
        this.ui.showResult({
            kind: o.result,
            title: RESULT_LABEL[o.result],
            // 第4群：目標を果たした撤収と、合戦の放棄を分けて添える（区別の無い結果では何も足さない）
            reason: sc.reasons[o.reason] + (withdrawalNote(o) ? `（${withdrawalNote(o)}）` : ''),
            time: fmtClock(o.elapsedSec),
            rows,
            lost,
            start,
            note: sc.notes[o.result],
            save: this.decidedNote ?? null,
            pledge: pledgeResultModel(this.s, o),
            abilities: abilitiesUsedText(this.s, o),
            objectives: objectiveResultModel(o),
        });
    }

    private finish(): void {
        if (this.finished || !this.s.result) return;
        this.decide();
        this.finished = true;
        const o = this.s.result;
        for (const f of this.off) f();
        this.off.length = 0;
        this.ui.dispose();
        this.view.dispose();
        exitMode();
        if (import.meta.env.DEV) {
            const w = window as unknown as { __battle?: { active: boolean } };
            if (w.__battle) w.__battle.active = false;
        }
        this.done(o);
    }

    // ---------------------------------------------------------------- 入力

    private listen<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen<K extends keyof DocumentEventMap>(t: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen<K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen(t: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
        const h = fn as unknown as EventListener;
        t.addEventListener(type, h, opts);
        this.off.push(() => t.removeEventListener(type, h, opts));
    }

    /** 指・マウス・キーをすべて離す（その指を動かし続けても、触り直すまで地図は動かない） */
    releaseInput(): void {
        for (const p of this.ptrs.values()) {
            try {
                if (this.ui.input.hasPointerCapture(p.id)) this.ui.input.releasePointerCapture(p.id);
            } catch {
                /* 捕捉が既に外れている */
            }
        }
        this.ptrs.clear();
        this.pinch = null;
        this.gesture = false;
        this.panKeys.clear();
        this.ui.input.classList.remove('dragging');
    }

    private local(e: PointerEvent | WheelEvent): [number, number] {
        const r = this.ctx.renderer.domElement.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    private bindInput(): void {
        const layer = this.ui.input;
        this.listen(layer, 'pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
            e.preventDefault();
            if (this.resultShown || this.ui.modalOpen) return;
            const [x, y] = this.local(e);
            try {
                layer.setPointerCapture(e.pointerId);
            } catch {
                /* 捕捉できない場合もそのまま */
            }
            this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, button: e.button, sx: x, sy: y, x, y, moved: false });
            if (this.ptrs.size >= 2) {
                this.gesture = true;
                const [a, b] = [...this.ptrs.values()];
                this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
            }
        });
        this.listen(layer, 'pointermove', (e) => {
            const p = this.ptrs.get(e.pointerId);
            const [x, y] = this.local(e);
            if (!p) {
                if (e.pointerType === 'mouse') this.hover(x, y);
                return;
            }
            const px = p.x;
            const py = p.y;
            p.x = x;
            p.y = y;
            if (this.ptrs.size >= 2 && this.pinch) {
                const [a, b] = [...this.ptrs.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                this.camTouched = true;
                this.view.zoomAt(this.pinch.d / d, mx, my);
                this.view.panByScreen(this.pinch.mx, this.pinch.my, mx, my);
                this.pinch = { d, mx, my };
                return;
            }
            if (!p.moved) {
                const slop = p.type === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
                if (Math.hypot(x - p.sx, y - p.sy) <= slop) return;
                p.moved = true;
                this.gesture = true;
                this.camTouched = true;
                layer.classList.add('dragging');
                this.view.panByScreen(p.sx, p.sy, x, y);
                return;
            }
            this.view.panByScreen(px, py, x, y);
        });
        const end = (e: PointerEvent, tap: boolean) => {
            const p = this.ptrs.get(e.pointerId);
            if (!p) return;
            this.ptrs.delete(e.pointerId);
            if (this.ptrs.size < 2) this.pinch = null;
            const wasGesture = this.gesture;
            if (this.ptrs.size === 0) {
                this.gesture = false;
                layer.classList.remove('dragging');
            }
            if (tap && !p.moved && !wasGesture && this.ptrs.size === 0) this.tap(p.x, p.y, p.type === 'mouse' && p.button === 2);
        };
        this.listen(layer, 'pointerup', (e) => end(e, true));
        this.listen(layer, 'pointercancel', (e) => end(e, false));
        this.listen(layer, 'lostpointercapture', (e) => end(e, false));
        this.listen(layer, 'contextmenu', (e) => e.preventDefault());
        this.listen(
            layer,
            'wheel',
            (e) => {
                e.preventDefault();
                if (this.ui.modalOpen) return;
                const [x, y] = this.local(e);
                this.camTouched = true;
                const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
                this.view.zoomAt(Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0016))), x, y);
            },
            { passive: false },
        );
        this.listen(window, 'blur', () => this.autoPause());
        this.listen(window, 'pagehide', () => this.autoPause());
        this.listen(document, 'visibilitychange', () => {
            if (document.visibilityState !== 'visible') this.autoPause();
        });
        this.listen(window, 'keydown', (e) => this.keyDown(e));
        this.listen(window, 'keyup', (e) => {
            this.panKeys.delete(e.code);
            // Mac で Cmd を押している間の keyup が届かないことがあるので、Cmd を離したら全部離す
            if (e.key === 'Meta') this.panKeys.clear();
        });
    }

    private hover(x: number, y: number): void {
        if (this.ui.modalOpen) return;
        // 点滅している名札（対象選びの間は対象の名札）の上：押せる印
        if (this.labelAt(x, y)) {
            if (this.ui.input.style.cursor !== 'pointer') this.ui.input.style.cursor = 'pointer';
            return;
        }
        const id = this.view.pick(this.s, x, y, 18);
        const u = id ? unitById(this.s, id) : undefined;
        const layer = this.ui.input;
        const sel = this.selected();
        let cur = '';
        if (u && this.pending === 'ability') cur = 'copy';
        // 移動先指定の間は、味方の上もその点へ移動（選び直さない）
        else if (this.pending === 'move' && sel?.commandable) cur = 'cell';
        else if (this.pending === 'face' && sel?.commandable) cur = 'crosshair';
        else if (u && u.side === 'ally') cur = 'pointer';
        else if (u && sel?.commandable) cur = 'crosshair';
        else if (u) cur = 'help';
        else if (sel?.commandable) cur = 'cell';
        if (layer.style.cursor !== cur) layer.style.cursor = cur;
    }

    /**
     * 押した所の名札（点滅している名札・対象選びの間は味方の名札）。当たりは control.ts の labelHit（見た目より少し広い。隣の部隊の中心を越えない。
     * 上に重なって見えている別の名札の下に隠れた所は当てない）。
     * part：'badge'＝能力の印（対象選びの間は名札全体）＝その場で名札の操作／'name'＝点滅している名札の名前の所（いちばん上に見えている名札）＝確かめ
     */
    private labelAt(x: number, y: number): { id: string; part: 'badge' | 'name' } | null {
        const ids = labelTapCandidates(this.s, this.pending, this.selectedId);
        if (ids.length === 0) return null;
        const c = this.ctx.renderer.domElement.getBoundingClientRect();
        // 点滅している武将：能力の印（◆号令）の所は 1 回で使う。対象選びの間：名札全体（その部隊を対象に）
        const choosing = this.pending === 'ability' && !!this.selectedId;
        const part = choosing ? 'all' : 'badge';
        // 名札の重なり（どれが上に見えているか）
        const covers: LabelCover[] = this.ui.labelCovers().map(({ id, rect, z }) => ({ id, l: rect.left - c.left, t: rect.top - c.top, r: rect.right - c.left, b: rect.bottom - c.top, z }));
        const zOf = new Map(covers.map((k) => [k.id, k.z]));
        const boxes: LabelBox[] = [];
        for (const id of ids) {
            const r = this.ui.labelRect(id, part);
            if (r) boxes.push({ id, l: r.left - c.left, t: r.top - c.top, r: r.right - c.left, b: r.bottom - c.top, z: zOf.get(id) ?? 0 });
        }
        // 部隊の体の中心（その部隊自身も）とほかの名札の中心：広げた当たりがこれより向こうへ行かないように
        const others: ScreenMark[] = [];
        for (let i = 0; i < this.s.units.length; i++) {
            const u = this.s.units[i];
            const m = this.view.unitCenter(i);
            if (!m.shown) continue;
            const p = this.view.project(m.x, m.y + 1.5, m.z);
            if (!p.off) others.push({ id: `${u.id}#body`, x: p.x, y: p.y });
        }
        for (const k of covers) others.push({ id: k.id, x: (k.l + k.r) / 2, y: (k.t + k.b) / 2 });
        // 当たりを見た目より広げるのは、命令を出せる味方を選んでいない時だけ（選んでいる時は、印のすぐ外の地面は移動のつもりの押しなので、
        // 1 合戦 1 回の能力を曖昧な押しで使わない。印そのものは今までどおり 1 回で使う）
        const sel = this.selected();
        const ordering = !choosing && !!sel && sel.side === 'ally' && sel.commandable;
        const minPx = ordering ? 0 : this.ctx.touch ? LABEL_HIT_PX.touch : LABEL_HIT_PX.mouse;
        const hit = boxes.length ? labelHit(boxes, others, x, y, minPx, covers) : null;
        if (hit) return { id: hit, part: 'badge' };
        if (choosing) return null;
        // 点滅している名札の名前の所（いちばん上に見えている名札が点滅している武将のとき）：確かめ
        const top = labelTopAt(covers, x, y);
        return top && ids.includes(top) ? { id: top, part: 'name' } : null;
    }

    /** 確認用（開発時の window.__battle.labelHitAt） */
    labelHitForDev(x: number, y: number): { id: string; part: 'badge' | 'name' } | null {
        return this.labelAt(x, y);
    }

    /**
     * 点滅している武将の名札の名前・部隊の体を押した（印の外）：その部隊を選び、短い確かめを出す（名札に「もう一度で◆号令」・下の案内）。
     * 確かめの中にもう一度押すと使う（control.ts の armDecision）
     */
    private armAbility(id: string, now: number, x: number, y: number): void {
        const u = unitById(this.s, id);
        const info = abilityInfo(this.s, id);
        if (!u || !info) return;
        this.select(id);
        this.pending = 'none';
        const g = this.view.groundAt(x, y);
        this.arm = { id, at: now, x, y, ...(g ? { gx: g.x, gz: g.z } : {}) };
        const how = info.needsTarget ? 'もう一度押すと「' + info.name + '」の対象選び' : 'もう一度押すと「' + info.name + '」を使う';
        this.ui.flash(`${u.name}を選んだ。${how}（◆の印なら 1 回で使える）`, 3000);
    }

    /** 名札の操作（使う・対象選びに入る・やめる・対象に選ぶ）をして、同じ所のタップの守りを付ける */
    private runLabelAction(x: number, y: number, act: NonNullable<ReturnType<typeof resolveLabelTap>>): void {
        this.arm = null;
        switch (act.type) {
            case 'use':
                this.useAbilityOn(act.unitId, undefined);
                break;
            case 'chooseTarget':
                // 対象選び：その武将の部隊を選び、選べる部隊に輪（view.ts）・選べない名札は薄く・案内の文
                this.select(act.unitId);
                this.pending = 'ability';
                this.frameTargetsFor = act.unitId;
                break;
            case 'cancel':
                this.pending = 'none';
                this.ui.flash('能力の対象選びをやめた（使用回数は減っていない）');
                break;
            case 'target':
                this.useAbilityOn(act.userId, act.targetId);
                break;
        }
        this.guardHere(x, y);
    }

    /** 移動先指定で行き先を押した印を付ける（MOVE_ECHO_SEC のあいだ。半径は名札の当たりの半分） */
    private setMoveEcho(x: number, y: number): void {
        const id = this.selectedId;
        if (!id) return;
        const hitPx = this.ctx.touch ? LABEL_HIT_PX.touch : LABEL_HIT_PX.mouse;
        this.moveEcho = { x, y, unitId: id, until: performance.now() / 1000 + MOVE_ECHO_SEC, r: hitPx / 2 };
    }

    /** 同じ所のタップの守り（TAP_GUARD_SEC の間、この点の近くの連打の 2 回目は何もしない。control.ts の guardTap） */
    private guardHere(x: number, y: number): void {
        const hitPx = this.ctx.touch ? LABEL_HIT_PX.touch : LABEL_HIT_PX.mouse;
        this.tapGuard = { x, y, until: performance.now() / 1000 + TAP_GUARD_SEC, r: hitPx / 2 };
    }

    /** 名札を押した（能力を使う・対象選びに入る・やめる・対象に選ぶ・名前の所は確かめ）。押した操作を使い切ったら true（地図を押した扱いにしない） */
    private labelTap(x: number, y: number, arm: AbilityArm | null): boolean {
        if (this.s.abilityList.length === 0 || !this.started) return false;
        const hit = this.labelAt(x, y);
        if (!hit) return false;
        if (hit.part === 'name') {
            // 向きの指定の間は、名札の名前の所は地図を押した扱い（確かめの中の 2 回目にもしない。能力の印 ◆ は能力のまま）。
            // 移動先指定の間は、名札の印・名前とも当たりにしない（labelTapCandidates が空。その点への移動）
            if (this.pending === 'move' || this.pending === 'face') return false;
            // 命令を出せる味方を選んでいる間は、名札の名前の所は今までどおり地図を押した扱い（地面の移動・部隊の選択。
            // 引いた画面では名札が地面・部隊に重なるので、移動のつもりの指を奪わない）。確かめの中のその武将の名札だけは 2 回目として使う
            const now = performance.now() / 1000;
            const sel = this.selected();
            if (sel && sel.side === 'ally' && sel.commandable && armLive(arm, now) !== hit.id) return false;
            const d = armDecision(arm, hit.id, now);
            if (d === 'wait') {
                this.arm = arm;
                return true;
            }
            if (d === 'arm') {
                this.armAbility(hit.id, now, x, y);
                return true;
            }
        }
        const act = resolveLabelTap(this.s, hit.id, this.pending, this.selectedId);
        if (!act) return false;
        this.runLabelAction(x, y, act);
        return true;
    }

    /** 地図を押した（動かさずに離した）。command は右クリック（味方を選んでいれば命令だけ） */
    private tap(x: number, y: number, command: boolean): void {
        if (this.resultShown || this.ui.modalOpen) return;
        // 能力を使った・名札を押した直後の同じ所（連打の 2 回目）：何もしない（地面の移動・部隊の選択に漏らさない）
        // 続けて押している間は守りを延ばす（control.ts の guardTap）
        const gt = guardTap(this.tapGuard, x, y, performance.now() / 1000);
        this.tapGuard = gt.guard;
        if (gt.swallow) return;
        // 移動先指定の素早い 2 回目（第4群）：選び直し・能力の発動（名札・体の確かめ）にしない。1 回目の近くなら何もしない（同じ点の移動の重ね）、
        // 離れていれば、移動先指定のまま、その点への移動にする（control.ts の moveEchoDecision）
        if (!command && this.moveEcho) {
            const now = performance.now() / 1000;
            const ed = moveEchoDecision(this.moveEcho, x, y, now, this.selectedId);
            if (ed) {
                this.arm = null;
                if (ed === 'same') {
                    this.moveEcho = { ...this.moveEcho, until: now + MOVE_ECHO_SEC };
                    return;
                }
                const g = this.view.groundAt(x, y);
                const sel = this.selected();
                if (!g || !sel || !sel.commandable) return;
                if (this.order(this.orderTargets(), { type: 'move', x: g.x, z: g.z })) this.setMoveEcho(x, y);
                return;
            }
            this.moveEcho = null;
        }
        const wasMove = this.pending === 'move';
        // 確かめ（もう一度押すと使う）は、同じ武将をもう一度押したときだけ続く。ほかのタップで消える
        const arm = this.arm;
        this.arm = null;
        // 確かめの中に、1 回目と同じ所（当たりの半分の半径）をもう一度押した：名札が長くなって動いていても、その武将の 2 回目とみなす
        // （名札の動いた後の地面の移動に漏らさない）
        // その武将を選んだままで、地図が動いていない（同じ画面の点の下が同じ地面）ときだけ。地図を動かした後の同じ画面の点は別の所
        if (!command && arm && arm.x !== undefined && arm.y !== undefined && this.pending === 'none' && this.s.abilityList.length > 0 && this.selectedId === arm.id) {
            const hitPx = this.ctx.touch ? LABEL_HIT_PX.touch : LABEL_HIT_PX.mouse;
            const g = this.view.groundAt(x, y);
            const sameGround = arm.gx === undefined || arm.gz === undefined || (g !== null && Math.hypot(g.x - arm.gx, g.z - arm.gz) <= ARM_SAME_GROUND_M);
            if (Math.hypot(x - arm.x, y - arm.y) <= hitPx / 2 && sameGround && abilityInfo(this.s, arm.id)?.ready) {
                const d = armDecision(arm, arm.id, performance.now() / 1000);
                if (d === 'wait') {
                    this.arm = arm;
                    return;
                }
                if (d === 'fire') {
                    const la = resolveLabelTap(this.s, arm.id, 'none', this.selectedId);
                    if (la) {
                        this.runLabelAction(x, y, la);
                        return;
                    }
                }
            }
        }
        // 点滅している名札（対象選びの間は味方の名札）：部隊の選択・地面の移動より先に、能力の操作として使い切る
        if (!command && this.labelTap(x, y, arm)) return;
        // 部隊そのもの（隊列の広がり＋少し）を押したか、押しやすくするための余白（タッチ 30 px・マウス 20 px）を押したか
        const exactId = this.view.pick(this.s, x, y, this.ctx.touch ? TAP_EXACT_PX.touch : TAP_EXACT_PX.mouse);
        const id = exactId ?? this.view.pick(this.s, x, y, this.ctx.touch ? 30 : 20);
        const g = this.view.groundAt(x, y);
        const u = id ? unitById(this.s, id) : undefined;
        let target: TapTarget;
        if (u) target = { kind: 'unit', unitId: u.id, side: u.side, x: g?.x ?? u.x, z: g?.z ?? u.z, near: !exactId, fighting: isActive(u) };
        else if (g) target = { kind: 'ground', x: g.x, z: g.z };
        else return;
        const sel = this.selected();
        if (command) {
            // 右クリック：選んでいる味方への命令だけ（選び直しはしない）。味方のすぐ近くなら、その地点へ移動
            if (!sel || !sel.commandable) return;
            if (target.kind === 'unit' && target.side === 'ally' && !target.near) return;
            if (target.kind === 'unit' && target.side === 'ally') target = { kind: 'ground', x: target.x, z: target.z };
            // 戦えない（敗走中の）敵の体は、地面と同じ（その地点へ移動）
            if (target.kind === 'unit' && target.fighting === false) target = { kind: 'ground', x: target.x, z: target.z };
            const o: Order = target.kind === 'unit' ? { type: 'attack', targetId: target.unitId } : { type: 'move', x: target.x, z: target.z };
            this.order(this.orderTargets(), o);
            return;
        }
        const act = resolveTap(sel, this.pending, target);
        // 点滅している武将の部隊の体を押した（選ぶ・選び直し）：選んで確かめを出す。確かめの中にもう一度押すと使う
        // （選んでいる部隊をもう一度押して外す Version 12 の操作は、確かめの中でなければ今までどおり）
        if (
            target.kind === 'unit' &&
            this.pending === 'none' &&
            this.started &&
            (act.type === 'select' || act.type === 'deselect') &&
            target.unitId === (act.type === 'select' ? act.unitId : this.selectedId) &&
            this.s.abilityList.length > 0 &&
            abilityInfo(this.s, target.unitId)?.ready
        ) {
            const now = performance.now() / 1000;
            const d = armDecision(arm, target.unitId, now);
            if (d === 'wait') {
                this.arm = arm;
                return;
            }
            if (d === 'fire') {
                const la = resolveLabelTap(this.s, target.unitId, 'none', this.selectedId);
                if (la) {
                    this.runLabelAction(x, y, la);
                    return;
                }
            } else if (act.type === 'select') {
                this.armAbility(target.unitId, now, x, y);
                return;
            }
        }
        switch (act.type) {
            case 'select':
            case 'inspect':
                this.select(act.unitId);
                this.pending = 'none';
                break;
            case 'order': {
                let o = act.order;
                let note = act.note;
                // 敵の「すぐ近く」（隊列の外の余白）を押した攻撃で、その敵へ道が無い（櫓台の上・閉じた門の向こう）：押した地点への移動にする
                // （曲輪の中の地面を押すと門の裏の槍への攻撃になって断られ、先に曲輪へ向かわせておけなかった）。体そのものを押したときは、
                // 攻撃として断って理由を出す（refusalText）
                if (o.type === 'attack' && target.kind === 'unit' && target.near) {
                    const me = unitById(this.s, act.unitId);
                    const foe = unitById(this.s, o.targetId);
                    if (me && foe && meleeUnreachable(this.s, me, foe)) {
                        o = { type: 'move', x: target.x, z: target.z };
                        note = `${foe.name}へは道が無いので、押した地点へ移動`;
                    }
                }
                // act.unitId は先頭の部隊。命令は選んでいる並びの部隊へ出す（今は同じ 1 部隊）
                const ok = this.order(this.selection.includes(act.unitId) ? this.orderTargets() : [act.unitId], o, note);
                // 移動先指定で出した移動：素早い 2 回目を選び直し・能力の発動にしない（moveEcho）
                if (ok && wasMove && o.type === 'move') this.setMoveEcho(x, y);
                break;
            }
            case 'face': {
                // 向きの指定：その場で押した方へ向き直る（今いる所への移動に向きを付ける）
                const o = faceOrder(this.s, act.unitId, act.x, act.z);
                if (!o) this.ui.flash('向く方（部隊から少し離れた所）を押してください');
                else this.order([act.unitId], o);
                break;
            }
            case 'deselect':
                this.select(null);
                this.pending = 'none';
                break;
            case 'hint':
                this.ui.flash(act.text);
                break;
            case 'abilityTarget':
                if (this.selectedId) this.useAbilityOn(this.selectedId, act.unitId);
                this.guardHere(x, y);
                break;
            case 'abilityCancel':
                this.pending = 'none';
                this.ui.flash(act.text);
                // 対象選びをやめた押しの連打（2 回目）を、地面の移動・部隊の選択に漏らさない
                this.guardHere(x, y);
                break;
            case 'none':
                break;
        }
    }

    private keyDown(e: KeyboardEvent): void {
        if (this.finished) return;
        const modal = this.ui.modalOpen;
        const onButton = document.activeElement instanceof HTMLButtonElement && this.ui.root.contains(document.activeElement);
        if (modal) {
            if (e.key === 'Enter' && !onButton) {
                e.preventDefault();
                this.ui.modalKey('primary');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.ui.modalKey('cancel');
            } else if (e.code === 'Space' && modal === 'briefing' && !onButton) {
                e.preventDefault();
                this.ui.modalKey('primary');
            }
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code.startsWith('Arrow')) {
            e.preventDefault();
            this.panKeys.add(e.code);
            return;
        }
        if (e.repeat) return;
        if (e.code === 'Space') {
            if (onButton) return; // ボタンに合っているときは、そのボタンを押す
            e.preventDefault();
            this.togglePause();
            return;
        }
        // 1〜8：札の順の味方（味方は最大 8 部隊）
        const allies = this.s.units.filter((u) => u.side === 'ally');
        const digit = /^(Digit|Numpad)([1-8])$/.exec(e.code);
        if (digit) {
            const u = allies[Number(digit[2]) - 1];
            if (u) this.selectFromCard(u.id);
            return;
        }
        switch (e.code) {
            case 'Escape':
                if (this.pending === 'ability') this.ui.flash('能力の対象選びをやめた（使用回数は減っていない）');
                if (this.pending !== 'none') this.pending = 'none';
                else this.select(null);
                break;
            case 'KeyM':
                this.command('move');
                break;
            case 'KeyA':
                this.command('attack');
                break;
            case 'KeyH':
                this.command('hold');
                break;
            case 'KeyR':
                this.command('retreat');
                break;
            case 'KeyT':
                // 向きの指定は、能力のある合戦（「向き」のボタンを出す合戦）だけ
                if (this.s.abilityList.length === 0) return;
                this.command('face');
                break;
            case 'KeyF':
                if (this.s.abilityList.length === 0) return;
                this.ability();
                break;
            case 'Equal':
            case 'NumpadAdd':
                this.zoomButton(1);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                this.zoomButton(-1);
                break;
            case 'Digit0':
            case 'Numpad0':
                this.zoomButton(0);
                break;
            default:
                return;
        }
        e.preventDefault();
    }
}

// ---------------------------------------------------------------- 開発時の確認用（本番には入らない）

function exposeDev(run: BattleRun): void {
    const api = {
        active: true,
        get state() {
            return run.s;
        },
        get ui() {
            return { selectedId: run.selectedId, selection: [...run.selection], pending: run.pending, paused: run.paused, started: run.started, speed: run.speed, resultShown: run.resultShown, modal: run.ui.modalOpen, decided: run.decidedNote };
        },
        get camera() {
            return { ...run.view.cam, maxDist: run.view.maxDist, zoomRatio: run.view.zoomRatio(), camTouched: run.camTouchedNow };
        },
        /** 画面に出ている部隊の名札の四角と重なりの順（z が大きいほど上）。名札の重なりの確認に使う（読むだけ） */
        labelCovers: () => run.ui.labelCovers().map(({ id, rect, z }) => ({ id, l: rect.left, t: rect.top, r: rect.right, b: rect.bottom, z })),
        /** その点（CSS px、ページの左上から）を押したら、どの名札のどこに当たるか（読むだけ。e2e が広げた当たりの点を探すのに使う） */
        labelHitAt(x: number, y: number) {
            const r = appContext().renderer.domElement.getBoundingClientRect();
            return run.labelHitForDev(x - r.left, y - r.top);
        },
        /** 画面の部品（左上の欄・能力の欄・下の札・案内の帯など）の四角（読むだけ） */
        blockers: () => run.ui.blockerRects().map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })),
        /** 表示（three の場面・カメラ）。確認用 */
        get view() {
            return run.view;
        },
        /**
         * 部隊が待っている理由（sim.ts の waitReason。順番待ち queue・開門待ち gate・道が無い noPath・近くの敵 foe・壁 wall・止まっている味方 ally・
         * 何も無い null）。e2e の「10 秒以上動かない部隊」の見張りが、sim.ts と同じ定義で順番待ちを分けるのに使う（読むだけ）
         */
        waitReason(unitId: string) {
            const u = unitById(run.s, unitId);
            return u ? waitReason(run.s, u) : null;
        },
        /** 合戦の時間を一気に進める（命令の台本 script を刻みごとに呼べる） */
        fastForward(seconds: number, script?: (s: BattleState) => void) {
            const end = run.s.t + seconds;
            const events: BattleEvent[] = [];
            while (run.s.t < end - 1e-9 && !run.s.result) {
                script?.(run.s);
                events.push(...stepBattle(run.s, 0.1));
            }
            for (const e of events.slice(-4)) {
                const tone = eventTone(run.s, e);
                if (tone) run.ui.toast(e.text, tone, e.unitId);
            }
            return { t: run.s.t, result: run.s.result, events: events.length };
        },
        order: (unitId: string, o: Order) => issueOrder(run.s, unitId, o),
        /** 状態を直接書き換える確認用（画面の確認では使わず、報告では「直接操作」と書く） */
        useAbility: (unitId: string, targetId?: string) => useAbility(run.s, unitId, targetId),
        /** 号令などの「効果を与えられる相手」（abilities.ts の abilityEffectTargets。読むだけ。確かめの無い能力は null） */
        effectTargets: (unitId: string) => abilityEffectTargets(run.s, unitId),
        allRetreat: () => orderAllRetreat(run.s),
        setTimeScale(k: number) {
            run.devScale = Math.max(0, Math.min(40, k));
        },
        pause(p?: boolean) {
            run.paused = p ?? !run.paused;
        },
        start: () => run.start(),
        select(id: string | null) {
            run.select(id);
        },
        /** 部隊の画面の位置（CSS px、ページの左上から）。実際のクリック・タップの確認に使う */
        screenOf(unitId: string) {
            const i = run.s.units.findIndex((u) => u.id === unitId);
            if (i < 0) return null;
            const p = run.view.unitPos(i);
            const u = run.s.units[i];
            // 夜（第4群）：発見していない敵の画面の位置は出さない（表示の層から漏らさない）
            if (run.s.setup.night && u.side === 'enemy' && !p.shown) return null;
            const r = appContext().renderer.domElement.getBoundingClientRect();
            const x = p.shown ? p.x : u.x;
            const z = p.shown ? p.z : u.z;
            // 丘の上の部隊（敵本陣など）も、描かれている高さで押せるように（地面の高さ + 2 m）
            const q = run.view.project(x, elevationAt(run.s.map, x, z) + 2, z);
            return { x: q.x + r.left, y: q.y + r.top, shown: p.shown };
        },
        screenOfGround(x: number, z: number) {
            const r = appContext().renderer.domElement.getBoundingClientRect();
            const q = run.view.project(x, elevationAt(run.s.map, x, z), z);
            return { x: q.x + r.left, y: q.y + r.top };
        },
        centerOn: (x: number, z: number, dist?: number) => {
            if (dist) run.view.cam.dist = dist;
            run.view.centerOn(x, z);
        },
        /** 台本を実時間の進みに合わせて刻みごとに呼ぶ（null で外す） */
        setScript(fn: ((s: BattleState) => void) | null) {
            run.script = fn;
        },
        /**
         * 部隊の名札の四角（CSS px、ページの左上から）と能力の印（data-ab）・点滅の明るさ。badge は能力の印（◆号令）の四角（無ければ null）。
         * 名札のクリック・タップの確認に使う（読むだけ）
         */
        labelOf(unitId: string) {
            const r = run.ui.labelRect(unitId);
            const g = run.ui.labelRect(unitId, 'badge');
            const e = document.querySelector(`.b-label[data-id="${unitId}"]`) as HTMLElement | null;
            const box = (q: DOMRect) => ({ l: q.left, t: q.top, r: q.right, b: q.bottom, x: (q.left + q.right) / 2, y: (q.top + q.bottom) / 2 });
            return r ? { ...box(r), badge: g ? box(g) : null, ab: e?.dataset.ab ?? '', blink: e ? Number(e.style.getPropertyValue('--ab') || 1) : 1 } : null;
        },
        /**
         * 名札の優先表示の様子（読むだけ）：部隊ごとの見せ方（full・mini・hide）・選んでいる・能力の印（data-ab）・重要な武将・
         * 画面に出ているか（地図の外・まだ着いていない部隊は false）
         */
        /** 最後に並べた名札の項目と結果（読むだけ。名札の優先表示の確かめ） */
        labelLayout: () => run.ui.lastLayout,
        labelFits() {
            return run.s.units.map((u) => {
                const e = document.querySelector(`.b-label[data-id="${u.id}"]`) as HTMLElement | null;
                return { id: u.id, fit: run.ui.labelFit(u.id), shown: !!e && !e.hidden, sel: !!e?.classList.contains('sel'), ab: e?.dataset.ab ?? '', imp: !!(u.generalId || u.leaderId) || u.isHq };
            });
        },
        /** 上の知らせに 1 つ出す（確認用。知らせの畳み＝tuckNotices の確かめに使う。報告では「直接操作」と書く） */
        toast(text: string, tone: 'good' | 'bad' | 'warn' | 'info' = 'info') {
            run.ui.toast(text, tone);
        },
        /** 上の知らせの畳み方（0 そのまま・1 新しい 1 つだけ・2 隠す。battleUi.ts の tuckNotices。読むだけ） */
        noticeFold: () => Number((document.querySelector('.b-topmid') as HTMLElement | null)?.dataset.fold ?? 0),
        /** 兵士の表示の数え上げ（直前のフレーム）：見えている兵士の数・部隊ごとの人数・描画の呼び出しの数・InstancedMesh ごとの数 */
        troopStats: () => run.view.troopStats(),
        /** 生成イラスト素材（Version 22）の地面の様子（読むだけ）：textured（素材の地面）か vertex（今までの地面）・植えた木の数・直前のフレームで描いた足元の影と砂ぼこりの数 */
        art: () => run.view.artProbe(),
        info() {
            const i = appContext().renderer.info;
            return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
        },
    };
    Object.assign(window, { __battle: api });
}
