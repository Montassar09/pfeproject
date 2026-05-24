"""
extract_energie.py  —  Extraction données énergie ELEONETECH
=============================================================
Lit depuis :
  DATA/energy/energie_eau.csv
  DATA/energy/energie_electricite.csv
  DATA/energy/energie_photovoltaique.csv

Ces fichiers viennent directement de la base eleonetech_db (app web).

Produit dans DATA/output/ :
  stg_energie_eau.csv          → date_releve, consommation_jour_m3, cout_jour_tnd
  stg_energie_electricite.csv  → date_releve, phase1, phase2, phase3,
                                  consommation_jour_kwh, cout_jour_tnd
  stg_energie_pv.csv           → date, puissance_installee_kwp,
                                  production_journaliere_kwh, production_cumulee_kwh,
                                  heures_equivalentes_h

Aucune transformation — renommage colonnes uniquement pour cohérence DW.

Usage : python extract_energie.py
"""

import warnings
from pathlib import Path
from datetime import datetime
import pandas as pd

warnings.filterwarnings("ignore")

BASE_DIR   = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
DIR_ENERGY = BASE_DIR / "energy"
CREATED_AT = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def main():
    print("=" * 65)
    print("  EXTRACT ÉNERGIE — Eleonetech")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Source : {DIR_ENERGY.resolve()}")
    print("=" * 65)

    # ── 1. EAU ────────────────────────────────────────────────────────────────
    # Colonnes source : id, date_releve, compteur, consommation_jour, cout_total, photo
    # Colonnes cibles : id, date_releve, compteur_m3, consommation_jour_m3, cout_jour_tnd
    print("\n[1/3] Eau...")
    eau_src = DIR_ENERGY / "energie_eau.csv"
    if not eau_src.exists():
        print(f"  ✗  {eau_src} introuvable")
    else:
        df = pd.read_csv(eau_src, encoding="utf-8-sig")
        df = df.rename(columns={
            "compteur":          "compteur_m3",
            "consommation_jour": "consommation_jour_m3",
            "cout_total":        "cout_jour_tnd",
        })
        # Garder seulement les colonnes utiles
        keep = ["id","date_releve","compteur_m3","consommation_jour_m3","cout_jour_tnd"]
        df = df[[c for c in keep if c in df.columns]]
        # Filtrer les lignes sans consommation
        df = df[df["consommation_jour_m3"].notna()]
        df = df.reset_index(drop=True)
        df["id"] = range(1, len(df) + 1)
        df["created_at"] = CREATED_AT
        out = OUTPUT_DIR / "stg_energie_eau.csv"
        df.to_csv(out, index=False, encoding="utf-8-sig")
        print(f"  ✓  stg_energie_eau.csv          {len(df):>5} lignes")
        print(f"     Période : {df['date_releve'].min()} → {df['date_releve'].max()}")
        print(f"     Coût renseigné : {df['cout_jour_tnd'].notna().sum()} lignes")

    # ── 2. ÉLECTRICITÉ ────────────────────────────────────────────────────────
    # Colonnes source : id, date_releve, phase1, phase2, phase3,
    #                   consommation_jour, cout_total,
    #                   photo_phase1, photo_phase2, photo_phase3
    # Colonnes cibles : id, date_releve, phase1_kwh, phase2_kwh, phase3_kwh,
    #                   consommation_jour_kwh, cout_jour_tnd
    print("\n[2/3] Électricité (3 phases)...")
    elec_src = DIR_ENERGY / "energie_electricite.csv"
    if not elec_src.exists():
        print(f"  ✗  {elec_src} introuvable")
    else:
        df = pd.read_csv(elec_src, encoding="utf-8-sig")
        df = df.rename(columns={
            "phase1":            "phase1_kwh",
            "phase2":            "phase2_kwh",
            "phase3":            "phase3_kwh",
            "consommation_jour": "consommation_jour_kwh",
            "cout_total":        "cout_jour_tnd",
        })
        keep = ["id","date_releve",
                "phase1_kwh","phase2_kwh","phase3_kwh",
                "consommation_jour_kwh","cout_jour_tnd"]
        df = df[[c for c in keep if c in df.columns]]
        # Garder toutes les lignes avec une date valide
        df = df[df["date_releve"].notna()]
        df = df.reset_index(drop=True)
        df["id"] = range(1, len(df) + 1)
        df["created_at"] = CREATED_AT
        out = OUTPUT_DIR / "stg_energie_electricite.csv"
        df.to_csv(out, index=False, encoding="utf-8-sig")
        non_null = df["consommation_jour_kwh"].notna().sum()
        print(f"  ✓  stg_energie_electricite.csv  {len(df):>5} lignes")
        print(f"     Période : {df['date_releve'].min()} → {df['date_releve'].max()}")
        print(f"     Consommation renseignée : {non_null} lignes")
        print(f"     Coût renseigné          : {df['cout_jour_tnd'].notna().sum()} lignes")

    # ── 3. PHOTOVOLTAÏQUE ─────────────────────────────────────────────────────
    # Colonnes source : id, date, mois, puissance_installee_kwp,
    #                   production_journaliere_kwh, production_cumulee_kwh,
    #                   heures_equivalentes_h, created_at
    # → Identiques, pas de renommage nécessaire
    print("\n[3/3] Photovoltaïque...")
    pv_src = DIR_ENERGY / "energie_photovoltaique.csv"
    if not pv_src.exists():
        print(f"  ✗  {pv_src} introuvable")
    else:
        df = pd.read_csv(pv_src, encoding="utf-8-sig")
        keep = ["id","date","mois","puissance_installee_kwp",
                "production_journaliere_kwh","production_cumulee_kwh",
                "heures_equivalentes_h"]
        df = df[[c for c in keep if c in df.columns]]
        # Garder toutes les lignes (même celles sans production — dates futures)
        df = df[df["date"].notna()]
        df = df.reset_index(drop=True)
        df["id"] = range(1, len(df) + 1)
        df["created_at"] = CREATED_AT
        out = OUTPUT_DIR / "stg_energie_pv.csv"
        df.to_csv(out, index=False, encoding="utf-8-sig")
        non_null = df["production_journaliere_kwh"].notna().sum()
        print(f"  ✓  stg_energie_pv.csv           {len(df):>5} lignes")
        print(f"     Période : {df['date'].min()} → {df['date'].max()}")
        print(f"     Jours avec production : {non_null} / {len(df)}")

    print("\n" + "=" * 65)
    print("  Résumé fichiers produits dans output/")
    print("=" * 65)
    for f in ["stg_energie_eau.csv","stg_energie_electricite.csv","stg_energie_pv.csv"]:
        p = OUTPUT_DIR / f
        if p.exists():
            df = pd.read_csv(p)
            print(f"  ✓  {f:<40} {len(df):>5} lignes")
    print(f"\n  Terminé : {datetime.now().strftime('%H:%M:%S')}")


if __name__ == "__main__":
    main()
