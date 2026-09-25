"""CPU inspection render of the delivered glTF itself. No external assets."""
from pathlib import Path
import json, math
import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation, Slerp
from numba import njit
R=Path(__file__).resolve().parents[1]
g=json.loads((R/'assets/sengoku_hero.gltf').read_text());raw=(R/'assets/sengoku_hero.bin').read_bytes()
def acc(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']];dt={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']]
 return np.frombuffer(raw,dt,a['count']*n,v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],n).copy()
def pose(clip,t):
 trans=[np.array(n.get('translation',[0,0,0]),float) for n in g['nodes']];rot=[np.array(n.get('rotation',[0,0,0,1]),float) for n in g['nodes']]
 anim=next(a for a in g['animations'] if a['name']==clip)
 for ch in anim['channels']:
  s=anim['samplers'][ch['sampler']];times=acc(s['input']).ravel();vals=acc(s['output']);tt=t%times[-1];i=max(0,min(len(times)-2,int(np.searchsorted(times,tt)-1)));u=(tt-times[i])/(times[i+1]-times[i]);a=vals[i];b=vals[i+1]
  if ch['target']['path']=='rotation':
   if a@b<0:b=-b
   q=a*(1-u)+b*u;q/=np.linalg.norm(q);rot[ch['target']['node']]=q
  else:trans[ch['target']['node']]=a*(1-u)+b*u
 glob=[None]*len(g['nodes'])
 def recur(i,parent):
  m=np.eye(4);m[:3,:3]=Rotation.from_quat(rot[i]).as_matrix();m[:3,3]=trans[i];glob[i]=parent@m
  for c in g['nodes'][i].get('children',[]):recur(c,glob[i])
 recur(0,np.eye(4));skin=g['skins'][0];inv=acc(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
 sm=np.stack([glob[n]@inv[j] for j,n in enumerate(skin['joints'])]);return sm

def scene(clip,t):
 sm=pose(clip,t);vs=[];ns=[];uvs=[];fs=[];mats=[];offset=0
 for p in g['meshes'][0]['primitives']:
  a=p['attributes'];v=acc(a['POSITION']);n=acc(a['NORMAL']);uv=acc(a['TEXCOORD_0']);j=acc(a['JOINTS_0']);w=acc(a['WEIGHTS_0']);f=acc(p['indices']).reshape(-1,3)
  mix=(sm[j]*w[:,:,None,None]).sum(1);vv=np.einsum('vij,vj->vi',mix,np.c_[v,np.ones(len(v))])[:,:3];nn=np.einsum('vij,vj->vi',mix[:,:3,:3],n)
  vs.append(vv);ns.append(nn);uvs.append(uv);fs.append(f+offset);mats.extend([p['material']]*len(f));offset+=len(v)
 model_faces=sum(len(f) for f in fs)
 floorv=np.array([(x,0,z) for z in np.linspace(-8,8,25) for x in np.linspace(-8,8,25)],float);floorf=[]
 for jj in range(24):
  for ii in range(24):
   p=jj*25+ii;floorf.extend([(p,p+25,p+26),(p,p+26,p+1)])
 vs.append(floorv);ns.append(np.tile([0,1,0],(len(floorv),1)));uvs.append(np.zeros((len(floorv),2)));fs.append(np.array(floorf)+offset);mats.extend([len(g['materials'])]*len(floorf))
 return np.concatenate(vs),np.concatenate(ns),np.concatenate(uvs),np.concatenate(fs).astype(np.int32),np.array(mats,np.int32),model_faces

def camera(eye,target):
 eye=np.array(eye,float);target=np.array(target,float);f=target-eye;f/=np.linalg.norm(f);right=np.cross(f,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,f);return np.stack([right,up,f]),eye
@njit
def depthpass(screen,faces,w,h):
 depth=np.full((h,w),1e10,np.float32)
 for tri in faces:
  p0,p1,p2=screen[tri[0]],screen[tri[1]],screen[tri[2]]
  den=(p1[1]-p2[1])*(p0[0]-p2[0])+(p2[0]-p1[0])*(p0[1]-p2[1])
  if abs(den)<1e-9:continue
  x0=max(0,int(min(p0[0],p1[0],p2[0])));x1=min(w-1,int(max(p0[0],p1[0],p2[0]))+1)
  y0=max(0,int(min(p0[1],p1[1],p2[1])));y1=min(h-1,int(max(p0[1],p1[1],p2[1]))+1)
  for y in range(y0,y1+1):
   for x in range(x0,x1+1):
    a=((p1[1]-p2[1])*(x+.5-p2[0])+(p2[0]-p1[0])*(y+.5-p2[1]))/den
    b=((p2[1]-p0[1])*(x+.5-p2[0])+(p0[0]-p2[0])*(y+.5-p2[1]))/den;c=1-a-b
    if a<0 or b<0 or c<0:continue
    z=a*p0[2]+b*p1[2]+c*p2[2]
    if z<depth[y,x]:depth[y,x]=z
 return depth
@njit
def shade(screen,world,norms,uv,faces,mi,colors,rough,metal,texids,textures,shadow,lightcoords,eye,w,h):
 out=np.zeros((h,w,3),np.float32);out[:]=np.array([.72,.73,.715]);depth=np.full((h,w),1e10,np.float32)
 light=np.array([-.6,1.4,1.1]);light/=np.sqrt((light*light).sum());fill=np.array([.9,.5,-.7]);fill/=np.sqrt((fill*fill).sum())
 for fi in range(len(faces)):
  tri=faces[fi];p0,p1,p2=screen[tri[0]],screen[tri[1]],screen[tri[2]]
  if min(p0[2],p1[2],p2[2])<.05:continue
  den=(p1[1]-p2[1])*(p0[0]-p2[0])+(p2[0]-p1[0])*(p0[1]-p2[1])
  if abs(den)<1e-8:continue
  x0=max(0,int(min(p0[0],p1[0],p2[0])));x1=min(w-1,int(max(p0[0],p1[0],p2[0]))+1);y0=max(0,int(min(p0[1],p1[1],p2[1])));y1=min(h-1,int(max(p0[1],p1[1],p2[1]))+1)
  mat=mi[fi]
  for y in range(y0,y1+1):
   for x in range(x0,x1+1):
    a=((p1[1]-p2[1])*(x+.5-p2[0])+(p2[0]-p1[0])*(y+.5-p2[1]))/den
    b=((p2[1]-p0[1])*(x+.5-p2[0])+(p0[0]-p2[0])*(y+.5-p2[1]))/den;c=1-a-b
    if a<0 or b<0 or c<0:continue
    aa=a/p0[2];bb=b/p1[2];cc=c/p2[2];iz=aa+bb+cc;z=1/iz
    if z>=depth[y,x]:continue
    a=aa/iz;b=bb/iz;c=cc/iz;depth[y,x]=z
    N=norms[tri[0]]*a+norms[tri[1]]*b+norms[tri[2]]*c;N/=np.sqrt((N*N).sum())+1e-12
    P=world[tri[0]]*a+world[tri[1]]*b+world[tri[2]]*c;V=eye-P;V/=np.sqrt((V*V).sum())+1e-12
    if (N*V).sum()<0:N=-N
    col=colors[mat].copy();ti=texids[mat]
    if ti>=0:
     tuv=uv[tri[0]]*a+uv[tri[1]]*b+uv[tri[2]]*c;tx=int((tuv[0]%1)*512)%512;ty=int((tuv[1]%1)*512)%512
     col*=textures[ti,ty,tx]
    lc=lightcoords[tri[0]]*a+lightcoords[tri[1]]*b+lightcoords[tri[2]]*c
    sx=int(lc[0]);sy=int(lc[1]);sh=1.
    if sx>1 and sx<shadow.shape[1]-2 and sy>1 and sy<shadow.shape[0]-2:
     occ=0.
     for dy in range(-1,2):
      for dx in range(-1,2):
       if lc[2]-.005>shadow[sy+dy,sx+dx]:occ+=1
     sh=1-occ/9*.90
    nl=max(0.,(N*light).sum());nf=max(0.,(N*fill).sum());hemi=N[1]*.5+.5
    illumination=np.array([.29,.285,.28])+(np.array([.20,.24,.30])*hemi)+np.array([1.70,1.53,1.33])*nl*sh+np.array([.26,.34,.46])*nf
    C=col*illumination
    H=light+V;H/=np.sqrt((H*H).sum())+1e-12;spec=max(0.,(N*H).sum())**(8+(1-rough[mat])*120)
    C+=spec*nl*sh*((1-metal[mat])*.035+metal[mat]*col*.40)
    for k in range(3):
     val=C[k];val=(val*(2.51*val+.03))/(val*(2.43*val+.59)+.14);out[y,x,k]=max(0.,min(1.,val))**(1/2.2)
 return out

def render(name,clip='Idle',t=0,eye=(1.55,1.47,4.1),target=(0,.9,0),w=1000,h=1250,fov=.5):
 vs,ns,uv,fs,mats,mf=scene(clip,t);cm,e=camera(eye,target);cp=(vs-e)@cm.T;focal=h/(2*math.tan(fov/2));ss=np.c_[w/2+cp[:,0]/cp[:,2]*focal,h/2-cp[:,1]/cp[:,2]*focal,cp[:,2]]
 lm,le=camera((-3,6,5),(0,.8,0));lc=(vs-le)@lm.T;ls=np.c_[1024+lc[:,0]*500,1024-lc[:,1]*500,lc[:,2]].astype(np.float32);shadow=depthpass(ls,fs[:mf],2048,2048)
 cols=[];rough=[];metal=[];texid=[];texs=[];td={}
 for m in g['materials']:
  b=m['pbrMetallicRoughness'];cols.append(b['baseColorFactor'][:3]);rough.append(b['roughnessFactor']);metal.append(b['metallicFactor'])
  if 'baseColorTexture' in b:
   im=g['images'][g['textures'][b['baseColorTexture']['index']]['source']]['uri']
   if im not in td:td[im]=len(texs);texs.append((np.asarray(Image.open(R/'assets'/im).convert('RGB').resize((512,512)),np.float32)/255)**2.2)
   texid.append(td[im])
  else:texid.append(-1)
 cols.append([.32,.325,.31]);rough.append(.95);metal.append(0);texid.append(-1)
 out=shade(ss,vs,ns,uv,fs,mats,np.array(cols,float),np.array(rough),np.array(metal),np.array(texid),np.array(texs,np.float32),shadow,ls,np.array(eye,float),w,h)
 path=R/'previews'/name;Image.fromarray(np.uint8(out*255)).save(path);print(path,flush=True)
if __name__=='__main__':
 render('front.png')
 render('detail.png',eye=(.60,1.47,1.72),target=(0,1.33,.012),w=1100,h=1000,fov=.49)
 render('run.png',clip='Run',t=.10,eye=(2.4,1.55,3.6))
 render('back.png',eye=(-1.5,1.47,-4.1))
