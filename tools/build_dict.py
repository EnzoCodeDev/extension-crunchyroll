"""Genera los datos del diccionario de la extensión.

- data/speak-dict.json: vocabulario revisado incluido en el repositorio, procedente
  de la app Speak del autor. Se conserva; no requiere otro proyecto instalado.
- data/cmudict.txt: CMU Pronouncing Dictionary (licencia BSD, ver data/CMUDICT-LICENSE),
  una línea «palabra FONEMAS» con la primera pronunciación de cada palabra.

Uso: python tools/build_dict.py [ruta-a-cmudict.dict] [ruta-a-LICENSE]
Sin argumentos descarga cmudict desde GitHub.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
# No importar automáticamente archivos de otros proyectos o perfiles privados.
CMU_REVISION = "74790861f652b15e4ac49015a90074ad62a27690"
CMU_URL = f"https://raw.githubusercontent.com/cmusphinx/cmudict/{CMU_REVISION}/"


def read(src: str | None, name: str) -> str:
    if src:
        return Path(src).read_text(encoding="utf-8")
    with urllib.request.urlopen(CMU_URL + name) as r:
        return r.read().decode("utf-8")


# 1) Diccionario revisado incluido: no requiere el proyecto privado de origen.
entries = json.loads((DATA / "speak-dict.json").read_text(encoding="utf-8"))
print("speak-dict.json:", len(entries), "palabras (sin modificar)")

# 2) CMU
cmu = read(sys.argv[1] if len(sys.argv) > 1 else None, "cmudict.dict")
lic = read(sys.argv[2] if len(sys.argv) > 2 else None, "LICENSE")
seen, lines = set(), []
for line in cmu.splitlines():
    line = line.split("#", 1)[0].strip()
    if not line:
        continue
    word, phones = line.split(" ", 1)
    if "(" in word or word in seen:  # variantes «word(2)»: solo la primera
        continue
    seen.add(word)
    lines.append(f"{word} {phones}")
(DATA / "cmudict.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
(DATA / "CMUDICT-LICENSE").write_text(lic, encoding="utf-8")
print("cmudict.txt:", len(lines), "palabras")
