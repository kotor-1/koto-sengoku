"""
城門・土塀・天守を作って書き出す（同じ場面で組むので、AO は互いの遮蔽も入る）。
    /root/blender-venv/bin/python proto3d/blender/gate/build.py [gate walls keep] [--no-bake] [--no-preview] [--quick] [--export=gate_v2,...]

--export を付けると、その組だけを焼いて書き出す（ほかの組は場面に置くだけ＝AO の遮蔽にだけ使う）。
  例：門だけ作り直す（塀の遮蔽は入れる、walls_v2.glb は書き換えない）: build.py gate walls --export=gate_v2

書き出し: proto3d/public/models/gate_v2.glb, walls_v2.glb, keep.glb
当たり判定: proto3d/blender/gate/gate_v2.meta.json, walls_v2.meta.json（ゲームの座標）
確認の描画: e2e-out/blender/gate_*.png
"""
from __future__ import annotations

import sys
import time

import gkit
from gkit import MODELS_DIR, PREVIEW_DIR, HERE, finish, mats, render, preview_ground, to_objects, write_meta
from common import export_glb, reset, triangles

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
WHAT = set(ARGS) or {'gate', 'walls', 'keep'}
BAKE = '--no-bake' not in sys.argv
PREVIEW = '--no-preview' not in sys.argv
QUICK = '--quick' in sys.argv
EXPORT = next((set(a.split('=', 1)[1].split(',')) for a in sys.argv if a.startswith('--export=')), None)

T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


# 材質ごとの色むら（量, 暖かさ）と AO 用の細分（m）
TINT = {'wood_timber#frame': (0.07, 0.03), 'wood_timber#door': (0.09, 0.03), 'wood_timber#end': (0.1, 0.03), 'wood_timber#edge': (0.04, 0.02), 'wood_timber#weather': (0.05, 0.02),
        'wood_timber#soffit': (0.06, 0.02), 'tile_ibushi': (0.075, 0.015), 'tile_ibushi#disc': (0.06, 0.01),
        'stone_granite': (0.07, 0.02), 'stone_ishigaki': (0.12, 0.05), 'stone_ishigaki#block': (0.09, 0.03),
        'wood_dark#frame': (0.07, 0.03), 'wood_dark#band': (0.05, 0.02), 'wood_dark#end': (0.08, 0.02)}
# 明るさ（頂点色に掛ける。three.js でも基本色に掛かる）
# 門の材：色は画像 wood_timber で決める（日なたで中くらいの暗い茶）。頂点色は全体を暗くするのに使わず、部材の差だけ：
# 扉は 1 割暗く、化粧裏板はわずかに明るく、垂木の木口と鏡柱の面取り（角の摩耗）は少し明るく、
# 鏡柱の町の側の面（雨と日で風化）は 1.1 倍で少し灰色に（面ごとの明るさの差で柱の面が読める）。
# 軒瓦の瓦当は 0.7 倍（空を映して銀の粒に見えないように）。石は落ち着いた温かい灰色、目地の奥は 0.5 倍
GAIN = {'wood_timber#frame': (0.75, 0.72, 0.71), 'wood_timber#door': (0.68, 0.65, 0.64), 'wood_timber#soffit': (0.8, 0.77, 0.75),
        'wood_timber#end': (0.97, 0.93, 0.88), 'wood_timber#edge': (1.0, 0.98, 0.97), 'wood_timber#weather': (0.82, 0.82, 0.84), 'tile_ibushi': (0.78, 0.78, 0.8), 'tile_ibushi#disc': (0.546, 0.546, 0.56),
        'tile_ibushi#valley': (0.62, 0.62, 0.64), 'stone_ishigaki': (0.93, 0.93, 0.93), 'stone_ishigaki#block': (0.97, 0.96, 0.95),
        'stone_ishigaki#core': (0.5, 0.48, 0.46), 'wood_dark#band': (0.85, 0.82, 0.8), 'wood_dark#frame': (0.8, 0.76, 0.72),
        'wood_dark#soffit': (0.95, 0.93, 0.9), 'wood_dark#end': (0.85, 0.8, 0.76)}
