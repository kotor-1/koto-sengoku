/**
 * BGM 3 種（城下町・危機／軍議・合戦）の楽譜（データだけ。three も DOM も Web Audio も使わない）。
 * すべてこのファイルで書いたオリジナルの旋律・伴奏・打楽器の型で、既存の曲・録音は使っていない。
 *
 * - 五音の音階（城下：陽音階・危機：都節（陰音階）・合戦：民謡の音階）。
 * - 段（A・B・C など）ごとに、旋律（笛・尺八の気分）・伴奏（箏）・打楽器（太鼓・締太鼓・鉦・拍子木・法螺）の型を変え、つないで繰り返す。
 * - 旋律は「音階の何番目:拍の長さ」を | で小節に区切った文字で書く（r は休み、b を付けると押し手で少し上げる）。
 * - 打楽器は 1 小節を 16 に分けた文字（x 弱・X 強・. 休み）。
 */

export type SongId = 'town' | 'crisis' | 'battle';
export type Inst = 'koto' | 'fue' | 'shaku' | 'taiko' | 'shime' | 'kane' | 'hyoshigi' | 'horagai';

/** 1 つの音（小節の始めからの拍・長さの拍） */
export interface NoteEvent {
    beat: number;
    inst: Inst;
    midi: number;
    dur: number;
    vel: number;
    bend?: number;
    pan?: number;
}

/** 伴奏の箏の型（和音の根の音階の番号に足す番号。1 小節 8 つ＝8 分音符） */
type KotoStyle = { kind: 'arp'; offsets: number[]; vel: number } | { kind: 'dyad'; beats: number[]; vel: number } | { kind: 'ostinato'; degrees: number[]; vel: number } | { kind: 'none' };

export interface Section {
    name: string;
    /** 旋律の楽器（'koto' は箏が旋律を弾く） */
    lead: 'fue' | 'shaku' | 'koto' | null;
    melody: string;
    /** 小節ごとの和音の根（音階の番号）。伴奏の型に使う */
    harmony: number[];
    koto: KotoStyle;
    drums: Partial<Record<'taiko' | 'shime' | 'kane' | 'hyoshigi', string[]>>;
    /** 段の始めに法螺を吹く（長さ・拍） */
    horagai?: number;
}

export interface Song {
    id: SongId;
    title: string;
    bpm: number;
    /** 音階（根からの半音の数。5 つ） */
    scale: number[];
    /** 音階の 0 番の高さ（midi） */
    root: number;
    sections: Record<string, Section>;
    /** 段の順（最初の繰り返しで流す）。loopFrom から後を繰り返す */
    order: string[];
    loopFrom: number;
    /** 曲全体の音量（3 曲の大きさをそろえる。オフラインで描いた音の RMS で合わせた値） */
    gain: number;
}

const rep = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

// ---------------------------------------------------------------- 城下町（陽音階・明るく歩く速さ）

