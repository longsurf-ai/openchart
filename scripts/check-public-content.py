#!/usr/bin/env python3
"""Check tracked source for internal writing and accidentally committed local state."""

from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
HAN = re.compile("[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
PRIVATE_PATH = re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/")
FORBIDDEN_PATH = re.compile(
    r"(^|/)(plans?|proposals?|scratch|tmp|sean_demo|node_modules|\.artifacts|\.worktrees)(/|$)"
    r"|(^|/)[^/]*(?:-proposal|-plan)\.md$|\.excalidraw$"
    r"|\.(?:sqlite3|p12|p8|pem|key)$|(^|/)\.npmrc$"
)
FORBIDDEN_HEADING = re.compile(
    r"(?im)^#{1,6} .*\b(?:implementation (?:plan|order|workstreams)|roadmap|pending triage|proposal)\b"
)
PUBLIC_ENV = {"app/.env.development", "app/.env.production"}
# These are real market names, not authored internal prose. Keep original aliases.
MARKET_NAMES = (
    "\u4e09\u83f1UFJ\u30d5\u30a3\u30ca\u30f3\u30b7\u30e3\u30eb\u30fb\u30b0\u30eb\u30fc\u30d7",
    "\u5e01\u5b89\u4eba\u751f",
    "\u725b\u6765",
)
# Reviewed fixtures verify native UTF-8 streams, arguments and filesystem paths.
# Keep this exact and file-scoped; test files still reject unrelated internal prose.
UNICODE_TEST_FIXTURES = {
    "common/models/src/providers/antigravity/adapter/native-config.test.ts": (
        "\u5e02\u5834",
    ),
    "platform/desktop/tests/native-executable.test.ts": (
        "\u6d4b\u8bd5", "\u4e2d\u6587",
    ),
}


def files(repository):
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=repository)
    return [Path(name) for name in output.decode().split("\0") if name]


errors = []
count = 0
for relative in files(ROOT):
    name = relative.as_posix()
    path = ROOT / relative
    if FORBIDDEN_PATH.search(name):
        errors.append(f"{name}: internal or machine-local path")
    if HAN.search(name):
        errors.append(f"{name}: non-English filename needs review")
    if path.is_symlink():
        if not path.resolve().is_relative_to(ROOT) or not path.exists():
            errors.append(f"{name}: broken or external symlink")
        continue
    if not path.is_file():
        continue
    count += 1
    raw = path.read_bytes()
    if b"\0" in raw:
        continue
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        continue
    if relative.name.startswith(".env"):
        if name not in PUBLIC_ENV:
            errors.append(f"{name}: unexpected environment file")
        for line in text.splitlines():
            if line.strip() and not line.lstrip().startswith("#") and not re.fullmatch(
                r"VITE_APP_CLERK_PUBLISHABLE_KEY=pk_(?:test|live)_[A-Za-z0-9+/=]+", line
            ):
                errors.append(f"{name}: environment file may contain private configuration")
    if PRIVATE_PATH.search(text):
        errors.append(f"{name}: machine-specific absolute path")
    if name.endswith(".md") and FORBIDDEN_HEADING.search(text):
        errors.append(f"{name}: internal planning section")
    if name == "server/data/providers/local/logos/assets/catalog.json":
        for market_name in MARKET_NAMES:
            text = text.replace(market_name, "")
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), text)
    for fixture in UNICODE_TEST_FIXTURES.get(name, ()):
        text = text.replace(fixture, "")
    if name != "scripts/check-public-content.py" and HAN.search(text):
        errors.append(f"{name}: Chinese internal text needs review")

# Tea is independently public; its language tests intentionally exercise Unicode.
tea = ROOT / "vendor/tea"
if not (tea / "package.json").is_file():
    errors.append("vendor/tea: initialize the pinned submodule before auditing")
else:
    for relative in files(tea):
        path = tea / relative
        if not path.is_file() or path.is_symlink():
            continue
        try:
            text = path.read_text()
        except UnicodeError:
            continue
        if relative.as_posix() == "src/lsp/analysis.test.ts":
            text = text.replace("\u65e5\u672c\U0001f600", "")
        if HAN.search(text):
            errors.append(f"vendor/tea/{relative}: Chinese text outside the reviewed Unicode test")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"Public-content check passed for {count} tracked files and the pinned Tea source.")