DENSE = {'stone_granite': 0.3}


def custom_mats():
    """ライブラリの変種（瓦当：粗さ 0.75 の一定値）"""
    return {'tile_ibushi#disc': gkit.variant_material('tile_ibushi', 'disc', rough=0.75)}


def main():
    reset()
    groups = {}
    metas = {}
    if 'gate' in WHAT:
        import model_gate
        g, info = model_gate.build_gate()
        log('gate geo tris', g.tris())
        objs = to_objects(g, 'gate', custom_mats())
        finish(objs, tint=TINT, densify=DENSE, gains=GAIN, seed=5)
        groups['gate_v2'] = objs
        metas['gate_v2'] = model_gate.gate_meta(info)
    if 'walls' in WHAT:
        import model_walls
        g, info = model_walls.build_walls()
        log('walls geo tris', g.tris())
        objs = to_objects(g, 'walls', custom_mats())
        finish(objs, tint=TINT, densify=DENSE, gains=GAIN, seed=9)
        plaster = model_walls.make_plaster(info)
        groups['walls_v2'] = objs + [plaster]
        metas['walls_v2'] = model_walls.walls_meta(info)
    if 'keep' in WHAT:
        import model_keep
        objs = model_keep.build_keep()
        groups['keep'] = objs
    for k, objs in groups.items():
        log(k, 'triangles', triangles(objs))

    out = {k: v for k, v in groups.items() if EXPORT is None or k in EXPORT}
    if BAKE:
        near = [o for k in ('gate_v2', 'walls_v2') if k in out for o in groups.get(k, []) if not o.get('koto_lightmap')]
        # 門の木：AO は本当に遮られるところ（継ぎ目・梁の下・根元）だけ。距離を短くして、広い面を一様に暗くしない
        wood = [o for o in near if o.get('koto_lib') == 'wood_timber']
        rest = [o for o in near if o.get('koto_lib') != 'wood_timber']
        if rest:
            log('AO bake (vertex colors)', len(rest), 'objects')
            mats.bake_ao_to_color(rest, ground_plane=True, samples=24 if QUICK else 48, distance=1.6, strength=0.6, ground_z=0.0)
        if wood:
            log('AO bake (vertex colors, wood)', len(wood), 'objects')
            mats.bake_ao_to_color(wood, ground_plane=True, samples=24 if QUICK else 48, distance=0.7, strength=0.55, ground_z=0.0)
        for o in (groups.get('walls_v2', []) if 'walls_v2' in out else []):
            if o.get('koto_lightmap'):
                log('AO bake (lightmap)', o.name)
                mats.bake_ao_to_texture(o, 1024, samples=24 if QUICK else 48, distance=2.0, strength=0.7, ground_z=0.0)
        if 'keep' in out:
            import model_keep
            model_keep.bake(groups['keep'], quick=QUICK)
        log('bake done')

    for k, objs in out.items():
        path = MODELS_DIR / f'{k}.glb'
        size = export_glb(path, objs)
        log('export', path, f'{size / 1e6:.2f} MB')
        summ = mats.glb_summary(path)
        log('  materials', [(m['name'], m['base'], m['normal'], bool(m['occlusion'])) for m in summ['materials']])
        log('  prims', len(summ['primitives']), 'COLOR_0:', sum('COLOR_0' in p['attrs'] for p in summ['primitives']))
    for k, (col, blk) in metas.items():
        if k not in out:
            continue
        write_meta(HERE / f'{k}.meta.json', k, col, blk)
        log('meta', k, len(col), 'colliders', len(blk), 'blockers')

    if PREVIEW:
        import preview
        preview.run(groups, quick=QUICK)
    log('done')


if __name__ == '__main__':
    main()