const TOWN: Song = {
    id: 'town',
    title: '城下の昼',
    bpm: 88,
    gain: 1.35,
    scale: [0, 2, 5, 7, 9],
    root: 62, // D4
    order: ['A', 'B', 'C', 'A2'],
    loopFrom: 0,
    sections: {
        A: {
            name: 'A',
            lead: 'fue',
            melody: '5:1 6:0.5 5:0.5 4:1 3:1 | 4:1.5 3:0.5 2:2 | 3:1 4:1 5:1 6:1 | 7:2 6:1 r:1 | 6:1 5:0.5 4:0.5 3:1 4:1 | 5:1.5 4:0.5 3:1 2:1 | 1:1 2:1 3:1 4:0.5 3:0.5 | 2:3 r:1',
            harmony: [0, 2, 3, 0, 3, 2, 1, 0],
            koto: { kind: 'arp', offsets: [-5, -3, -2, 0, -2, -3, -5, -2], vel: 0.32 },
            drums: { shime: rep(8, 'x.......x.......'), kane: rep(8, '............x...') },
        },
        B: {
            name: 'B',
            lead: 'fue',
            melody: '7:1.5 8:0.5 7:1 6:1 | 5:2 6:1 5:1 | 4:1 5:1 6:1.5b 5:0.5 | 4:3 r:1 | 3:1 5:1 4:1 3:1 | 2:1 3:0.5 4:0.5 5:2 | 6:1 7:1 6:1 5:0.5 4:0.5 | 5:3 r:1',
            harmony: [3, 0, 2, 3, 1, 2, 3, 0],
            koto: { kind: 'dyad', beats: [0, 1.5, 2, 3], vel: 0.3 },
            drums: { taiko: rep(8, 'x...............'), shime: rep(8, '....x.......x.x.'), hyoshigi: rep(8, '........x.......') },
        },
        C: {
            name: 'C（箏の段）',
            lead: 'koto',
            melody: '0:0.5 2:0.5 3:0.5 5:0.5 4:1 3:1 | 2:1 3:0.5 2:0.5 1:2b | 0:0.5 1:0.5 2:0.5 3:0.5 5:1 4:1 | 3:1 2:1 0:2',
            harmony: [0, 1, 0, 0],
            koto: { kind: 'dyad', beats: [0, 2], vel: 0.42 },
            drums: { shime: rep(4, 'x.......x.......'), kane: rep(4, '....x.......x...') },
        },
        A2: {
            name: 'A′',
            lead: 'fue',
            melody: '5:1 6:0.5 5:0.5 4:1 3:1 | 4:1.5 3:0.5 2:2 | 3:1 4:1 5:1 6:1 | 7:2 6:1 r:1 | 6:1 5:0.5 4:0.5 3:1 4:1 | 5:1.5 4:0.5 3:1 2:1 | 3:1 4:1 6:1 5:0.5 4:0.5 | 5:3 r:1',
            harmony: [0, 2, 3, 0, 3, 2, 3, 0],
            koto: { kind: 'arp', offsets: [-5, -2, 0, -2, -5, -3, 0, -3], vel: 0.32 },
            drums: { taiko: ['x...............', ...rep(7, '................')], shime: rep(8, 'x.......x...x...'), kane: rep(8, '............x...') },
        },
    },
};

// ---------------------------------------------------------------- 危機・軍議（都節の音階・ゆっくり・低い太鼓）

const CRISIS: Song = {
    id: 'crisis',
    title: '急報',
    bpm: 66,
    gain: 0.8,
    scale: [0, 1, 5, 7, 8],
    root: 52, // E3
    order: ['A', 'B', 'A2'],
    loopFrom: 0,
    sections: {
        A: {
            name: 'A',
            lead: 'shaku',
            melody: '7:3 6:1 | 5:4 | 6:1.5 7:0.5 8:2 | 7:3 r:1 | 9:2 8:1 7:1 | 6:2b 7:1 6:1 | 5:1 6:1 4:2 | 5:4',
            harmony: [0, 0, 1, 0, 2, 1, 0, 0],
            koto: { kind: 'dyad', beats: [0, 2], vel: 0.34 },
            drums: { taiko: rep(8, 'X..x............') },
        },
        B: {
            name: 'B（高まる）',
            lead: 'shaku',
            melody: '10:2 9:1 8:1 | 9:2b 8:2 | 7:1 8:1 9:1 8:1 | 7:4 | 8:1.5 9:0.5 10:2 | 9:1 8:1 7:2 | 6:1 5:1 6:1 4:1 | 5:4',
            harmony: [0, 1, 0, 2, 0, 1, 0, 0],
            koto: { kind: 'ostinato', degrees: [0, 0, 1, 0, 0, 0, 1, 0], vel: 0.26 },
            drums: {
                taiko: ['X..x............', 'X..x............', 'X..x............', 'x.x.x.x.xxxxXXXX', 'X..x............', 'X..x............', 'X..x....x...x...', 'x.x.x.x.xxxxXXXX'],
                kane: rep(8, '........x.......'),
            },
        },
        A2: {
            name: 'A′（箏の刻み）',
            lead: 'shaku',
            melody: '7:3 6:1 | 5:4 | 6:1.5 7:0.5 8:2 | 7:3 r:1 | 9:2 8:1 7:1 | 6:2 7:1 6:1 | 5:1 6:1 4:2 | 5:4',
            harmony: [0, 0, 1, 0, 2, 1, 0, 0],
            koto: { kind: 'ostinato', degrees: [0, 2, 1, 0, 0, 2, 1, 0], vel: 0.24 },
            drums: { taiko: rep(8, 'X..x....x.......'), hyoshigi: rep(8, '............x...') },
        },
    },
};

// ---------------------------------------------------------------- 合戦（民謡の音階・速い太鼓・法螺）

