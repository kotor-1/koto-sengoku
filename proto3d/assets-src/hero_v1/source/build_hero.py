#!/usr/bin/env python3
"""Original skinned game character. No downloaded models, textures or motions.
Run: python source/build_hero.py
Dependencies: numpy, scipy, Pillow. Units: metres; Y up, +Z forward.
"""
from __future__ import annotations
import json, math, struct, pathlib, io, base64
from collections import defaultdict
import numpy as np
from scipy.spatial.transform import Rotation
from scipy.interpolate import PchipInterpolator
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT/'assets'; TEX = ASSETS/'textures'
TEX.mkdir(parents=True, exist_ok=True)
PI = math.pi
rng = np.random.default_rng(27491)

# All rest-pose joint axes are aligned to world axes. Skin bind matrices carry position.
BONES=[]; BI={}; REST={}
def bone(name, parent, pos):
    BI[name]=len(BONES); REST[name]=np.array(pos,dtype=float)
    BONES.append(dict(name=name,parent=parent,pos=list(pos)))
bone('Root',None,(0,0,0))
bone('Hips','Root',(0,.945,0))
bone('Spine','Hips',(0,1.105,0))
bone('Chest','Spine',(0,1.315,0))
bone('Neck','Chest',(0,1.469,0))
bone('Head','Neck',(0,1.541,0))
for side,s in [('Left',1),('Right',-1)]:
    bone(side+'Shoulder','Chest',(s*.173,1.37,0))
    bone(side+'UpperArm',side+'Shoulder',(s*.205,1.369,0))
    bone(side+'ForeArm',side+'UpperArm',(s*.296,1.108,.012))
    bone(side+'Hand',side+'ForeArm',(s*.325,.889,.032))
    bone(side+'UpperLeg','Hips',(s*.099,.945,0))
    bone(side+'LowerLeg',side+'UpperLeg',(s*.099,.514,.012))
    bone(side+'Foot',side+'LowerLeg',(s*.099,.098,.026))
NJOINT=len(BONES)

MATS=[]; MATID={}
def material(name, rgb, rough=.7,metal=0, texture=None, normal=None):
    i=len(MATS); MATID[name]=i
    MATS.append(dict(name=name,rgb=rgb,rough=rough,metal=metal,texture=texture,normal=normal))
    return i

def cloth_texture(name, base, strength=.08, direction=0):
    n=512
    noise=rng.normal(0,1,(n,n))
    low=np.asarray(Image.fromarray(np.uint8(np.clip(noise*30+128,0,255))).filter(ImageFilter.GaussianBlur(16)),float)/255-.5
    yy,xx=np.mgrid[:n,:n]
    weave=(.34*np.sin(xx*PI)+.24*np.cos(yy*PI)+.42*np.sin(xx*PI/2)*np.cos(yy*PI/2))
    fibers=(np.sin(xx*.53)+np.cos(yy*.69))*.17
    broad=np.sin(yy*.022+np.sin(xx*.028))*.01
    val=1+weave*.035+fibers*.025+noise*.011+low*.8+broad
    arr=np.clip(np.array(base)[None,None,:]*val[:,:,None],0,255).astype(np.uint8)
    Image.fromarray(arr).save(TEX/(name+'_basecolor.png'))
    height=weave*.20+noise*.04+low*.7
    dx=np.roll(height,-1,1)-np.roll(height,1,1)
    dy=np.roll(height,-1,0)-np.roll(height,1,0)
    norm=np.dstack((-dx*strength,-dy*strength,np.ones_like(dx)))
    norm/=np.linalg.norm(norm,axis=2,keepdims=True)
    Image.fromarray(np.uint8(np.clip((norm*.5+.5)*255,0,255))).save(TEX/(name+'_normal.png'))
cloth_texture('indigo',(46,68,87),.7)
cloth_texture('hakama',(65,65,59),.6)
cloth_texture('linen',(211,202,179),.35)
material('Indigo woven kosode',(1,1,1),.87,texture='indigo_basecolor.png',normal='indigo_normal.png')
material('Pleated charcoal hakama',(1,1,1),.89,texture='hakama_basecolor.png',normal='hakama_normal.png')
material('Undercollar and tabi',(1,1,1),.9,texture='linen_basecolor.png',normal='linen_normal.png')
material('Skin',(.39,.245,.163),.63)
material('Lips and ear fold',(.255,.118,.082),.7)
material('Hair',(.024,.020,.018),.43)
material('Hair strands',(.031,.026,.022),.46)
material('Sclera',(.57,.54,.45),.39)
material('Iris',(.041,.025,.013),.32)
material('Pupil',(.008,.006,.004),.24)
material('Obi and scabbard',(.04,.047,.045),.65)
material('Patinated bronze',(.23,.15,.057),.48,.72)
material('Steel',(.18,.205,.22),.35,.85)
material('Braided straw',(.33,.255,.15),.91)
material('Seam blue',(.055,.081,.109),.84)
material('Seam grey',(.08,.079,.067),.89)

parts=[]

def weights_dict(w):
    if isinstance(w,str): return {BI[w]:1.0}
    return {BI[k] if isinstance(k,str) else k:float(v) for k,v in w.items() if v>1e-7}
def mix(a,b,t):
    t=float(np.clip(t,0,1));return {a:1-t,b:t}
