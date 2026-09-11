"""
Merge two Bhagavad Gita datasets into a single CSV ready for /ingest.

Source A (JSON) — vedicscriptures/bhagavad-gita
    https://github.com/vedicscriptures/bhagavad-gita
    Either:
      (a) a folder of per-verse files at slok/<chapter>/<verse>/index.json, or
      (b) a single exported JSON array of the same verse objects.
    Each verse object looks like:
      {
        "chapter": 1, "verse": 1,
        "slok": "<sanskrit>", "transliteration": "<...>",
        "siva": {"author": "Swami Sivananda", "et": "<english>", "ht": "<hindi>"},
        "purohit": {"author": "Shri Purohit Swami", "et": "<english>"},
        ... more author keys, only some of which contain "et" (English)
      }

Source B (CSV) — i8o8i-Developer/Bhagwat-Gita-DataSet (or any similar CSV)
    Column names vary by dataset export, so this script auto-detects common
    header spellings (see COLUMN_ALIASES). If auto-detection misses your
    file's headers, pass --csv-map to override, e.g.:
      --csv-map chapter=Chapter,verse=Shloka,sanskrit=Shlok,english=Translation

MERGE STRATEGY (Option B — merge by chapter+verse):
    For each (chapter, verse) key found in either source:
      - sanskrit / transliteration: prefer the JSON source (usually more
        complete/accurate Devanagari), fall back to the CSV.
      - english_translation: concatenate every distinct translation found
        across both sources, each labeled with its origin, so the RAG
        chunk for a verse carries multiple perspectives.

Output: a single CSV at --out with columns
    chapter,verse,sanskrit,transliteration,english_translation
which matches exactly what POST /ingest already expects -- no backend
changes needed to use it.

Usage:
    python scripts/merge_datasets.py \
        --json /path/to/vedicscriptures_slok_folder_or_export.json \
        --csv /path/to/Bhagwat-Gita-DataSet.csv \
        --out data/merged_gita.csv
"""
import argparse
import csv
import json
import os
import re
from collections import defaultdict

# Common header spellings seen across community Gita CSV exports.
COLUMN_ALIASES = {
    "chapter": ["chapter", "chap", "ch", "adhyaya", "adhyay"],
    "verse": ["verse", "shloka_no", "shlok_no", "sl", "verse_number", "shlok", "no"],
    "sanskrit": ["sanskrit", "shlok", "shloka", "slok", "devanagari", "verse_text"],
    "transliteration": ["transliteration", "translit", "romanized", "iast"],
    "english": [
        "english", "translation", "eng_meaning", "english_translation",
        "enlgish_translation",  # typo used by the bundled i8o8i CSV
        "meaning", "eng", "translation_english", "et",
    ],
}


def _normalize_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", h.strip().lower())


def detect_csv_columns(fieldnames, override: dict | None = None):
    """Maps logical field -> actual CSV header, using aliases + optional override."""
    normalized = {_normalize_header(f): f for f in fieldnames}
    mapping = {}
    for field, aliases in COLUMN_ALIASES.items():
        if override and field in override:
            mapping[field] = override[field]
            continue
        for alias in aliases:
            if _normalize_header(alias) in normalized:
                mapping[field] = normalized[_normalize_header(alias)]
                break
    return mapping


def load_csv_source(path: str, override: dict | None = None):
    """Returns dict[(chapter, verse)] -> {sanskrit, transliteration, english}"""
    out = {}
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        mapping = detect_csv_columns(reader.fieldnames, override)
        missing = [k for k in ("chapter", "verse", "english") if k not in mapping]
        if missing:
            raise ValueError(
                f"Could not auto-detect CSV columns for: {missing}. "
                f"Found headers: {reader.fieldnames}. "
                f"Re-run with --csv-map to specify them manually, e.g. "
                f"--csv-map chapter=Chapter,verse=Verse,english=Translation"
            )
        for row in reader:
            try:
                chapter_numbers = re.findall(r"\d+", str(row[mapping["chapter"]]))
                verse_numbers = re.findall(r"\d+", str(row[mapping["verse"]]))
                # Values in the bundled CSV look like "Chapter 1" and
                # "Verse 1.2"; the final number is the actual verse number.
                ch = int(chapter_numbers[-1])
                vs = int(verse_numbers[-1])
            except (ValueError, KeyError, IndexError):
                continue
            out[(ch, vs)] = {
                "sanskrit": row.get(mapping.get("sanskrit", ""), "").strip(),
                "transliteration": row.get(mapping.get("transliteration", ""), "").strip(),
                "english": row.get(mapping.get("english", ""), "").strip(),
            }
    return out


