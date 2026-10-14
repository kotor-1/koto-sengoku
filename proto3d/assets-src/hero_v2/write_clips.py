#!/usr/bin/env python3
"""人物の GLB の動き（Idle / Walk / Run）だけを、hero_motion.py の動きに差し替えた写しを書く（Version 28）。
形・重み・材質・画像のデータは 1 バイトも変えない（並べ直すだけ。画像の中身は同じバイト列のまま）。元の GLB は消さない・上書きしない。

    python3 proto3d/assets-src/hero_v2/write_clips.py <元の GLB> <書き出す GLB> [--relax-arms] [--check]

--relax-arms：第 3 版の主人公（blender/hero/build_hero_v3.py の relax_arms）と同じく、どの動きでも上腕を体の側へ 13°、肘を 8° 曲げる。
  元の hero_v3_mpfb.glb の動きは、hero_v2.glb の動きの上腕・前腕の回転に一定の回転を左から掛けたものだった（全コマで差の標準偏差 0 を確かめた：
  上腕 Rz(∓0.2269)、前腕 Rx(−0.1396)）。ここでも同じ回転を掛ける。
--check：書いた後に読み直し、形・画像のデータが元と同じバイト列であることを確かめる。

使い方（Version 28 で作った物）：
    python3 proto3d/assets-src/hero_v2/write_clips.py proto3d/public/models/hero_v2.glb proto3d/public/models/hero_v2b.glb --check
    python3 proto3d/assets-src/hero_v2/write_clips.py proto3d/public/models/hero_v3_mpfb.glb proto3d/public/models/hero_v3b_mpfb.glb --relax-arms --check
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import struct
import sys

import numpy as np
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import hero_motion as HM  # noqa: E402

RELAX = {
    'LeftUpperArm': Rotation.from_rotvec([0., 0., -0.2269]),
    'RightUpperArm': Rotation.from_rotvec([0., 0., 0.2269]),
    'LeftForeArm': Rotation.from_rotvec([-0.1396, 0., 0.]),
    'RightForeArm': Rotation.from_rotvec([-0.1396, 0., 0.]),
}


def read_glb(path):
    b = pathlib.Path(path).read_bytes()
    if b[:4] != b'glTF':
        raise SystemExit(f'{path} は GLB ではありません')
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    bs = 20 + jl
    bl = struct.unpack_from('<I', b, bs)[0]
    return j, bytes(b[bs + 8:bs + 8 + bl])


def view_bytes(j, binary, i):
    v = j['bufferViews'][i]
    o = v.get('byteOffset', 0)
    return binary[o:o + v['byteLength']]


def write_glb(path, j, binary):
    jj = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode()
    jj += b' ' * ((-len(jj)) % 4)
    bb = binary + b'\0' * ((-len(binary)) % 4)
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(jj) + 8 + len(bb)) + struct.pack('<I4s', len(jj), b'JSON') + jj + struct.pack('<I4s', len(bb), b'BIN\0') + bb
    pathlib.Path(path).write_bytes(out)


def replace_animations(j, binary, relax):
    anim_acc = set()
    for a in j.get('animations', []):
        for s in a['samplers']:
            anim_acc.add(s['input'])
            anim_acc.add(s['output'])
    # 動き以外（形・重み・骨の初めの行列・画像）が使う accessor / bufferView は残す
    keep_acc = [i for i in range(len(j['accessors'])) if i not in anim_acc]
    used_views = {j['accessors'][i]['bufferView'] for i in keep_acc if 'bufferView' in j['accessors'][i]}
    used_views |= {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im}
    keep_views = [i for i in range(len(j['bufferViews'])) if i in used_views]
    vmap = {}
    out = bytearray()
    views = []
    for i in keep_views:
        while len(out) % 4:
            out.append(0)
        v = dict(j['bufferViews'][i])
        data = view_bytes(j, binary, i)
        v['byteOffset'] = len(out)
        out.extend(data)
        vmap[i] = len(views)
        views.append(v)
    amap = {}
    accs = []
    for i in keep_acc:
        a = dict(j['accessors'][i])
        if 'bufferView' in a:
            a['bufferView'] = vmap[a['bufferView']]
        amap[i] = len(accs)
        accs.append(a)
    for m in j.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: amap[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = amap[p['indices']]
            for t in p.get('targets', []):
                for k in t:
                    t[k] = amap[t[k]]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
    for im in j.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = vmap[im['bufferView']]
    j['bufferViews'] = views
    j['accessors'] = accs

    def add(arr, typ, bounds=False):
        a = np.ascontiguousarray(arr, dtype='<f4')
        while len(out) % 4:
            out.append(0)
        vi = len(j['bufferViews'])
        j['bufferViews'].append({'buffer': 0, 'byteOffset': len(out), 'byteLength': a.nbytes})
        out.extend(a.tobytes())
        n = a.shape[0]
        acc = {'bufferView': vi, 'componentType': 5126, 'count': n, 'type': typ}
        if bounds:
            aa = a.reshape(n, -1)
            acc['min'] = aa.min(0).tolist()
            acc['max'] = aa.max(0).tolist()
        j['accessors'].append(acc)
        return len(j['accessors']) - 1

    # 骨の名前 → 節（骨組みの関節の一覧から。形の節に同じ名前（Head など）があっても取り違えない）
    joints = j['skins'][0]['joints']
    node_of = {j['nodes'][k]['name']: k for k in joints}
    missing = [b for b in HM.BONE_NAMES if b not in node_of]
    if missing:
        raise SystemExit(f'骨が見つかりません：{missing}')
    anims = []
    for clip in HM.build_clips():
        ani = {'name': clip['name'], 'samplers': [], 'channels': []}
        ta = add(clip['times'], 'SCALAR', bounds=True)
        for bn in HM.BONE_NAMES:
            if bn == 'Root':
                continue
            rs = np.array(clip['rots'][bn], dtype=float)
            if relax and bn in RELAX:
                rs = (RELAX[bn] * Rotation.from_quat(rs)).as_quat()
            for i in range(1, len(rs)):
                if rs[i] @ rs[i - 1] < 0:
                    rs[i] *= -1
            si = len(ani['samplers'])
            ani['samplers'].append({'input': ta, 'output': add(rs, 'VEC4'), 'interpolation': 'LINEAR'})
            ani['channels'].append({'sampler': si, 'target': {'node': node_of[bn], 'path': 'rotation'}})
        si = len(ani['samplers'])
        ani['samplers'].append({'input': ta, 'output': add(clip['trans'], 'VEC3'), 'interpolation': 'LINEAR'})
        ani['channels'].append({'sampler': si, 'target': {'node': node_of['Hips'], 'path': 'translation'}})
        anims.append(ani)
    j['animations'] = anims
    j['buffers'] = [{'byteLength': len(out)}]
    extras = dict(j.get('extras') or {})
    info = HM.info()
    extras.update({
        'motion': 'v28 (proto3d/assets-src/hero_v2/hero_motion.py)',
        'walk_reference_speed_mps': info['Walk']['speed'], 'walk_stride_m': info['Walk']['stride'], 'walk_duty': info['Walk']['duty'],
        'run_reference_speed_mps': info['Run']['speed'], 'run_stride_m': info['Run']['stride'], 'run_duty': info['Run']['duty'],
        'phase_note': 'phase 0 = left heel strike, 0.5 = right heel strike',
    })
    j['extras'] = extras
    return bytes(out)


def content_hashes(j, binary):
    """形・重み・画像のデータ（動き以外）の中身のハッシュ（並べ方に依らない）"""
    anim_acc = set()
    for a in j.get('animations', []):
        for s in a['samplers']:
            anim_acc |= {s['input'], s['output']}
    acc = []
    for m in j.get('meshes', []):
        for p in m['primitives']:
            for k in sorted(p['attributes']):
                acc.append((m.get('name'), k, p['attributes'][k]))
            if 'indices' in p:
                acc.append((m.get('name'), 'indices', p['indices']))
    for s in j.get('skins', []):
        acc.append(('skin', 'ibm', s['inverseBindMatrices']))
    h = {}
    for name, k, i in acc:
        a = j['accessors'][i]
        v = view_bytes(j, binary, a['bufferView'])
        h[f'{name}/{k}/{i}'] = hashlib.sha256(v + json.dumps({x: a[x] for x in ('componentType', 'count', 'type', 'byteOffset') if x in a}).encode()).hexdigest()
    imgs = [hashlib.sha256(view_bytes(j, binary, im['bufferView'])).hexdigest() for im in j.get('images', []) if 'bufferView' in im]
    return h, imgs


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        raise SystemExit(__doc__)
    src, dst = map(pathlib.Path, args)
    if src.resolve() == dst.resolve():
        raise SystemExit('元の GLB を上書きしない（別の名前で書く）')
    if dst.exists():
        raise SystemExit(f'{dst} はもうある（消してから書き直す。元の素材ではないことを確かめて）')
    j, binary = read_glb(src)
    h0, i0 = content_hashes(j, binary)
    j2 = json.loads(json.dumps(j))
    out = replace_animations(j2, binary, '--relax-arms' in sys.argv)
    write_glb(dst, j2, out)
    print(f'{dst}: {dst.stat().st_size} bytes（元 {src.stat().st_size}）、動き {[a["name"] for a in j2["animations"]]}')
    if '--check' in sys.argv:
        j3, b3 = read_glb(dst)
        h1, i1 = content_hashes(j3, b3)
        same_mesh = sorted(h0.values()) == sorted(h1.values())
        same_img = i0 == i1
        print(f'形・重みのデータ {len(h0)} 個：{"同じ" if same_mesh else "違う"}、画像 {len(i0)} 枚：{"同じ" if same_img else "違う"}')
        keys = ('nodes', 'meshes', 'materials', 'textures', 'samplers', 'skins', 'scenes', 'scene')
        same_json = all(json.dumps(j.get(k)) == json.dumps(j3.get(k)) for k in keys if k not in ('meshes', 'skins'))
        print(f'節・材質・画像の指定：{"同じ" if same_json else "違う"}')
        if not (same_mesh and same_img and same_json):
            raise SystemExit('形・画像が元と違う')


if __name__ == '__main__':
    main()