def torso_w(p):
    y=p[1]
    if y<1.04:return 'Hips'
    if y<1.18:return mix('Hips','Spine',(y-1.04)/.14)
    if y<1.34:return mix('Spine','Chest',(y-1.18)/.16)
    if y<1.45:return 'Chest'
    return mix('Chest','Neck',(y-1.45)/.07)
def leg_w(side,p):
    y=p[1]
    if y>.89:return mix(side+'UpperLeg','Hips',(y-.89)/.085)
    if y>.61:return side+'UpperLeg'
    if y>.40:return mix(side+'LowerLeg',side+'UpperLeg',(y-.40)/.21)
    return side+'LowerLeg'
def arm_w(side,p):
    y=p[1]
    if y>1.37:return mix(side+'UpperArm','Chest',(y-1.37)/.065)
    if y>1.18:return side+'UpperArm'
    if y>1.04:return mix(side+'ForeArm',side+'UpperArm',(y-1.04)/.14)
    return side+'ForeArm'

def add(name,verts,faces,mat,uv=None,weight='Root'):
    vs=np.asarray(verts,float); fs=np.asarray(faces,np.uint32).reshape(-1,3)
    if len(vs)==0 or len(fs)==0:return
    uv=np.zeros((len(vs),2),float) if uv is None else np.asarray(uv,float)
    j=np.zeros((len(vs),4),np.uint16);w=np.zeros((len(vs),4),np.float32)
    for i,p in enumerate(vs):
        d=weights_dict(weight(p) if callable(weight) else weight)
        ordered=sorted(d.items(),key=lambda item:-item[1])[:4]; s=sum(v for k,v in ordered)
        for c,(k,v) in enumerate(ordered):j[i,c]=k;w[i,c]=v/s
    parts.append(dict(name=name,v=vs,f=fs,uv=uv,j=j,w=w,mat=MATID[mat]))

def surface(name,fn,nu,nv,mat,weight='Root',flip=False,uscale=1,vscale=1):
    nu=max(6,round(nu*.85));nv=max(4,round(nv*.85))
    v=[];uv=[];f=[]
    for j in range(nv+1):
        b=j/nv
        for i in range(nu+1):
            a=i/nu;v.append(fn(a,b));uv.append((a*uscale,b*vscale))
    for j in range(nv):
        for i in range(nu):
            p=j*(nu+1)+i
            tri=[(p,p+1,p+nu+2),(p,p+nu+2,p+nu+1)]
            f.extend(tuple(reversed(t)) if flip else t for t in tri)
    add(name,v,f,mat,uv,weight)

def ellipsoid(name,center,radii,mat,weight='Root',segments=24,rings=14,rot=None):
    c=np.array(center);r=np.array(radii);R=np.eye(3) if rot is None else np.array(rot)
    def fn(u,v):
        a=2*PI*u;t=PI*v
        p=r*np.array([math.sin(t)*math.sin(a),-math.cos(t),math.sin(t)*math.cos(a)])
        return c+R@p
    surface(name,fn,segments,rings,mat,weight)

def tube(name,points,radii,mat,weight='Root',sides=12,ellipse=1.0,caps=True,twist=0):
    ps=np.asarray(points,float)
    if np.isscalar(radii):radii=[radii]*len(ps)
    v=[];uv=[]
    for j,p in enumerate(ps):
        tangent=ps[min(j+1,len(ps)-1)]-ps[max(0,j-1)];tangent/=np.linalg.norm(tangent)+1e-12
        ref=np.array([0.,0.,1.]) if abs(tangent[2])<.88 else np.array([0.,1.,0.])
        ax=np.cross(tangent,ref);ax/=np.linalg.norm(ax);bx=np.cross(tangent,ax)
        for i in range(sides+1):
            a=2*PI*i/sides+twist
            v.append(p+radii[j]*(math.cos(a)*ax+ellipse*math.sin(a)*bx));uv.append((i/sides,j/max(len(ps)-1,1)))
    f=[]
    for j in range(len(ps)-1):
        for i in range(sides):
            p=j*(sides+1)+i
            f.extend([(p,p+1,p+sides+2),(p,p+sides+2,p+sides+1)])
    if caps:
        first=len(v);v.extend([ps[0],ps[-1]]);uv.extend([(0,0),(0,1)])
        for i in range(sides):
            f.append((first,i+1,i));p=(len(ps)-1)*(sides+1)+i
            f.append((first+1,p,p+1))
    add(name,v,f,mat,uv,weight)

def ribbon(name,points,widths,mat,weight,normal=(0,0,1),thick=.0015):
    # A solid, softly rolled ribbon rather than a single painted line.
    ps=np.asarray(points); widths=np.broadcast_to(widths,(len(ps),));vs=[];fs=[];uv=[]
    for j,p in enumerate(ps):
        t=ps[min(j+1,len(ps)-1)]-ps[max(0,j-1)]
        side=np.cross(t,normal);side/=np.linalg.norm(side)+1e-12
        for k in range(5):
            q=k/4; vs.append(p+side*(q-.5)*widths[j]+np.array(normal)*math.sin(q*PI)*thick);uv.append((q,j/(len(ps)-1)))
    for j in range(len(ps)-1):
        for k in range(4):
            p=j*5+k;fs.extend([(p,p+1,p+6),(p,p+6,p+5)])
    add(name,vs,fs,mat,uv,weight)

