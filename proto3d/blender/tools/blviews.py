# Blender 側（原因確認用）：ゲームと同じ素材（書き出した GLB）・同じカメラ・ゲームに寄せた光で描く
import sys, json, pathlib
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/scene')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
import bpy
import assemble as A
from common import reset
out = pathlib.Path(sys.argv[sys.argv.index('--') + 1]); prefix = sys.argv[sys.argv.index('--') + 2]
only = sys.argv[sys.argv.index('--') + 3].split(',') if len(sys.argv) > sys.argv.index('--') + 3 else None
samples = 48
out.mkdir(parents=True, exist_ok=True)
V = json.load(open('/home/user/koto-sengoku/proto3d/blender/tools/views.json'))
rt = json.load(open('/home/user/koto-sengoku/e2e-out/diag/runtime.json'))
c, d = rt['cam']['pos'], rt['cam']['dir']
V['start'] = {'cam': c, 'tgt': [c[i] + d[i] * 10 for i in range(3)], 'fov': 50}
reset()
A.assemble()
bpy.context.scene.frame_set(34)  # ゲームの待機の動き 約 1.34 秒（25 fps）
A.setup_game_look()
for name, v in V.items():
    if only and name not in only:
        continue
    A.render_game(out / f'{prefix}-{name}.png', tuple(v['cam']), tuple(v['tgt']), res=(1280, 720), samples=samples, fov_deg=v['fov'])
