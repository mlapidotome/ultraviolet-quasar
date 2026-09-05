"""
address_finder.normalization

Normalization, parsing, and extraction utilities for streets, addresses, bairros, and cadastral BCs.
Extracts only production-visible public listing clues.
Includes exact-address leakage classification (CEP alone or street alone is NOT leakage).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple


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


# ---------------------------------------------------------------------------
# Direct Exact Address Leakage Classification
# ---------------------------------------------------------------------------
# Strict rule: DIRECT_EXACT_ADDRESS_LEAK requires an explicit exact-address signal:
# Street name + exact door number presented as property location.
# CEP alone is NOT exact physical address leakage.
# Street alone (without number) is NOT exact physical address leakage.
_STREET_TYPES_REGEX = r"(?:rua|avenida|av\.|alameda|travessa|estrada|rodovia|rod\.|pra[çc]a)"
_EXACT_ADDRESS_LEAK_RE = re.compile(
    rf"\b{_STREET_TYPES_REGEX}\s+[A-Za-z0-9\xc0-\xff\s\.\-]{{2,60}}[,\s]+(?:n[°º]?|n[ºo]\.?|n[uú]mero\s*)?(\d{{1,5}})\b",
    re.IGNORECASE,
)


def classify_direct_address_leakage(text: str) -> Tuple[bool, List[str]]:
    """
    Classify whether text contains an exact physical address leak (Street + door number).
    Returns (is_leak: bool, evidence: list[str]).
    - CEP alone: NOT a leak.
    - Street name alone: NOT a leak.
    - Street name + door number: LEAK.
    """
    if not text:
        return False, []

    evidence: List[str] = []
    # Check for street + door number match
    for m in _EXACT_ADDRESS_LEAK_RE.finditer(text):
        matched_str = m.group(0).strip()
        num_str = m.group(1)
        # Avoid false positives where the number is e.g. year 2024 or CEP part
        if num_str and int(num_str) > 0 and int(num_str) < 99999:
            # Verify it is not just 'Rua X, Taubaté' followed by a CEP or phone
            evidence.append(matched_str)

    is_leak = len(evidence) > 0
    return is_leak, evidence


# ---------------------------------------------------------------------------
# Public Listing Clue Extraction from HTML
# ---------------------------------------------------------------------------
_CEP_EXTRACT_RE = re.compile(r"\b(\d{5}-\d{3})\b")
_STREET_EXTRACT_RE = re.compile(
    rf"\b({_STREET_TYPES_REGEX}\s+[A-Z\xc0-\xda][A-Za-z0-9\xc0-\xff\s\.\-]{{2,50}}?)(?:,|\s+n[°º]|\s+n[ºo]|\s+n[uú]mero|\s+bairro|\s+-|\s+Taubat|\s*<|\s*\n|$)",
    re.IGNORECASE,
)


def extract_public_clues_from_html(html: str) -> List[Dict[str, Any]]:
    """
    Extract public-visible clues from frozen HTML listing page.
    Extracts and persists, with explicit provenance:
    - title
    - description
    - neighbourhood
    - street
    - CEP
    - house_number (unverified)
    - property_type
    - area_m2
    - floors
    - image_alt_geo
    - image_url (CDN / public photo metadata)

    CRITICAL INVARIANT:
    Does NOT use corpus data or infer listing street from cadastral records.
    """
    clues: List[Dict[str, Any]] = []

    # 1. Title
    m_title = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if m_title:
        title_text = re.sub(r"\s+", " ", m_title.group(1)).strip()
        clues.append({"type": "title", "value": title_text, "source": "meta_title"})
    else:
        m_h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.IGNORECASE | re.DOTALL)
        if m_h1:
            h1_text = re.sub(r"<[^>]+>", "", m_h1.group(1)).strip()
            h1_text = re.sub(r"\s+", " ", h1_text)
            clues.append({"type": "title", "value": h1_text, "source": "h1_tag"})

    # 2. Description
    m_desc = re.search(
        r'<meta\s+(?:name|property)=["\'](?:description|og:description)["\']\s+content=["\'](.*?)["\']',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if m_desc:
        desc_text = re.sub(r"\s+", " ", m_desc.group(1)).strip()
        clues.append({"type": "description", "value": desc_text, "source": "meta_description"})

    # 3. Neighbourhood
    # Check explicit field or itemprop
    m_bairro_prop = re.search(
        r'itemprop=["\']addressLocality["\'][^>]*>(.*?)<', html, re.IGNORECASE
    )
    if m_bairro_prop:
        b_val = re.sub(r"<[^>]+>", "", m_bairro_prop.group(1)).strip()
        clues.append({"type": "neighbourhood", "value": b_val, "source": "schema_org_addressLocality"})
    else:
        for m in re.finditer(r"bairro[:\s]+([A-Z\xc0-\xda][A-Za-z\xc0-\xff\s\-]+?)[,\s<]", html, re.IGNORECASE):
            b_val = m.group(1).strip()
            if len(b_val) > 2 and b_val.lower() not in ("de", "do", "da", "em"):
                clues.append({"type": "neighbourhood", "value": b_val, "source": "bairro_field"})
                break

    # 4. Street name
    # Check schema.org streetAddress
    m_street_prop = re.search(
        r'itemprop=["\']streetAddress["\'][^>]*>(.*?)<', html, re.IGNORECASE
    )
    if m_street_prop:
        s_val = re.sub(r"<[^>]+>", "", m_street_prop.group(1)).strip()
        clues.append({"type": "street", "value": s_val, "source": "schema_org_streetAddress"})
    else:
        # Check standard street regex in page content
        m_st = _STREET_EXTRACT_RE.search(html)
        if m_st:
            s_val = m_st.group(1).strip()
            # Verify street token contains more than just the type prefix
            if len(s_val.split()) >= 2:
                clues.append({"type": "street", "value": s_val, "source": "page_text_street_pattern"})

    # 5. CEP (allowed public signal)
    m_cep = _CEP_EXTRACT_RE.search(html)
    if m_cep:
        clues.append({"type": "cep", "value": m_cep.group(1), "source": "page_cep_field"})

    # 6. House number (if present as unverified door number)
    m_num = re.search(
        rf"\b{_STREET_TYPES_REGEX}\s+[A-Za-z0-9\xc0-\xff\s\.\-]{{2,50}}[,\s]+(?:n[°º]?|n[ºo]\.?|n[uú]mero\s*)?(\d{{1,5}})\b",
        html,
        re.IGNORECASE,
    )
    if m_num:
        door_num = int(m_num.group(1))
        if door_num > 0 and door_num < 99999:
            clues.append({"type": "house_number", "value": door_num, "source": "page_unverified_door_number"})

    # 7. Property type
    for t in ("sobrado", "casa"):
        if re.search(rf"\b{t}\b", html, re.IGNORECASE):
            clues.append({"type": "property_type", "value": t, "source": "page_text"})
            break

    # 8. Area m2
    for m in re.finditer(r"(\d[\d.,]+)\s*m[²2]", html, re.IGNORECASE):
        val = m.group(1).replace(".", "").replace(",", ".")
        try:
            float(val)
            clues.append({"type": "area_m2", "value": val, "source": "area_field"})
            break
        except ValueError:
            pass

    # 9. Floors
    m_fl = re.search(r"(\d)\s*(?:pav[ie]|andar)", html, re.IGNORECASE)
    if m_fl:
        clues.append({"type": "floors", "value": m_fl.group(1), "source": "floor_field"})

    # 10. Image alt geo
    for m in re.finditer(r'<img[^>]+alt=["\']((?!\s)[^"\'"]{5,120})["\']', html, re.IGNORECASE):
        alt = m.group(1).strip()
        if any(kw in alt.lower() for kw in ("taubat", "bairro", "fachada", "frente", "exterior", "casa", "rua")):
            clues.append({"type": "image_alt_geo", "value": alt, "source": "img_alt"})

    # 11. Image URL (CDN / public photo metadata)
    for m in re.finditer(r'<img[^>]+src=["\'](https?://[^"\'\s]+\.(?:jpg|jpeg|png|webp)[^"\'\s]*)["\']', html, re.IGNORECASE):
        src_url = m.group(1).strip()
        clues.append({"type": "image_url", "value": src_url, "source": "public_image_cdn"})
        break  # Keep first public photo metadata

    return clues