# NECK and sculpted head.
neck_rows=np.array([[1.332,.09,.108],[1.37,.088,.096],[1.411,.068,.079],[1.448,.047,.046],[1.479,.034,.035],[1.519,.031,.032],[1.548,.03,.028]])
neck_x=PchipInterpolator(neck_rows[:,0],neck_rows[:,1]);neck_z=PchipInterpolator(neck_rows[:,0],neck_rows[:,2])
def neck_surface(u,v):
    y=1.332+.216*v;a=u*2*PI
    return (float(neck_x(y))*math.sin(a),y,float(neck_z(y))*math.cos(a)-.002)
surface('neck and clavicle',neck_surface,44,30,'Skin',lambda p:torso_w(p) if p[1]<1.46 else 'Neck')
head_rows=np.array([
[1.512,.021,.035,.003],[1.525,.038,.046,.002],[1.547,.053,.054,-.002],
[1.574,.068,.061,-.005],[1.603,.075,.064,-.008],[1.629,.073,.063,-.008],
[1.65,.072,.064,-.009],[1.684,.071,.068,-.012],[1.712,.062,.061,-.014],
[1.735,.037,.042,-.015],[1.742,.001,.002,-.015]])
interp=[PchipInterpolator(head_rows[:,0],head_rows[:,k]) for k in (1,2,3)]
def head_point(u,v):
    y=1.512+v*.23;rx,rz,cz=[float(fn(y)) for fn in interp];a=u*2*PI
    x=rx*math.sin(a);z=cz+rz*math.cos(a); front=max(0,math.cos(a))**5
    # Anatomical relief: nose bridge/tip, orbital depression, cheek and brow volumes.
    nose=.021*math.exp(-(x/.010)**2-((y-1.606)/.025)**2)+.015*math.exp(-(x/.014)**2-((y-1.592)/.009)**2)
    cheeks=sum(.006*math.exp(-((x-s*.043)/.02)**2-((y-1.598)/.018)**2) for s in [-1,1])
    sockets=sum(-.0045*math.exp(-((x-s*.032)/.017)**2-((y-1.628)/.009)**2)+.0045*math.exp(-((x-s*.032)/.018)**2-((y-1.642)/.008)**2) for s in [-1,1])
    mouth=.005*math.exp(-(x/.033)**2-((y-1.563)/.02)**2)
    return (x,y,z+front*(nose+cheeks+sockets+mouth))
surface('sculpted face',head_point,56,44,'Skin','Head')
# Lips, nostrils, eyes and brows. Facial features are geometry, not a face decal.
for s,side in [(1,'Left'),(-1,'Right')]:
    ellipsoid(side+' ear',(s*.075,1.604,-.003),(.0115,.024,.014),'Skin','Head',20,14)
    ellipsoid(side+' inner ear',(s*.082,1.604,.004),(.0045,.015,.008),'Lips and ear fold','Head',16,10)
    pts=[(s*(.080+.003*math.sin(a)),1.605+.020*math.cos(a),.003+.012*math.sin(a)) for a in np.linspace(-1.7,1.7,18)]
    tube(side+' helix',pts,.0026,'Skin','Head',8)
    ex=s*.031;ey=1.627;ez=.046
    ellipsoid(side+' eye',(ex,ey,ez),(.014,.0043,.0045),'Sclera','Head',24,12)
    ellipsoid(side+' iris',(ex-s*.001,ey,.0501),(.0037,.0037,.0009),'Iris','Head',16,12)
    ellipsoid(side+' pupil',(ex-s*.001,ey,.051),(.0019,.0022,.0006),'Pupil','Head',14,8)
    for top in [True,False]:
        pts=[]
        for t in np.linspace(-1,1,21):
            pts.append((ex+t*.015,ey+(1 if top else -1)*.0045*(1-t*t)+s*t*.0008,.047+.0042*(1-t*t)))
        tube(side+(' upper lid' if top else ' lower lid'),pts,.0015 if top else .0012,'Skin','Head',8)
    pts=[(ex+t*.017,1.644+.003*(1-t*t)-s*t*.0015,.052+.004*(1-t*t)) for t in np.linspace(-1,1,12)]
    ribbon(side+' eyebrow',pts,np.sin(np.linspace(.15,2.99,12))*.004,'Hair','Head')
    ellipsoid(side+' nostril',(s*.007,1.587,.084),(.0032,.0017,.0015),'Lips and ear fold','Head',12,8)
for upper in [True,False]:
    pts=[]
    for t in np.linspace(-1,1,23):
        y=1.565+( .0022*(1-t*t)-.0018*math.exp(-(t/.2)**2) if upper else -.002*(1-t*t))
        pts.append((t*.021,y,.059+.005*(1-t*t)))
    tube('upper lip' if upper else 'lower lip',pts,[.0007+.001*(1-t*t) for t in np.linspace(-1,1,23)],'Lips and ear fold','Head',8)
# Hair shell with irregular combed-back hairline, subtle directional locks.
def hairfn(u,v):
    a=u*2*PI
    bottom=1.611+.066*max(0,math.cos(a))**1.4
    end=1.748
    y=bottom+(end-bottom)*v
    hy=min(y,1.742);rx=float(interp[0](hy))+.0034;rz=float(interp[1](hy))+.0034;cz=float(interp[2](hy));
    if y>1.742:
        fac=max(.02,(1.748-y)/.006);rx*=fac;rz*=fac
    return (rx*math.sin(a),y,cz+rz*math.cos(a))
