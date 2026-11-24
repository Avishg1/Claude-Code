#!/usr/bin/env python3
"""
שינוי שמות קבצים בכמות גדולה לפי תבנית.

משתנים נתמכים בתבנית:
  {n}         מספר רץ (01, 02, 03...)
  {date}      תאריך שינוי אחרון של הקובץ, בפורמט YYYY-MM-DD
  {taken}     תאריך הצילום מתוך נתוני EXIF, בפורמט YYYY-MM-DD
  {original}  שם הקובץ המקורי ללא סיומת
  {ext}       סיומת הקובץ (ללא נקודה)

אם התבנית לא כוללת {ext}, הסיומת המקורית תתווסף אוטומטית.
כשהתבנית כוללת {taken}, הקבצים ממוספרים לפי זמן הצילום (כרונולוגית).
{taken} נתמך ב-JPEG, CR3, CR2, NEF, ARW, DNG, TIFF ללא ספריות נוספות;
לפורמטים אחרים (כמו HEIC) ייעשה שימוש ב-exiftool אם הוא מותקן.
קובץ ללא תאריך EXIF יקבל את תאריך השינוי האחרון, עם אזהרה.

קבצי sidecar מסוג ‎.xmp משנים שם יחד עם התמונה שלהם, בשני הסגנונות:
  IMG_0001.xmp      (Lightroom, DPP)   ->  vacation-01.xmp
  IMG_0001.CR3.xmp  (darktable)        ->  vacation-01.CR3.xmp
אפשר לבטל זאת עם ‎--no-sidecars.

קבצים באותה תיקייה עם אותו שם וסיומת שונה (למשל RAW+JPEG) מקבלים מספר משותף:
  IMG_0003.CR3 + IMG_0003.JPG  ->  trip-03.CR3 + trip-03.JPG
אפשר לבטל זאת עם ‎--no-pairs.

דוגמאות:
  python bulk_rename.py ./photos "vacation-{date}-{n}"
  python bulk_rename.py ./photos "trip-{n}" --filter "*.jpg" --start 10 --preview
  python bulk_rename.py ./docs "{original}-backup.{ext}" --recursive
"""

import argparse
import fnmatch
import os
import re
import shutil
import struct
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

VARIABLE_RE = re.compile(r"\{([^{}]*)\}")
KNOWN_VARIABLES = {"n", "date", "taken", "original", "ext"}
INVALID_CHARS = set('<>:"/\\|?*')
CASE_INSENSITIVE_FS = os.name == "nt" or sys.platform == "darwin"

# ---------------------------------------------------------------- EXIF

TAG_DATETIME = 0x0132           # IFD0: תאריך שינוי במצלמה
TAG_EXIF_IFD = 0x8769           # מצביע ל-Exif IFD
TAG_DATETIME_ORIGINAL = 0x9003  # תאריך הצילום
HEAD_BYTES = 4 * 1024 * 1024    # מספיק כדי להכיל את נתוני ה-EXIF ברוב הקבצים


