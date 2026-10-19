"""Download a local Android toolchain. No machine-wide settings are changed."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".tools"
TOOLS.mkdir(exist_ok=True)

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Weiji-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)

def install(name, url, checksum=None, algorithm="sha1"):
    destination = TOOLS / name
    if destination.exists() and any(destination.iterdir()):
        print(f"{name}: already installed", flush=True)
        return
    archive = TOOLS / (name + ".zip")
    if not archive.exists():
        print(f"{name}: downloading", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Weiji-build/1.0"})
        part = archive.with_suffix(".part")
        with urllib.request.urlopen(req, timeout=120) as response, part.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        part.replace(archive)
    if checksum:
        digest = hashlib.new(algorithm, archive.read_bytes()).hexdigest()
        if digest != checksum:
            raise RuntimeError(f"Checksum mismatch: {name}")
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        source.extractall(destination)
    print(f"{name}: installed", flush=True)

if __name__ == "__main__":
    jdk_packages = fetch_json("https://api.azul.com/metadata/v1/zulu/packages/?java_version=17&os=windows&arch=x86&archive_type=zip&java_package_type=jdk&release_status=ga&availability_types=CA&latest=true")
    jdk = next(item for item in jdk_packages if "-fx-" not in item["name"])
    packages = [
        ("jdk", jdk["download_url"], None),
        ("platform", "https://dl.google.com/android/repository/platform-35_r02.zip", "0bb560a90a7a2cbd0dd8348224d518b638fe7949"),
        ("build-tools", "https://dl.google.com/android/repository/build-tools_r35_windows.zip", "af059bb67cf7786f45ee0db85e2d24985df1b4b6"),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(install, *package) for package in packages]
        for future in futures:
            future.result()
    print("Android toolchain ready.", flush=True)