surface('combed hair',hairfn,48,22,'Hair','Head')
for k in range(30):
    u=k/30
    pts=[hairfn(u+.009*math.sin(t*PI),t) for t in np.linspace(.025,.96,18)]
    pts=[(p[0]*1.020,p[1]+.0010,(p[2]+.015)*1.020-.015) for p in pts]
    tube('hair strand',pts,.0004,'Hair strands','Head',5)
# Flattened folded topknot, not a vertical cone.
ellipsoid('folded topknot',(0,1.745,-.020),(.025,.014,.040),'Hair','Head',28,14)
tube('hair tie',[(-.023,1.746,-.01),(-.014,1.758,-.011),(0,1.761,-.012),(.014,1.758,-.011),(.023,1.746,-.01)],.0024,'Obi and scabbard','Head',8)
for k in range(9):
    x=(k-4)*.0043
    pts=[(x,1.748+.011*math.sin(t*PI),-.053+t*.066) for t in np.linspace(0,1,15)]
    tube('topknot fibers',pts,.00055,'Hair strands','Head',5)

# KOSODE: continuous tailored torso shell, cloth folds, real overlap/lapel thickness.
body_rows=np.array([[.946,.151,.094],[.982,.157,.104],[1.047,.170,.116],[1.13,.190,.119],[1.24,.207,.122],[1.33,.219,.108],[1.379,.206,.091],[1.415,.142,.069],[1.454,.052,.042]])
bfx=PchipInterpolator(body_rows[:,0],body_rows[:,1]);bfz=PchipInterpolator(body_rows[:,0],body_rows[:,2])
def torso_surface(u,v):
    y=.946+v*.508
    opening_width=.049*max(0,min(1,(y-1.335)/.119))
    cut=math.asin(min(.96,opening_width/float(bfx(y))))
    a=cut+(2*PI-2*cut)*u
    # Small tension folds radiating from waistband and shoulder, no high-frequency noise.
    dr=.0035*math.sin(9*a+y*27)*math.sin(v*PI)**2+.002*math.sin(17*a-y*16)*(1-v)
    return ((float(bfx(y))+dr)*math.sin(a),y,(float(bfz(y))+dr)*math.cos(a))
surface('kosode torso',torso_surface,48,28,'Indigo woven kosode',torso_w,uscale=2,vscale=2)
# Chest opening and overlap. Ribbons sit on the actual curved torso surface.
# Inner pale collar and the main left-over-right lapel.
inner=[(-.047,1.459,.039),(-.066,1.42,.068),(-.028,1.366,.114),(.019,1.305,.125),(.075,1.222,.116)]
ribbon('ivory inner collar',inner,[.020,.026,.025,.024,.020],'Undercollar and tabi',torso_w)
outer=[(-.060,1.453,.044),(-.092,1.417,.073),(-.062,1.355,.119),(-.011,1.28,.131),(.045,1.198,.129),(.109,1.095,.095),(.133,1.02,.062)]
ribbon('left overlap lapel',outer,[.030,.041,.044,.044,.041,.035,.029],'Indigo woven kosode',torso_w,thick=.003)
other=[(.048,1.454,.040),(.068,1.418,.069),(.033,1.364,.112),(-.007,1.308,.125)]
ribbon('right underlap collar',other,[.022,.026,.025,.024],'Undercollar and tabi',torso_w)
# Lapel stitch piping subtle.
tube('lapel seam',[(x-.014,y,z+.0015) for x,y,z in outer],.0011,'Seam blue',torso_w,6)
# Sleeve shells oriented along gently bent arms.
for s,side in [(1,'Left'),(-1,'Right')]:
    cps=np.array([[s*.125,1.344,0],[s*.198,1.30,.002],[s*.258,1.215,.008],[s*.294,1.115,.018],[s*.314,1.024,.025],[s*.324,.935,.032]])
    coords=[PchipInterpolator(np.linspace(0,1,len(cps)),cps[:,k]) for k in range(3)]
    radius=PchipInterpolator([0,.18,.44,.66,.82,1],[.056,.076,.086,.079,.064,.043])
    def sleeve(u,v):
        c=np.array([fn(v) for fn in coords]);vt=min(1,v+.002);vb=max(0,v-.002)
        tang=np.array([fn(vt)-fn(vb) for fn in coords]);tang/=np.linalg.norm(tang)
        ax=np.cross(tang,[0,0,1]);ax/=np.linalg.norm(ax);bx=np.cross(tang,ax)
        a=u*2*PI;r=float(radius(v));fold=.003*math.sin(9*a+v*3)+.002*math.sin(v*24+a*2)
        return c+(r+fold)*(math.cos(a)*ax+1.03*math.sin(a)*bx)
    surface(side+' kosode sleeve',sleeve,32,24,'Indigo woven kosode',lambda p,side=side:arm_w(side,p),uscale=1.3,vscale=1.8)
    cuff=[sleeve(k/40,1) for k in range(41)]
    tube(side+' cuff hem',cuff,.003,'Seam blue',side+'ForeArm',6)
    # Wrist and articulated-looking hands; fingers follow the hand bone.
    ellipsoid(side+' wrist',(s*.325,.898,.032),(.026,.049,.025),'Skin',side+'Hand',20,12)
    R=Rotation.from_euler('z',s*.08).as_matrix()
    ellipsoid(side+' palm',(s*.331,.851,.039),(.030,.048,.016),'Skin',side+'Hand',24,16,rot=R)
    for f in range(4):
        x=s*(.311+f*.0135);length=[.052,.058,.054,.043][f]
        pts=[(x,.828,.040),(x+s*.002,.81,.047),(x+s*.003,.828-length,.05)]
        tube(side+' finger '+str(f),pts,[.0075,.0065,.0048],'Skin',side+'Hand',10,ellipse=.87)
        ellipsoid(side+' nail '+str(f),(x+s*.003,.833-length,.054),(.004,.007,.001),'Undercollar and tabi',side+'Hand',10,6)
    tube(side+' thumb',[(s*.307,.860,.051),(s*.288,.837,.062),(s*.286,.818,.066)],[.01,.008,.006],'Skin',side+'Hand',12)

