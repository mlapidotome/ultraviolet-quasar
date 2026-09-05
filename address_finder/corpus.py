"""
address_finder.corpus

Loads, validates, and indexes the municipal cadastral corpus (acervo_casas_taubate.json).
MANDATORY PRIVACY/SAFETY RULE:
Contribuinte / owner identity is strictly excluded from all parcel objects and index structures.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from address_finder.normalization import (
    normalize_bairro_name,
    normalize_street_name,
    parse_bc,
    parse_raw_address,
)


@dataclass(frozen=True)
class NormalizedParcel:
    """
    Cadastral parcel containing only physical and spatial coordinates.
    Notice: No owner/contribuinte identity is present in this data structure.
    """
    bc: str
    d: int
    s: int
    qqq: int
    lll: int
    sss: int
    ds: str
    dsq: str
    dsqlll: str
    endereco: str
    normalized_street: str
    house_number: Optional[int]
    category: str
    bairro: str
    normalized_bairro: str
    tipo_imovel: str
    loteamento: str
    complemento: str
    area_terreno_m2: float
    area_construida_m2: float
    valor_venal_total_rs: float


@dataclass
class Corpus:
    """
    In-memory indexed collection of normalized parcels from the frozen cadastral file.
    """
    source_path: Path
    corpus_sha256: str
    parcels: List[NormalizedParcel]
    by_dsq: Dict[str, List[NormalizedParcel]] = field(default_factory=dict)
    by_dsqlll: Dict[str, List[NormalizedParcel]] = field(default_factory=dict)
    by_street: Dict[str, List[NormalizedParcel]] = field(default_factory=dict)
    by_bairro: Dict[str, List[NormalizedParcel]] = field(default_factory=dict)
    bairro_to_dsqs: Dict[str, Set[str]] = field(default_factory=lambda: defaultdict(set))
    street_to_dsqs: Dict[str, Set[str]] = field(default_factory=lambda: defaultdict(set))

    def get_parcels_in_dsq(self, dsq: str) -> List[NormalizedParcel]:
        return self.by_dsq.get(dsq, [])

    def get_candidate_dsqs_for_bairro(self, norm_bairro: str) -> Set[str]:
        if not norm_bairro:
            return set()
        matched = set()
        for b_key, dsq_set in self.bairro_to_dsqs.items():
            if norm_bairro in b_key or b_key in norm_bairro:
                matched.update(dsq_set)
        return matched

    def get_candidate_dsqs_for_street(self, norm_street: str) -> Set[str]:
        if not norm_street:
            return set()
        matched = set()
        for s_key, dsq_set in self.street_to_dsqs.items():
            if norm_street == s_key or norm_street in s_key or s_key in norm_street:
                matched.update(dsq_set)
        return matched


def compute_sha256(filepath: Path | str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def load_corpus(corpus_path: Path | str) -> Corpus:
    """
    Load raw cadastral corpus from JSON, validate mandatory fields,
    strip private contribuinte / owner identity, and build lookup indexes.
    """
    p = Path(corpus_path).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"Corpus file not found: {p}")

    digest = compute_sha256(p)
    with p.open("r", encoding="utf-8") as f:
        raw_records = json.load(f)

    if not isinstance(raw_records, list):
        raise ValueError(f"Expected list of records in corpus file: {p}")

    parcels: List[NormalizedParcel] = []
    by_dsq: Dict[str, List[NormalizedParcel]] = defaultdict(list)
    by_dsqlll: Dict[str, List[NormalizedParcel]] = defaultdict(list)
    by_street: Dict[str, List[NormalizedParcel]] = defaultdict(list)
    by_bairro: Dict[str, List[NormalizedParcel]] = defaultdict(list)
    bairro_to_dsqs: Dict[str, Set[str]] = defaultdict(set)
    street_to_dsqs: Dict[str, Set[str]] = defaultdict(set)

    for idx, r in enumerate(raw_records):
        raw_bc = r.get("bc")
        if not raw_bc:
            continue
        try:
            bc_info = parse_bc(raw_bc)
        except ValueError:
            continue

        raw_endereco = r.get("endereco", "")
        addr_info = parse_raw_address(raw_endereco)

        raw_bairro = r.get("bairro", "")
        norm_bairro = normalize_bairro_name(raw_bairro)

        # STRICT PRIVACY: Ignore 'contribuinte' completely
        parcel = NormalizedParcel(
            bc=bc_info["bc_canonical"],
            d=bc_info["d"],
            s=bc_info["s"],
            qqq=bc_info["qqq"],
            lll=bc_info["lll"],
            sss=bc_info["sss"],
            ds=bc_info["ds"],
            dsq=bc_info["dsq"],
            dsqlll=bc_info["dsqlll"],
            endereco=raw_endereco,
            normalized_street=addr_info["street_norm"],
            house_number=addr_info["house_number"],
            category=addr_info["category"],
            bairro=raw_bairro,
            normalized_bairro=norm_bairro,
            tipo_imovel=r.get("tipo_imovel", ""),
            loteamento=r.get("loteamento", ""),
            complemento=r.get("complemento", ""),
            area_terreno_m2=float(r.get("area_terreno_m2") or 0.0),
            area_construida_m2=float(r.get("area_construida_m2") or 0.0),
            valor_venal_total_rs=float(r.get("valor_venal_total_rs") or 0.0),
        )

        parcels.append(parcel)
        by_dsq[parcel.dsq].append(parcel)
        by_dsqlll[parcel.dsqlll].append(parcel)

        if parcel.normalized_street:
            by_street[parcel.normalized_street].append(parcel)
            street_to_dsqs[parcel.normalized_street].add(parcel.dsq)

        if parcel.normalized_bairro:
            by_bairro[parcel.normalized_bairro].append(parcel)
            bairro_to_dsqs[parcel.normalized_bairro].add(parcel.dsq)

    return Corpus(
        source_path=p,
        corpus_sha256=digest,
        parcels=parcels,
        by_dsq=dict(by_dsq),
        by_dsqlll=dict(by_dsqlll),
        by_street=dict(by_street),
        by_bairro=dict(by_bairro),
        bairro_to_dsqs=dict(bairro_to_dsqs),
        street_to_dsqs=dict(street_to_dsqs),
    )
