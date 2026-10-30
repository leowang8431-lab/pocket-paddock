"""Package the existing Vite dist, with index.html at the ZIP root.

Run npm run build first. This script neither builds nor publishes the website.
"""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
if not (dist / "index.html").is_file():
    raise SystemExit("dist/index.html is missing. Run npm run build first.")
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = root / "outputs" / f"Pocket-Paddock-Static-{version}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(dist.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(dist).as_posix())
with zipfile.ZipFile(output) as archive:
    names = archive.namelist()
    if "index.html" not in names or any(name.startswith("dist/") for name in names):
        raise SystemExit("Invalid archive layout; expected index.html at root.")
    print(json.dumps({"archive": str(output), "files": len(names), "bytes": output.stat().st_size}, ensure_ascii=False))
