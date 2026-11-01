"""Pruebas del filtro de publicación, con valores sintéticos construidos."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io
import json
import os
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location(
    "publication", Path(__file__).resolve().parents[1] / "tools" / "check_publication.py",
)
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationTests(unittest.TestCase):
    def test_personal_path(self):
        value = "C:" + "/" + "Users" + "/" + "example" + "/private"
        self.assertIn("ruta-personal", publication.scan_text(value.encode()))

    def test_ipv4(self):
        value = ".".join(map(str, [198, 51, 100, 7]))
        self.assertIn("ipv4", publication.scan_text(value.encode()))

    def test_token(self):
        value = "gh" + "p_" + "a" * 36
        self.assertIn("token", publication.scan_text(value.encode()))

    def test_private_key(self):
        value = "-----BEGIN " + "PRIVATE KEY-----"
        self.assertIn("clave-privada", publication.scan_text(value.encode()))

    def test_mail(self):
        value = "someone" + "@" + "example.test"
        self.assertIn("correo", publication.scan_text(value.encode()))

    def test_metadata_allows_only_public_noreply(self):
        self.assertNotIn("correo", publication.scan_text(publication.PUBLIC_AUTHOR.encode(), metadata=True))
        self.assertIn("correo", publication.scan_text(publication.PUBLIC_AUTHOR.encode()))

    def test_unknown_path_is_blocked(self):
        self.assertIn("ruta-no-autorizada", publication.inspect_blob("private-notes.txt", b"notes", {}))

    def test_asset_change_is_blocked(self):
        name = "icons/icon-16.png"
        original = b"\0PNG example"
        hashes = {name: hashlib.sha256(original).hexdigest()}
        self.assertEqual(publication.inspect_blob(name, original, hashes), [])
        self.assertIn("hash-sin-revisar", publication.inspect_blob(name, original + b"x", hashes))

    def test_unknown_binary_is_blocked(self):
        self.assertIn("binario-sin-revisar", publication.inspect_blob("private.bin", b"\0binary", {}))

    def test_real_git_history_and_unreachable_objects(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("HERMES_SCRATCH")) as tmp:
            root = Path(tmp)

            def git(*args, data=None):
                return subprocess.check_output(
                    ["git", "-C", str(root), *args], input=data, stderr=subprocess.DEVNULL,
                )

            git("init", "-b", "main")
            git("config", "user.name", "EnzoCodeDev")
            git("config", "user.email", publication.PUBLIC_AUTHOR)
            git("config", "core.hooksPath", ".git/hooks")
            (root / "icons").mkdir()
            for version in [b"\0image-a", b"\0image-b"]:
                (root / "icons/icon-16.png").write_bytes(version)
                (root / ".publication-assets.json").write_text(json.dumps({
                    "icons/icon-16.png": hashlib.sha256(version).hexdigest(),
                }), encoding="utf-8")
                git("add", "--all")
                git("-c", "commit.gpgsign=false", "commit", "-m", "Synthetic assets")
            with patch.object(publication, "ROOT", root), redirect_stdout(io.StringIO()):
                # Una política diferente por commit conserva las capturas revisadas.
                self.assertEqual(publication.main(), 0)
                # Un secreto sintético NO alcanzable debe bloquear igualmente.
                value = ("gh" + "p_" + "z" * 36).encode()
                git("hash-object", "-w", "--stdin", data=value)
                self.assertEqual(publication.main(), 1)

    def test_scanner_source_does_not_match_itself(self):
        self.assertEqual(publication.scan_text(Path(publication.__file__).read_bytes()), [])


if __name__ == "__main__":
    unittest.main()