# HAKAMA: two split, pleated cloth volumes, with smooth hip/thigh/shin weighting.
pants_y=np.array([.145,.22,.32,.51,.69,.83,.94,.986])
pants_rx=PchipInterpolator(pants_y,[.151,.151,.147,.145,.141,.129,.106,.093])
pants_rz=PchipInterpolator(pants_y,[.129,.131,.13,.128,.123,.116,.101,.091])
for s,side in [(1,'Left'),(-1,'Right')]:
    def pant(u,v):
        y=.145+v*.841;a=u*2*PI
        center=s*(.109+.010*math.sin(v*PI))
        # Long structured pleats taper at the belt, with smaller knee tension wrinkles.
        amp=.0105*(.30+.70*math.sin(v*PI/2))
        fold=amp*(math.cos(10*a+.1*s)-.32*math.cos(20*a+.2*s))
        fold+=.002*math.sin(y*36+4*a)*math.exp(-((y-.51)/.18)**2)
        return (center+(float(pants_rx(y))+fold)*math.copysign(abs(math.sin(a))**.82,math.sin(a)),y,(float(pants_rz(y))+fold)*math.copysign(abs(math.cos(a))**.85,math.cos(a)))
    surface(side+' hakama',pant,48,30,'Pleated charcoal hakama',lambda p,side=side:leg_w(side,p),uscale=1.6,vscale=2.3)
    hem=[pant(k/64,.005) for k in range(65)]
    tube(side+' hakama hem',hem,.0022,'Seam grey',side+'LowerLeg',6)
# High waistband and wrapped himo; shells enclose the meeting of pants and kosode.
def beltfn(u,v):
    a=u*2*PI;y=.974+v*.053
    return (.172*math.sin(a),y,.108*math.cos(a))
surface('wrapped obi',beltfn,64,8,'Obi and scabbard','Hips')
for y in [.981,.998,1.017]:
    pts=[(.173*math.sin(a),y+.001*math.sin(3*a),.110*math.cos(a)) for a in np.linspace(0,2*PI,65)]
    tube('himo band',pts,.0030,'Pleated charcoal hakama','Hips',6)
# Flat bow knot at front.
ellipsoid('himo knot',(0,1.0,.115),(.019,.015,.007),'Pleated charcoal hakama','Hips',18,10)
for s in [-1,1]:
    ribbon('himo loop',[(0,1,.117),(s*.044,1.011,.115),(s*.051,.994,.116),(0,.998,.119)],[.012,.019,.017,.009],'Pleated charcoal hakama','Hips')
    ribbon('himo end',[(s*.012,.995,.117),(s*.025,.956,.126),(s*.023,.919,.136)],[.017,.017,.013],'Pleated charcoal hakama',torso_w)
# Tabi, split toes, and straw sandals.
for s,side in [(1,'Left'),(-1,'Right')]:
    x=s*.099
    ellipsoid(side+' tabi heel',(x,.067,.005),(.040,.045,.081),'Undercollar and tabi',side+'Foot',24,16)
    ellipsoid(side+' tabi ankle',(x,.126,.016),(.033,.074,.032),'Undercollar and tabi',side+'Foot',20,16)
    ellipsoid(side+' tabi forefoot',(x,.063,.084),(.043,.027,.063),'Undercollar and tabi',side+'Foot',24,14)
    ellipsoid(side+' big toe',(x-s*.024,.057,.141),(.017,.019,.028),'Undercollar and tabi',side+'Foot',18,12)
    ellipsoid(side+' other toes',(x+s*.014,.056,.14),(.025,.018,.029),'Undercollar and tabi',side+'Foot',18,12)
    ellipsoid(side+' sandal sole',(x,.025,.055),(.049,.014,.130),'Braided straw',side+'Foot',32,12)
    # Three-dimensional braided sole edge and sparse woven top strands.
    pts=[(x+.047*math.sin(a),.03,.055+.126*math.cos(a)) for a in np.linspace(0,2*PI,65)]
    tube(side+' sole edge',pts,.0022,'Braided straw',side+'Foot',6)
    for z in np.linspace(-.045,.16,20):
        ww=.042*math.sqrt(max(.05,1-((z-.055)/.12)**2))
        tube(side+' weave',[(x-ww,.035,z),(x,.036,z+.001),(x+ww,.035,z)],.0012,'Braided straw',side+'Foot',5)
    for d in [-1,1]:
        tube(side+' sandal strap',[(x,.086,.124),(x+d*.024,.089,.065),(x+d*.043,.048,.015)],[.005,.005,.004],'Obi and scabbard',side+'Foot',9)

