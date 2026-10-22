from pathlib import Path
from PIL import Image, ImageDraw
import math
root=Path(__file__).resolve().parent
root.mkdir(exist_ok=True)
scale=4
image=Image.new('RGBA',(128*scale,128*scale),(0,0,0,0))
draw=ImageDraw.Draw(image)
draw.rounded_rectangle((0,0,128*scale-1,128*scale-1),radius=27*scale,fill='#0d608c')
for y0 in (49,78):
 points=[((26+x)*scale,(y0+7*math.sin(x/76*2*math.pi))*scale) for x in range(77)]
 draw.line(points,fill='white',width=9*scale,joint='curve')
 for x,y in (points[0],points[-1]):draw.ellipse((x-4.5*scale,y-4.5*scale,x+4.5*scale,y+4.5*scale),fill='white')
image=image.resize((128,128),Image.Resampling.LANCZOS)
image.save(root/'icon.png')
image.save(root/'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128)])
print('Created original shared wave icon, RGBA PNG and Windows ICO')
