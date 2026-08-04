"""
scrape_sources.py
──────────────────────────────────────────────────────────────────────────
Scrapes publicly available informational pages (FAQs, tariffs, complaint
procedures, load-shedding info, net-metering info, etc.) from Pakistan's
electricity DISCOs, NEPRA, WAPDA, and K-Electric, and saves cleaned text
into rag/knowledge_base/ — one .txt file per source page.

Run this on YOUR OWN machine (not inside the chat container), since it
needs open internet access to reach these government/utility domains:

    pip install requests beautifulsoup4 lxml
    python scrape_sources.py

Then run build_index.py to embed + index everything for the chatbot.

NOTES / THINGS TO CHECK BEFORE RUNNING
──────────────────────────────────────────────────────────────────────────
1. These are informational/government sites — check each site's
   robots.txt and terms of use before scraping at scale. This script
   scrapes a small, fixed list of pages once (not continuously), which
   is normally fine for FAQ/tariff/help content, but you're responsible
   for confirming that's OK for your use case.
2. Government sites in Pakistan sometimes have unstable uptime, expired
   TLS certs, or change their page structure — the script skips a URL
   and logs a warning instead of crashing if something fails.
3. Add/remove URLs freely in SOURCES below. The more relevant pages you
   add (FAQ, tariff schedule, complaint/theft-reporting procedure, new
   connection process, net metering), the better your chatbot's answers.
4. This script only extracts plain text (no images/PDFs). If a DISCO's
   tariff info is only in a PDF, download it separately and drop the
   extracted text into rag/knowledge_base/ manually.
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "knowledge_base")
os.makedirs(OUTPUT_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
}

# Edit / extend this list. Keep to official domains only.
SOURCES = [
    # NEPRA — regulator: tariffs, consumer rights, complaint process
    ("nepra_home", "https://www.nepra.org.pk/"),
    ("nepra_consumer_rights", "https://www.nepra.org.pk/Consumer%20Complaint%20Handling.php"),

    # WAPDA — overall power system background
    ("wapda_home", "https://www.wapda.gov.pk/"),

    # K-Electric — Karachi
    ("ke_faqs", "https://www.ke.com.pk/faqs/"),
    ("ke_complaints", "https://www.ke.com.pk/customer-services/"),

    # LESCO — Lahore
    ("lesco_home", "https://www.lesco.gov.pk/"),

    # IESCO — Islamabad/Rawalpindi
    ("iesco_home", "https://www.iesco.com.pk/"),

    # PESCO — KPK
    ("pesco_home", "https://pesco.com.pk/"),

    # MEPCO — Multan
    ("mepco_home", "https://www.mepco.com.pk/"),

    # FESCO — Faisalabad
    ("fesco_home", "https://www.fesco.com.pk/"),

    # GEPCO — Gujranwala
    ("gepco_home", "https://www.gepco.com.pk/"),

    # HESCO — Hyderabad
    ("hesco_home", "https://www.hesco.gov.pk/"),
]


def clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")

    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()

    text = soup.get_text(separator="\n")
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def scrape_one(name: str, url: str) -> bool:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20, verify=True)
        resp.raise_for_status()
    except requests.exceptions.SSLError:
        # A few .gov.pk sites have misconfigured certs — retry without verification.
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20, verify=False)
            resp.raise_for_status()
        except Exception as e:
            print(f"[SKIP] {name} ({url}) — SSL/verify failed: {e}")
            return False
    except Exception as e:
        print(f"[SKIP] {name} ({url}) — {e}")
        return False

    text = clean_text(resp.text)
    if len(text) < 200:
        print(f"[SKIP] {name} ({url}) — page returned almost no text (likely JS-rendered)")
        return False

    out_path = os.path.join(OUTPUT_DIR, f"{name}.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"SOURCE_URL: {url}\n\n{text}")

    print(f"[OK]   {name} — {len(text)} chars saved -> {out_path}")
    return True


def main():
    ok, failed = 0, 0
    for name, url in SOURCES:
        if scrape_one(name, url):
            ok += 1
        else:
            failed += 1
        time.sleep(1.5)  # be polite, don't hammer government servers

    print(f"\nDone. {ok} pages saved, {failed} skipped.")
    print(f"Knowledge base folder: {os.path.abspath(OUTPUT_DIR)}")
    print("Next step: python build_index.py")


if __name__ == "__main__":
    main()
