"""Download or import one exact published archive, on explicit request."""
import argparse
import hashlib
from pathlib import Path
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "jorge-valente/single-machine-total-weighted-tardiness-instances"
REVISION = "d5d42e4f55896354dc2ba2d400d058de8857e916"
ARCHIVES = {
    "train": ("training_set.zip", 7_432_195, "7761faaedffcdacf6eab469a1a783fafe9c99bd8914334048ece16c13d380d89"),
    "test": ("test_set.zip", 74_219_898, "80d68ff178f8577065559079a17b511ee737335759f23e2a0d06c51ff8ad7294"),
}


def archive_identity(split):
    name, _, checksum = ARCHIVES[split]
    return {
        "kind": "published",
        "name": "Martins, Valente and Schaller (2026)",
        "doi": "10.1111/itor.70146",
        "split": split,
        "job_count": 50,
        "revision": REVISION,
        "archive": name,
        "url": f"https://raw.githubusercontent.com/{REPOSITORY}/{REVISION}/{name}",
        "sha256": checksum,
    }


def verify_archive(data, split):
    name, size, checksum = ARCHIVES[split]
    if len(data) != size or hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError(f"{name} does not match the pinned archive size and SHA-256")


def import_archive(split, local_archive=None, *, data_dir=ROOT / "data"):
    import os

    name, size, _ = ARCHIVES[split]
    destination = data_dir / name
    if destination.exists():
        with destination.open("rb") as archive:
            verify_archive(archive.read(size + 1), split)
        return destination

    source = local_archive.open("rb") if local_archive is not None else urlopen(archive_identity(split)["url"], timeout=30)
    with source:
        data = source.read(size + 1)
    verify_archive(data, split)
    data_dir.mkdir(parents=True, exist_ok=True)
    # Publish only a complete, verified archive. An existing file is never replaced.
    with tempfile.NamedTemporaryFile(dir=data_dir) as staging:
        staging.write(data)
        staging.flush()
        try:
            os.link(staging.name, destination)
        except FileExistsError:
            with destination.open("rb") as archive:
                verify_archive(archive.read(size + 1), split)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=ARCHIVES, default="train")
    parser.add_argument("--archive", type=Path, help="Use a local ZIP instead of downloading")
    args = parser.parse_args()
    try:
        path = import_archive(args.split, args.archive)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Benchmark import failed: {error}\n")
    identity = archive_identity(args.split)
    print(f"Verified {path}\nSHA-256: {identity['sha256']}\nSource: {identity['url']}")


if __name__ == "__main__":
    main()
