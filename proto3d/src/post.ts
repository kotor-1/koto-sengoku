/**
 * 画面の仕上げ（画質「高」のときだけ）：物が接する所・奥まった所の陰（GTAO、画面の深さから求める）と、
 * 色の整え（トーンマッピングの後に、陰を青く・日なたを暖かく・彩度と明暗を少し強く・画面の隅を少し暗く）。
 * three.js 付属の EffectComposer と GTAOPass を使う（追加の読み込みなし）。陰の計算は半分の解像度で行う。
 * 画質「低」（?q=low）ではこれを使わず、これまでどおり renderer.render だけで描く。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** 色の整え（表示の色＝sRGB の値に対して）。値は実際のゲーム画面を参考画像と並べて決めた */
export const GRADE = {
    /** 陰の色（暗い所に寄せる色）と強さ */
    shadowTint: new THREE.Color(0.86, 0.95, 1.12),
    /** 日なたの色（明るい所に寄せる色） */
    highlightTint: new THREE.Color(1.06, 1.0, 0.9),
    saturation: 1.18,
    /** 明暗の強さ（中間の明るさを軸に S 字） */
    contrast: 0.22,
    /** 画面の隅を暗くする強さ */
    vignette: 0.28,
    /** 物の陰（AO）の強さ */
    ao: 0.85,
};

export interface Post {
    render(): void;
    setSize(w: number, h: number): void;
    composer: EffectComposer;
    gtao: GTAOPass;
}

/** 確認用（開発時の調整）：最後に作った仕上げ */
export const lastPost: { post?: Post; uniforms?: Record<string, THREE.IUniform> } = {};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Post {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // 場面を描く先：深さも画像として残し（陰の計算に使う）、縁のぎざぎざを抑える（4 倍の標本）
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: 4,
        depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const depth = (composer.readBuffer as THREE.WebGLRenderTarget).depthTexture!;
    // 深さは場面を描いたときのものを使い、向き（法線）は深さから求める（場面をもう 1 回描かない）。
    // コンストラクタに深さを渡すと r186 では内部の描き先が作られず失敗するので、作った後で差し替える
    const gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.setGBuffer(depth, undefined);
    gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    // 陰だけを求め、画面への重ね合わせは仕上げの 1 回（下）でまとめて行う
    gtao.output = GTAOPass.OUTPUT.Off;
    gtao.needsSwap = false;
    // 陰の計算は半分の解像度で（重さを抑える）
    const gtaoSetSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w: number, h: number) => gtaoSetSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    composer.addPass(gtao);

    const out = new OutputPass();
    out.uniforms.tAO = { value: gtao.pdRenderTarget.texture };
    out.uniforms.aoStrength = { value: GRADE.ao };
    out.uniforms.shadowTint = { value: GRADE.shadowTint };
    out.uniforms.highlightTint = { value: GRADE.highlightTint };
    out.uniforms.saturation = { value: GRADE.saturation };
    out.uniforms.contrast = { value: GRADE.contrast };
    out.uniforms.vignette = { value: GRADE.vignette };
    out.material.fragmentShader = out.material.fragmentShader
        .replace(
            'uniform sampler2D tDiffuse;',
            `uniform sampler2D tDiffuse;
            uniform sampler2D tAO;
            uniform float aoStrength;
            uniform vec3 shadowTint;
            uniform vec3 highlightTint;
            uniform float saturation;
            uniform float contrast;
            uniform float vignette;`,
        )
        .replace(
            'gl_FragColor = texture2D( tDiffuse, vUv );',
            `gl_FragColor = texture2D( tDiffuse, vUv );
            float ao = texture2D( tAO, vUv ).r;
            gl_FragColor.rgb *= mix( 1.0, ao, aoStrength );`,
        )
        .replace(
            /(#ifdef SRGB_TRANSFER\s*gl_FragColor = sRGBTransferOETF\( gl_FragColor \);\s*#endif)/,
            `$1
            {
                vec3 c = clamp( gl_FragColor.rgb, 0.0, 1.0 );
                float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
                // 陰は青く、日なたは暖かく
                c *= mix( shadowTint, highlightTint, smoothstep( 0.08, 0.7, l ) );
                // 彩度
                l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
                c = mix( vec3( l ), c, saturation );
                // 明暗（中間を軸に S 字）
                c = clamp( c, 0.0, 1.0 );
                vec3 s = c * c * ( 3.0 - 2.0 * c );
                c = mix( c, s, contrast );
                // 画面の隅を少し暗く
                vec2 q = vUv - 0.5;
                c *= 1.0 - vignette * smoothstep( 0.25, 0.85, dot( q, q ) * 2.2 );
                gl_FragColor.rgb = c;
            }`,
        );
    if (!out.material.fragmentShader.includes('vignette * smoothstep')) throw new Error('画面の仕上げの組み立てに失敗しました');
    // 最後の画面への描き出しの後に入れ替えない（次のコマも同じ描き先に描き、深さを陰の計算に使う）
    out.needsSwap = false;
    composer.addPass(out);

    const post: Post = {
        composer,
        gtao,
        render: () => composer.render(),
        setSize: (w, h) => {
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(w, h);
        },
    };
    lastPost.post = post;
    lastPost.uniforms = out.uniforms;
    return post;
}
