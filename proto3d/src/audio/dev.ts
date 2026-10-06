/**
 * 開発時だけの確かめの口（window.__audio）。本番のビルドには入らない（boot が import.meta.env.DEV のときだけ読み込む）。
 * - probe：音の様子（曲・声・効果音の数・設定）。
 * - level：マスターの後（ミュートの後）の音の大きさ（AnalyserNode の RMS と最大値）。
 * - meter(ms, every)：その間の音の大きさを every ms ごとに記録して返す。
 * - startRecord()／stopRecord()：マスターの後の音を MediaRecorder で取り、base64 の音のファイル（webm/opus）で返す。
 * - mixStream()：マスターの後の音の MediaStream（画面の流しと一緒に取るとき）。
 */
import type { AudioSystem } from './index';

export function exposeAudioDev(sys: AudioSystem): void {
    let dest: MediaStreamAudioDestinationNode | null = null;
    let rec: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    const stream = (): MediaStream | null => {
        const e = sys.engine;
        if (!e.ctx || !e.analyser) return null;
        if (!dest) {
            dest = e.ctx.createMediaStreamDestination();
            e.analyser.connect(dest);
        }
        return dest.stream;
    };
    Object.assign(window, {
        __audio: {
            sys,
            get probe() {
                return sys.probe();
            },
            level: () => sys.engine.level(),
            now: () => sys.engine.now(),
            async meter(ms = 1000, every = 50) {
                const out: { t: number; ctxT: number; rms: number; peak: number }[] = [];
                const t0 = performance.now();
                while (performance.now() - t0 < ms) {
                    const l = sys.engine.level();
                    out.push({ t: Math.round(performance.now() - t0), ctxT: Math.round(sys.engine.now() * 1000) / 1000, rms: l.rms, peak: l.peak });
                    await new Promise((r) => setTimeout(r, every));
                }
                return out;
            },
            mixStream: stream,
            startRecord(): boolean {
                const s = stream();
                if (!s || rec) return false;
                chunks = [];
                rec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' });
                rec.ondataavailable = (ev) => {
                    if (ev.data.size) chunks.push(ev.data);
                };
                rec.start(500);
                return true;
            },
            async stopRecord(): Promise<string | null> {
                const r = rec;
                if (!r) return null;
                rec = null;
                await new Promise<void>((res) => {
                    r.onstop = () => res();
                    r.stop();
                });
                const buf = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                return btoa(bin);
            },
        },
    });
}