def _parse_exif_datetime(value: str):
    try:
        return datetime.strptime(value.strip("\x00 ")[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def _tiff_date(buf: bytes, base: int):
    """מחפש תאריך צילום בבלוק TIFF/EXIF שמתחיל ב-base."""
    try:
        order = buf[base:base + 2]
        if order == b"II":
            e = "<"
        elif order == b"MM":
            e = ">"
        else:
            return None
        u16 = lambda off: struct.unpack_from(e + "H", buf, base + off)[0]
        u32 = lambda off: struct.unpack_from(e + "I", buf, base + off)[0]

        def read_ifd(off):
            tags = {}
            for i in range(u16(off)):
                entry = off + 2 + i * 12
                tags[u16(entry)] = (u16(entry + 2), u32(entry + 4), entry + 8)
            return tags

        def ascii_value(tag):
            typ, count, val_pos = tag
            if typ != 2:
                return None
            start = base + (val_pos if count <= 4 else u32(val_pos))
            return buf[start:start + count].decode("ascii", "replace")

        ifd0 = read_ifd(u32(4))
        candidates = []
        if TAG_DATETIME_ORIGINAL in ifd0:  # ב-CR3 הבלוק CMT2 הוא ה-Exif IFD עצמו
            candidates.append(ifd0[TAG_DATETIME_ORIGINAL])
        if TAG_EXIF_IFD in ifd0:
            exif = read_ifd(u32(ifd0[TAG_EXIF_IFD][2]))
            if TAG_DATETIME_ORIGINAL in exif:
                candidates.append(exif[TAG_DATETIME_ORIGINAL])
        if TAG_DATETIME in ifd0:
            candidates.append(ifd0[TAG_DATETIME])
        for tag in candidates:
            value = ascii_value(tag)
            if value and (dt := _parse_exif_datetime(value)):
                return dt
    except (struct.error, IndexError):
        pass
    return None


def _jpeg_date(buf: bytes):
    pos = 2
    while pos + 4 <= len(buf) and buf[pos] == 0xFF:
        marker = buf[pos + 1]
        length = struct.unpack_from(">H", buf, pos + 2)[0]
        if marker == 0xE1 and buf[pos + 4:pos + 10] == b"Exif\x00\x00":
            return _tiff_date(buf, pos + 10)
        if marker == 0xDA:  # תחילת נתוני התמונה – אין EXIF
            break
        pos += 2 + length
    return None


def _cr3_date(buf: bytes):
    # CMT2 = Exif IFD, CMT1 = IFD0. מבנה תיבה: size(4) type(4) data
    for box in (b"CMT2", b"CMT1"):
        idx = buf.find(box)
        if idx >= 0 and (dt := _tiff_date(buf, idx + 4)):
            return dt
    return None


def _exiftool_date(path: Path):
    exe = shutil.which("exiftool")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "-s3", "-DateTimeOriginal", "-CreateDate", str(path)],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        if dt := _parse_exif_datetime(line):
            return dt
    return None


def get_taken_date(path: Path):
    """תאריך הצילום מתוך EXIF, או None אם לא נמצא."""
    try:
        with open(path, "rb") as f:
            buf = f.read(HEAD_BYTES)
    except OSError:
        return None
    dt = None
    if buf[:2] == b"\xff\xd8":
        dt = _jpeg_date(buf)
    elif buf[:4] in (b"II*\x00", b"MM\x00*"):
        dt = _tiff_date(buf, 0)
    elif buf[4:12] == b"ftypcrx ":
        dt = _cr3_date(buf)
    return dt or _exiftool_date(path)

# ---------------------------------------------------------------- שינוי שמות


def norm(path: Path) -> str:
    """מפתח השוואה לנתיב – לא תלוי רישיות במערכות קבצים שאינן רגישות לרישיות."""
    s = str(path)
    return s.lower() if CASE_INSENSITIVE_FS else s


def validate_pattern(pattern: str) -> None:
    unknown = [v for v in VARIABLE_RE.findall(pattern) if v not in KNOWN_VARIABLES]
    if unknown:
        raise ValueError(
            f"משתנה לא מוכר בתבנית: {{{unknown[0]}}}. "
            f"משתנים נתמכים: {{n}}, {{date}}, {{taken}}, {{original}}, {{ext}}"
        )
    literal = VARIABLE_RE.sub("", pattern)
    bad = sorted(INVALID_CHARS & set(literal))
    if bad:
        raise ValueError(f"התבנית מכילה תווים אסורים בשם קובץ: {' '.join(bad)}")
    if not pattern.strip():
        raise ValueError("התבנית ריקה")


def build_name(pattern: str, path: Path, number: int, width: int, taken) -> str:
    ext = path.suffix[1:] if path.suffix else ""
    modified = datetime.fromtimestamp(path.stat().st_mtime)
    values = {
        "n": str(number).zfill(width),
        "date": modified.strftime("%Y-%m-%d"),
        "taken": (taken or modified).strftime("%Y-%m-%d"),
        "original": path.stem,
        "ext": ext,
    }
    name = VARIABLE_RE.sub(lambda m: values[m.group(1)], pattern)
    if "{ext}" not in pattern and path.suffix:
        name += path.suffix
    # הסרת נקודה מיותרת בסוף כשהתבנית היא "x.{ext}" וקובץ ללא סיומת
    return name.rstrip(". ")


SIDECAR_EXTS = {".xmp"}
JPEG_EXTS = {".jpg", ".jpeg"}


def find_sidecars(dirpath: Path, filenames: list, photos: list) -> dict:
    """מחזיר מילון: קובץ תמונה -> רשימת קבצי ה-sidecar שלו באותה תיקייה."""
    owners = [p for p in photos if p.suffix.lower() not in SIDECAR_EXTS]
    by_name = {p.name.lower(): p for p in owners}
    by_stem = {}
    for p in owners:
        by_stem.setdefault(p.stem.lower(), []).append(p)

    result = {}
    for f in filenames:
        suffix = Path(f).suffix
        if suffix.lower() not in SIDECAR_EXTS or not (dirpath / f).is_file():
            continue
        base = f[: -len(suffix)].lower()
        owner = by_name.get(base)  # IMG_0001.CR3.xmp
        if owner is None and base in by_stem:  # IMG_0001.xmp
            # RAW+JPEG עם אותו שם: ה-sidecar שייך לקובץ ה-RAW
            owner = min(by_stem[base], key=lambda p: (p.suffix.lower() in JPEG_EXTS, p.name.lower()))
        if owner is not None:
            result.setdefault(owner, []).append(dirpath / f)
    return result


def collect_files(folder: Path, filter_pattern: str, recursive: bool, with_sidecars: bool):
    """מחזיר (מילון: תיקייה -> רשימת קבצים ממוינת, מילון: תמונה -> קבצי sidecar)."""
    groups, sidecars = {}, {}
    walker = os.walk(folder) if recursive else [(folder, [], os.listdir(folder))]
    for dirpath, dirnames, filenames in walker:
        dirnames.sort(key=str.lower)
        dirpath = Path(dirpath)
        files = [
            dirpath / f
            for f in filenames
            if (dirpath / f).is_file() and fnmatch.fnmatch(f.lower(), filter_pattern.lower())
        ]
        if with_sidecars:
            found = find_sidecars(dirpath, filenames, files)
            attached = {s for lst in found.values() for s in lst}
            files = [f for f in files if f not in attached]  # sidecar לא מקבל מספר משלו
            sidecars.update(found)
        if files:
            groups[dirpath] = sorted(files, key=lambda p: p.name.lower())
    return groups, sidecars


def sidecar_new_name(sidecar: Path, owner: Path, owner_new: Path) -> str:
    if sidecar.name.lower().startswith(owner.name.lower() + "."):
        return owner_new.name + sidecar.suffix  # IMG_0001.CR3.xmp
    return Path(owner_new.name).stem + sidecar.suffix  # IMG_0001.xmp


def group_units(files: list, pair: bool) -> list:
    """מקבץ קבצים עם אותו שם וסיומת שונה (למשל RAW+JPEG) ליחידה אחת שמקבלת מספר אחד."""
    if not pair:
        return [[f] for f in files]
    units = {}
    for f in files:
        units.setdefault(f.stem.lower(), []).append(f)
    # בתוך יחידה: RAW לפני JPEG
    return [sorted(u, key=lambda p: (p.suffix.lower() in JPEG_EXTS, p.name.lower())) for u in units.values()]


def plan_renames(groups: dict, pattern: str, start: int, sidecars: dict, pair: bool):
    """מחזיר (תוכנית, רשימת קבצים ללא תאריך EXIF, מספר קבצי sidecar, מספר זוגות)."""
    use_taken = "{taken}" in pattern
    plan, missing = [], []
    sidecar_count = pair_count = 0
    for files in groups.values():
        units = group_units(files, pair)
        pair_count += sum(1 for u in units if len(u) > 1)

        # תאריך צילום משותף ליחידה: הראשון שנמצא בין הקבצים שלה
        taken = {}
        if use_taken:
            for unit in units:
                dt = None
                for path in unit:
                    if (dt := get_taken_date(path)):
                        break
                if dt is None:
                    missing.extend(unit)
                taken[id(unit)] = dt

        def sort_key(unit):
            first_name = min(p.name.lower() for p in unit)
            if not use_taken:
                return (first_name,)
            when = taken[id(unit)] or min(datetime.fromtimestamp(p.stat().st_mtime) for p in unit)
            return (when, first_name)  # מספור כרונולוגי

        units.sort(key=sort_key)
        last = start + len(units) - 1
        width = max(2, len(str(last)))
        for i, unit in enumerate(units):
            for path in unit:
                new_path = path.with_name(build_name(pattern, path, start + i, width, taken.get(id(unit))))
                plan.append((path, new_path))
                for sidecar in sidecars.get(path, []):
                    plan.append((sidecar, sidecar.with_name(sidecar_new_name(sidecar, path, new_path))))
                    sidecar_count += 1
    return plan, missing, sidecar_count, pair_count


def check_conflicts(plan: list) -> list:
    errors = []
    sources = {norm(old) for old, _ in plan}
    seen = {}
    for old, new in plan:
        if not new.name:
            errors.append(f"שם ריק נוצר עבור: {old}")
            continue
        key = norm(new)
        if key in seen:
            errors.append(f"שם כפול: '{new.name}' עבור '{seen[key].name}' וגם '{old.name}' (ב-{new.parent})")
        seen[key] = old
        # התנגשות עם קובץ קיים שאינו חלק מהשינוי
        if new.exists() and key not in sources:
            errors.append(f"הקובץ '{new}' כבר קיים ואינו חלק מהשינוי")
    return errors


def execute(plan: list) -> None:
    """שינוי שמות בשני שלבים (דרך שמות זמניים) כדי לאפשר החלפות בין קבצים."""
    token = uuid.uuid4().hex[:8]
    temps = []
    try:
        for i, (old, new) in enumerate(plan):
            tmp = old.with_name(f".__bulk_rename_{token}_{i}")
            old.rename(tmp)
            temps.append((old, tmp, new))
    except OSError as e:
        for old, tmp, _ in temps:  # ביטול השלב הראשון
            tmp.rename(old)
        raise RuntimeError(f"השינוי בוטל, לא שונה אף קובץ. שגיאה: {e}") from e

    for old, tmp, new in temps:
        tmp.rename(new)


def print_plan(plan: list, root: Path, unchanged: int) -> None:
    width = max(len(str(old.relative_to(root))) for old, _ in plan)
    for old, new in plan:
        print(f"  {str(old.relative_to(root)).ljust(width)}  ->  {new.relative_to(root)}")
    if unchanged:
        print(f"\n  ({unchanged} קבצים כבר בשם הנכון ודולגו)")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description="שינוי שמות קבצים בכמות גדולה לפי תבנית.",
        epilog="משתנים: {n} מספר רץ, {date} תאריך שינוי (YYYY-MM-DD), "
               "{taken} תאריך צילום מ-EXIF (YYYY-MM-DD), "
               "{original} שם מקורי ללא סיומת, {ext} סיומת. "
               "אם {ext} לא מופיע בתבנית, הסיומת המקורית נשמרת.",
    )
    parser.add_argument("folder", help="נתיב התיקייה")
    parser.add_argument("pattern", help="תבנית השם, לדוגמה: vacation-{date}-{n}")
    parser.add_argument("--start", type=int, default=1, help="מספר ההתחלה של {n} (ברירת מחדל: 1)")
    parser.add_argument("--filter", default="*", help="שנה רק קבצים התואמים לתבנית, לדוגמה: '*.jpg'")
    parser.add_argument("--preview", action="store_true", help="הצג את השמות הישנים והחדשים בלי לשנות בפועל")
    parser.add_argument("--recursive", action="store_true", help="עבד גם תיקיות משנה (המספור מתחיל מחדש בכל תיקייה)")
    parser.add_argument("--no-sidecars", action="store_true", help="אל תשנה את שמות קבצי ה-‎.xmp יחד עם התמונות")
    parser.add_argument("--no-pairs", action="store_true",
                        help="תן מספר נפרד לכל קובץ, גם לקבצים עם אותו שם וסיומת שונה (כמו RAW+JPEG)")
    args = parser.parse_args()

    folder = Path(args.folder).resolve()
    if not folder.is_dir():
        print(f"שגיאה: התיקייה לא נמצאה: {folder}", file=sys.stderr)
        return 1
    if args.start < 0:
        print("שגיאה: --start חייב להיות מספר אי-שלילי", file=sys.stderr)
        return 1
    try:
        validate_pattern(args.pattern)
    except ValueError as e:
        print(f"שגיאה: {e}", file=sys.stderr)
        return 1

    groups, sidecars = collect_files(folder, args.filter, args.recursive, not args.no_sidecars)
    if not groups:
        print(f"לא נמצאו קבצים התואמים ל-'{args.filter}' ב-{folder}")
        return 0

    full_plan, missing, sidecar_count, pair_count = plan_renames(
        groups, args.pattern, args.start, sidecars, not args.no_pairs
    )
    if missing:
        print(f"אזהרה: לא נמצא תאריך צילום ב-EXIF עבור {len(missing)} קבצים; "
              f"נעשה שימוש בתאריך השינוי האחרון:", file=sys.stderr)
        for path in missing:
            print(f"  - {path.relative_to(folder)}", file=sys.stderr)
        print(file=sys.stderr)
    plan = [(o, n) for o, n in full_plan if o.name != n.name]
    unchanged = len(full_plan) - len(plan)
    if not plan:
        print("כל הקבצים כבר בשם הנכון, אין מה לשנות.")
        return 0

    errors = check_conflicts(full_plan)
    if errors:
        print("שגיאה: נמצאו התנגשויות, לא שונה אף קובץ:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    if args.preview:
        extra = f", מתוכם {sidecar_count} קבצי sidecar" if sidecar_count else ""
        if pair_count:
            extra += f", {pair_count} זוגות עם מספר משותף"
        print(f"תצוגה מקדימה ({len(plan)} קבצים{extra}, לא בוצע שינוי):\n")
        print_plan(plan, folder, unchanged)
        return 0

    try:
        execute(plan)
    except RuntimeError as e:
        print(f"שגיאה: {e}", file=sys.stderr)
        return 1

    print_plan(plan, folder, unchanged)
    print(f"\nשונו בהצלחה {len(plan)} קבצים.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
