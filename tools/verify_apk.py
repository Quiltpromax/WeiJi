"""Inspect the built APK and extract its exact assets for final UI checks."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
VERSION=ET.parse(ROOT / "app" / "src" / "main" / "AndroidManifest.xml").getroot().attrib["{http://schemas.android.com/apk/res/android}versionName"]
APK=ROOT / "artifacts" / f"weiji-v{VERSION}.apk"
TARGET=ROOT / "build" / "verified-apk-assets"

if __name__=="__main__":
    TARGET.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(APK) as package:
        assert package.testzip() is None,"APK archive is corrupt"
        names=package.namelist()
        assert "classes.dex" in names
        assert "AndroidManifest.xml" in names
        assert "assets/index.html" in names
        assert "assets/theme.css" in names and "assets/theme.js" in names
        for name in names:
            if name.startswith("assets/") and not name.endswith("/"):
                relative=Path(name[7:])
                assert not relative.is_absolute() and ".." not in relative.parts
                destination=TARGET / relative
                destination.parent.mkdir(parents=True,exist_ok=True)
                destination.write_bytes(package.read(name))
        js=package.read("assets/app.js").decode("utf-8")
        assert "elapsed-days" in js and "weiji-backup" in js and "pendingImageDraft" in js
        assert "form-url" not in js and "form-type" not in js and "open-video-link" not in js
        assert "add-view" in js and "legacy-target" in js
        assert "existing?." not in js
        assert b"ExifInterface" in package.read("classes.dex")
        assert all(marker in package.read("classes.dex") for marker in [b"theme.css",b"theme.js",b"haptic",b"setTheme",b"isSystemDark"])
    stage=Path(tempfile.mkdtemp(prefix="weiji-inspect-"))
    plain=stage / "app.apk"
    shutil.copy2(APK,plain)
    aapt=next((ROOT / ".tools" / "build-tools").rglob("aapt2.exe"))
    result=subprocess.run([str(aapt),"dump","badging",str(plain)],capture_output=True)
    assert result.returncode==0,result.stderr
    try: summary=result.stdout.decode("utf-8")
    except UnicodeDecodeError: summary=result.stdout.decode("cp936")
    assert "package: name='com.weiji.privatejournal' " in summary
    assert f"versionName='{VERSION}'" in summary
    assert "minSdkVersion:'26'" in summary
    assert "targetSdkVersion:'34'" in summary
    assert "application-label:'微记'" in summary
    assert "uses-permission:" not in summary,"The APK should not request broad or network permissions"
    (ROOT / "artifacts" / "apk-inspection.txt").write_text(summary,encoding="utf-8")
    print("APK contents verified: Android 8+, target 34, no requested permissions, packaged UI and DEX present.")
