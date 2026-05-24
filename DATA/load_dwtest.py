"""
load_dw.py  —  Peuple eleonetech_dw depuis eleonetech_staging
=============================================================
Architecture corrigée :

DIMENSIONS :
  dim_temps        → clé temporelle (OT timestamp + mois + jours énergie)
  dim_zone         → 8 zones fixes
  dim_equipement   → équipements avec KPIs agrégés
  dim_ligne        → lignes de production
  dim_employe      → techniciens avec KPIs agrégés
  dim_intervention → attributs descriptifs d'un OT (pas les mesures)
  dim_prc          → pièces de rechange avec stock et prix
  dim_electricite  → 1 ligne/jour — attributs du relevé élec
                     (date, annee_mois, annee, mois_num,
                      phase1_kwh, phase2_kwh, phase3_kwh  ← attributs)
  dim_pv           → 1 ligne/jour — attributs du relevé PV
                     (date, puissance_installee_kwp, production_cumulee_kwh,
                      heures_equiv_h  ← attributs descriptifs)
  dim_eau          → 1 ligne/jour — attributs du relevé eau
                     (date, annee_mois, annee, mois_num)

TABLES DE FAITS (mesures uniquement) :
  fact_ot_global     → 1/mois  : nb_ot, taux_realisation
  fact_intervention  → 1/OT    : duree_intervention_h
  fact_pdr           → 1/mvt   : quantite_sortie, valeur_consommee_tnd
  fact_arret         → 1/(eq×mois) : MTBF, MTTR, dispo (calculés)
  fact_energie_elec  → 1/jour  : conso_jour_kwh, cout_jour_tnd  ← MESURES
  fact_energie_eau   → 1/jour  : conso_jour_m3, cout_jour_tnd   ← MESURES
  fact_energie_pv    → 1/jour  : production_kwh, valeur_pv_tnd  ← MESURES

MTBF/MTTR calculés :
  sum_ttr_h = SUM(hrs_travaux) OT curatifs depuis stg_charges_employes
  MTTR = sum_ttr_h / nb_arret
  MTBF = (t_ouverture - sum_ttr_h) / nb_arret
  Dispo = MTBF / (MTBF + MTTR) × 100
  Seuils : MTBF ≥ 715h | MTTR ≤ 1h | Dispo ≥ 95%

Usage : python load_dw.py
"""

import numpy as np
import pandas as pd
import warnings
from datetime import datetime
from sqlalchemy import create_engine, text

warnings.filterwarnings("ignore")

# ── Config ────────────────────────────────────────────────────────────────────
DB_HOST     = "localhost"
DB_PORT     = 5432
DB_USER     = "postgres"
DB_PASSWORD = ""
DB_STAGING  = "eleonetech_staging"
DB_DW       = "eleonetech_dw"


def get_engine(db):
    if DB_PASSWORD:
        url = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{db}"
    else:
        url = f"postgresql+psycopg2://{DB_USER}@{DB_HOST}:{DB_PORT}/{db}"
    return create_engine(url)


MOIS_MAP = {
    1:'Janvier',2:'Février',3:'Mars',4:'Avril',5:'Mai',6:'Juin',
    7:'Juillet',8:'Août',9:'Septembre',10:'Octobre',11:'Novembre',12:'Décembre'
}

MOIS_SQL = """CASE
    WHEN UPPER({col})='JANVIER'                  THEN 1
    WHEN UPPER({col}) IN ('FEVRIER','FÉVRIER')   THEN 2
    WHEN UPPER({col})='MARS'                     THEN 3
    WHEN UPPER({col})='AVRIL'                    THEN 4
    WHEN UPPER({col})='MAI'                      THEN 5
    WHEN UPPER({col})='JUIN'                     THEN 6
    WHEN UPPER({col})='JUILLET'                  THEN 7
    WHEN UPPER({col}) IN ('AOUT','AOÛT')         THEN 8
    WHEN UPPER({col})='SEPTEMBRE'                THEN 9
    WHEN UPPER({col})='OCTOBRE'                  THEN 10
    WHEN UPPER({col})='NOVEMBRE'                 THEN 11
    WHEN UPPER({col}) IN ('DECEMBRE','DÉCEMBRE') THEN 12
END"""

# ── DDL ───────────────────────────────────────────────────────────────────────


DW_DROP = """
DROP TABLE IF EXISTS fact_ot_global        CASCADE;
DROP TABLE IF EXISTS fact_intervention     CASCADE;
DROP TABLE IF EXISTS fact_pdr              CASCADE;
DROP TABLE IF EXISTS fact_arret            CASCADE;
DROP TABLE IF EXISTS fact_energie_elec     CASCADE;
DROP TABLE IF EXISTS fact_energie_eau      CASCADE;
DROP TABLE IF EXISTS fact_energie_pv       CASCADE;
DROP TABLE IF EXISTS dim_intervention      CASCADE;
DROP TABLE IF EXISTS dim_employe           CASCADE;
DROP TABLE IF EXISTS dim_prc               CASCADE;
DROP TABLE IF EXISTS dim_ligne             CASCADE;
DROP TABLE IF EXISTS dim_equipement        CASCADE;
DROP TABLE IF EXISTS dim_zone              CASCADE;
DROP TABLE IF EXISTS dim_temps             CASCADE;
DROP TABLE IF EXISTS dim_electricite       CASCADE;
DROP TABLE IF EXISTS dim_pv                CASCADE;
DROP TABLE IF EXISTS dim_eau               CASCADE;
DROP VIEW  IF EXISTS v_kpi_ot_mensuel      CASCADE;
DROP VIEW  IF EXISTS v_kpi_technicien      CASCADE;
DROP VIEW  IF EXISTS v_kpi_equipement      CASCADE;
DROP VIEW  IF EXISTS v_kpi_disponibilite   CASCADE;
DROP VIEW  IF EXISTS v_kpi_pdr             CASCADE;
DROP VIEW  IF EXISTS v_kpi_energie_mensuel CASCADE;
DROP VIEW  IF EXISTS v_kpi_pv_gain         CASCADE;
"""