# Paired sheathed swords: original non-functional game geometry, no blade detail.
for k,(L,x,y,z) in enumerate([(.70,.204,1.007,.055),(.48,.233,.975,.087)]):
    pts=[]
    for t in np.linspace(0,1,25):pts.append((x+.026*t,y-.17*t,z-L*t-.025*math.sin(t*PI)))
    tube('scabbard '+str(k),pts,np.linspace(.015,.010,25),'Obi and scabbard','Hips',14,ellipse=.77)
    tube('scabbard cap '+str(k),pts[-3:],np.linspace(.011,.009,3),'Patinated bronze','Hips',14,ellipse=.82)
    # Hilt extends in front of the belt, pitched gently upwards.
    p=np.array([x,y,z]);v=np.array([-.02,.17,L]);v/=np.linalg.norm(v)
    tube('hilt '+str(k),[p+v*t for t in np.linspace(0,.21 if k==0 else .15,12)],.012,'Braided straw','Hips',12,ellipse=.85)
    # Elliptical tsuba perpendicular to the sword.
    ref=np.array([1.,0.,0.]);ax=np.cross(v,ref);ax/=np.linalg.norm(ax);bx=np.cross(v,ax)
    guard=[p+.004*v+.035*math.cos(a)*ax+.026*math.sin(a)*bx for a in np.linspace(0,2*PI,33)]
    tube('tsuba '+str(k),[p-.002*v,p+.003*v],.034,'Patinated bronze','Hips',14,ellipse=.78)
    for n in range(11 if k==0 else 8):
        t=.015+n*.016
        for s in [-1,1]:
            wrap=[p+v*(t+q*.016)+.0125*(math.cos(q*PI*s)*ax+.85*math.sin(q*PI*s)*bx) for q in np.linspace(0,1,8)]
            tube('hilt binding',wrap,.0032,'Obi and scabbard','Hips',6)

# Merge parts by material; retain original part counts in metadata.
def merged():
    groups=[]
    for mi,mat in enumerate(MATS):
        pp=[p for p in parts if p['mat']==mi]
        if not pp:continue
        nv=0;fs=[]
        for p in pp:fs.append(p['f']+nv);nv+=len(p['v'])
        vs=np.concatenate([p['v'] for p in pp]);f=np.concatenate(fs)
        normals=np.zeros_like(vs)
        tri=np.cross(vs[f[:,1]]-vs[f[:,0]],vs[f[:,2]]-vs[f[:,0]])
        for k in range(3):np.add.at(normals,f[:,k],tri)
        # Smooth duplicated UV seams and sphere poles without welding texture coordinates.
        unique,inv=np.unique(np.round(vs,7),axis=0,return_inverse=True)
        shared=np.zeros_like(unique);np.add.at(shared,inv,normals);normals=shared[inv]
        lengths=np.linalg.norm(normals,axis=1,keepdims=True)
        normals[lengths[:,0]<1e-12]=[0,1,0]
        normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
        groups.append(dict(mat=mi,v=vs.astype(np.float32),f=f.astype(np.uint32),n=normals.astype(np.float32),uv=np.concatenate([p['uv'] for p in pp]).astype(np.float32),j=np.concatenate([p['j'] for p in pp]),w=np.concatenate([p['w'] for p in pp])))
    return groups
GROUPS=merged()

# Animation: original keyframes, in place. IK foot targets on the ground plane.
def quat_from_to(a,b):
    a=np.array(a,float);b=np.array(b,float);a/=np.linalg.norm(a);b/=np.linalg.norm(b)
    d=float(np.clip(a@b,-1,1))
    if d<-.999999:return Rotation.from_rotvec(np.array([1.,0,0])*PI).as_quat()
    q=np.r_[np.cross(a,b),1+d];return q/np.linalg.norm(q)

