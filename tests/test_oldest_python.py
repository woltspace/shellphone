"""Every .py here compiles on the oldest Python that pyproject promises, not only on the one running the tests.

A wolt runs connector.py with whatever `python3` its computer has, so syntax from a newer Python breaks it outright.
uv fetches that Python when it's missing; without uv on PATH the test is skipped.
"""
import re, shutil, subprocess, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class OldestPython(unittest.TestCase):
    def test_every_file_compiles_on_the_oldest_python_we_support(self):
        uv = shutil.which("uv")
        if not uv:
            self.skipTest("needs uv to fetch the oldest Python")
        oldest = re.search(r'requires-python\s*=\s*">=\s*([\d.]+)"', (REPO / "pyproject.toml").read_text()).group(1)
        files = [str(p) for p in sorted(REPO.rglob("*.py")) if not {".venv", "node_modules", "build", "dist"} & set(p.relative_to(REPO).parts)]
        code = "import sys\nfor f in sys.argv[1:]:\n    compile(open(f, encoding='utf-8').read(), f, 'exec')"
        python = [uv, "run", "-q", "--no-project", "--python", oldest, "python"]
        if subprocess.run([*python, "-c", "pass"], capture_output=True, timeout=300).returncode:
            self.skipTest(f"uv couldn't get Python {oldest}")
        r = subprocess.run([*python, "-c", code, *files], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, f"doesn't compile on Python {oldest}:\n{r.stderr}")


if __name__ == "__main__":
    unittest.main()
