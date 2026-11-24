#!/usr/bin/env python3
"""מארגן קבצים: ממיין את הקבצים בתיקייה לתתי-תיקיות לפי סוג הקובץ.

שימוש:
    python organize_files.py                      # מארגן את תיקיית ההורדות
    python organize_files.py --path "D:\\Stuff"    # מארגן תיקייה אחרת
    python organize_files.py --dry-run            # מציג מה יקרה בלי להזיז דבר
"""

import argparse
import os
import shutil
import stat
import sys
from collections import Counter
from pathlib import Path

# הצגת עברית תקינה גם בקונסול של Windows
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

CATEGORIES = {
    "Images": {"jpg", "jpeg", "png", "gif", "webp", "svg", "heic"},
    "Documents": {"pdf", "doc", "docx", "txt", "rtf", "odt"},
    "Spreadsheets": {"xls", "xlsx", "csv"},
    "Presentations": {"ppt", "pptx"},
    "Videos": {"mp4", "mov", "avi", "mkv", "wmv"},
    "Audio": {"mp3", "wav", "flac", "aac", "ogg"},
    "Archives": {"zip", "rar", "7z", "tar", "gz"},
    "Code": {"py", "js", "html", "css", "java", "cpp", "json", "xml"},
    "Installers": {"exe", "msi"},
}
OTHER = "Other"
ALL_CATEGORIES = list(CATEGORIES) + [OTHER]

# שמות תצוגה בעברית לסיכום
HEBREW_NAMES = {
    "Images": "תמונות",
    "Documents": "מסמכים",
    "Spreadsheets": "גיליונות",
    "Presentations": "מצגות",
    "Videos": "סרטונים",
    "Audio": "שמע",
    "Archives": "ארכיונים",
    "Code": "קוד",
    "Installers": "תוכנות התקנה",
    "Other": "אחר",
}

EXTENSION_MAP = {ext: cat for cat, exts in CATEGORIES.items() for ext in exts}

# מזהה התיקייה "הורדות" ב-Windows (Known Folder ID)
WINDOWS_DOWNLOADS_ID = "{374DE290-123F-4565-9164-39C4925E467B}"


def default_downloads_folder() -> Path:
    """מחזיר את תיקיית ההורדות כפי שהיא מוגדרת ב-Windows (גם אם הועברה, למשל ל-iCloud).
    בכל מערכת אחרת, או אם הקריאה נכשלת - חוזר ל-~/Downloads."""
    if sys.platform == "win32":
        try:
            import winreg

            key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                value, _ = winreg.QueryValueEx(key, WINDOWS_DOWNLOADS_ID)
            folder = Path(os.path.expandvars(value))
            if folder.is_dir():
                return folder
        except OSError:
            pass
    return Path.home() / "Downloads"


def is_hidden_or_system(file: Path) -> bool:
    """קבצים מוסתרים או קבצי מערכת (כמו desktop.ini) לא מועברים."""
    if file.name.startswith("."):
        return True
    attrs = getattr(file.stat(), "st_file_attributes", 0)  # קיים רק ב-Windows
    return bool(attrs & (stat.FILE_ATTRIBUTE_HIDDEN | stat.FILE_ATTRIBUTE_SYSTEM)) if attrs else False


def get_category(file: Path) -> str:
    """מחזיר את שם הקטגוריה לפי סיומת הקובץ (ללא תלות באותיות גדולות/קטנות)."""
    return EXTENSION_MAP.get(file.suffix.lower().lstrip("."), OTHER)


def unique_destination(dest_dir: Path, name: str, reserved: set) -> Path:
    """מחזיר נתיב יעד שלא קיים, ומוסיף סיומת מספר במידת הצורך: file (1).txt"""
    candidate = dest_dir / name
    stem, suffix = Path(name).stem, Path(name).suffix
    counter = 1
    while candidate.exists() or candidate in reserved:
        candidate = dest_dir / f"{stem} ({counter}){suffix}"
        counter += 1
    return candidate


def organize(folder: Path, dry_run: bool) -> Counter:
    counts = Counter()
    reserved = set()  # יעדים שכבר הוקצו בריצה הזו (חשוב במיוחד ב-dry-run)
    this_script = Path(__file__).resolve()

    files = sorted(
        (
            p
            for p in folder.iterdir()
            if p.is_file() and p.resolve() != this_script and not is_hidden_or_system(p)
        ),
        key=lambda p: p.name.lower(),
    )

    for file in files:
        category = get_category(file)
        dest_dir = folder / category
        dest = unique_destination(dest_dir, file.name, reserved)
        reserved.add(dest)

        renamed = f"  (שם חדש: {dest.name})" if dest.name != file.name else ""
        if dry_run:
            print(f"[הדמיה] {file.name}  ←  {category}/{renamed}")
        else:
            try:
                dest_dir.mkdir(exist_ok=True)
                shutil.move(str(file), str(dest))
                print(f"הועבר: {file.name}  ←  {category}/{renamed}")
            except OSError as err:
                print(f"שגיאה בהעברת {file.name}: {err}", file=sys.stderr)
                continue
        counts[category] += 1

    return counts


def print_summary(counts: Counter, dry_run: bool) -> None:
    title = "סיכום (הדמיה - לא הועברו קבצים)" if dry_run else "סיכום"
    verb = "יועברו" if dry_run else "הועברו"
    print()
    print(f"===== {title} =====")
    for category in ALL_CATEGORIES:
        if counts[category]:
            print(f"  {HEBREW_NAMES[category]} ({category}): {counts[category]}")
    print(f"  סה\"כ קבצים ש{verb}: {sum(counts.values())}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ממיין קבצים בתיקייה לתתי-תיקיות לפי סוג הקובץ."
    )
    parser.add_argument(
        "--path",
        type=Path,
        default=default_downloads_folder(),
        help="התיקייה לארגון (ברירת מחדל: תיקיית ההורדות)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="הצגת מה שיקרה בלי להזיז שום קובץ",
    )
    args = parser.parse_args()

    folder = args.path.expanduser().resolve()
    if not folder.is_dir():
        print(f"שגיאה: התיקייה לא נמצאה: {folder}", file=sys.stderr)
        return 1

    print(f"מארגן את התיקייה: {folder}")
    if args.dry_run:
        print("מצב הדמיה: שום קובץ לא יועבר.")
    print()

    counts = organize(folder, args.dry_run)
    if not counts:
        print("לא נמצאו קבצים לארגון.")
        return 0

    print_summary(counts, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
