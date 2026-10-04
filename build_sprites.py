from PIL import Image, ImageOps
import numpy as np, json, os
A='/home/box/agent-data/agents/06f17c61-d7d0-4047-a3d3-d2a2690779d7/assets/'
src={
'chronos':'c83e60aa5aba77d3965e76321ebc587eb59072b8263fbfe92eb85f3744713530',
'plutus':'4b75faddc2a5dd3ccaf52be75bc480c071cc99ce0b5d2c738133537133835ddd',
'hestia':'d1f3eb6847d46f7abd157ca155998285762893eea830f8375e9aecd8a138f38f',
'hermes':'74e6cbc9898bf71bc8dec392c23992af55ddd3ecf2bdf6b8fcf1811f6a81afbb',
'hygieia':'cfdfe535b5a2b08a7b45a0c646cd4367ff21f1c0e46ab36e1fbb0561aeae3a40',
'atlas':'49966ac86402e282bf0085f1a1e9376ae8817497e0c6f6f88e1d60b2393b6377',
'hephaestus':'78bd1c2049e0aa35d1575808024e8231716cec499621b6805739b268486cac2f',
'thoth':'11cc30e5d0f4468888b7370f6d2f43a6493bfdf309a4c17f8ed0551c494447cf',
'prometheus':'2fac8ba5a9fa88693e9b9b6e375acf4af89fc6e42b09f585ab1a057f2bea6bb4',
'fortuna':'3d50bc344749e8a3461f5d4889a7281757474e59bc85e66b583d62ccaee747c1',
'artemis':'7a65d9c7df458ace51fb88d77747c0e33cdc11ea793bb3cccf72ff7e2edd39dc',
'daedalus':'226b214d2aab3d4b0335a88b586a841568bf5427665ffdbb71f7d929c3c0cd63',
'apollo':'5ec5004156e59b42e4fef944618b4e7cdff0c743d4fb1a6e1343da2ac003b9b2',
'athena':'cce5d3de877d0c4733529ea85c0be9ab5015c738f77cad635b816066664b4438',
'iris':'4a28d7b25d832c268ffa4a5859d56b9c8724f76ce9ff757475780f4bf334e2c3',
'hades':'9604e92f4bff6bd6ceba8fc310fe80afe1a17a0e2777cae9b014a60896b666e7',
'argus':'b69368100a3a3c5fc0db736126a1080886434f82510fcd7fb86228c93392f84f',
'timesnap':'b0ed721ad2cb49640c53a4d5d581b5f389c7aa455555688046ea73f7e1291de6',
}
side_faces_right={'prometheus','daedalus'}
def key(im):
    a=np.asarray(im.convert('RGB')).astype(int)
    h,w,_=a.shape
    corners=np.concatenate([a[:20,:20].reshape(-1,3),a[:20,-20:].reshape(-1,3),a[-20:,:20].reshape(-1,3),a[-20:,-20:].reshape(-1,3)])
    bg=np.median(corners,axis=0)
    d=np.sqrt(((a-bg)**2).sum(-1))
    # also hue-based: magenta-ish or green-ish
    r,g,b=a[...,0],a[...,1],a[...,2]
    if bg[1]>bg[0]: spill=(g>r+60)&(g>b+60)
    else: spill=(r>g+90)&(b>g+60)
    alpha=np.where((d<110)|spill,0,255).astype(np.uint8)
    rgba=np.dstack([a.astype(np.uint8),alpha])
    return Image.fromarray(rgba,'RGBA')
def bbox_largest(im):
    from PIL import ImageFilter
    al=im.split()[3]
    m=al.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(9))
    bb=m.getbbox()
    out=im.crop(bb)
    return out.crop(out.getbbox())
meta={}
FR=48
for name,h in src.items():
    p=A+h+('.jpg' if os.path.exists(A+h+'.jpg') else '.png')
    im=key(Image.open(p)); W,H=im.size
    cuts=[0,int(W*0.275),int(W*0.5),int(W*0.725),W]
    poses=[bbox_largest(im.crop((cuts[i],0,cuts[i+1],H))) for i in range(4)]
    down,side,_,up=poses
    left=ImageOps.mirror(side) if name in side_faces_right else side
    right=ImageOps.mirror(left)
    dirs=[down,left,right,up]
    mh=max(p.size[1] for p in dirs); mw=max(p.size[0] for p in dirs)
    for size,suffix in [(48,''),(96,'@2x')]:
        s=min((size-2)/mh,(size-2)/mw)
        sheet=Image.new('RGBA',(size*4,size*4),(0,0,0,0))
        idle=None
        for r,pz in enumerate(dirs):
            w2,h2=max(1,round(pz.size[0]*s)),max(1,round(pz.size[1]*s))
            small=pz.resize((w2,h2),Image.BOX)
            a=np.asarray(small).copy(); a[...,3]=np.where(a[...,3]>140,255,0); small=Image.fromarray(a,'RGBA')
            for f in range(4):
                bob=(size//48) if f in (1,3) else 0
                x=(size-w2)//2; y=size-1-h2-bob
                sheet.alpha_composite(small,(r*0+f*size+x, r*size+y))
            if r==0:
                idle=Image.new('RGBA',(size,size),(0,0,0,0)); idle.alpha_composite(small,((size-w2)//2,size-1-h2))
        sheet.save(f'assets/sprites/{name}{suffix}.png')
        idle.save(f'assets/sprites/{name}-idle{suffix}.png')
    meta[name]={'frame':48,'rows':['down','left','right','up'],'frames_per_row':4}
json.dump({'frame_size':48,'hd_frame_size':96,'rows':['down','left','right','up'],'frames_per_row':4,'sprites':sorted(meta)},open('assets/sprites/sprites.json','w'),indent=1)
print('ok',len(meta))