def frame_pose(kind,t):
    qs={b['name']:np.array([0.,0,0,1.]) for b in BONES}; ts={}
    if kind=='Idle':
        p=2*PI*t/3.2
        qs['Spine']=Rotation.from_euler('x',.010*math.sin(p)).as_quat()
        qs['Head']=Rotation.from_euler('y',.025*math.sin(p)*.5).as_quat()
        for side,s in [('Left',1),('Right',-1)]:
            qs[side+'UpperArm']=Rotation.from_euler('xz',[.03,.012*s*math.sin(p)]).as_quat()
            qs[side+'ForeArm']=Rotation.from_euler('x',-.06).as_quat()
        return qs,ts
    run=kind=='Run';cycle=.64 if run else .84;nominal=3.0 if run else 1.4;stance=.36 if run else .56
    phase=(t/cycle)%1; travel=nominal*cycle*stance; amp=travel/2
    # Lower the pelvis slightly from its relaxed rest height for adequate reach.
    hy=.875+( .027*abs(math.sin(phase*2*PI)) if run else .012*math.cos(phase*4*PI))
    ts['Hips']=REST['Hips']-REST['Root']+np.array([0,hy-.945,0])
    qs['Spine']=Rotation.from_euler('xyz',[(.11 if run else .025),(.03 if run else .025)*math.sin(phase*2*PI),0]).as_quat()
    qs['Chest']=Rotation.from_euler('y',-.04*math.sin(phase*2*PI)).as_quat()
    for side,s,offset in [('Left',1,0),('Right',-1,.5)]:
        ph=(phase+offset)%1
        if ph<stance:
            q=ph/stance;z=amp-travel*q;fy=.098
        else:
            q=(ph-stance)/(1-stance);sm=q*q*(3-2*q)
            z=-amp+travel*sm;fy=.098+(.16 if run else .080)*math.sin(q*PI)**1.2
        hip=REST[side+'UpperLeg'].copy();hip[1]+=hy-.945
        ankle=np.array([hip[0],fy,.026+z]);u0=REST[side+'LowerLeg']-REST[side+'UpperLeg'];l0=REST[side+'Foot']-REST[side+'LowerLeg']
        l1=np.linalg.norm(u0);l2=np.linalg.norm(l0);d=ankle-hip;dist=np.linalg.norm(d);dist=min(dist,l1+l2-1e-5);dn=d/(np.linalg.norm(d)+1e-12)
        along=(l1*l1-l2*l2+dist*dist)/(2*dist);height=math.sqrt(max(0,l1*l1-along*along))
        perp=np.array([0.,dn[2],-dn[1]]) # knee bends toward +Z
        perp/=np.linalg.norm(perp)
        knee=hip+along*dn+height*perp
        qu=quat_from_to(u0,knee-hip);ru=Rotation.from_quat(qu)
        qlworld=quat_from_to(l0,ankle-knee);rlworld=Rotation.from_quat(qlworld)
        qs[side+'UpperLeg']=qu;qs[side+'LowerLeg']=(ru.inv()*rlworld).as_quat()
        qs[side+'Foot']=rlworld.inv().as_quat()
        armphase=2*PI*ph
        qs[side+'UpperArm']=Rotation.from_euler('xz',[(.43 if run else .22)*math.cos(armphase),s*(.025 if run else .012)]).as_quat()
        qs[side+'ForeArm']=Rotation.from_euler('x',-.85 if run else -.10-.06*(1+math.sin(armphase))).as_quat()
        qs[side+'Hand']=Rotation.from_euler('y',-.1*s if run else 0).as_quat()
    return qs,ts
CLIPS=[]
for name,dur in [('Idle',3.2),('Walk',.84),('Run',.64)]:
    count=round(dur*30)+1;times=np.linspace(0,dur,count,dtype=np.float32)
    rots={b['name']:[] for b in BONES};trans=[]
    for i,t in enumerate(times):
        q,tr=frame_pose(name,float(t) if i<count-1 else 0.)
        for bn in rots:rots[bn].append(q[bn])
        trans.append(tr.get('Hips',REST['Hips']))
    CLIPS.append(dict(name=name,times=times,rots=rots,trans=np.array(trans,np.float32)))

