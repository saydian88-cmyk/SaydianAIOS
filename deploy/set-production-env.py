#!/usr/bin/env python3
import os
import sys
from pathlib import Path

KEYS = {"OPS_ADMIN_USERNAME", "OPS_ADMIN_PASSWORD", "AI_VIDEO_URL", "AI_VIDEO_PASSWORD"}
ENV_FILE = Path("/opt/saydian/env/production.env")

key = sys.argv[1] if len(sys.argv) == 2 else ""
value = sys.stdin.read()
if key not in KEYS or not value or "\n" in value or "\r" in value:
    raise SystemExit(2)

lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
lines = [line for line in lines if not line.startswith(f"{key}=")]
temporary = ENV_FILE.with_suffix(".env.tmp")
temporary.write_text("\n".join([*lines, f"{key}={value}"]) + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
temporary.replace(ENV_FILE)
