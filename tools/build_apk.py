"""Build a signed APK with the official Android tools, without Gradle."""
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".tools"
BUILD = Path(tempfile.mkdtemp(prefix="weiji-build-"))
OUT = ROOT / "artifacts"
APP_SOURCE = ROOT / "app" / "src" / "main"
APP = BUILD / "app"

def find(name, under):
    matches = list(under.rglob(name))
    if not matches:
        raise RuntimeError(f"Missing {name}; run python tools/setup_android.py first.")
    return matches[0]

def run(args):
    result = subprocess.run([str(arg) for arg in args], cwd=ROOT, env=BUILD_ENV, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    if result.stdout.strip():
        print(result.stdout.strip(), flush=True)

if __name__ == "__main__":
    shutil.copytree(APP_SOURCE, APP)
    OUT.mkdir(exist_ok=True)
    java = find("java.exe", TOOLS / "jdk")
    javac = java.with_name("javac.exe")
    keytool = java.with_name("keytool.exe")
    android = BUILD / "android.jar"
    shutil.copy2(find("android.jar", TOOLS / "platform"), android)
    aapt = find("aapt2.exe", TOOLS / "build-tools")
    zipalign = find("zipalign.exe", TOOLS / "build-tools")
    d8 = find("d8.jar", TOOLS / "build-tools")
    apksigner = find("apksigner.jar", TOOLS / "build-tools")
    BUILD_ENV = {**os.environ, "JAVA_HOME": str(java.parent.parent), "PATH": str(java.parent) + os.pathsep + os.environ.get("PATH", "")}
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is needed to prepare the APK assets.")
    run([node,ROOT / "tools" / "prepare_assets.cjs",APP / "assets"])
    classes, dex = BUILD / "classes", BUILD / "dex"
    classes.mkdir(exist_ok=True)
    dex.mkdir(exist_ok=True)
    print("Compiling Android resources...", flush=True)
    resources = BUILD / "compiled-res.zip"
    run([aapt,"compile","--dir",APP / "res","-o",resources])
    package = BUILD / "resources.apk"
    run([aapt,"link","-o",package,"-I",android,"--manifest",APP / "AndroidManifest.xml","--min-sdk-version","26","--target-sdk-version","34","-A",APP / "assets",resources])
    print("Compiling application...", flush=True)
    sources = sorted((APP / "java").rglob("*.java"))
    run([javac,"-J-Duser.language=en","-J-Duser.country=US","-encoding","UTF-8","-source","8","-target","8","-classpath",android,"-d",classes,*sources])
    jar = BUILD / "classes.jar"
    with zipfile.ZipFile(jar,"w",zipfile.ZIP_DEFLATED) as out:
        for source in classes.rglob("*.class"):
            out.write(source,source.relative_to(classes).as_posix())
    run([java,"-cp",d8,"com.android.tools.r8.D8","--release","--min-api","26","--lib",android,"--output",dex,jar])
    unsigned = BUILD / "unsigned.apk"
    shutil.copy2(package,unsigned)
    with zipfile.ZipFile(unsigned,"a",zipfile.ZIP_DEFLATED) as out:
        out.write(dex / "classes.dex","classes.dex")
    aligned = BUILD / "aligned.apk"
    run([zipalign,"-f","-p","4",unsigned,aligned])
    key, password_file = TOOLS / "weiji-signing.p12", TOOLS / "signing-password.txt"
    if not key.exists():
        password = secrets.token_urlsafe(32)
        password_file.write_text(password,encoding="ascii")
        run([keytool,"-genkeypair","-alias","weiji","-keyalg","RSA","-keysize","3072","-validity","10000","-keystore",key,"-storetype","PKCS12","-storepass:file",password_file,"-keypass:file",password_file,"-dname","CN=Weiji Personal Journal"])
    version = ET.parse(APP_SOURCE / "AndroidManifest.xml").getroot().attrib["{http://schemas.android.com/apk/res/android}versionName"]
    apk = OUT / f"weiji-v{version}.apk"
    run([java,"-jar",apksigner,"sign","--ks",key,"--ks-type","PKCS12","--ks-key-alias","weiji","--ks-pass","file:"+str(password_file),"--out",apk,aligned])
    run([java,"-jar",apksigner,"verify","--verbose",apk])
    run([zipalign,"-c","-p","4",apk])
    print(f"Built: {apk} ({apk.stat().st_size:,} bytes)",flush=True)
