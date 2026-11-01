"""Control cerrado de publicación: índice, commits y objetos locales completos.

No imprime coincidencias sensibles: solo ruta/tipo de regla. No es garantía
absoluta; se complementa con revisión manual y binarios con hash aprobado.
Uso: python tools/check_publication.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = frozenset("""
.gitignore .gitattributes .publication-assets.json
README.md SECURITY.md PRIVACY.md THIRD_PARTY_NOTICES.md
manifest.json package.json package-lock.json
src/background.js src/content.js src/network.js src/page-hook.js src/page.css
src/panel.css src/pron.js src/scoring.js src/settings.js src/subs.js
popup/popup.html popup/popup.js popup/popup.css
icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
data/CMUDICT-LICENSE data/cmudict.txt data/speak-dict.json
tools/build_dict.py tools/make_icons.py tools/check_publication.py
tests/logic.test.js tests/security.test.js tests/test_publication.py
tests/e2e/run.mjs tests/e2e/fixtures/en.vtt tests/e2e/fixtures/es.ass
tests/e2e/fixtures/watch.html
docs/screenshots/01-escritura.png docs/screenshots/02-palabras.png
docs/screenshots/03-aprobada.png docs/screenshots/04-ajustes.png
""".split())

PATTERNS = {
    "ruta-personal": re.compile(r"(?i)(?:[a-z]:[/\\]|/)(?:users|home)[/\\]"),
    "ipv4": re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])"),
    "clave-privada": re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----"),
    "token": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,})"),
    "correo": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "conexion-privada": re.compile(r"(?i)(?:ssh|scp)\s+[^\s]+@|(?:https?://)[^\s/]+:[^\s/]+@"),
}
PUBLIC_AUTHOR = "EnzoCodeDev" + "@" + "users.noreply.github.com"


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args], stderr=subprocess.DEVNULL)


def scan_text(data: bytes, metadata: bool = False) -> list[str]:
    text = data.decode("utf-8", errors="replace")
    if metadata:
        text = text.replace(PUBLIC_AUTHOR, "")
    hits = [rule for rule, pattern in PATTERNS.items() if pattern.search(text)]
    # La identidad local se deriva del entorno, nunca se escribe en este repo.
    local_user = Path.home().name
    if len(local_user) > 4 and local_user.lower() in text.lower():
        hits.append("identidad-local")
    return hits


def inspect_blob(name: str, data: bytes, assets: dict[str, str]) -> list[str]:
    issues = []
    if name not in ALLOWED:
        issues.append("ruta-no-autorizada")
    binary = b"\0" in data or name.endswith(".png")
    canonical = data if binary else data.replace(b"\r\n", b"\n")
    if name in assets and hashlib.sha256(canonical).hexdigest() != assets[name]:
        issues.append("hash-sin-revisar")
    if binary:
        if name not in assets:
            issues.append("binario-sin-revisar")
    else:
        issues.extend(scan_text(data))
    return issues


def main() -> int:
    assets = json.loads((ROOT / ".publication-assets.json").read_text(encoding="utf-8"))
    if not isinstance(assets, dict) or set(assets) - ALLOWED:
        raise ValueError("Manifiesto de activos no válido")
    issues, seen, path_count = [], set(), 0

    def check(name: str, oid: str, mode: str, policy: dict[str, str]) -> None:
        nonlocal path_count
        path_count += 1
        if mode not in {"100644", "100755"}:
            issues.append((name, "enlace-o-gitlink-no-permitido"))
        fingerprint = json.dumps(policy, sort_keys=True)
        if (name, oid, fingerprint) not in seen:
            seen.add((name, oid, fingerprint))
            data = git("cat-file", "blob", oid)
            issues.extend((name, rule) for rule in inspect_blob(name, data, policy))

    staged = git("ls-files", "--stage", "-z").split(b"\0")
    if not any(staged):
        issues.append(("indice", "vacio"))
    for entry in filter(None, staged):
        fields, name = entry.decode("utf-8").split("\t", 1)
        mode, oid, stage = fields.split()
        if stage != "0":
            issues.append((name, "conflicto"))
        check(name, oid, mode, assets)

    # Recorre todos los objetos, incluidos blobs y commits no alcanzables.
    objects = git("cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)").decode().splitlines()
    reviewed_binary_hashes = set(assets.values())
    policies = {}
    # Cada commit conserva sus hashes revisados: cambiar una captura no invalida
    # la captura anterior del historial. No se omite el escaneo de texto.
    for line in objects:
        oid, kind = line.split()
        if kind == "commit":
            try:
                policy = json.loads(git("show", oid + ":.publication-assets.json"))
                if not isinstance(policy, dict) or set(policy) - ALLOWED:
                    raise ValueError("Política histórica no válida")
                policies[oid] = policy
                reviewed_binary_hashes.update(policy.values())
            except (subprocess.CalledProcessError, ValueError, TypeError):
                issues.append(("commit:" + oid[:8], "politica-de-activos-ausente-o-invalida"))
                policies[oid] = {}
    commit_count = blob_count = 0
    for line in objects:
        oid, kind = line.split()
        if kind in {"commit", "tag"}:
            body = git("cat-file", kind, oid)
            issues.extend(("metadatos:" + oid[:8], rule) for rule in scan_text(body, metadata=True))
        if kind == "commit":
            commit_count += 1
            for entry in filter(None, git("ls-tree", "-r", "-z", oid).split(b"\0")):
                fields, name = entry.decode("utf-8").split("\t", 1)
                mode, obj_type, blob = fields.split()
                if obj_type != "blob":
                    issues.append((name, "objeto-no-publicable"))
                else:
                    check(name, blob, mode, policies[oid])
        elif kind == "blob":
            blob_count += 1
            data = git("cat-file", "blob", oid)
            if b"\0" in data:
                if hashlib.sha256(data).hexdigest() not in reviewed_binary_hashes:
                    issues.append(("objeto:" + oid[:8], "binario-sin-revisar"))
            else:
                issues.extend(("objeto:" + oid[:8], rule) for rule in scan_text(data))

    # Comprobar el árbol local permitido además de los blobs que se van a publicar.
    for name in ALLOWED:
        file = ROOT / name
        if file.is_file():
            issues.extend((name, rule) for rule in inspect_blob(name, file.read_bytes(), assets))
    for name, rule in sorted(set(issues)):
        print(f"BLOQUEADO {name}: {rule}")
    print(f"Revisados: {len(seen)} versiones de archivo; {commit_count} commits; {blob_count} blobs.")
    if issues:
        return 1
    print("Publicación: índice, historial, objetos y archivos permitidos sin alertas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