DW_DDL = """
CREATE TABLE dim_temps (
    temps_id      SERIAL       PRIMARY KEY,
    date_debut    TIMESTAMP,
    duree_minutes NUMERIC(10,2),
    annee         SMALLINT,
    semestre      SMALLINT,
    trimestre     SMALLINT,
    mois_num      SMALLINT,
    mois_nom      VARCHAR(20),
    semaine       SMALLINT,
    jour          SMALLINT,
    jour_semaine  SMALLINT,
    heure         SMALLINT,
    minute        SMALLINT,
    annee_mois    VARCHAR(7)
);

CREATE TABLE dim_zone (
    zone_id      SERIAL       PRIMARY KEY,
    code_zone    VARCHAR(10)  NOT NULL UNIQUE,
    libelle_zone VARCHAR(60)  NOT NULL,
    batiment     VARCHAR(30),
    etage        VARCHAR(20)
);

CREATE TABLE dim_equipement (
    equip_id        SERIAL       PRIMARY KEY,
    code_equipement VARCHAR(30)  NOT NULL UNIQUE,
    libelle         TEXT,
    zone_id         INT          REFERENCES dim_zone(zone_id),
    nb_arrets_total INTEGER      DEFAULT 0,
    nb_ot_curatif   INTEGER      DEFAULT 0,
    nb_ot_preventif INTEGER      DEFAULT 0,
    nb_ot_autre     INTEGER      DEFAULT 0
);

CREATE TABLE dim_ligne (
    ligne_id    SERIAL       PRIMARY KEY,
    code_ligne  VARCHAR(20)  NOT NULL UNIQUE,
    description TEXT,
    entite      VARCHAR(20)  DEFAULT 'SG',
    statut      VARCHAR(10)  DEFAULT 'Actif',
    zone_id     INT          REFERENCES dim_zone(zone_id),
    equip_id    INT          REFERENCES dim_equipement(equip_id)
);

CREATE TABLE dim_prc (
    prc_id             SERIAL        PRIMARY KEY,
    code_prc           VARCHAR(15)   NOT NULL UNIQUE,
    designation        TEXT,
    famille_equipement TEXT,
    cout_unitaire_tnd  NUMERIC(12,3) DEFAULT 0,
    stock_actuel       INTEGER       DEFAULT 0
);

CREATE TABLE dim_employe (
    employe_id      SERIAL        PRIMARY KEY,
    matricule       VARCHAR(20)   NOT NULL UNIQUE,
    nom_prenom      TEXT,
    total_hrs_annee NUMERIC(10,3) DEFAULT 0,
    hrs_curatif     NUMERIC(10,3) DEFAULT 0,
    hrs_preventif   NUMERIC(10,3) DEFAULT 0,
    hrs_autre       NUMERIC(10,3) DEFAULT 0,
    nb_ot_total     INTEGER       DEFAULT 0,
    nb_ot_curatif   INTEGER       DEFAULT 0,
    nb_ot_preventif INTEGER       DEFAULT 0,
    nb_ot_autre     INTEGER       DEFAULT 0
);

CREATE TABLE dim_intervention (
    id_inter          SERIAL       PRIMARY KEY,
    numero_ot         VARCHAR(30)  UNIQUE,
    type_intervention VARCHAR(10),
    matricule_tech    VARCHAR(20),
    nom_technicien    TEXT,
    code_equipement   VARCHAR(30),
    date_debut        TIMESTAMP,
    duree_h           NUMERIC(10,3)
);

CREATE TABLE dim_electricite (
    elec_id      SERIAL  PRIMARY KEY,
    date_releve  DATE    NOT NULL UNIQUE,
    annee_mois   VARCHAR(7),
    annee        SMALLINT,
    mois_num     SMALLINT,
    jour         SMALLINT,
    semaine      SMALLINT,
    jour_semaine SMALLINT,
    phase1_kwh   NUMERIC(12,3),
    phase2_kwh   NUMERIC(12,3),
    phase3_kwh   NUMERIC(12,3)
);

CREATE TABLE dim_pv (
    pv_id                   SERIAL  PRIMARY KEY,
    date_jour               DATE    NOT NULL UNIQUE,
    annee_mois              VARCHAR(7),
    annee                   SMALLINT,
    mois_num                SMALLINT,
    jour                    SMALLINT,
    semaine                 SMALLINT,
    jour_semaine            SMALLINT,
    puissance_installee_kwp NUMERIC(8,2),
    production_cumulee_kwh  NUMERIC(12,3)
);

CREATE TABLE dim_eau (
    eau_id       SERIAL  PRIMARY KEY,
    date_releve  DATE    NOT NULL UNIQUE,
    annee_mois   VARCHAR(7),
    annee        SMALLINT,
    mois_num     SMALLINT,
    jour         SMALLINT,
    semaine      SMALLINT,
    jour_semaine SMALLINT
);

CREATE TABLE fact_ot_global (
    id                   SERIAL PRIMARY KEY,
    temps_id             INT    REFERENCES dim_temps(temps_id),
    nb_ot_total          INTEGER,
    nb_ot_curatif        INTEGER,
    nb_ot_preventif      INTEGER,
    nb_ot_autre          INTEGER,
    nb_ot_honore         INTEGER,
    taux_realisation_pct NUMERIC(5,2),
    ratio_preventif_pct  NUMERIC(5,2),
    UNIQUE (temps_id)
);

CREATE TABLE fact_intervention (
    id                   SERIAL PRIMARY KEY,
    temps_id             INT    REFERENCES dim_temps(temps_id),
    equip_id             INT    REFERENCES dim_equipement(equip_id),
    employe_id           INT    REFERENCES dim_employe(employe_id),
    zone_id              INT    REFERENCES dim_zone(zone_id),
    id_inter             INT    REFERENCES dim_intervention(id_inter),
    type_intervention    VARCHAR(10),
    duree_intervention_h NUMERIC(10,3),
    UNIQUE (id_inter)
);

CREATE TABLE fact_pdr (
    id                   SERIAL PRIMARY KEY,
    temps_id             INT    REFERENCES dim_temps(temps_id),
    prc_id               INT    REFERENCES dim_prc(prc_id),
    quantite_sortie      INTEGER,
    stock_final          INTEGER,
    valeur_consommee_tnd NUMERIC(12,3)
);

-- fact_arret : nb_arrets INTEGER, sans colonnes _pdf
-- ecart_mtbf = MTBF_calcule - 715 (negatif = mauvais)
-- ecart_mttr = 1 - MTTR_calcule (negatif = mauvais)
-- dispo=100% quand nb_arrets=0 est CORRECT (aucune panne ce mois)
CREATE TABLE fact_arret (
    id                SERIAL PRIMARY KEY,
    temps_id          INT    REFERENCES dim_temps(temps_id),
    ligne_id          INT    REFERENCES dim_ligne(ligne_id),
    zone_id           INT    REFERENCES dim_zone(zone_id),
    equip_id          INT    REFERENCES dim_equipement(equip_id),
    duree_ouverture_h NUMERIC(10,2),
    nb_arrets         INTEGER,
    sum_ttr_h         NUMERIC(10,2),
    nb_ot_curatif     INTEGER,
    mttr_h            NUMERIC(10,2),
    mtbf_h            NUMERIC(10,2),
    disponibilite_pct NUMERIC(5,2),
    conforme_mtbf     BOOLEAN       GENERATED ALWAYS AS (mtbf_h >= 715) STORED,
    conforme_mttr     BOOLEAN       GENERATED ALWAYS AS (mttr_h <= 1)   STORED,
    ecart_mtbf        NUMERIC(10,2) GENERATED ALWAYS AS (mtbf_h - 715)  STORED,
    ecart_mttr        NUMERIC(10,2) GENERATED ALWAYS AS (1 - mttr_h)    STORED,
    UNIQUE (temps_id, ligne_id)
);

CREATE TABLE fact_energie_elec (
    id             SERIAL PRIMARY KEY,
    elec_id        INT    REFERENCES dim_electricite(elec_id),
    temps_id       INT    REFERENCES dim_temps(temps_id),
    zone_id        INT    REFERENCES dim_zone(zone_id),
    conso_jour_kwh NUMERIC(12,3),
    cout_jour_tnd  NUMERIC(12,3),
    UNIQUE (elec_id)
);

CREATE TABLE fact_energie_eau (
    id            SERIAL PRIMARY KEY,
    eau_id        INT    REFERENCES dim_eau(eau_id),
    temps_id      INT    REFERENCES dim_temps(temps_id),
    zone_id       INT    REFERENCES dim_zone(zone_id),
    conso_jour_m3 NUMERIC(10,3),
    cout_jour_tnd NUMERIC(10,3) GENERATED ALWAYS AS (
        ROUND(COALESCE(conso_jour_m3,0)*0.200,3)) STORED,
    UNIQUE (eau_id)
);

CREATE TABLE fact_energie_pv (
    id             SERIAL PRIMARY KEY,
    pv_id          INT    REFERENCES dim_pv(pv_id),
    temps_id       INT    REFERENCES dim_temps(temps_id),
    zone_id        INT    REFERENCES dim_zone(zone_id),
    production_kwh NUMERIC(12,3),
    heures_equiv_h NUMERIC(8,3),
    valeur_pv_tnd  NUMERIC(12,3) GENERATED ALWAYS AS (
        ROUND(COALESCE(production_kwh,0)*0.291,3)) STORED,
    UNIQUE (pv_id)
);
"""

DW_SEED = """
INSERT INTO dim_zone (code_zone,libelle_zone,batiment,etage) VALUES
('BAT','Batiment','Bat. Principal','RDC'),
('CMS','CMS Assemblage','Bat. Production','RDC'),
('MAG','Magasin','Bat. Stockage','RDC'),
('MEZ','Mezzanine','Bat. Principal','Mezzanine'),
('SEP','SEP Separation','Bat. Production','RDC'),
('THT','THT Traversant','Bat. Production','RDC'),
('UAP4','UAP4 Production','Bat. Production','RDC')
ON CONFLICT (code_zone) DO NOTHING;
"""