const BATTLE: Song = {
    id: 'battle',
    title: '合戦',
    bpm: 136,
    gain: 0.75,
    scale: [0, 3, 5, 7, 10],
    root: 50, // D3
    order: ['I', 'A', 'B', 'C'],
    loopFrom: 1,
    sections: {
        I: {
            name: '始め（法螺と太鼓）',
            lead: null,
            melody: 'r:4 | r:4',
            harmony: [0, 0],
            koto: { kind: 'none' },
            drums: { taiko: ['X.......X.......', 'X...X...X.x.XXXX'] },
            horagai: 3.5,
        },
        A: {
            name: 'A',
            lead: 'fue',
            melody: '10:1 11:0.5 10:0.5 9:1 8:1 | 7:1 8:1 10:2 | 11:1 12:1 11:0.5 10:0.5 9:1 | 10:3 r:1 | 8:0.5 9:0.5 10:1 9:0.5 8:0.5 7:1 | 8:1 7:1 5:2 | 6:1 7:1 8:1 9:1 | 10:3 r:1',
            harmony: rep(8, 0),
            koto: { kind: 'ostinato', degrees: [0, 0, 5, 0, 3, 0, 5, 4], vel: 0.3 },
            drums: { taiko: rep(8, 'X..x..X.X..x..x.'), shime: rep(8, 'x.x.x.x.x.x.x.x.'), kane: rep(8, '....x.......x...') },
        },
        B: {
            name: 'B',
            lead: 'fue',
            melody: '13:2 12:1 11:1 | 10:1 11:1 12:2 | 11:1 10:1 9:1 8:1 | 7:3 r:1 | 8:1 10:1 11:1 10:1 | 12:1.5 11:0.5 10:2 | 9:1 8:1 7:1 6:1 | 5:3 r:1',
            harmony: [0, 0, 2, 2, 0, 0, 3, 0],
            koto: { kind: 'ostinato', degrees: [0, 3, 5, 3, 0, 3, 5, 7], vel: 0.3 },
            drums: { taiko: rep(8, 'X.x.X.x.X.x.XxXx'), shime: rep(8, 'x.xxx.xxx.xxx.xx'), kane: rep(8, '....x.......x...') },
        },
        C: {
            name: 'C（太鼓の掛け合い）',
            lead: null,
            melody: 'r:4 | r:4 | r:4 | r:4',
            harmony: [0, 0, 0, 0],
            koto: { kind: 'ostinato', degrees: [0, 0, 0, 0, 0, 0, 1, 0], vel: 0.22 },
            drums: { taiko: ['X...X...X.X.X...', '....x.x.....XXXX', 'X...X...X.X.X...', 'x.x.x.x.xxxxXXXX'], hyoshigi: ['....x.......x...', 'x.......x.......', '....x.......x...', '................'] },
            horagai: 3,
        },
    },
};

export const SONGS: Readonly<Record<SongId, Song>> = { town: TOWN, crisis: CRISIS, battle: BATTLE };

export const BEATS_PER_BAR = 4;

/** 旋律の 1 小節 */
export interface MelodyNote {
    degree: number | null;
    beats: number;
    bend: boolean;
}

/** 旋律の文字を小節ごとに読む */
export function parseMelody(text: string): MelodyNote[][] {
    return text.split('|').map((bar) =>
        bar
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((tok) => {
                const m = /^(r|-?\d+):([\d.]+)(b?)$/.exec(tok);
                if (!m) throw new Error(`旋律の書き方の誤り：${tok}`);
                return { degree: m[1] === 'r' ? null : Number(m[1]), beats: Number(m[2]), bend: m[3] === 'b' };
            }),
    );
}

/** 音階の番号 → 音の高さ（midi） */
export function degreeToMidi(song: Song, degree: number): number {
    const n = song.scale.length;
    const oct = Math.floor(degree / n);
    const k = ((degree % n) + n) % n;
    return song.root + oct * 12 + song.scale[k]!;
}

