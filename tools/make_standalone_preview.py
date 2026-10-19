"""Bundle a complete interactive preview into one file, with no server needed."""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app" / "src" / "main" / "assets"
OUT = ROOT / "artifacts"

if __name__ == "__main__":
    html = (ASSETS / "index.html").read_text(encoding="utf-8")
    css = (ASSETS / "style.css").read_text(encoding="utf-8")
    theme_css = (ASSETS / "theme.css").read_text(encoding="utf-8")
    theme_js = (ASSETS / "theme.js").read_text(encoding="utf-8")
    core = (ASSETS / "core.js").read_text(encoding="utf-8")
    app = (ASSETS / "app.js").read_text(encoding="utf-8")
    covers = {f"covers/{i}.svg": "data:image/svg+xml;base64," + base64.b64encode((ASSETS / "covers" / f"{i}.svg").read_bytes()).decode("ascii") for i in range(1, 4)}
    old_mode = 'const demoMode = !native && new URLSearchParams(location.search).get("demo") === "1";'
    new_mode = 'const demoMode = !native && new URLSearchParams(location.search).get("blank") !== "1";'
    old_url = 'function imageUrl(value) {\n    return value.startsWith("data:") || value.startsWith("covers/") ? value : "images/" + value;\n  }'
    new_url = "function imageUrl(value) {return window.WeijiPreviewCovers[value] || (value.startsWith('data:')||value.startsWith('covers/')?value:'images/'+value);}"
    old_exit = '$("#exit-demo").onclick = () => {\n    location.href = location.pathname;\n  };'
    new_exit = "$('#exit-demo').onclick=()=>{const target=new URL(location.href);target.search='?blank=1';location.href=target.href;};"
    assert old_mode in app and old_url in app and old_exit in app
    app = app.replace(old_mode,new_mode).replace(old_url,new_url).replace(old_exit,new_exit)
    html = html.replace("script-src 'self';", "script-src 'unsafe-inline';")
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>" + css + "</style>")
    html = html.replace('<link rel="stylesheet" href="theme.css">', "<style>" + theme_css + "</style>")
    def script(value):
        return "<script>" + value.replace("</script", "<\\/script") + "</script>"
    html = html.replace('<script src="theme.js"></script>', script(theme_js))
    html = html.replace('<script src="core.js"></script>', script("window.WeijiPreviewCovers=" + json.dumps(covers) + ";\n" + core))
    html = html.replace('<script src="app.js"></script>', script(app))
    OUT.mkdir(exist_ok=True)
    target = OUT / "weiji-preview.html"
    target.write_text(html, encoding="utf-8")
    print("Standalone preview ready.")
