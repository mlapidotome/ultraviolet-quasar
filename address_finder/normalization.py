"""
address_finder.normalization

Normalization, parsing, and extraction utilities for streets, addresses, bairros, and cadastral BCs.
Extracts only production-visible public listing clues.
Includes:
- Robust Chaves na Mão listing URL parsing (/id-<number>/) and original canonical URL preservation
- Condominium property detection & exclusion
- Target-listing-owned exact-address leakage classification (ignores whole-page ads/related cards)
"""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
from typing import Any, Dict, List, Optional, Set, Tuple


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

    if len(parts) >= 2:
        m_num = re.search(r"\b(\d+)\b", parts[1])
        if m_num and int(m_num.group(1)) > 0:
            return {
                "category": "STREET_WITH_HOUSE_NUMBER",
                "street_raw": parts[0],
                "street_norm": normalize_street_name(parts[0]),
                "house_number": int(m_num.group(1)),
            }

    if any(s.upper().startswith(p) for p in ["RUA ", "AVENIDA ", "ALAMEDA ", "TRAVESSA ", "PRACA ", "ESTRADA ", "RODOVIA "]):
        return {
            "category": "STREET_WITHOUT_HOUSE_NUMBER",
            "street_raw": s,
            "street_norm": normalize_street_name(s),
            "house_number": None,
        }

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
# Chaves na Mão URL Extraction & Canonical Normalization
# ---------------------------------------------------------------------------
_CNM_ID_URL_RE = re.compile(
    r"/imovel/(?:[A-Za-z0-9\-_]+/)?id-([0-9]+)/?",
    re.IGNORECASE,
)
_CNM_LEGACY_URL_RE = re.compile(
    r"/imovel/([0-9]+)/?",
    re.IGNORECASE,
)


def parse_cnm_listing_url(
    url_or_href: str,
    base_url: str = "https://www.chavesnamao.com.br",
) -> Optional[Tuple[str, str]]:
    """
    Extract (listing_id, normalized_canonical_url) from a Chaves na Mão listing link.
    Handles current format:
        https://www.chavesnamao.com.br/imovel/casa-a-venda-taubate/id-45635914/
    and relative hrefs:
        /imovel/casa-a-venda-taubate/id-45635914/
    Returns None if href is not a listing page.
    Preserves the original discovered path/slug in canonical URL.
    """
    if not url_or_href or not isinstance(url_or_href, str):
        return None

    # Strip query parameters and fragment
    clean_href = url_or_href.strip().split("?")[0].split("#")[0]

    # Try current /id-<number>/ format
    m = _CNM_ID_URL_RE.search(clean_href)
    if m:
        listing_id = m.group(1)
    else:
        # Fallback to legacy numeric ID
        m_leg = _CNM_LEGACY_URL_RE.search(clean_href)
        if m_leg:
            listing_id = m_leg.group(1)
        else:
            return None

    # Build canonical absolute URL
    if clean_href.startswith("http://") or clean_href.startswith("https://"):
        full_url = clean_href
    else:
        full_url = urllib.parse.urljoin(base_url, clean_href)

    # Ensure trailing slash
    if not full_url.endswith("/"):
        full_url += "/"

    return listing_id, full_url


def extract_cnm_search_listings(
    html: str,
    base_url: str = "https://www.chavesnamao.com.br",
) -> List[Tuple[str, str]]:
    """
    Extract and deduplicate all listing links from a Chaves na Mão search results page.
    Returns list of (listing_id, canonical_url) in order of appearance.
    """
    results: List[Tuple[str, str]] = []
    seen_ids: Set[str] = set()

    # Search for all hrefs matching /imovel/
    pattern = re.compile(r'href=["\'](/imovel/[^"\'\s]+|https?://(?:www\.)?chavesnamao\.com\.br/imovel/[^"\'\s]+)["\']', re.IGNORECASE)
    for m in pattern.finditer(html):
        href = m.group(1)
        parsed = parse_cnm_listing_url(href, base_url)
        if parsed:
            lid, can_url = parsed
            if lid not in seen_ids:
                seen_ids.add(lid)
                results.append((lid, can_url))

    return results


