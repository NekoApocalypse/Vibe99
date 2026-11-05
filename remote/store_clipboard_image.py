"""One-shot PNG upload over SSH stdin. No daemon and no terminal commands."""
import os
import pathlib
import stat
import sys
import tempfile
import time

LIMIT = 16 * 1024 * 1024
PNG = bytes([137, 80, 78, 71, 13, 10, 26, 10])


def store(stream):
    data = stream.read(LIMIT + 1)
    if len(data) > LIMIT or not data.startswith(PNG):
        raise ValueError("Expected a PNG image up to 16 MiB")
    root = pathlib.Path(tempfile.gettempdir()) / ("vibe99-images-%d" % os.getuid())
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError("Unsafe clipboard image directory")
    root.chmod(0o700)
    for entry in root.iterdir():
        info = entry.lstat()
        if (entry.name.startswith("image-") and entry.suffix == ".png"
                and stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and time.time() - info.st_mtime > 7 * 86400):
            entry.unlink()
    fd, name = tempfile.mkstemp(prefix="image-", suffix=".png", dir=root)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
        return name
    except BaseException:
        os.unlink(name)
        raise


if __name__ == "__main__":
    print(store(sys.stdin.buffer))
