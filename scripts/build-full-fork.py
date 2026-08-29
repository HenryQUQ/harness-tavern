#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

product = Path(__file__).resolve().parents[1]
release = product / "release"
version = json.loads((product / "package.json").read_text(encoding="utf-8"))["version"]
input_zip = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/mnt/data/deepseek-harness-master(1).zip")
if not input_zip.exists():
    matches = [p for p in Path("/mnt/data").glob("*deepseek*harness*.zip") if "tavern" not in p.name.lower()]
    if not matches:
        raise SystemExit("DeepSeek Harness source ZIP was not found")
    input_zip = matches[0]

release.mkdir(parents=True, exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix="harness-tavern-fork-"))
try:
    with zipfile.ZipFile(input_zip) as archive:
        archive.extractall(stage)

    candidates = [
        p.parent
        for p in stage.rglob("package.json")
        if (p.parent / "packages" / "core" / "agent-loop").exists()
    ]
    if not candidates:
        raise SystemExit("Extracted archive does not look like DeepSeek Harness")
    upstream = candidates[0]
    target = upstream / "products" / "harness-tavern"
    target.parent.mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns(".git", ".ht-data", "release", "node_modules", "coverage", "*.log", "__pycache__", "*.pyc")
    shutil.copytree(product, target, ignore=ignore)

    integration_readme = f"""# Harness Tavern downstream product

This source snapshot contains Harness Tavern {version} under
`products/harness-tavern`. It was assembled from the user-provided DeepSeek
Harness source archive and keeps Tavern as a separate chat-first product
surface.

Start the Tavern product directly:

```bash
cd products/harness-tavern
npm start
```

The included installer can copy this isolated product surface into another
DeepSeek Harness checkout. It does not claim to mount a coding-agent or Cordis
profile; that boundary remains explicit and replaceable.
"""
    (upstream / "HARNESS_TAVERN.md").write_text(integration_readme, encoding="utf-8")

    install = subprocess.run(
        ["npm", "ci", "--ignore-scripts"],
        cwd=target,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    (target / "FULL_FORK_PRODUCT_INSTALL.txt").write_text(install.stdout, encoding="utf-8")
    if install.returncode:
        raise SystemExit(f"Product dependency install failed inside full fork (exit {install.returncode})")

    test = subprocess.run(
        ["npm", "test"],
        cwd=target,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    (target / "FULL_FORK_PRODUCT_TEST.txt").write_text(test.stdout, encoding="utf-8")
    if test.returncode:
        raise SystemExit(f"Product tests failed inside full fork (exit {test.returncode})")
    shutil.rmtree(target / "node_modules", ignore_errors=True)

    output = release / f"deepseek-harness-tavern-{version}-full-fork-source.zip"
    output.unlink(missing_ok=True)
    archive_root = f"deepseek-harness-tavern-{version}"
    files = sorted(
        p for p in upstream.rglob("*")
        if p.is_file() and "/.git/" not in p.as_posix() and "__pycache__" not in p.parts
    )
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            arc = f"{archive_root}/{path.relative_to(upstream).as_posix()}"
            info = zipfile.ZipInfo(arc, date_time=(2026, 8, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if os.access(path, os.X_OK) else 0o644) << 16
            archive.writestr(info, path.read_bytes())

    report = {
        "product_version": version,
        "input_archive": str(input_zip),
        "input_sha256": hashlib.sha256(input_zip.read_bytes()).hexdigest(),
        "output": output.name,
        "output_bytes": output.stat().st_size,
        "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "product_tests_inside_fork": "passed",
        "product_files": sum(1 for p in target.rglob("*") if p.is_file()),
        "upstream_lock": json.loads((product / "UPSTREAM.lock.json").read_text(encoding="utf-8")),
    }
    (release / "FULL_FORK_REPORT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
finally:
    shutil.rmtree(stage, ignore_errors=True)