# ---------------------------------------------------------------------------
# Condominium Property Detection
# ---------------------------------------------------------------------------
_CONDO_KEYWORDS = [
    r"em\s+condom[ií]nio",
    r"condom[ií]nio\s+fechado",
    r"casa\s+em\s+condom[ií]nio",
    r"sobrado\s+em\s+condom[ií]nio",
    r"condom[ií]nio\s+residencial",
    r"casa\s*/\s*sobrado\s+em\s+condom[ií]nio",
]
_CONDO_RE = re.compile(r"|".join(_CONDO_KEYWORDS), re.IGNORECASE)


def is_condominium_listing(text_or_html: str) -> Tuple[bool, Optional[str]]:
    """
    Check if property text or HTML explicitly identifies it as a condominium.
    Main pilot cohort is OPEN-STREET houses/sobrados only.
    Restricts check to target listing fields, ignoring footer navigation and recommendation carousels.
    Returns (is_condo: bool, reason: str | None).
    """
    if not text_or_html:
        return False, None

    # If full HTML is provided, extract target-owned fields
    if "<html" in text_or_html.lower() or "<title" in text_or_html.lower():
        m_title = re.search(r"<title[^>]*>(.*?)</title>", text_or_html, re.IGNORECASE | re.DOTALL)
        m_h1 = re.search(r"<h1[^>]*>(.*?)</h1>", text_or_html, re.IGNORECASE | re.DOTALL)
        m_desc = re.search(r'<meta\s+name=[\'"]description[\'"]\s+content=[\'"](.*?)[\'"]', text_or_html, re.IGNORECASE | re.DOTALL)
        m_body_desc = re.search(r'<div[^>]+class=[\'"][^\'"]*(?:descricao|description)[^\'"]*[\'"][^>]*>(.*?)</div>', text_or_html, re.IGNORECASE | re.DOTALL)

        target_parts = [
            m_title.group(1) if m_title else "",
            m_h1.group(1) if m_h1 else "",
            m_desc.group(1) if m_desc else "",
            m_body_desc.group(1) if m_body_desc else "",
        ]
        eval_text = " ".join(target_parts)
    else:
        eval_text = text_or_html

    m = _CONDO_RE.search(eval_text)
    if m:
        return True, "CONDOMINIUM_EXCLUDED_MAIN_COHORT"
    return False, None


# ---------------------------------------------------------------------------
# Direct Exact Address Leakage Classification (Target Fields Only)
# ---------------------------------------------------------------------------
_STREET_TYPES_REGEX = r"(?:rua|avenida|av\.|alameda|travessa|estrada|rodovia|rod\.|pra[çc]a)"
_EXACT_ADDRESS_LEAK_RE = re.compile(
    rf"\b{_STREET_TYPES_REGEX}\s+[A-Za-z0-9\xc0-\xff\s\.\-]{{2,60}}[,\s]+(?:n[°º]?|n[ºo]\.?|n[uú]mero\s*)?(\d{{1,5}})\b",
    re.IGNORECASE,
)


def classify_direct_address_leakage(text: str) -> Tuple[bool, List[str]]:
    """
    Classify whether raw text contains an exact physical address leak (Street + door number).
    - CEP alone: NOT a leak.
    - Street alone: NOT a leak.
    - Street + door number: LEAK.
    """
    if not text:
        return False, []

    evidence: List[str] = []
    for m in _EXACT_ADDRESS_LEAK_RE.finditer(text):
        num_str = m.group(1)
        if num_str and 0 < int(num_str) < 99999:
            evidence.append(m.group(0).strip())

    return len(evidence) > 0, evidence