/** 繰り返しの中の小節の並び（段の名前と、段の中の小節の番号）。index は 0 から数え続けた番号 */
export function barAt(song: Song, index: number): { section: Section; bar: number } {
    const lens = song.order.map((n) => song.sections[n]!.harmony.length);
    const first = lens.reduce((a, b) => a + b, 0);
    let i = index;
    if (i >= first) {
        const loopLens = lens.slice(song.loopFrom);
        const loop = loopLens.reduce((a, b) => a + b, 0);
        const before = lens.slice(0, song.loopFrom).reduce((a, b) => a + b, 0);
        i = before + ((i - first) % loop);
    }
    for (let k = 0; k < song.order.length; k++) {
        if (i < lens[k]!) return { section: song.sections[song.order[k]!]!, bar: i };
        i -= lens[k]!;
    }
    throw new Error('小節が見つかりません');
}

const parsed = new WeakMap<Section, MelodyNote[][]>();
function melodyOf(s: Section): MelodyNote[][] {
    let m = parsed.get(s);
    if (!m) {
        m = parseMelody(s.melody);
        parsed.set(s, m);
    }
    return m;
}

/** わずかな揺らぎ（決まった値。同じ小節は同じ音） */
function wobble(i: number, k: number): number {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
}

/** index 番目の小節の音（小節の始めからの拍） */
export function barEvents(song: Song, index: number): NoteEvent[] {
    const { section: s, bar } = barAt(song, index);
    const out: NoteEvent[] = [];
    const h = s.harmony[bar] ?? 0;
    // 旋律
    const mel = melodyOf(s)[bar] ?? [];
    let beat = 0;
    const lead = s.lead;
    mel.forEach((n, k) => {
        if (n.degree !== null && lead) {
            const w = wobble(index, k);
            if (lead === 'koto') {
                out.push({ beat, inst: 'koto', midi: degreeToMidi(song, n.degree + 5), dur: n.beats * (60 / song.bpm), vel: 0.95 + w * 0.1, ...(n.bend ? { bend: 1 } : {}), pan: 0.15 });
            } else {
                const d = degreeToMidi(song, n.degree);
                out.push({ beat, inst: lead, midi: d, dur: n.beats * (60 / song.bpm) * 0.96, vel: (lead === 'fue' ? 0.22 : 0.3) + w * 0.05, ...(n.bend ? { bend: 1 } : {}), pan: -0.1 });
            }
        }
        beat += n.beats;
    });
    // 伴奏（箏）
    const k = s.koto;
    const spb = 60 / song.bpm;
    if (k.kind === 'arp') {
        k.offsets.forEach((o, i) => out.push({ beat: i * 0.5, inst: 'koto', midi: degreeToMidi(song, h + o), dur: spb * 1.5, vel: k.vel * (i % 2 === 0 ? 1 : 0.78) * (0.92 + wobble(index, 20 + i) * 0.16), pan: 0.35 }));
    } else if (k.kind === 'dyad') {
        for (const b of k.beats) {
            out.push({ beat: b, inst: 'koto', midi: degreeToMidi(song, h - 5), dur: spb * 2, vel: k.vel, pan: 0.3 });
            out.push({ beat: b + 0.04, inst: 'koto', midi: degreeToMidi(song, h - 3), dur: spb * 2, vel: k.vel * 0.8, pan: 0.4 });
        }
    } else if (k.kind === 'ostinato') {
        k.degrees.forEach((d, i) => out.push({ beat: i * 0.5, inst: 'koto', midi: degreeToMidi(song, h + d), dur: spb * 0.6, vel: k.vel * (i % 2 === 0 ? 1 : 0.75), pan: 0.3 }));
    }
    // 打楽器
    for (const [inst, pats] of Object.entries(s.drums) as [Inst, string[]][]) {
        const pat = pats[bar % pats.length] ?? '';
        for (let i = 0; i < pat.length && i < 16; i++) {
            const c = pat[i];
            if (c !== 'x' && c !== 'X') continue;
            const base = inst === 'taiko' ? 0.62 : inst === 'shime' ? 0.3 : inst === 'kane' ? 0.12 : 0.22;
            out.push({ beat: i / 4, inst, midi: 0, dur: 0, vel: base * (c === 'X' ? 1.35 : 1) * (0.9 + wobble(index, 40 + i) * 0.2) });
        }
    }
    if (s.horagai && bar === 0) out.push({ beat: 0, inst: 'horagai', midi: 55, dur: s.horagai * spb, vel: 0.35 });
    return out.sort((a, b) => a.beat - b.beat);
}

/** 1 小節の長さ（秒） */
export function barSeconds(song: Song): number {
    return (60 / song.bpm) * BEATS_PER_BAR;
}
