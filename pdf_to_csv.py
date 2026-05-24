import re
import csv
import pdfplumber
from datetime import datetime

PDF_PATH    = "Charges_employes5678837328820646242.pdf"
OUTPUT_PATH = "charges_employes_maintenance.csv"

HEADERS = [
    "id", "matricule", "nom_prenom", "numero_ot", "type_intervention",
    "code_equipement", "description_equipement", "date_debut", "hrs_travaux",
    "periode_debut", "periode_fin", "created_at", "total_hrs_employe",
]

SKIP_PREFIXES = [
    "Charges des Employés", "Du ", "Au ", "Matricule Nom",
    "OT Interventio", "Page ", "Total Hrs", "Nbr OT",
]

RE_EMPLOYEE = re.compile(r"^([A-Z0-9]{2,4})\s+(.+?)\s+(\d+[,]\d+)$")
RE_OT_START = re.compile(r"^(20\d{8})\s")
RE_DATE_HRS = re.compile(r"(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2})\s+([\d,]+)$")
RE_EQUIP    = re.compile(r"\b([A-Z]{2,}[-_]?[A-Z0-9]+[-_]?[A-Z0-9]*)\b")
RE_FOOTER   = re.compile(r"^\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}")


def extract_lines(path):
    lines = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                lines.extend(text.split("\n"))
    return [l.strip() for l in lines if l.strip()]


def parse(path):
    lines = extract_lines(path)
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    periode_debut, periode_fin = "", ""
    for line in lines[:10]:
        m = re.search(r"Du\s+(\d{2}/\d{2}/\d{4})", line)
        if m:
            periode_debut = m.group(1)
        m = re.search(r"Au\s+(\d{2}/\d{2}/\d{4})", line)
        if m:
            periode_fin = m.group(1)

    records = []
    row_id = 0
    matricule = nom = total_hrs = None

    for line in lines:
        if RE_FOOTER.match(line) or any(line.startswith(p) for p in SKIP_PREFIXES):
            continue

        m = RE_EMPLOYEE.match(line)
        if m and not re.match(r"^20[2-9]\d{7}$", m.group(1)):
            matricule = m.group(1)
            nom       = m.group(2).strip()
            total_hrs = float(m.group(3).replace(",", "."))
            continue

        if RE_OT_START.match(line) and matricule:
            m_date = RE_DATE_HRS.search(line)
            if not m_date:
                continue

            date_str = m_date.group(1)
            hrs      = float(m_date.group(2).replace(",", "."))
            tokens   = line[: m_date.start()].split()
            numero   = tokens[0]
            rest     = " ".join(tokens[1:])

            m_eq = RE_EQUIP.search(rest)
            if m_eq:
                equip  = m_eq.group(1)
                interv = rest[: m_eq.start()].strip() or "Intervention"
                desc   = rest[m_eq.end() :].strip() or equip
            else:
                equip  = ""
                interv = "Intervention"
                desc   = rest

            row_id += 1
            records.append([
                row_id, matricule, nom, numero, interv,
                equip, desc, date_str, hrs,
                periode_debut, periode_fin, created_at, total_hrs,
            ])

    return records, periode_debut, periode_fin


def main():
    print(f"Reading  : {PDF_PATH}")
    records, debut, fin = parse(PDF_PATH)

    print(f"Writing  : {OUTPUT_PATH}")
    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(HEADERS)
        writer.writerows(records)

    print(f"Done — {len(records)} rows saved ({debut} -> {fin})")


if __name__ == "__main__":
    main()