# glTF 2.0 serializer: supports skins, PBR materials and animation clips.
class Gltf:
    def __init__(self):
        self.bin=bytearray();self.d=dict(asset={'version':'2.0','generator':'Original Sengoku Hero / build_hero.py'},scene=0,scenes=[{'nodes':[0]}],nodes=[],meshes=[],skins=[],materials=[],textures=[],images=[],samplers=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],bufferViews=[],accessors=[],animations=[],buffers=[])
    def view(self,raw,target=None):
        while len(self.bin)%4:self.bin.append(0)
        v={'buffer':0,'byteOffset':len(self.bin),'byteLength':len(raw)}
        if target:v['target']=target
        i=len(self.d['bufferViews']);self.d['bufferViews'].append(v);self.bin.extend(raw);return i
    def acc(self,arr,typ,comp=5126,target=None,bounds=False):
        dt={5126:'<f4',5125:'<u4',5123:'<u2'}[comp];a=np.asarray(arr,dtype=dt);idx=self.view(a.tobytes(),target)
        n=len(a);acc={'bufferView':idx,'componentType':comp,'count':n,'type':typ}
        if bounds:
            aa=a.reshape(n,-1);acc['min']=aa.min(0).tolist();acc['max']=aa.max(0).tolist()
        self.d['accessors'].append(acc);return len(self.d['accessors'])-1
    def texture(self,name,embed=True):
        for i,t in enumerate(self.d['images']):
            if t.get('name')==name:return i
        im={'name':name}
        if embed:im.update({'bufferView':self.view((TEX/name).read_bytes()),'mimeType':'image/png'})
        else:im['uri']='textures/'+name
        ix=len(self.d['images']);self.d['images'].append(im);self.d['textures'].append({'sampler':0,'source':ix});return ix
    def write(self,filename,embed=True):
        d=self.d
        for m in MATS:
            pbr={'baseColorFactor':list(m['rgb'])+[1],'metallicFactor':m['metal'],'roughnessFactor':m['rough']}
            out={'name':m['name'],'pbrMetallicRoughness':pbr,'doubleSided':True}
            if m['texture']:pbr['baseColorTexture']={'index':self.texture(m['texture'],embed)}
            if m['normal']:out['normalTexture']={'index':self.texture(m['normal'],embed),'scale':.40}
            d['materials'].append(out)
        # Root object, bone nodes, then skinned mesh.
        d['nodes']=[{'name':'SengokuHero_Original','children':[1,NJOINT+1]}]
        for b in BONES:
            p=np.array(b['pos']);parent=b['parent'];loc=p-REST[parent] if parent else p
            node={'name':b['name'],'translation':loc.tolist()};ch=[BI[x['name']]+1 for x in BONES if x['parent']==b['name']]
            if ch:node['children']=ch
            d['nodes'].append(node)
        d['nodes'].append({'name':'HeroSkin','mesh':0,'skin':0})
        ib=[]
        for b in BONES:
            mm=np.eye(4,dtype=np.float32);mm[:3,3]=-np.array(b['pos']);ib.append(mm.T.reshape(16))
        d['skins']=[{'name':'HeroRig','joints':list(range(1,NJOINT+1)),'skeleton':1,'inverseBindMatrices':self.acc(np.array(ib),'MAT4')}]
        prim=[]
        for g in GROUPS:
            attrs={'POSITION':self.acc(g['v'],'VEC3',target=34962,bounds=True),'NORMAL':self.acc(g['n'],'VEC3',target=34962),'TEXCOORD_0':self.acc(g['uv'],'VEC2',target=34962),'JOINTS_0':self.acc(g['j'],'VEC4',5123,34962),'WEIGHTS_0':self.acc(g['w'],'VEC4',target=34962)}
            prim.append({'attributes':attrs,'indices':self.acc(g['f'].reshape(-1),'SCALAR',5125,34963),'material':g['mat'],'mode':4})
        d['meshes']=[{'name':'Hero_Skinned','primitives':prim}]
        for clip in CLIPS:
            ani={'name':clip['name'],'samplers':[],'channels':[]};ta=self.acc(clip['times'],'SCALAR',bounds=True)
            for bn,rs in clip['rots'].items():
                # Keep quaternions in the same hemisphere to avoid interpolation flips.
                rs=np.array(rs,np.float32)
                for i in range(1,len(rs)):
                    if rs[i]@rs[i-1]<0:rs[i]*=-1
                if np.max(np.abs(rs-rs[0]))<1e-7 and np.max(np.abs(rs[0]-[0,0,0,1]))<1e-7:continue
                si=len(ani['samplers']);ani['samplers'].append({'input':ta,'output':self.acc(rs,'VEC4'),'interpolation':'LINEAR'})
                ani['channels'].append({'sampler':si,'target':{'node':BI[bn]+1,'path':'rotation'}})
            if clip['name']!='Idle':
                si=len(ani['samplers']);ani['samplers'].append({'input':ta,'output':self.acc(clip['trans'],'VEC3'),'interpolation':'LINEAR'})
                ani['channels'].append({'sampler':si,'target':{'node':BI['Hips']+1,'path':'translation'}})
            d['animations'].append(ani)
        d['extras']={'original_asset':True,'coordinate_system':'Y-up, +Z forward, metres','animation_root_motion':False,'walk_reference_speed_mps':1.4,'run_reference_speed_mps':3.0,'notice':'Original fictional game character, not an authenticated historical portrait. Clothes are skinned, not cloth-simulated.'}
        d['buffers']=[{'byteLength':len(self.bin)}]
        if filename.suffix=='.gltf':
            d['buffers'][0]['uri']=filename.stem+'.bin';filename.write_text(json.dumps(d,separators=(',',':')));filename.with_suffix('.bin').write_bytes(self.bin)
        else:
            jj=json.dumps(d,separators=(',',':')).encode();jj+=b' '*((-len(jj))%4);bb=bytes(self.bin)+b'\0'*((-len(self.bin))%4)
            out=struct.pack('<4sII',b'glTF',2,12+8+len(jj)+8+len(bb))+struct.pack('<I4s',len(jj),b'JSON')+jj+struct.pack('<I4s',len(bb),b'BIN\0')+bb
            filename.write_bytes(out)

Gltf().write(ASSETS/'sengoku_hero.glb',True)
Gltf().write(ASSETS/'sengoku_hero.gltf',False)
# A JSON-wrapped binary model with EXTERNAL textures for restrictive hosts.
g=Gltf();g.write(ASSETS/'sengoku_hero.external.glb',False)
raw=(ASSETS/'sengoku_hero.external.glb').read_bytes()
(ASSETS/'sengoku_hero.web.json').write_text(json.dumps({'format':'glb-base64-external-images-v1','base64':base64.b64encode(raw).decode()},separators=(',',':')))
(ASSETS/'sengoku_hero.external.glb').unlink()
verts=np.concatenate([g['v'] for g in GROUPS]);meta=dict(vertices=len(verts),triangles=sum(len(g['f']) for g in GROUPS),materials=len(MATS),joints=NJOINT,animations=[{'name':c['name'],'seconds':float(c['times'][-1])} for c in CLIPS],bounds_min=verts.min(0).tolist(),bounds_max=verts.max(0).tolist(),model_bytes=(ASSETS/'sengoku_hero.glb').stat().st_size,parts=len(parts))
(ROOT/'asset-info.json').write_text(json.dumps(meta,indent=2))
print(json.dumps(meta,indent=2),flush=True)