DW_VIEWS = """
DROP VIEW IF EXISTS v_kpi_ot_mensuel      CASCADE;
DROP VIEW IF EXISTS v_kpi_technicien      CASCADE;
DROP VIEW IF EXISTS v_kpi_equipement      CASCADE;
DROP VIEW IF EXISTS v_kpi_disponibilite   CASCADE;
DROP VIEW IF EXISTS v_kpi_pdr             CASCADE;
DROP VIEW IF EXISTS v_kpi_energie_mensuel CASCADE;
DROP VIEW IF EXISTS v_kpi_pv_gain         CASCADE;

CREATE OR REPLACE VIEW v_kpi_ot_mensuel AS
SELECT dt.annee, dt.mois_nom, dt.annee_mois, dt.trimestre,
       f.nb_ot_total, f.nb_ot_curatif, f.nb_ot_preventif, f.nb_ot_autre,
       f.nb_ot_honore, f.taux_realisation_pct, f.ratio_preventif_pct,
       ROUND(f.nb_ot_curatif::NUMERIC  /NULLIF(f.nb_ot_total,0)*100,2) AS pct_curatif,
       ROUND(f.nb_ot_preventif::NUMERIC/NULLIF(f.nb_ot_total,0)*100,2) AS pct_preventif,
       ROUND(f.nb_ot_autre::NUMERIC    /NULLIF(f.nb_ot_total,0)*100,2) AS pct_autre
FROM fact_ot_global f
JOIN dim_temps dt ON dt.temps_id = f.temps_id
ORDER BY dt.annee, dt.mois_num;

CREATE OR REPLACE VIEW v_kpi_technicien AS
SELECT de.matricule, de.nom_prenom,
       dt.annee_mois, dt.mois_nom, dt.annee,
       COUNT(fi.id)                                                   AS nb_ot,
       ROUND(SUM(COALESCE(fi.duree_intervention_h,0)),2)              AS total_hrs,
       SUM(CASE WHEN fi.type_intervention='CURA'  THEN 1 ELSE 0 END) AS nb_curatif,
       SUM(CASE WHEN fi.type_intervention='PREV'  THEN 1 ELSE 0 END) AS nb_preventif,
       SUM(CASE WHEN fi.type_intervention='AUTRE' THEN 1 ELSE 0 END) AS nb_autre,
       ROUND(SUM(CASE WHEN fi.type_intervention='CURA'
           THEN COALESCE(fi.duree_intervention_h,0) ELSE 0 END),2)   AS hrs_curatif,
       ROUND(SUM(CASE WHEN fi.type_intervention='PREV'
           THEN COALESCE(fi.duree_intervention_h,0) ELSE 0 END),2)   AS hrs_preventif,
       ROUND(SUM(CASE WHEN fi.type_intervention='AUTRE'
           THEN COALESCE(fi.duree_intervention_h,0) ELSE 0 END),2)   AS hrs_autre
FROM fact_intervention fi
JOIN dim_employe de ON de.employe_id = fi.employe_id
JOIN dim_temps   dt ON dt.temps_id   = fi.temps_id
GROUP BY de.matricule, de.nom_prenom,
         dt.annee_mois, dt.mois_nom, dt.annee, dt.mois_num
ORDER BY dt.annee, dt.mois_num, total_hrs DESC;

CREATE OR REPLACE VIEW v_kpi_equipement AS
SELECT deq.code_equipement, deq.libelle, dz.code_zone,
       dt.annee_mois, dt.mois_nom, dt.annee,
       COUNT(fi.id)                                                   AS nb_interventions,
       ROUND(SUM(COALESCE(fi.duree_intervention_h,0)),2)              AS total_hrs,
       SUM(CASE WHEN fi.type_intervention='CURA'  THEN 1 ELSE 0 END) AS nb_curatif,
       SUM(CASE WHEN fi.type_intervention='PREV'  THEN 1 ELSE 0 END) AS nb_preventif,
       SUM(CASE WHEN fi.type_intervention='AUTRE' THEN 1 ELSE 0 END) AS nb_autre,
       fa.nb_arrets, fa.mtbf_h, fa.mttr_h, fa.disponibilite_pct,
       fa.conforme_mtbf, fa.conforme_mttr, fa.ecart_mtbf, fa.ecart_mttr
FROM dim_equipement deq
LEFT JOIN dim_zone          dz ON dz.zone_id  = deq.zone_id
LEFT JOIN fact_intervention fi ON fi.equip_id = deq.equip_id
LEFT JOIN dim_temps         dt ON dt.temps_id = fi.temps_id
LEFT JOIN fact_arret        fa ON fa.equip_id = deq.equip_id
                               AND fa.temps_id = fi.temps_id
WHERE dt.annee_mois IS NOT NULL
GROUP BY deq.code_equipement, deq.libelle, dz.code_zone,
         dt.annee_mois, dt.mois_nom, dt.annee, dt.mois_num,
         fa.nb_arrets, fa.mtbf_h, fa.mttr_h, fa.disponibilite_pct,
         fa.conforme_mtbf, fa.conforme_mttr, fa.ecart_mtbf, fa.ecart_mttr
ORDER BY dt.annee, dt.mois_num, nb_interventions DESC;

CREATE OR REPLACE VIEW v_kpi_disponibilite AS
SELECT deq.code_equipement, deq.libelle, dz.code_zone,
       dt.annee, dt.mois_nom, dt.annee_mois, dt.trimestre,
       fa.duree_ouverture_h, fa.nb_arrets,
       fa.sum_ttr_h, fa.nb_ot_curatif,
       fa.mttr_h, fa.mtbf_h, fa.disponibilite_pct,
       fa.conforme_mtbf, fa.conforme_mttr,
       fa.ecart_mtbf, fa.ecart_mttr,
       715  AS objectif_mtbf,
       1    AS objectif_mttr,
       95.0 AS objectif_dispo,
       CASE WHEN fa.conforme_mtbf AND fa.conforme_mttr THEN 'Conforme'
            WHEN fa.conforme_mtbf OR  fa.conforme_mttr THEN 'Partiel'
            ELSE 'Non conforme' END AS statut
FROM fact_arret fa
JOIN dim_temps      dt  ON dt.temps_id  = fa.temps_id
JOIN dim_equipement deq ON deq.equip_id = fa.equip_id
LEFT JOIN dim_zone  dz  ON dz.zone_id   = deq.zone_id
ORDER BY dt.annee, dt.mois_num, fa.disponibilite_pct;

CREATE OR REPLACE VIEW v_kpi_pdr AS
SELECT dp.code_prc, dp.designation, dp.famille_equipement,
       dp.cout_unitaire_tnd, dp.stock_actuel,
       dt.annee, dt.mois_nom, dt.annee_mois,
       SUM(fp.quantite_sortie)          AS qtite_sortie,
       MAX(fp.stock_final)              AS stock_final,
       SUM(fp.valeur_consommee_tnd)     AS cout_total_periode,
       dp.stock_actuel * dp.cout_unitaire_tnd AS valeur_stock_tnd
FROM fact_pdr fp
JOIN dim_prc   dp ON dp.prc_id   = fp.prc_id
JOIN dim_temps dt ON dt.temps_id = fp.temps_id
GROUP BY dp.code_prc, dp.designation, dp.famille_equipement,
         dp.cout_unitaire_tnd, dp.stock_actuel,
         dt.annee, dt.mois_nom, dt.annee_mois, dt.mois_num
ORDER BY dt.annee, dt.mois_num, cout_total_periode DESC;

CREATE OR REPLACE VIEW v_kpi_energie_mensuel AS
SELECT de.annee_mois, de.annee, de.mois_num,
       SUM(fe.conso_jour_kwh) AS conso_elec_kwh,
       SUM(fe.cout_jour_tnd)  AS cout_elec_tnd,
       COUNT(fe.id)           AS nb_jours_elec,
       eau_m.conso_eau_m3, eau_m.cout_eau_tnd,
       pv_m.production_pv_kwh, pv_m.heures_equiv_h,
       ROUND(pv_m.production_pv_kwh * 0.291, 3) AS valeur_pv_tnd,
       ROUND(pv_m.production_pv_kwh * 0.291 - COALESCE(SUM(fe.cout_jour_tnd),0), 3) AS gain_pv_tnd,
       CASE WHEN SUM(fe.conso_jour_kwh) > 0
            THEN ROUND(pv_m.production_pv_kwh/SUM(fe.conso_jour_kwh)*100,2)
            ELSE 0 END AS taux_couverture_pct
FROM dim_electricite de
LEFT JOIN fact_energie_elec fe ON fe.elec_id = de.elec_id
LEFT JOIN (
    SELECT deau.annee_mois,
           SUM(fw.conso_jour_m3) AS conso_eau_m3,
           SUM(fw.cout_jour_tnd) AS cout_eau_tnd
    FROM fact_energie_eau fw JOIN dim_eau deau ON deau.eau_id = fw.eau_id
    GROUP BY deau.annee_mois
) eau_m ON eau_m.annee_mois = de.annee_mois
LEFT JOIN (
    SELECT dpv.annee_mois,
           SUM(fpv.production_kwh) AS production_pv_kwh,
           SUM(fpv.heures_equiv_h) AS heures_equiv_h
    FROM fact_energie_pv fpv JOIN dim_pv dpv ON dpv.pv_id = fpv.pv_id
    GROUP BY dpv.annee_mois
) pv_m ON pv_m.annee_mois = de.annee_mois
GROUP BY de.annee_mois, de.annee, de.mois_num,
         eau_m.conso_eau_m3, eau_m.cout_eau_tnd,
         pv_m.production_pv_kwh, pv_m.heures_equiv_h
ORDER BY de.annee, de.mois_num;

CREATE OR REPLACE VIEW v_kpi_pv_gain AS
SELECT dpv.date_jour, dpv.annee_mois,
       dpv.puissance_installee_kwp, dpv.production_cumulee_kwh,
       fpv.production_kwh, fpv.heures_equiv_h, fpv.valeur_pv_tnd,
       fe.conso_jour_kwh, fe.cout_jour_tnd AS cout_elec_tnd,
       ROUND(fpv.valeur_pv_tnd - COALESCE(fe.cout_jour_tnd,0),3) AS gain_jour_tnd,
       CASE WHEN fpv.valeur_pv_tnd > COALESCE(fe.cout_jour_tnd,0)
            THEN 'Rentable' ELSE 'Deficit' END AS statut_pv
FROM fact_energie_pv fpv
JOIN dim_pv dpv ON dpv.pv_id = fpv.pv_id
LEFT JOIN fact_energie_elec fe  ON fe.temps_id = fpv.temps_id
LEFT JOIN dim_electricite   dee ON dee.elec_id  = fe.elec_id
                                AND dee.date_releve = dpv.date_jour
WHERE fpv.production_kwh IS NOT NULL AND fpv.production_kwh > 0
ORDER BY dpv.date_jour;
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def run_sql(engine, sql_block, label="SQL"):
    ok = err = 0
    for stmt in sql_block.split(";"):
        stmt = stmt.strip()
        if stmt:
            try:
                with engine.begin() as c:
                    c.execute(text(stmt))
                ok += 1
            except Exception as e:
                err += 1
                print(f"    ↳ [{label}] {str(e)[:100]}")
    return ok, err


def stg(engine_stg, sql):
    with engine_stg.connect() as c:
        return pd.read_sql(text(sql), c)


def dw_read(engine_dw, sql):
    with engine_dw.connect() as c:
        return pd.read_sql(text(sql), c)


def dw_write(df, table, engine_dw):
    if df is None or df.empty:
        print(f"    ⚠  {table}: rien à insérer")
        return 0
    df = df.copy().where(pd.notna(df), other=None)
    for col in df.columns:
        df[col] = df[col].apply(
            lambda v: None if v is None
            else int(v)   if isinstance(v, np.integer)
            else float(v) if isinstance(v, np.floating)
            else v)
    try:
        df.to_sql(table, engine_dw, if_exists="append",
                  index=False, method="multi", chunksize=200)
        print(f"    ✓  {table:<42} {len(df):>5} lignes")
        return len(df)
    except Exception as e:
        print(f"    ✗  {table}: {str(e)[:120]}")
        return 0


# ═══════════════════════════════════════════════════════════════════════════════
# DIMENSIONS
# ═══════════════════════════════════════════════════════════════════════════════

def load_dim_employe(engine_stg, engine_dw):
    df = stg(engine_stg, """
        SELECT matricule, MAX(nom_prenom) AS nom_prenom,
               ROUND(SUM(COALESCE(hrs_travaux,0)),3) AS total_hrs_annee,
               ROUND(SUM(CASE WHEN type_intervention='CURA'
                   THEN COALESCE(hrs_travaux,0) ELSE 0 END),3) AS hrs_curatif,
               ROUND(SUM(CASE WHEN type_intervention='PREV'
                   THEN COALESCE(hrs_travaux,0) ELSE 0 END),3) AS hrs_preventif,
               ROUND(SUM(CASE WHEN UPPER(COALESCE(type_intervention,'')) NOT LIKE '%CURA%'
                   AND UPPER(COALESCE(type_intervention,'')) NOT LIKE '%PREV%'
                   THEN COALESCE(hrs_travaux,0) ELSE 0 END),3) AS hrs_autre,
               COUNT(DISTINCT numero_ot)                                          AS nb_ot_total,
               COUNT(DISTINCT CASE WHEN type_intervention='CURA'  THEN numero_ot END) AS nb_ot_curatif,
               COUNT(DISTINCT CASE WHEN type_intervention='PREV'  THEN numero_ot END) AS nb_ot_preventif,
               COUNT(DISTINCT CASE WHEN type_intervention='AUTRE' THEN numero_ot END) AS nb_ot_autre
        FROM stg_clean_charges
        WHERE matricule IS NOT NULL
        GROUP BY matricule
    """)
    dw_write(df[["matricule","nom_prenom","total_hrs_annee","hrs_curatif","hrs_preventif","hrs_autre","nb_ot_total","nb_ot_curatif","nb_ot_preventif","nb_ot_autre"]], "dim_employe", engine_dw)


def load_dim_equipement(engine_stg, engine_dw):
    df = stg(engine_stg, """
        SELECT DISTINCT td.code_ligne AS code_equipement, td.description AS libelle,
               CASE
                   WHEN td.code_ligne LIKE 'BAT%'  THEN 'BAT'
                   WHEN td.code_ligne LIKE 'THT%'  THEN 'THT'
                   WHEN td.code_ligne = 'LEVAGE'   THEN 'MAG'
                   WHEN td.code_ligne = 'ELECT'    THEN 'BAT'
                   WHEN td.code_ligne = 'ESD'      THEN 'BAT'
                   WHEN td.code_ligne LIKE 'MAG%'  THEN 'MAG'
                   WHEN td.code_ligne LIKE 'CONV%' THEN 'CMS'
                   ELSE 'SG'
               END AS zone_code
        FROM stg_clean_taux_dispo td
        WHERE td.code_ligne IS NOT NULL
    """)
    if not df.empty:
        dz = dw_read(engine_dw, "SELECT zone_id, code_zone FROM dim_zone")
        df = df.merge(dz, left_on="zone_code", right_on="code_zone", how="left")
        dw_write(df[["code_equipement","libelle","zone_id"]], "dim_equipement", engine_dw)

    # Équipements depuis charges_employes non encore dans dim_equipement
    df_eq = stg(engine_stg, """
        SELECT DISTINCT code_equipement FROM stg_clean_charges
        WHERE code_equipement IS NOT NULL
    """)
    if not df_eq.empty:
        existing = dw_read(engine_dw, "SELECT code_equipement FROM dim_equipement")
        sg_zone  = dw_read(engine_dw, "SELECT zone_id FROM dim_zone WHERE code_zone='BAT'")
        new_eq   = df_eq[~df_eq["code_equipement"].isin(existing["code_equipement"])].copy()
        if not new_eq.empty:
            new_eq["libelle"] = new_eq["code_equipement"]
            new_eq["zone_id"] = int(sg_zone["zone_id"].iloc[0])
            dw_write(new_eq, "dim_equipement", engine_dw)

    # KPIs agrégés
    # nb_arrets → depuis stg_taux_disponibilite
    df_arr = stg(engine_stg, """
        SELECT code_ligne,
               SUM(COALESCE(nb_arret,0))::INTEGER AS total_arrets
        FROM stg_clean_taux_dispo
        GROUP BY code_ligne
    """)
    # nb_ot_curatif/preventif → depuis stg_charges_employes (source directe des OT)
    df_ot = stg(engine_stg, """
        SELECT code_equipement,
               COUNT(DISTINCT CASE WHEN type_intervention='CURA'
                   THEN numero_ot END) AS nb_ot_cura,
               COUNT(DISTINCT CASE WHEN type_intervention='PREV'
                   THEN numero_ot END) AS nb_ot_prev
        FROM stg_clean_charges
        WHERE code_equipement IS NOT NULL AND code_equipement != ''
        GROUP BY code_equipement
    """)
    with engine_dw.begin() as c:
        for _, row in df_arr.iterrows():
            c.execute(text(
                "UPDATE dim_equipement SET nb_arrets_total=:na WHERE code_equipement=:ce"),
                {"na": int(row.total_arrets), "ce": row.code_ligne})
        for _, row in df_ot.iterrows():
            c.execute(text(
                "UPDATE dim_equipement SET nb_ot_curatif=:nc, nb_ot_preventif=:np, nb_ot_autre=:na "
                "WHERE code_equipement=:ce"),
                {"nc": int(row.nb_ot_cura), "np": int(row.nb_ot_prev),
                 "na": int(row.get("nb_ot_autre", 0)), "ce": row.code_equipement})


def load_dim_prc(engine_stg, engine_dw):
    df = stg(engine_stg, """
        SELECT code_prc_format AS code_prc, designation,
               equipement AS famille_equipement,
               COALESCE(NULLIF(cout_tnd,'')::NUMERIC,0) AS cout_unitaire_tnd
        FROM stg_pieces_rechange_catalogue
        WHERE code_prc_format IS NOT NULL
    """)
    dw_write(df, "dim_prc", engine_dw)
    df_stock = stg(engine_stg, """
        SELECT code_prc, MAX(NULLIF(aftsto,'')::NUMERIC) AS stock
        FROM stg_pieces_rechange_mouvements
        WHERE aftsto IS NOT NULL AND aftsto != ''
        GROUP BY code_prc
    """)
    if not df_stock.empty:
        with engine_dw.begin() as c:
            for _, row in df_stock.iterrows():
                if row.stock is not None:
                    c.execute(text(
                        "UPDATE dim_prc SET stock_actuel=:s WHERE code_prc=:cp"),
                        {"s": int(round(float(row.stock))), "cp": row.code_prc})


def load_dim_intervention(engine_stg, engine_dw):
    # Prioriser CURA > PREV > AUTRE pour chaque OT
    # Un OT peut avoir plusieurs lignes → prendre la plus significative
    df = stg(engine_stg, """
        SELECT DISTINCT ON (numero_ot)
               numero_ot,
               type_intervention,
               matricule AS matricule_tech, nom_prenom AS nom_technicien,
               code_equipement,
               date_debut,
               COALESCE(hrs_travaux,0) AS duree_h
        FROM stg_clean_charges
        WHERE numero_ot IS NOT NULL AND matricule IS NOT NULL
        ORDER BY numero_ot,
                 CASE WHEN type_intervention='CURA' THEN 1
                      WHEN type_intervention='PREV' THEN 2
                      ELSE 3 END ASC,
                 date_debut DESC NULLS LAST
    """)
    dw_write(df, "dim_intervention", engine_dw)


def load_dim_temps(engine_stg, engine_dw):
    # A. Entrée par OT (timestamp précis)
    di = dw_read(engine_dw,
        "SELECT id_inter, date_debut, duree_h FROM dim_intervention WHERE date_debut IS NOT NULL")
    if not di.empty:
        di["date_debut"]   = pd.to_datetime(di["date_debut"])
        di["annee"]        = di["date_debut"].dt.year.astype("Int64")
        di["semestre"]     = ((di["date_debut"].dt.month-1)//6+1).astype("Int64")
        di["trimestre"]    = di["date_debut"].dt.quarter.astype("Int64")
        di["mois_num"]     = di["date_debut"].dt.month.astype("Int64")
        di["mois_nom"]     = di["mois_num"].map(MOIS_MAP)
        di["semaine"]      = di["date_debut"].dt.isocalendar().week.astype("Int64")
        di["jour"]         = di["date_debut"].dt.day.astype("Int64")
        di["jour_semaine"] = (di["date_debut"].dt.dayofweek+1).astype("Int64")
        di["heure"]        = di["date_debut"].dt.hour.astype("Int64")
        di["minute"]       = di["date_debut"].dt.minute.astype("Int64")
        di["annee_mois"]   = di["date_debut"].dt.strftime("%Y-%m")
        di["duree_minutes"]= (di["duree_h"]*60).round(2)
        dw_write(di[["date_debut","duree_minutes","annee","semestre","trimestre",
                     "mois_num","mois_nom","semaine","jour","jour_semaine",
                     "heure","minute","annee_mois"]], "dim_temps", engine_dw)

    # B. Entrée mensuelle pour les mois du PDF
    df_td = stg(engine_stg, f"""
        SELECT DISTINCT annee::SMALLINT AS annee,
               {MOIS_SQL.format(col='mois_libelle')} AS mois_num
        FROM stg_clean_taux_dispo
        WHERE annee IS NOT NULL
    """)
    if not df_td.empty:
        df_td = df_td.dropna(subset=["mois_num"])
        df_td["mois_nom"]  = df_td["mois_num"].map(MOIS_MAP)
        df_td["annee_mois"]= df_td.apply(
            lambda r: f"{int(r.annee):04d}-{int(r.mois_num):02d}", axis=1)
        df_td["semestre"]  = df_td["mois_num"].apply(lambda m: 1 if int(m)<=6 else 2)
        df_td["trimestre"] = df_td["mois_num"].apply(lambda m: (int(m)-1)//3+1)
        existing = set(dw_read(engine_dw,
            "SELECT DISTINCT annee_mois FROM dim_temps WHERE annee_mois IS NOT NULL"
        )["annee_mois"].tolist())
        new_m = df_td[~df_td["annee_mois"].isin(existing)]
        if not new_m.empty:
            dw_write(new_m[["annee","mois_num","mois_nom","semestre",
                             "trimestre","annee_mois"]], "dim_temps", engine_dw)

    # C. Entrée journalière pour les dates énergie
    for src_table, date_col in [
        ("stg_energie_electricite", "date_releve"),
        ("stg_energie_eau",         "date_releve"),
        ("stg_energie_photovoltaique", "date"),
    ]:
        try:
            df_d = stg(engine_stg,
                f"SELECT DISTINCT {date_col}::DATE AS jour FROM {src_table} "
                f"WHERE {date_col} IS NOT NULL")
            if df_d.empty:
                continue
            df_d["jour"]       = pd.to_datetime(df_d["jour"])
            df_d["annee"]      = df_d["jour"].dt.year.astype("Int64")
            df_d["semestre"]   = ((df_d["jour"].dt.month-1)//6+1).astype("Int64")
            df_d["trimestre"]  = df_d["jour"].dt.quarter.astype("Int64")
            df_d["mois_num"]   = df_d["jour"].dt.month.astype("Int64")
            df_d["mois_nom"]   = df_d["mois_num"].map(MOIS_MAP)
            df_d["semaine"]    = df_d["jour"].dt.isocalendar().week.astype("Int64")
            df_d["jour_num"]   = df_d["jour"].dt.day.astype("Int64")
            df_d["jour_sem"]   = (df_d["jour"].dt.dayofweek+1).astype("Int64")
            df_d["annee_mois"] = df_d["jour"].dt.strftime("%Y-%m")
            df_d["date_debut"] = df_d["jour"]
            existing_d = set(dw_read(engine_dw,
                "SELECT DISTINCT DATE(date_debut) AS d FROM dim_temps "
                "WHERE date_debut IS NOT NULL")["d"].astype(str).tolist())
            new_d = df_d[~df_d["jour"].dt.strftime("%Y-%m-%d").isin(existing_d)]
            if not new_d.empty:
                dw_write(new_d[["date_debut","annee","semestre","trimestre",
                                "mois_num","mois_nom","semaine","jour_num",
                                "jour_sem","annee_mois"]].rename(
                    columns={"jour_num":"jour","jour_sem":"jour_semaine"}),
                    "dim_temps", engine_dw)
        except Exception as e:
            print(f"    ⚠  dim_temps {src_table}: {str(e)[:80]}")


def load_dim_ligne(engine_stg, engine_dw):
    de = dw_read(engine_dw, "SELECT equip_id, code_equipement, zone_id FROM dim_equipement")
    df = stg(engine_stg,
        "SELECT DISTINCT code_ligne, description FROM stg_clean_taux_dispo")
    if not df.empty:
        df = df.merge(de, left_on="code_ligne", right_on="code_equipement", how="left")
        dw_write(df[["code_ligne","description","zone_id","equip_id"]], "dim_ligne", engine_dw)


def load_dim_energie(engine_stg, engine_dw):
    """
    dim_electricite : attributs du relevé (date, mois, phases kwh)
    dim_pv          : attributs (date, mois, puissance installée, cumulé)
    dim_eau         : attributs temporels (date, mois)
    Les MESURES vont dans les tables de faits.
    """
    import datetime as _dt

    # ── dim_electricite ───────────────────────────────────────────────────────
    df_e = stg(engine_stg, """
        SELECT date_releve::TEXT AS date_releve,
               SUM(phase1_kwh) AS phase1_kwh,
               SUM(phase2_kwh) AS phase2_kwh,
               SUM(phase3_kwh) AS phase3_kwh
        FROM stg_energie_electricite
        WHERE date_releve IS NOT NULL
        GROUP BY date_releve ORDER BY date_releve
    """)
    if not df_e.empty:
        df_e["date_releve"]  = pd.to_datetime(df_e["date_releve"]).dt.date
        df_e["annee"]        = pd.to_datetime(df_e["date_releve"].astype(str)).dt.year
        df_e["mois_num"]     = pd.to_datetime(df_e["date_releve"].astype(str)).dt.month
        df_e["annee_mois"]   = pd.to_datetime(df_e["date_releve"].astype(str)).dt.strftime("%Y-%m")
        df_e["jour"]         = pd.to_datetime(df_e["date_releve"].astype(str)).dt.day
        df_e["semaine"]      = pd.to_datetime(df_e["date_releve"].astype(str)).dt.isocalendar().week.astype(int)
        df_e["jour_semaine"] = pd.to_datetime(df_e["date_releve"].astype(str)).dt.dayofweek + 1
        dw_write(df_e[["date_releve","annee_mois","annee","mois_num",
                        "jour","semaine","jour_semaine",
                        "phase1_kwh","phase2_kwh","phase3_kwh"]], "dim_electricite", engine_dw)

    # ── dim_pv ────────────────────────────────────────────────────────────────
    df_p = stg(engine_stg, """
        SELECT date::TEXT AS date_jour,
               NULLIF(puissance_installee_kwp,'')::NUMERIC  AS puissance_installee_kwp,
               NULLIF(production_cumulee_kwh,'')::NUMERIC   AS production_cumulee_kwh
        FROM stg_energie_photovoltaique
        WHERE date IS NOT NULL
          AND NULLIF(production_journaliere_kwh,'')::NUMERIC > 0
        ORDER BY date
    """)
    if not df_p.empty:
        df_p["date_jour"]    = pd.to_datetime(df_p["date_jour"]).dt.strftime("%Y-%m-%d")
        df_p["annee"]        = pd.to_datetime(df_p["date_jour"]).dt.year
        df_p["mois_num"]     = pd.to_datetime(df_p["date_jour"]).dt.month
        df_p["annee_mois"]   = pd.to_datetime(df_p["date_jour"]).dt.strftime("%Y-%m")
        df_p["jour"]         = pd.to_datetime(df_p["date_jour"]).dt.day
        df_p["semaine"]      = pd.to_datetime(df_p["date_jour"]).dt.isocalendar().week.astype(int)
        df_p["jour_semaine"] = pd.to_datetime(df_p["date_jour"]).dt.dayofweek + 1
        # Dédoublonner sur date_jour (garder la ligne avec puissance la plus grande)
        df_p = df_p.sort_values("puissance_installee_kwp", ascending=False)
        df_p = df_p.drop_duplicates(subset=["date_jour"], keep="first")
        dw_write(df_p[["date_jour","annee_mois","annee","mois_num",
                        "jour","semaine","jour_semaine",
                        "puissance_installee_kwp","production_cumulee_kwh"]], "dim_pv", engine_dw)

    # ── dim_eau ───────────────────────────────────────────────────────────────
    df_w = stg(engine_stg, """
        SELECT DISTINCT date_releve::TEXT AS date_releve
        FROM stg_energie_eau
        WHERE date_releve IS NOT NULL
        ORDER BY date_releve
    """)
    if not df_w.empty:
        df_w["date_releve"]  = pd.to_datetime(df_w["date_releve"]).dt.date
        df_w["annee"]        = pd.to_datetime(df_w["date_releve"].astype(str)).dt.year
        df_w["mois_num"]     = pd.to_datetime(df_w["date_releve"].astype(str)).dt.month
        df_w["annee_mois"]   = pd.to_datetime(df_w["date_releve"].astype(str)).dt.strftime("%Y-%m")
        df_w["jour"]         = pd.to_datetime(df_w["date_releve"].astype(str)).dt.day
        df_w["semaine"]      = pd.to_datetime(df_w["date_releve"].astype(str)).dt.isocalendar().week.astype(int)
        df_w["jour_semaine"] = pd.to_datetime(df_w["date_releve"].astype(str)).dt.dayofweek + 1
        dw_write(df_w[["date_releve","annee_mois","annee","mois_num",
                        "jour","semaine","jour_semaine"]], "dim_eau", engine_dw)

def load_fact_ot_global(engine_stg, engine_dw):
    df_ot = stg(engine_stg, """
        SELECT r.annee::SMALLINT AS annee, r.mois_num::SMALLINT AS mois_num,
               ROUND(r.nb_ot_total::NUMERIC)::INTEGER  AS nb_ot_total,
               ROUND(r.nb_curatif::NUMERIC)::INTEGER   AS nb_ot_curatif,
               ROUND(r.nb_preventif::NUMERIC)::INTEGER AS nb_ot_preventif,
               r.ratio_preventif_pct::NUMERIC          AS ratio_preventif_pct
        FROM stg_ratio_intervention r
        WHERE r.nb_ot_total IS NOT NULL AND r.nb_ot_total != ''
    """)
    df_sit = stg(engine_stg, f"""
        SELECT s.annee::SMALLINT AS annee,
               {MOIS_SQL.format(col='s.mois')} AS mois_num,
               SUM(COALESCE(ROUND(NULLIF(s.ot_lance_prev,'')::NUMERIC)::INT,0) +
                   COALESCE(ROUND(NULLIF(s.ot_lance_cura,'')::NUMERIC)::INT,0)) AS lances,
               SUM(COALESCE(ROUND(NULLIF(s.ot_honore_prev,'')::NUMERIC)::INT,0) +
                   COALESCE(ROUND(NULLIF(s.ot_honore_cura,'')::NUMERIC)::INT,0)) AS honores
        FROM stg_situation_mensuelle s WHERE UPPER(s.entite)='SG'
        GROUP BY s.annee, s.mois
    """)
    if df_ot.empty:
        return
    df_ot["annee_mois"] = df_ot.apply(
        lambda r: f"{int(r.annee):04d}-{int(r.mois_num):02d}", axis=1)
    if not df_sit.empty:
        df_sit = df_sit.dropna(subset=["mois_num"])
        df_sit["annee_mois"]  = df_sit.apply(
            lambda r: f"{int(r.annee):04d}-{int(r.mois_num):02d}", axis=1)
        df_sit["nb_ot_honore"]= df_sit["honores"]
        df_ot = df_ot.merge(df_sit[["annee_mois","nb_ot_honore"]], on="annee_mois", how="left")
        df_ot["taux_realisation_pct"] = df_ot.apply(
            lambda r: round(r.nb_ot_honore/r.nb_ot_total*100,2)
                      if pd.notna(r.nb_ot_honore) and r.nb_ot_total > 0
                      else None, axis=1)
    else:
        df_ot["nb_ot_honore"] = df_ot["taux_realisation_pct"] = None

    dt  = dw_read(engine_dw,
        "SELECT temps_id, annee_mois FROM dim_temps WHERE annee_mois IS NOT NULL")
    dt_u = dt.drop_duplicates(subset=["annee_mois"])
    df_ot = df_ot.merge(dt_u, on="annee_mois", how="inner")
    df_ot["nb_ot_autre"] = (df_ot["nb_ot_total"].fillna(0).astype(int)
                            - df_ot["nb_ot_curatif"].fillna(0).astype(int)
                            - df_ot["nb_ot_preventif"].fillna(0).astype(int)).clip(lower=0)
    dw_write(df_ot[["temps_id","nb_ot_total","nb_ot_curatif",
                    "nb_ot_preventif","nb_ot_autre","nb_ot_honore",
                    "taux_realisation_pct","ratio_preventif_pct"]], "fact_ot_global", engine_dw)


def load_fact_intervention(engine_stg, engine_dw):
    dt  = dw_read(engine_dw, "SELECT temps_id, annee_mois FROM dim_temps WHERE annee_mois IS NOT NULL")
    de  = dw_read(engine_dw, "SELECT employe_id, matricule FROM dim_employe")
    deq = dw_read(engine_dw, "SELECT equip_id, code_equipement FROM dim_equipement")
    di  = dw_read(engine_dw, "SELECT id_inter, numero_ot FROM dim_intervention")
    df  = stg(engine_stg, """
        SELECT numero_ot, matricule, code_equipement,
               type_intervention,
               annee_mois,
               COALESCE(hrs_travaux,0) AS duree_h
        FROM stg_clean_charges
        WHERE numero_ot IS NOT NULL AND matricule IS NOT NULL
          AND annee_mois IS NOT NULL
    """)
    if df.empty:
        return
    dt_u = dt.drop_duplicates(subset=["annee_mois"])
    # deq contient les 710 codes longs (EOT...) + 8 codes courts (ESD/ELECT...)
    # merge left → equip_id NULL si code pas dans dim_equipement
    df = df.merge(dt_u, on="annee_mois",     how="inner")
    df = df.merge(de,   on="matricule",       how="inner")
    df = df.merge(deq,  on="code_equipement", how="left")
    df = df.merge(di,   on="numero_ot",       how="left")
    df = df.rename(columns={"duree_h":"duree_intervention_h"})
    # zone depuis dim_equipement (inclus dans deq déjà chargé)
    deq_full = dw_read(engine_dw, "SELECT equip_id, zone_id FROM dim_equipement")
    df = df.merge(deq_full.rename(columns={"zone_id":"zone_eq","equip_id":"eid2"}),
                  left_on="equip_id", right_on="eid2", how="left")
    df["zone_id"] = df["zone_eq"]
    df = df.dropna(subset=["id_inter"]).drop_duplicates(subset=["id_inter"])
    dw_write(df[["temps_id","equip_id","employe_id","zone_id","id_inter",
                 "type_intervention","duree_intervention_h"]], "fact_intervention", engine_dw)


def load_fact_pdr(engine_stg, engine_dw):
    """
    fact_pdr : 1 ligne/mouvement PDR
    Clés : temps_id, prc_id (pas de zone_id ni equip_id - PDR pas lié à équipement spécifique)
    Mesures : quantite_sortie INTEGER, stock_final INTEGER, valeur_consommee_tnd
    """
    df = stg(engine_stg, """
        SELECT m.annee_mois, m.code_prc,
               SUM(CASE WHEN m.direction='sortie'
                   THEN ABS(COALESCE(m.qtypcu,0)) ELSE 0 END) AS qtite_sortie,
               MAX(COALESCE(m.aftsto,0))                       AS stock_final
        FROM stg_clean_prc_mouvements m
        WHERE m.annee_mois IS NOT NULL AND m.code_prc IS NOT NULL
          AND m.qtypcu IS NOT NULL
        GROUP BY m.annee_mois, m.code_prc
    """)
    if df.empty:
        return
    dt = dw_read(engine_dw, "SELECT temps_id, annee_mois FROM dim_temps WHERE annee_mois IS NOT NULL")
    dp = dw_read(engine_dw, "SELECT prc_id, code_prc, cout_unitaire_tnd FROM dim_prc")
    dt_u = dt.drop_duplicates(subset=["annee_mois"])
    df = df.merge(dt_u, on="annee_mois", how="inner")
    df = df.merge(dp,   on="code_prc",   how="inner")
    df["quantite_sortie"]      = df["qtite_sortie"].fillna(0).round(0).astype(int)
    df["stock_final"]          = df["stock_final"].fillna(0).round(0).astype(int)
    df["valeur_consommee_tnd"] = (df["quantite_sortie"] * df["cout_unitaire_tnd"].fillna(0)).round(3)
    dw_write(df[["temps_id","prc_id","quantite_sortie","stock_final","valeur_consommee_tnd"]],
             "fact_pdr", engine_dw)

def load_fact_arret(engine_stg, engine_dw):
    df_taux = stg(engine_stg, """
        SELECT td.code_ligne,
               td.annee_mois,
               td.t_ouverture AS t_ouverture,
               td.nb_arret    AS nb_arret
        FROM stg_clean_taux_dispo td
        WHERE td.code_ligne IS NOT NULL
          AND td.t_ouverture IS NOT NULL
          AND td.annee_mois  IS NOT NULL
    """)
    df_ttr = stg(engine_stg, """
        SELECT code_equipement,
               annee_mois,
               SUM(COALESCE(hrs_travaux,0)) AS sum_ttr_h,
               COUNT(*)                     AS nb_ot_curatif
        FROM stg_clean_charges
        WHERE date_debut IS NOT NULL
          AND annee_mois IS NOT NULL
          AND code_equipement IS NOT NULL
          AND type_intervention = 'CURA'
        GROUP BY code_equipement, annee_mois
    """)
    if df_taux.empty:
        return
    df_taux = df_taux.dropna(subset=["annee_mois","t_ouverture"])
    df = df_taux.merge(df_ttr,
                       left_on=["code_ligne","annee_mois"],
                       right_on=["code_equipement","annee_mois"],
                       how="left")
    df["sum_ttr_h"]    = df["sum_ttr_h"].fillna(0.0)
    df["nb_ot_curatif"]= df["nb_ot_curatif"].fillna(0).astype(int)
    df["nb_arret"]  = df["nb_arret"].fillna(0.0)
    df["nb_arrets"] = df["nb_arret"].round(0).astype(int)

    def calc(row):
        t   = float(row.t_ouverture or 0)
        nb  = float(row.nb_arret or 0)
        ttr = float(row.sum_ttr_h or 0)
        if nb <= 0:
            # Aucun arret ce mois : dispo = 100%, MTBF = t_ouverture, MTTR = 0
            return 0.0, round(t, 2), 100.0
        mttr = round(ttr / nb, 4)
        mtbf = round(max(t - ttr, 0) / nb, 4)
        dispo = round(mtbf / (mtbf + mttr) * 100, 2) if (mtbf + mttr) > 0 else 0.0
        return mttr, mtbf, dispo

    df[["mttr_h","mtbf_h","disponibilite_pct"]] = df.apply(
        lambda r: pd.Series(calc(r)), axis=1)

    dt = dw_read(engine_dw,
        "SELECT temps_id, annee_mois FROM dim_temps WHERE annee_mois IS NOT NULL")
    dl = dw_read(engine_dw,
        "SELECT ligne_id, code_ligne, zone_id, equip_id FROM dim_ligne")

    # Prendre 1 seul temps_id par annee_mois (le premier = entrée mensuelle)
    dt_u = dt.sort_values("temps_id").drop_duplicates(subset=["annee_mois"], keep="first")

    df = df.merge(dt_u, on="annee_mois", how="inner")
    df = df.merge(dl,   on="code_ligne",  how="inner")
    df = df.rename(columns={"t_ouverture":"duree_ouverture_h"})

    cols = ["temps_id","ligne_id","zone_id","equip_id",
            "duree_ouverture_h","nb_arrets","sum_ttr_h","nb_ot_curatif",
            "mttr_h","mtbf_h","disponibilite_pct"]
    df = df[cols].drop_duplicates(subset=["temps_id","ligne_id"])
    print(f"    → fact_arret: {len(df)} lignes avant insert")
    dw_write(df, "fact_arret", engine_dw)


def load_fact_energie(engine_stg, engine_dw):
    """
    fact_energie_elec : mesures conso_jour_kwh, cout_jour_tnd
    fact_energie_eau  : mesure conso_jour_m3 (cout GENERATED)
    fact_energie_pv   : mesures production_kwh, heures_equiv_h (valeur GENERATED)
    Jointure via dim_* sur la date (TEXT comparaison pour éviter type mismatch)
    temps_id optionnel (LEFT JOIN)
    """
    sg_id = int(dw_read(engine_dw,
        "SELECT zone_id FROM dim_zone WHERE code_zone='BAT'")["zone_id"].iloc[0])

    # dim_temps journalier (passe C) pour temps_id optionnel
    dt_day = dw_read(engine_dw, """
        SELECT temps_id,
               DATE(date_debut)::TEXT AS jour_str
        FROM dim_temps
        WHERE date_debut IS NOT NULL
    """).drop_duplicates(subset=["jour_str"])

    # ── fact_energie_elec ─────────────────────────────────────────────────────
    df_e = stg(engine_stg, """
        SELECT date_releve::TEXT AS date_releve,
               SUM(consommation_jour_kwh) AS conso_jour_kwh,
               SUM(cout_jour_tnd)         AS cout_jour_tnd
        FROM stg_energie_electricite
        WHERE date_releve IS NOT NULL
          AND consommation_jour_kwh IS NOT NULL
        GROUP BY date_releve ORDER BY date_releve
    """)
    if not df_e.empty:
        dee = dw_read(engine_dw, "SELECT elec_id, date_releve::TEXT AS date_releve FROM dim_electricite")
        df_e = df_e.merge(dee, on="date_releve", how="inner")
        df_e = df_e.merge(dt_day, left_on="date_releve", right_on="jour_str", how="left")
        df_e["zone_id"] = sg_id
        dw_write(df_e[["elec_id","temps_id","zone_id",
                        "conso_jour_kwh","cout_jour_tnd"]], "fact_energie_elec", engine_dw)

    # ── fact_energie_eau ──────────────────────────────────────────────────────
    df_w = stg(engine_stg, """
        SELECT date_releve::TEXT AS date_releve,
               SUM(consommation_jour_m3) AS conso_jour_m3
        FROM stg_energie_eau
        WHERE date_releve IS NOT NULL
          AND consommation_jour_m3 IS NOT NULL
        GROUP BY date_releve ORDER BY date_releve
    """)
    if not df_w.empty:
        dew = dw_read(engine_dw, "SELECT eau_id, date_releve::TEXT AS date_releve FROM dim_eau")
        df_w = df_w.merge(dew, on="date_releve", how="inner")
        df_w = df_w.merge(dt_day, left_on="date_releve", right_on="jour_str", how="left")
        df_w["zone_id"] = sg_id
        dw_write(df_w[["eau_id","temps_id","zone_id","conso_jour_m3"]],
                 "fact_energie_eau", engine_dw)

    # ── fact_energie_pv ───────────────────────────────────────────────────────
    df_p = stg(engine_stg, """
        SELECT date::TEXT AS date_jour,
               NULLIF(production_journaliere_kwh,'')::NUMERIC AS production_kwh,
               NULLIF(heures_equivalentes_h,'')::NUMERIC      AS heures_equiv_h
        FROM stg_energie_photovoltaique
        WHERE date IS NOT NULL
          AND NULLIF(production_journaliere_kwh,'') IS NOT NULL
          AND NULLIF(production_journaliere_kwh,'')::NUMERIC > 0
        ORDER BY date
    """)
    if not df_p.empty:
        dpv = dw_read(engine_dw, "SELECT pv_id, date_jour::TEXT AS date_jour FROM dim_pv")
        df_p = df_p.merge(dpv, on="date_jour", how="inner")
        df_p = df_p.merge(dt_day, left_on="date_jour", right_on="jour_str", how="left")
        df_p["zone_id"] = sg_id
        dw_write(df_p[["pv_id","temps_id","zone_id",
                        "production_kwh","heures_equiv_h"]], "fact_energie_pv", engine_dw)

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 65)
    print("  LOAD DW — Eleonetech  (architecture 7 faits)")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    engine_stg = get_engine(DB_STAGING)
    engine_dw  = get_engine(DB_DW)
    for eng, name in [(engine_stg, DB_STAGING), (engine_dw, DB_DW)]:
        try:
            with eng.connect() as c:
                c.execute(text("SELECT 1"))
            print(f"  ✓  Connexion {name}")
        except Exception as e:
            print(f"  ✗  {name}: {e}"); return

    print("\n  ── DDL ─────────────────────────────────────────────")
    run_sql(engine_dw, DW_DROP, "DROP")
    _, err = run_sql(engine_dw, DW_DDL, "DDL")
    print(f"  DDL : {'✓' if err==0 else f'⚠ {err} erreurs'}")
    run_sql(engine_dw, DW_SEED, "SEED")
    print("  Zones : ✓")

    print("\n  ── DIMENSIONS ──────────────────────────────────────")
    print("  [1] dim_employe");        load_dim_employe(engine_stg, engine_dw)
    print("  [2] dim_equipement");     load_dim_equipement(engine_stg, engine_dw)
    print("  [3] dim_prc");            load_dim_prc(engine_stg, engine_dw)
    print("  [4] dim_intervention");   load_dim_intervention(engine_stg, engine_dw)
    print("  [5] dim_temps");          load_dim_temps(engine_stg, engine_dw)
    print("  [6] dim_ligne");          load_dim_ligne(engine_stg, engine_dw)
    print("  [7] dim_electricite / dim_pv / dim_eau")
    load_dim_energie(engine_stg, engine_dw)

    print("\n  ── FAITS ───────────────────────────────────────────")
    print("  [8]  fact_ot_global");          load_fact_ot_global(engine_stg, engine_dw)
    print("  [9]  fact_intervention");       load_fact_intervention(engine_stg, engine_dw)
    print("  [10] fact_pdr");                load_fact_pdr(engine_stg, engine_dw)
    print("  [11] fact_arret");              load_fact_arret(engine_stg, engine_dw)
    print("  [12] fact_energie_elec/eau/pv");load_fact_energie(engine_stg, engine_dw)

    print("\n  ── VUES ────────────────────────────────────────────")
    _, err_v = run_sql(engine_dw, DW_VIEWS, "VIEWS")
    print(f"  Vues : {'✓' if err_v==0 else f'⚠ {err_v} erreurs'}")

    # Vérification finale
    print("\n" + "=" * 65)
    print("  VÉRIFICATION FINALE")
    print("=" * 65)
    tables = [
        "dim_temps","dim_zone","dim_equipement","dim_ligne",
        "dim_prc","dim_employe","dim_intervention",
        "dim_electricite","dim_pv","dim_eau",
        "fact_ot_global","fact_intervention","fact_pdr","fact_arret",
        "fact_energie_elec","fact_energie_eau","fact_energie_pv",
    ]
    with engine_dw.connect() as c:
        for t in tables:
            try:
                n = c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                print(f"  {'✓' if n>0 else '⚠'}  {t:<40} {n:>6}")
            except Exception as ex:
                print(f"  ✗  {t}: {str(ex)[:50]}")

        # Vérification intégrité référentielle
        print("\n  Intégrité référentielle :")
        checks = [
            ("fact_intervention","equip_id","dim_equipement","equip_id"),
            ("fact_intervention","employe_id","dim_employe","employe_id"),
            ("fact_intervention","temps_id","dim_temps","temps_id"),
            ("fact_arret","temps_id","dim_temps","temps_id"),
            ("fact_arret","ligne_id","dim_ligne","ligne_id"),
            ("fact_energie_elec","elec_id","dim_electricite","elec_id"),
            ("fact_energie_eau","eau_id","dim_eau","eau_id"),
            ("fact_energie_pv","pv_id","dim_pv","pv_id"),
        ]
        for fact, fk, dim, pk in checks:
            try:
                n = c.execute(text(f"""
                    SELECT COUNT(*) FROM {fact} f
                    WHERE f.{fk} IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM {dim} d WHERE d.{pk} = f.{fk})
                """)).scalar()
                icon = "✓" if n == 0 else "✗"
                print(f"  {icon}  {fact}.{fk} → {dim} : {n} orphelins")
            except Exception as ex:
                print(f"  ?  {fact}.{fk}: {str(ex)[:50]}")

    print(f"\n  Terminé : {datetime.now().strftime('%H:%M:%S')}")


if __name__ == "__main__":
    main()