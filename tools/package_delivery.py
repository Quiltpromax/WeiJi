"""Create the visual overview and a source archive for the user."""
from pathlib import Path
import hashlib
import zipfile
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT / "artifacts"

def font(size):
    return ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",size)

if __name__=="__main__":
    width,height=390,844
    margin,gap=38,26
    canvas=Image.new("RGB",(margin*2+width*3+gap*2,height+166),(238,241,235))
    draw=ImageDraw.Draw(canvas)
    draw.text((margin,22),"微记 · 你的私人记录",font=font(27),fill="#344a3c")
    draw.text((margin,63),"界面示例  /  安装后从空白记录开始",font=font(14),fill="#8f9b87")
    panels=[("preview-home.png","距上次活动"),("preview-dark.png","夜间深色模式"),("preview-combined.png","活动与观看一起记录")]
    for i,(file,label) in enumerate(panels):
        x=margin+i*(width+gap)
        draw.text((x,100),label,font=font(17),fill="#667a60")
        screen=Image.open(OUT / file).convert("RGB").resize((width,height),Image.Resampling.LANCZOS)
        mask=Image.new("L",(width,height),0)
        ImageDraw.Draw(mask).rounded_rectangle((0,0,width-1,height-1),radius=19,fill=255)
        canvas.paste(screen,(x,136),mask)
    canvas.save(OUT / "preview-overview.png",optimize=True)
    sources=[ROOT / ".gitignore",ROOT / "README.md",ROOT / "CHANGELOG.md",ROOT / "package.json",ROOT / "package-lock.json",ROOT / "settings.gradle",ROOT / "build.gradle"]
    for folder in ("app","tools","tests"):
        sources.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    with zipfile.ZipFile(OUT / "weiji-source.zip","w",zipfile.ZIP_DEFLATED) as archive:
        for file in sources:
            archive.write(file,"weiji/"+file.relative_to(ROOT).as_posix())
    version=ET.parse(ROOT / "app" / "src" / "main" / "AndroidManifest.xml").getroot().attrib["{http://schemas.android.com/apk/res/android}versionName"]
    apk=OUT / f"weiji-v{version}.apk"
    digest=hashlib.sha256(apk.read_bytes()).hexdigest()
    (OUT / "SHA256.txt").write_text(digest+"  "+apk.name+"\n",encoding="ascii")
    print("Preview and source archive ready.")