def _iter_json_records(path: str):
    """
    Yields raw verse dicts from either:
      - a directory tree of slok/<chapter>/<verse>/index.json files, or
      - a single JSON file containing a list of verse dicts.
    """
    if os.path.isdir(path):
        for root, _, files in os.walk(path):
            for fname in files:
                # Support both the original slok/<chapter>/<verse>/index.json
                # layout and flat exports such as
                # bhagavadgita_chapter_1_slok_1.json.
                if fname.lower().endswith(".json"):
                    with open(os.path.join(root, fname), "r", encoding="utf-8") as f:
                        yield json.load(f)
    else:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            yield from data
        elif isinstance(data, dict):
            # some exports nest as {"1": {"1": {...}}, ...}
            for ch_data in data.values():
                if isinstance(ch_data, dict):
                    yield from ch_data.values()
                elif isinstance(ch_data, list):
                    yield from ch_data


def load_json_source(path: str):
    """Returns dict[(chapter, verse)] -> {sanskrit, transliteration, english_list}"""
    out = {}
    for rec in _iter_json_records(path):
        try:
            ch = int(rec["chapter"])
            vs = int(rec["verse"])
        except (KeyError, ValueError, TypeError):
            continue

        sanskrit = rec.get("slok", "").strip()
        transliteration = rec.get("transliteration", "").strip()

        # Scan every author sub-object for an English translation ("et").
        english_list = []
        for key, val in rec.items():
            if isinstance(val, dict) and val.get("et"):
                author = val.get("author", key)
                english_list.append(f"{author}: {val['et'].strip()}")

        out[(ch, vs)] = {
            "sanskrit": sanskrit,
            "transliteration": transliteration,
            "english_list": english_list,
        }
    return out


def merge(json_map: dict, csv_map: dict) -> list[dict]:
    all_keys = sorted(set(json_map.keys()) | set(csv_map.keys()))
    merged = []
    for key in all_keys:
        ch, vs = key
        j = json_map.get(key, {})
        c = csv_map.get(key, {})

        sanskrit = j.get("sanskrit") or c.get("sanskrit") or ""
        transliteration = j.get("transliteration") or c.get("transliteration") or ""

        translations = list(j.get("english_list", []))
        if c.get("english"):
            translations.append(f"CSV source: {c['english'].strip()}")

        if not translations:
            continue  # nothing usable for this verse from either source

        merged.append(
            {
                "chapter": ch,
                "verse": vs,
                "sanskrit": sanskrit,
                "transliteration": transliteration,
                "english_translation": "\n\n".join(translations),
            }
        )
    return merged


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", required=True, help="Path to vedicscriptures JSON file or slok/ folder")
    parser.add_argument("--csv", required=True, help="Path to the second (CSV) dataset")
    parser.add_argument("--out", default="data/merged_gita.csv", help="Output CSV path")
    parser.add_argument(
        "--csv-map",
        default=None,
        help="Manual column override, e.g. chapter=Chapter,verse=Verse,english=Translation",
    )
    args = parser.parse_args()

    override = None
    if args.csv_map:
        override = dict(pair.split("=") for pair in args.csv_map.split(","))

    print(f"Loading JSON source from {args.json} ...")
    json_map = load_json_source(args.json)
    print(f"  -> {len(json_map)} verses found")

    print(f"Loading CSV source from {args.csv} ...")
    csv_map = load_csv_source(args.csv, override)
    print(f"  -> {len(csv_map)} verses found")

    merged = merge(json_map, csv_map)
    print(f"Merged into {len(merged)} unique verses")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["chapter", "verse", "sanskrit", "transliteration", "english_translation"]
        )
        writer.writeheader()
        writer.writerows(merged)

    print(f"Wrote {args.out}")
    print(f"Ingest it with:  curl -X POST http://localhost:8000/ingest -F \"file=@{args.out}\"")


if __name__ == "__main__":
    main()
