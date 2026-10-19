"""Check update identity against the original release without reading private key passwords."""
import hashlib
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = ET.parse(ROOT / "app/src/main/AndroidManifest.xml").getroot().attrib["{http://schemas.android.com/apk/res/android}versionName"]


def inspect(apk, destination, java, signer, aapt):
    shutil.copy2(apk, destination)
    signature = subprocess.run([str(java), "-jar", str(signer), "verify", "--print-certs", str(destination)], capture_output=True, check=True).stdout.decode("utf-8")
    metadata = subprocess.run([str(aapt), "dump", "badging", str(destination)], capture_output=True, check=True).stdout.decode("utf-8")
    package, code, version = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", metadata).groups()
    certificates = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)", signature)
    assert len(certificates) == 1, "Expected the original single signing identity"
    return {"package": package, "code": int(code), "version": version, "certificate": certificates[0], "sha256": hashlib.sha256(apk.read_bytes()).hexdigest()}


if __name__ == "__main__":
    java = next((ROOT / ".tools/jdk").rglob("java.exe"))
    signer = next((ROOT / ".tools/build-tools").rglob("apksigner.jar"))
    aapt = next((ROOT / ".tools/build-tools").rglob("aapt2.exe"))
    with tempfile.TemporaryDirectory(prefix="weiji-upgrade-") as directory:
        stage = Path(directory)
        original = inspect(ROOT / "artifacts/weiji-v1.2.0.apk", stage / "original.apk", java, signer, aapt)
        current = inspect(ROOT / "artifacts" / f"weiji-v{VERSION}.apk", stage / "current.apk", java, signer, aapt)
    assert current["package"] == original["package"] == "com.weiji.privatejournal", "Package identity changed"
    assert current["certificate"] == original["certificate"], "Signing identity differs from the installed original release"
    assert current["code"] > original["code"], "Internal version must increase"
    report = (
        "PASS: same application package and signing certificate as original 1.2.0; increased versionCode.\n"
        f"Package: {current['package']}\n"
        f"Original: {original['version']} (versionCode {original['code']})\n"
        f"Current: {current['version']} (versionCode {current['code']})\n"
        f"Certificate SHA-256: {current['certificate']}\n"
        f"APK SHA-256: {current['sha256']}\n"
        "The signing identity and version requirements for updating the original app are satisfied.\n"
        "No physical Android device or emulator was connected; actual installation and hardware haptics remain untested.\n"
    )
    (ROOT / "artifacts/update-compatibility.txt").write_text(report, encoding="utf-8")
    print(report)