def classify_target_listing_leakage(html: str) -> Tuple[bool, List[Dict[str, Any]]]:
    """
    Classify direct exact address leakage on TARGET-LISTING-owned fields only.
    Does NOT inspect whole page ads, unrelated recommendation cards, or footer agency info.

    Target-owned fields checked:
    - Target <title>
    - Target <meta name="description"> or og:description
    - Target <h1> tag
    - Target schema.org address (streetAddress, addressLocality)
    - Target main property details container (e.g. .property-info, .specs, .main-content)

    Returns: (is_leak: bool, evidence_list: list[dict])
    Each evidence entry contains:
      leak_field: str
      leak_evidence: str
      leak_field_owner: "TARGET_LISTING"
    """
    if not html:
        return False, []

    # Strip unrelated sections (recommendations, footer ads, other listings)
    clean_target_html = re.sub(
        r'<div[^>]+class=["\'][^"\']*(?:recomendad|outros-imoveis|relacionad|veja-tambem|footer|anuncio|publicidade)[^"\']*["\'][^>]*>.*?</div>',
        "",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )

    evidence_records: List[Dict[str, Any]] = []

    # 1. Target Title
    m_title = re.search(r"<title[^>]*>(.*?)</title>", clean_target_html, re.IGNORECASE | re.DOTALL)
    if m_title:
        title_text = m_title.group(1)
        is_l, evs = classify_direct_address_leakage(title_text)
        for ev in evs:
            evidence_records.append({
                "leak_field": "title",
                "leak_evidence": ev,
                "leak_field_owner": "TARGET_LISTING",
            })

    # 2. Target Meta Description
    m_desc = re.search(
        r'<meta\s+(?:name|property)=["\'](?:description|og:description)["\']\s+content=["\'](.*?)["\']',
        clean_target_html,
        re.IGNORECASE | re.DOTALL,
    )
    if m_desc:
        desc_text = m_desc.group(1)
        is_l, evs = classify_direct_address_leakage(desc_text)
        for ev in evs:
            evidence_records.append({
                "leak_field": "meta_description",
                "leak_evidence": ev,
                "leak_field_owner": "TARGET_LISTING",
            })

    # 3. Target H1
    m_h1 = re.search(r"<h1[^>]*>(.*?)</h1>", clean_target_html, re.IGNORECASE | re.DOTALL)
    if m_h1:
        h1_text = re.sub(r"<[^>]+>", "", m_h1.group(1))
        is_l, evs = classify_direct_address_leakage(h1_text)
        for ev in evs:
            evidence_records.append({
                "leak_field": "h1",
                "leak_evidence": ev,
                "leak_field_owner": "TARGET_LISTING",
            })

    # 4. Target Schema.org streetAddress
    m_st_prop = re.search(r'itemprop=["\']streetAddress["\'][^>]*>(.*?)<', clean_target_html, re.IGNORECASE)
    if m_st_prop:
        st_val = m_st_prop.group(1)
        is_l, evs = classify_direct_address_leakage(st_val)
        for ev in evs:
            evidence_records.append({
                "leak_field": "schema_org_streetAddress",
                "leak_evidence": ev,
                "leak_field_owner": "TARGET_LISTING",
            })

    # 5. Target Location Block (if explicitly labeled Endereço / Localização)
    for m_loc in re.finditer(r"(?:endere[çc]o|localiza[çc][ãa]o)[:\s]+([^<\n]{5,100})", clean_target_html, re.IGNORECASE):
        loc_text = m_loc.group(1)
        is_l, evs = classify_direct_address_leakage(loc_text)
        for ev in evs:
            evidence_records.append({
                "leak_field": "location_field",
                "leak_evidence": ev,
                "leak_field_owner": "TARGET_LISTING",
            })

    is_leak = len(evidence_records) > 0
    return is_leak, evidence_records


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
    m_street_prop = re.search(
        r'itemprop=["\']streetAddress["\'][^>]*>(.*?)<', html, re.IGNORECASE
    )
    if m_street_prop:
        s_val = re.sub(r"<[^>]+>", "", m_street_prop.group(1)).strip()
        clues.append({"type": "street", "value": s_val, "source": "schema_org_streetAddress"})
    else:
        m_st = _STREET_EXTRACT_RE.search(html)
        if m_st:
            s_val = m_st.group(1).strip()
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
        if 0 < door_num < 99999:
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
        break

    return clues
