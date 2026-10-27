#!/usr/bin/env python3
"""Build all Pro archives, encrypt them with AES-256, and rewrite the
store catalog in assets/store.js.

    python3 build/encrypt_packs.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # .../showcase-site
SECRETS = ROOT / "build" / "pack-secrets.json"
PACKS = ROOT / "packs"
MONEY4_PRODUCTS = Path("/Users/evgenijdanilov/gemini/money4/products")
MONEYMAKER_PRODUCTS = Path("/Users/evgenijdanilov/moneymaker/work/products")

EXCLUDE_DIRS = {".git", "__pycache__", ".cache", "packs", "node_modules", "work",
                "holler-brand", "shots"}
EXCLUDE_FILES = {"config.json", "alertbot.sqlite", "pack-secrets.json", ".DS_Store"}

SPECS = [
    {
        "id": "forensics",
        "price": 19,
        "source": MONEYMAKER_PRODUCTS / "p1-forensics",
        "archive": "forensics-pro.zip",
        "label": "Token Holder Forensics Kit — Pro",
    },
    {
        "id": "paywall",
        "price": 29,
        "source": ROOT,
        "archive": "paywall-pro.zip",
        "label": "USDC Paywall Boilerplate — Pro",
    },
    {
        "id": "alertbot",
        "price": 25,
        "source": MONEYMAKER_PRODUCTS / "p3-alertbot",
        "archive": "alertbot-pro.zip",
        "label": "Alert & Bounty Sniper Bot — Pro",
    },
    {
        "id": "tgbot",
        "price": 29,
        "source": MONEY4_PRODUCTS / "01-telegram-crypto-shop-pro",
        "archive": "tg-crypto-shop-pro.zip",
        "label": "Telegram Crypto Shop Bot (aiogram 3) — Pro",
    },
    {
        "id": "scraper",
        "price": 39,
        "source": MONEY4_PRODUCTS / "02-universal-scraper-pro",
        "archive": "universal-scraper-pro.zip",
        "label": "Universal Scraper Pro (Cloudflare Bypass) — Pro",
    },
    {
        "id": "uikit",
        "price": 25,
        "source": MONEY4_PRODUCTS / "03-landing-ui-svg-kit",
        "archive": "landing-ui-svg-kit-pro.zip",
        "label": "10 Premium Landing UI Components & SVG Kit — Pro",
    },
    {
        "id": "bounty",
        "price": 49,
        "source": MONEY4_PRODUCTS / "04-crypto-bounty-hunter-toolkit",
        "archive": "crypto-bounty-hunter-pro.zip",
        "label": "Crypto Bounty Hunter & Onchain Analytics — Pro",
    },
]

def load_secrets() -> dict:
    if SECRETS.exists():
        return json.loads(SECRETS.read_text())
    return {}

def save_secrets(data: dict) -> None:
    SECRETS.parent.mkdir(parents=True, exist_ok=True)
    SECRETS.write_text(json.dumps(data, indent=2))
    SECRETS.chmod(0o600)

def passphrase_for(pid: str, store: dict) -> str:
    if pid not in store:
        store[pid] = secrets.token_urlsafe(18)
    return store[pid]

PLACEHOLDER_CATALOG = """  const CATALOG = {
    forensics: {
      id: "forensics",
      name: "Your product name",
      price: 19,
      units: 19000000n,
      archive: "packs/your-product.zip.enc",
      pass: "REPLACE_ME",
      sha256: "",
      bytes: 0
    }
  };"""

def sanitize_paywall(tmp_source: Path) -> None:
    store_js = tmp_source / "assets" / "store.js"
    if not store_js.exists():
        return
    src = store_js.read_text()
    new, n = re.subn(
        r"/\* CATALOG:BEGIN.*?CATALOG:END \*/",
        lambda _m: "/* CATALOG:BEGIN — replace with your own products */\n"
                   + PLACEHOLDER_CATALOG + "\n  /* CATALOG:END */",
        src,
        flags=re.S,
    )
    if n != 1:
        raise SystemExit("paywall sanitize: CATALOG markers not found")
    store_js.write_text(new)

def make_zip(source: Path, target: Path, arc_root: str) -> int:
    count = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(source.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(source)
            if any(part in EXCLUDE_DIRS for part in rel.parts[:-1]):
                continue
            if rel.name in EXCLUDE_FILES:
                continue
            if rel.suffix in {".enc", ".pyc"}:
                continue
            if rel.parent.name == "data" and rel.name.startswith("pack-"):
                continue
            if path.stat().st_size > 8 * 1024 * 1024:
                print("  skip (too large): %s" % rel)
                continue
            zf.write(path, arcname=str(Path(arc_root) / rel))
            count += 1
    return count

def encrypt(plain: Path, out: Path, passphrase: str) -> None:
    out.unlink(missing_ok=True)
    cmd = [
        "openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt",
        "-in", str(plain), "-out", str(out), "-pass", "pass:" + passphrase,
    ]
    subprocess.run(cmd, check=True)

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def rewrite_catalog(entries: dict) -> None:
    store_js = ROOT / "assets" / "store.js"
    src = store_js.read_text()
    lines = ["  const CATALOG = {"]
    ids = list(entries)
    for i, pid in enumerate(ids):
        e = entries[pid]
        comma = "," if i < len(ids) - 1 else ""
        lines += [
            '    %s: {' % pid,
            '      id: "%s",' % pid,
            '      name: %s,' % json.dumps(e["label"]),
            '      price: %d,' % e["price"],
            '      units: %dn,' % (e["price"] * 1_000_000),
            '      archive: "packs/%s",' % e["file"],
            '      pass: %s,' % json.dumps(e["pass"]),
            '      sha256: "%s",' % e["sha256"],
            '      bytes: %d' % e["size"],
            '    }%s' % comma,
        ]
    lines.append("  };")
    block = "\n".join(lines)
    replacement = ("/* CATALOG:BEGIN — rewritten by build/encrypt_packs.py, do not hand-edit */\n"
                   + block + "\n  /* CATALOG:END */")
    new, n = re.subn(
        r"/\* CATALOG:BEGIN.*?CATALOG:END \*/",
        lambda _m: replacement,
        src,
        flags=re.S,
    )
    if n != 1:
        raise SystemExit("CATALOG markers not found exactly once in assets/store.js")
    store_js.write_text(new)

def main() -> int:
    PACKS.mkdir(exist_ok=True)
    store = load_secrets()
    entries = {}

    for spec in SPECS:
        src = spec["source"]
        if not src.is_dir():
            raise SystemExit("missing product source: %s" % src)
        passphrase = passphrase_for(spec["id"], store)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            if spec["id"] == "paywall":
                staged = tmp / "staged"
                shutil.copytree(src, staged, ignore=shutil.ignore_patterns(
                    ".git", "packs", "holler-brand", "shots", "work", "__pycache__"))
                sanitize_paywall(staged)
                src_for_zip = staged
            else:
                src_for_zip = src
            plain = tmp / spec["archive"]
            n = make_zip(src_for_zip, plain, spec["archive"].replace(".zip", ""))
            if n < 4:
                raise SystemExit("%s: only %d files, refusing to ship" % (spec["id"], n))
            out = PACKS / (spec["archive"] + ".enc")
            encrypt(plain, out, passphrase)
            size = out.stat().st_size
        entries[spec["id"]] = {
            "label": spec["label"],
            "price": spec["price"],
            "file": spec["archive"] + ".enc",
            "pass": passphrase,
            "sha256": sha256(PACKS / (spec["archive"] + ".enc")),
            "size": size,
        }
        print("%-10s %3d files → %-32s %7.1f KB  sha %s"
              % (spec["id"], n, spec["archive"] + ".enc", size / 1024,
                 entries[spec["id"]]["sha256"][:16]))

    save_secrets(store)
    rewrite_catalog(entries)
    print("\ncatalog rewritten in assets/store.js")
    print("secrets kept in %s (chmod 600, gitignored)" % SECRETS.relative_to(ROOT))
    return 0

if __name__ == "__main__":
    sys.exit(main())
