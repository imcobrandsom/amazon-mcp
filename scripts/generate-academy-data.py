#!/usr/bin/env python3
"""
Converts HubSpot knowledge base CSV export to a static JSON asset.
Usage: python3 scripts/generate-academy-data.py <path-to-csv>
Output: public/academy-articles.json
"""
import csv
import json
import sys
import os

def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "hubspot-knowledge-base-export.csv"
    out_path = os.path.join(os.path.dirname(__file__), "..", "public", "academy-articles.json")

    articles = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["Archived"].strip().lower() == "true":
                continue
            if row["Status"].strip().upper() != "PUBLISHED":
                continue

            url = row["Article URL"].strip()
            slug = url.replace("https://knowledge.brandsom.nl/", "").strip("/")
            if not slug:
                continue

            articles.append({
                "title":        row["Article title"].strip(),
                "subtitle":     row["Article subtitle"].strip(),
                "slug":         slug,
                "category":     row["Category"].strip(),
                "subcategory":  row["Subcategory"].strip(),
                "keywords":     row["Keywords"].strip(),
                "body":         row["Article body"],
                "lastModified": row["Last modified date"].strip(),
            })

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Written {len(articles)} articles to {out_path}")
    size_kb = os.path.getsize(out_path) // 1024
    print(f"File size: {size_kb} KB")

if __name__ == "__main__":
    main()
