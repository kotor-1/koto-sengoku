"""Structural checks, not a Khronos validator and not a device benchmark."""
from pathlib import Path
import json,struct,math
import numpy as np
from PIL import Image
R=Path(__file__).resolve().parents[1]
g=json.loads((R/'assets/sengoku_hero.gltf').read_text());raw=(R/'assets/sengoku_hero.bin').read_bytes();checks=[]
def check(name,ok,detail=''):
 checks.append({'name':name,'passed':bool(ok),'detail':detail})
 if not ok:raise AssertionError(name+': '+detail)
def acc(i):
 a=g['accessors'][i];bv=g['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']]
 return np.frombuffer(raw,dt,a['count']*n,bv.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],n)
check('glTF version',g['asset']['version']=='2.0')
check('buffer length',len(raw)==g['buffers'][0]['byteLength'])
check('buffer views aligned and bounded',all(b.get('byteOffset',0)%4==0 and b.get('byteOffset',0)+b['byteLength']<=len(raw) for b in g['bufferViews']))
check('finite accessor data',all(np.all(np.isfinite(acc(i))) for i in range(len(g['accessors']))))
prims=g['meshes'][0]['primitives'];nj=len(g['skins'][0]['joints'])
check('triangle indices in range',all(acc(p['indices']).max()<len(acc(p['attributes']['POSITION'])) for p in prims))
check('skin joints in range',all(acc(p['attributes']['JOINTS_0']).max()<nj for p in prims))
check('skin weights nonnegative and normalized',all(np.all(acc(p['attributes']['WEIGHTS_0'])>=0) and np.allclose(acc(p['attributes']['WEIGHTS_0']).sum(1),1,atol=1e-5) for p in prims))
check('unit normals',all(np.allclose(np.linalg.norm(acc(p['attributes']['NORMAL']),axis=1),1,atol=1e-5) for p in prims))
check('required clips',set(a['name'] for a in g['animations'])=={'Idle','Walk','Run'})
for anim in g['animations']:
 for sam in anim['samplers']:
  times=acc(sam['input']).ravel();vals=acc(sam['output'])
  assert len(times)==len(vals) and np.all(np.diff(times)>0)
  assert np.allclose(vals[0],vals[-1],atol=1e-5)
check('animation time arrays and loop endpoints',True)
check('unit animation quaternions',all(np.allclose(np.linalg.norm(acc(s['output']),axis=1),1,atol=1e-5) for a in g['animations'] for c in a['channels'] if c['target']['path']=='rotation' for s in [a['samplers'][c['sampler']]]))
check('no horizontal root motion',all(np.allclose(acc(a['samplers'][c['sampler']]['output'])[:,[0,2]],0,atol=1e-6) for a in g['animations'] for c in a['channels'] if c['target']['path']=='translation'))
check('external texture files present',all((R/'assets'/im['uri']).is_file() for im in g['images']))
for im in g['images']:Image.open(R/'assets'/im['uri']).verify()
check('PNG textures decode',True)
b=(R/'assets/sengoku_hero.glb').read_bytes();magic,ver,total=struct.unpack_from('<4sII',b)
check('GLB header and length',magic==b'glTF' and ver==2 and total==len(b))
off=12;chunks=[]
while off<len(b):
 n,typ=struct.unpack_from('<I4s',b,off);chunks.append((typ,b[off+8:off+8+n]));off+=8+n
check('GLB chunks',len(chunks)==2 and chunks[0][0]==b'JSON' and chunks[1][0]==b'BIN\x00' and off==len(b))
glb=json.loads(chunks[0][1]);check('GLB contains the same animation names',[a['name'] for a in glb['animations']]==[a['name'] for a in g['animations']])
import base64
web=json.loads((R/'assets/sengoku_hero.web.json').read_text());wb=base64.b64decode(web['base64']);jl=struct.unpack_from('<I',wb,12)[0];wj=json.loads(wb[20:20+jl])
check('web variant has external images and no data URIs',all('uri' in im and not im['uri'].startswith('data:') for im in wj['images']) and not any('uri' in b for b in wj['buffers']))
# Independent geometry loader (does not validate animation playback).
import trimesh
scene=trimesh.load(R/'assets/sengoku_hero.glb',force='scene')
check('independent trimesh geometry import',len(scene.geometry)>0 and sum(len(m.vertices) for m in scene.geometry.values())>0)
report={'checks':checks,'passed':len(checks),'failed':0,'scope':'Structural, skin data, animation data and independent geometry import. Not a full glTF conformance test. Preview images are offline CPU renders of the exported glTF.','unverified':['Existing game integration','Three.js animation playback in the user project','iPhone / Android / Mac runtime performance','Cloth intersections during arbitrary transitions','Historical costume accuracy'],'preview_browser_note':'The working container did not provide a WebGL2 context. No successful browser playback claim is made.'}
(R/'validation-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps({'passed':len(checks),'failed':0,'geometry_parts':len(scene.geometry)}))
