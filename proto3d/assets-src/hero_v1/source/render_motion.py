"""Offline pose sequence from the exported glTF; not a real-time performance video."""
from pathlib import Path
import tempfile, shutil
from PIL import Image, ImageDraw, ImageFont
from render_preview import render, R
out=R/'previews'
frames=[]
for i in range(12):
 p1=f'_walk_{i:02d}.png';p2=f'_run_{i:02d}.png'
 # Both clips are shown at their own normalized cycle phase for pose inspection.
 render(p1,clip='Walk',t=.84*i/12,eye=(1.4,1.45,4.2),w=420,h=570)
 render(p2,clip='Run',t=.64*i/12,eye=(1.4,1.45,4.2),w=420,h=570)
 canvas=Image.new('RGB',(850,608),(235,235,231));canvas.paste(Image.open(out/p1),(0,38));canvas.paste(Image.open(out/p2),(430,38))
 d=ImageDraw.Draw(canvas);d.text((18,12),'WALK / offline pose check',fill=(42,48,43));d.text((448,12),'RUN / offline pose check',fill=(42,48,43))
 frames.append(canvas.quantize(colors=128));(out/p1).unlink();(out/p2).unlink()
frames[0].save(out/'motion_check.gif',save_all=True,append_images=frames[1:],duration=80,loop=0,optimize=False)
print('motion_check.gif complete')
