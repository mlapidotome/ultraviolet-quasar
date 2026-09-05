"""
address_finder.normalization

Normalization and parsing utilities for streets, addresses, bairros, and cadastral BCs.
Extracts only scientific, deterministic string normalization logic.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Optional


def strip_accents(text: str) -> str:
    """Strip diacritics and convert to ASCII uppercase."""
    if not text:
        return ""
    s = unicodedata.normalize("NFD", text.upper().strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s


def normalize_street_name(street_str: str) -> str:
    """
    Canonical street normalization as validated in Phase Map-Aware LLL pipeline.
    Replaces abbreviations, strips punctuation, removes stopwords and type prefixes,
    and returns a clean, lower-case token string.
    """
    if not street_str:
        return ""
    s = strip_accents(street_str)
    s = re.sub(r"[^A-Z0-9\s]", " ", s)
    tokens = s.split()

    abbr_map = {
        "R": "RUA", "R.": "RUA", "AV": "AVENIDA", "AV.": "AVENIDA",
        "AL": "ALAMEDA", "AL.": "ALAMEDA", "TV": "TRAVESSA", "TV.": "TRAVESSA",
        "PCA": "PRACA", "PCA.": "PRACA", "PC": "PRACA", "PC.": "PRACA",
        "EST": "ESTRADA", "EST.": "ESTRADA", "ROD": "RODOVIA", "ROD.": "RODOVIA",
        "DR": "DOUTOR", "DR.": "DOUTOR", "DRA": "DOUTORA", "DRA.": "DOUTORA",
        "PROF": "PROFESSOR", "PROF.": "PROFESSOR", "PROFA": "PROFESSORA", "PROFA.": "PROFESSORA",
        "CEL": "CORONEL", "CEL.": "CORONEL", "GEN": "GENERAL", "GEN.": "GENERAL",
        "MAJ": "MAJOR", "MAJ.": "MAJOR", "CAP": "CAPITAO", "CAP.": "CAPITAO",
        "TEN": "TENENTE", "TEN.": "TENENTE", "SGT": "SARGENTO", "SGT.": "SARGENTO",
        "ENG": "ENGENHEIRO", "ENG.": "ENGENHEIRO", "DEP": "DEPUTADO", "DEP.": "DEPUTADO",
        "VER": "VEREADOR", "VER.": "VEREADOR", "DES": "DESEMBARGADOR", "DES.": "DESEMBARGADOR",
        "STO": "SANTO", "STO.": "SANTO", "STA": "SANTA", "STA.": "SANTA",
        "S": "SAO", "S.": "SAO", "N": "NOSSA", "N.": "NOSSA", "SRA": "SENHORA", "SRA.": "SENHORA",
        "NS": "NOSSA SENHORA", "NS.": "NOSSA SENHORA", "N SRA": "NOSSA SENHORA"
    }

    expanded_tokens = []
    for t in tokens:
        if t in abbr_map:
            expanded_tokens.extend(abbr_map[t].split())
        else:
            expanded_tokens.append(t)

    stopwords = {"RUA", "AVENIDA", "ALAMEDA", "TRAVESSA", "PRACA", "ESTRADA", "RODOVIA",
                 "DE", "DA", "DO", "DOS", "DAS", "E"}
    clean_tokens = [t for t in expanded_tokens if t not in stopwords]
    return " ".join(clean_tokens).lower().strip()


def normalize_bairro_name(bairro_str: str) -> str:
    """
    Normalize neighbourhood names by stripping numeric code prefixes (e.g. '181 - JARDIM DAS NACOES'),
    stripping accents, removing punctuation, and returning lowercase string.
    """
    if not bairro_str:
        return ""
    s = strip_accents(bairro_str)
    # Strip leading code e.g. '181 - '
    s = re.sub(r"^\d+\s*-\s*", "", s)
    s = re.sub(r"[^A-Z0-9\s]", " ", s)
    tokens = s.split()
    stopwords = {"DE", "DA", "DO", "DOS", "DAS", "E"}
    clean = [t for t in tokens if t not in stopwords]
    return " ".join(clean).lower().strip()


def parse_raw_address(end_str: str) -> Dict[str, Any]:
    """
    Parse raw address field (such as in acervo_casas_taubate or public listing).
    Categorizes into STREET_WITH_HOUSE_NUMBER, STREET_WITHOUT_HOUSE_NUMBER,
    DOCUMENTARY_TEXT_VACANT_LOT, or EMPTY_ADDRESS.
    """
    if not end_str or not end_str.strip():
        return {
            "category": "EMPTY_ADDRESS",
            "street_raw": "",
            "street_norm": "",
            "house_number": None,
        }
    s = end_str.strip()
    parts = [p.strip() for p in s.split(",")]
    # Pattern: 'STREET, TYPE_ABBR, NUMBER' (standard municipal cadastral format)
    if len(parts) >= 2 and any(parts[1].upper() == t for t in ["R", "AV", "AL", "TV", "PCA", "EST", "ROD", "PC", "TR"]):
        street_raw = parts[0]
        num_str = parts[2] if len(parts) >= 3 else ""
        num_clean = re.sub(r"^[0]+", "", num_str).strip()
        house_num = int(num_clean) if num_clean.isdigit() and int(num_clean) > 0 else None
        cat = "STREET_WITH_HOUSE_NUMBER" if house_num is not None else "STREET_WITHOUT_HOUSE_NUMBER"
        return {
            "category": cat,
            "street_raw": street_raw,
            "street_norm": normalize_street_name(street_raw),
            "house_number": house_num,
        }

    # Alternative standard format: 'Rua Nome, 123'
    if len(parts) >= 2:
        m_num = re.search(r"\b(\d+)\b", parts[1])
        if m_num and int(m_num.group(1)) > 0:
            return {
                "category": "STREET_WITH_HOUSE_NUMBER",
                "street_raw": parts[0],
                "street_norm": normalize_street_name(parts[0]),
                "house_number": int(m_num.group(1)),
            }

    # Street without number
    if any(s.upper().startswith(p) for p in ["RUA ", "AVENIDA ", "ALAMEDA ", "TRAVESSA ", "PRACA ", "ESTRADA ", "RODOVIA "]):
        return {
            "category": "STREET_WITHOUT_HOUSE_NUMBER",
            "street_raw": s,
            "street_norm": normalize_street_name(s),
            "house_number": None,
        }

    # Descriptive / lot text
    return {
        "category": "DOCUMENTARY_TEXT_VACANT_LOT",
        "street_raw": s,
        "street_norm": "",
        "house_number": None,
    }


def parse_bc(bc_str: str) -> Dict[str, Any]:
    """
    Parse municipal boletim de cadastro (BC) formatted as D.S.QQQ.LLL.SSS.
    Returns parsed numerical components, DS prefix, DSQ, and DSQLLL canonical forms.
    """
    if not bc_str or not isinstance(bc_str, str):
        raise ValueError(f"Invalid BC string: {bc_str}")
    parts = bc_str.strip().split(".")
    if len(parts) != 5:
        raise ValueError(f"BC does not have 5 parts (expected D.S.QQQ.LLL.SSS): {bc_str}")
    try:
        d = int(parts[0])
        s = int(parts[1])
        qqq = int(parts[2])
        lll = int(parts[3])
        sss = int(parts[4])
    except ValueError as exc:
        raise ValueError(f"Non-integer component in BC {bc_str}") from exc

    return {
        "bc_canonical": f"{d}.{s}.{qqq:03d}.{lll:03d}.{sss:03d}",
        "d": d,
        "s": s,
        "qqq": qqq,
        "lll": lll,
        "sss": sss,
        "ds": f"{d}.{s}",
        "dsq": f"{d}.{s}.{qqq:03d}",
        "dsqlll": f"{d}.{s}.{qqq:03d}.{lll:03d}",
    }


def token_jaccard(s1: str, s2: str) -> float:
    """Compute token-level Jaccard similarity between two strings."""
    t1 = set(s1.split())
    t2 = set(s2.split())
    if not t1 or not t2:
        return 0.0
    return len(t1 & t2) / len(t1 | t2)
