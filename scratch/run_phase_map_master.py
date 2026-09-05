import os
import json
import hashlib
import re
import math
import random
from collections import defaultdict

OUT_DIR = 'facade-checker/data/address_finder_bc_anchors_v1'
os.makedirs(OUT_DIR, exist_ok=True)

def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def write_json_and_hash(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    sha = compute_sha256(filepath)
    with open(filepath + '.sha256', 'w', encoding='utf-8') as f:
        f.write(f"{sha}  {os.path.basename(filepath)}\n")
    return sha

print("=== Starting Phase Map-Aware LLL Block-Perimeter Validation Master Pipeline ===")

# ==========================================
# STEP 1: INGESTION, AUDIT & CANONICALIZATION
# ==========================================
print("\n--- Step 1: Ingestion & Audit ---")
raw_json_path = 'acervo_casas_taubate.json'
raw_excel_path = 'Acervo_Casas_Taubate_1000_Lotes.xlsx'

raw_json_sha = compute_sha256(raw_json_path)
raw_excel_sha = compute_sha256(raw_excel_path) if os.path.exists(raw_excel_path) else None

with open(raw_json_path, 'r', encoding='utf-8') as f:
    raw_records = json.load(f)

print(f"Total raw records: {len(raw_records)}")

# Street normalization helper
def normalize_street_name(street_str):
    if not street_str:
        return ""
    s = street_str.upper().strip()
    replacements = {
        'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
        'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
        'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
        'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
        'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
        'Ç': 'C', 'Ñ': 'N'
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    s = re.sub(r'[^A-Z0-9\s]', ' ', s)
    tokens = s.split()
    abbr_map = {
        'R': 'RUA', 'R.': 'RUA', 'AV': 'AVENIDA', 'AV.': 'AVENIDA',
        'AL': 'ALAMEDA', 'AL.': 'ALAMEDA', 'TV': 'TRAVESSA', 'TV.': 'TRAVESSA',
        'PCA': 'PRACA', 'PCA.': 'PRACA', 'PC': 'PRACA', 'PC.': 'PRACA',
        'EST': 'ESTRADA', 'EST.': 'ESTRADA', 'ROD': 'RODOVIA', 'ROD.': 'RODOVIA',
        'DR': 'DOUTOR', 'DR.': 'DOUTOR', 'DRA': 'DOUTORA', 'DRA.': 'DOUTORA',
        'PROF': 'PROFESSOR', 'PROF.': 'PROFESSOR', 'PROFA': 'PROFESSORA', 'PROFA.': 'PROFESSORA',
        'CEL': 'CORONEL', 'CEL.': 'CORONEL', 'GEN': 'GENERAL', 'GEN.': 'GENERAL',
        'MAJ': 'MAJOR', 'MAJ.': 'MAJOR', 'CAP': 'CAPITAO', 'CAP.': 'CAPITAO',
        'TEN': 'TENENTE', 'TEN.': 'TENENTE', 'SGT': 'SARGENTO', 'SGT.': 'SARGENTO',
        'ENG': 'ENGENHEIRO', 'ENG.': 'ENGENHEIRO', 'DEP': 'DEPUTADO', 'DEP.': 'DEPUTADO',
        'VER': 'VEREADOR', 'VER.': 'VEREADOR', 'DES': 'DESEMBARGADOR', 'DES.': 'DESEMBARGADOR',
        'STO': 'SANTO', 'STO.': 'SANTO', 'STA': 'SANTA', 'STA.': 'SANTA',
        'S': 'SAO', 'S.': 'SAO', 'N': 'NOSSA', 'N.': 'NOSSA', 'SRA': 'SENHORA', 'SRA.': 'SENHORA',
        'NS': 'NOSSA SENHORA', 'NS.': 'NOSSA SENHORA', 'N SRA': 'NOSSA SENHORA'
    }
    expanded_tokens = []
    for t in tokens:
        if t in abbr_map:
            expanded_tokens.extend(abbr_map[t].split())
        else:
            expanded_tokens.append(t)
    clean_tokens = [t for t in expanded_tokens if t not in ['RUA', 'AVENIDA', 'ALAMEDA', 'TRAVESSA', 'PRACA', 'ESTRADA', 'RODOVIA', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E']]
    return " ".join(clean_tokens).lower().strip()

def parse_raw_address(end_str):
    if not end_str or not end_str.strip():
        return {'category': 'EMPTY_ADDRESS', 'street_raw': '', 'street_norm': '', 'house_number': None}
    s = end_str.strip()
    parts = [p.strip() for p in s.split(',')]
    if len(parts) >= 2 and any(parts[1].upper() == t for t in ['R', 'AV', 'AL', 'TV', 'PCA', 'EST', 'ROD', 'PC', 'TR']):
        street_raw = parts[0]
        num_str = parts[2] if len(parts) >= 3 else ''
        num_clean = re.sub(r'^[0]+', '', num_str).strip()
        house_num = int(num_clean) if num_clean.isdigit() and int(num_clean) > 0 else None
        cat = 'STREET_WITH_HOUSE_NUMBER' if house_num is not None else 'STREET_WITHOUT_HOUSE_NUMBER'
        return {
            'category': cat,
            'street_raw': street_raw,
            'street_norm': normalize_street_name(street_raw),
            'house_number': house_num
        }
    if any(s.upper().startswith(p) for p in ['RUA ', 'AVENIDA ', 'ALAMEDA ', 'TRAVESSA ', 'PRACA ', 'ESTRADA ', 'RODOVIA ']):
        return {
            'category': 'STREET_WITHOUT_HOUSE_NUMBER',
            'street_raw': s,
            'street_norm': normalize_street_name(s),
            'house_number': None
        }
    return {
        'category': 'DOCUMENTARY_TEXT_VACANT_LOT',
        'street_raw': s,
        'street_norm': '',
        'house_number': None
    }

dsqlll_dict = defaultdict(list)
audit_counts_raw = defaultdict(int)

for r in raw_records:
    bc = r.get('bc') or ''
    parts = bc.split('.')
    if len(parts) == 5:
        d = int(parts[0])
        s = int(parts[1])
        qqq = int(parts[2])
        lll = int(parts[3])
        sss = int(parts[4])
        dsq = f"{d}.{s}.{qqq:03d}"
        dsqlll = f"{d}.{s}.{qqq:03d}.{lll:03d}"
    else:
        d, s, qqq, lll, sss = None, None, None, None, None
        dsq = 'UNKNOWN'
        dsqlll = bc

    addr_info = parse_raw_address(r.get('endereco'))
    audit_counts_raw[addr_info['category']] += 1

    item = {
        'bc_canonical': bc,
        'd': d, 's': s, 'qqq': qqq, 'lll': lll, 'sss': sss,
        'dsq': dsq,
        'dsqlll': dsqlll,
        'street_raw': addr_info['street_raw'],
        'street_norm': addr_info['street_norm'],
        'house_number': addr_info['house_number'],
        'category': addr_info['category'],
        'neighborhood': r.get('bairro', ''),
        'property_type': r.get('tipo_imovel', ''),
        'land_area_m2': r.get('area_terreno_m2', 0),
        'built_area_m2': r.get('area_construida_m2', 0),
        'valor_venal_total_rs': r.get('valor_venal_total_rs', 0)
    }
    dsqlll_dict[dsqlll].append(item)

canonical_parcels = []
audit_counts_dsqlll = defaultdict(int)

for dsqlll, items in sorted(dsqlll_dict.items()):
    sorted_items = sorted(items, key=lambda x: (x['house_number'] is not None, x['house_number'] or 0), reverse=True)
    primary = sorted_items[0].copy()
    primary['sublot_count'] = len(items)
    primary['sublots'] = [it['sss'] for it in items if it['sss'] is not None]
    audit_counts_dsqlll[primary['category']] += 1
    canonical_parcels.append(primary)

print(f"Total Unique DSQLLL Spatial Parcels: {len(canonical_parcels)}")
print(f"Total Unique DSQs: {len(set(p['dsq'] for p in canonical_parcels))}")
print("Category Breakdown (DSQLLL):", dict(audit_counts_dsqlll))

cohort_file = os.path.join(OUT_DIR, 'phase_map_normalized_cohort.json')
cohort_sha = write_json_and_hash(cohort_file, {
    'metadata': {
        'phase': 'MAP_AWARE_LLL_BLOCK_PERIMETER_VALIDATION',
        'raw_records_count': len(raw_records),
        'unique_dsqlll_count': len(canonical_parcels),
        'unique_dsq_count': len(set(p['dsq'] for p in canonical_parcels)),
        'raw_json_sha256': raw_json_sha,
        'raw_excel_sha256': raw_excel_sha
    },
    'audit_breakdown': {
        'raw_records': dict(audit_counts_raw),
        'unique_spatial_parcels': dict(audit_counts_dsqlll)
    },
    'parcels': canonical_parcels
})

manifest_file = os.path.join(OUT_DIR, 'phase_map_source_manifest.json')
manifest_sha = write_json_and_hash(manifest_file, {
    'raw_sources': {
        'acervo_casas_taubate.json': {'sha256': raw_json_sha, 'records': len(raw_records)},
        'Acervo_Casas_Taubate_1000_Lotes.xlsx': {'sha256': raw_excel_sha, 'records': len(raw_records)}
    },
    'normalized_cohort': {
        'file': 'phase_map_normalized_cohort.json',
        'sha256': cohort_sha,
        'unique_dsqlll': len(canonical_parcels),
        'unique_dsq': len(set(p['dsq'] for p in canonical_parcels))
    },
    'reconciliation_table': {
        'street_with_house_number': {'parcels': audit_counts_dsqlll['STREET_WITH_HOUSE_NUMBER'], 'records': audit_counts_raw['STREET_WITH_HOUSE_NUMBER']},
        'street_without_house_number': {'parcels': audit_counts_dsqlll['STREET_WITHOUT_HOUSE_NUMBER'], 'records': audit_counts_raw['STREET_WITHOUT_HOUSE_NUMBER']},
        'documentary_text_vacant_lot': {'parcels': audit_counts_dsqlll['DOCUMENTARY_TEXT_VACANT_LOT'], 'records': audit_counts_raw['DOCUMENTARY_TEXT_VACANT_LOT']},
        'empty_address': {'parcels': audit_counts_dsqlll['EMPTY_ADDRESS'], 'records': audit_counts_raw['EMPTY_ADDRESS']},
        'total_cohort': {'parcels': len(canonical_parcels), 'records': len(raw_records)}
    }
})

# =========================================================================
# STEP 2: STREET-TO-ROAD-NETWORK BINDING & AMBIGUITY HANDLING
# =========================================================================
print("\n--- Step 2: Street-to-Road-Network Binding ---")
rn_path = 'facade-checker/data/address_finder_bc_anchors_v1/road_network_taubate.json'
with open(rn_path, 'r', encoding='utf-8') as f:
    road_network = json.load(f)

osm_streets = road_network.get('streets', {})
print(f"Loaded OSM road network with {len(osm_streets)} street entities.")

# Extract unique normalized street names from cohort
cohort_streets = sorted(list(set(p['street_norm'] for p in canonical_parcels if p['street_norm'])))
print(f"Unique normalized street names in cohort: {len(cohort_streets)}")

def token_jaccard(s1, s2):
    t1 = set(s1.split())
    t2 = set(s2.split())
    if not t1 or not t2:
        return 0.0
    return len(t1 & t2) / len(t1 | t2)

street_bindings = {}
binding_counts = defaultdict(int)

for s in cohort_streets:
    # 1. Exact match
    if s in osm_streets:
        street_bindings[s] = {
            'status': 'EXACT',
            'matched_osm_key': s,
            'score': 1.0,
            'direct_cross_streets': osm_streets[s].get('direct_cross_streets', []),
            'centroid': osm_streets[s].get('centroid', None),
            'bbox': osm_streets[s].get('bbox', None)
        }
        binding_counts['EXACT'] += 1
        continue
    
    # 2. Match against osm_keys and raw names
    candidates = []
    for osm_k, osm_data in osm_streets.items():
        norm_osm_k = normalize_street_name(osm_k)
        raw_osm_norm = normalize_street_name(osm_data.get('street_name_raw', ''))
        
        j1 = token_jaccard(s, osm_k)
        j2 = token_jaccard(s, norm_osm_k)
        j3 = token_jaccard(s, raw_osm_norm)
        max_j = max(j1, j2, j3)
        
        # Substring exact check if tokens match well
        if s == norm_osm_k or s == raw_osm_norm:
            candidates.append((osm_k, 1.0, 'canonical_exact'))
        elif max_j >= 0.75:
            candidates.append((osm_k, max_j, 'fuzzy_token'))
        elif len(s.split()) >= 2 and (s in osm_k or osm_k in s):
            candidates.append((osm_k, 0.80, 'substring_containment'))

    if not candidates:
        street_bindings[s] = {
            'status': 'UNMATCHED',
            'matched_osm_key': None,
            'score': 0.0,
            'direct_cross_streets': [],
            'centroid': None,
            'bbox': None
        }
        binding_counts['UNMATCHED'] += 1
    elif len(candidates) == 1:
        osm_k, sc, reason = candidates[0]
        street_bindings[s] = {
            'status': 'HIGH_CONFIDENCE_UNIQUE',
            'matched_osm_key': osm_k,
            'score': sc,
            'match_reason': reason,
            'direct_cross_streets': osm_streets[osm_k].get('direct_cross_streets', []),
            'centroid': osm_streets[osm_k].get('centroid', None),
            'bbox': osm_streets[osm_k].get('bbox', None)
        }
        binding_counts['HIGH_CONFIDENCE_UNIQUE'] += 1
    else:
        # Check if top score is distinct or tied
        candidates.sort(key=lambda x: x[1], reverse=True)
        if candidates[0][1] >= 0.90 and (len(candidates) == 1 or candidates[0][1] - candidates[1][1] >= 0.20):
            osm_k, sc, reason = candidates[0]
            street_bindings[s] = {
                'status': 'HIGH_CONFIDENCE_UNIQUE',
                'matched_osm_key': osm_k,
                'score': sc,
                'match_reason': reason,
                'direct_cross_streets': osm_streets[osm_k].get('direct_cross_streets', []),
                'centroid': osm_streets[osm_k].get('centroid', None),
                'bbox': osm_streets[osm_k].get('bbox', None)
            }
            binding_counts['HIGH_CONFIDENCE_UNIQUE'] += 1
        else:
            street_bindings[s] = {
                'status': 'AMBIGUOUS',
                'matched_osm_key': None,
                'candidate_keys': [c[0] for c in candidates[:4]],
                'score': candidates[0][1],
                'direct_cross_streets': [],
                'centroid': None,
                'bbox': None
            }
            binding_counts['AMBIGUOUS'] += 1

print("Street Binding Results:", dict(binding_counts))
measured_coverage_rate = (binding_counts['EXACT'] + binding_counts['HIGH_CONFIDENCE_UNIQUE']) / len(cohort_streets)
print(f"Measured Street Match Coverage: {measured_coverage_rate*100:.2f}%")

bindings_file = os.path.join(OUT_DIR, 'phase_map_street_bindings.json')
bindings_sha = write_json_and_hash(bindings_file, {
    'metadata': {
        'total_cohort_streets': len(cohort_streets),
        'binding_breakdown': dict(binding_counts),
        'measured_coverage_rate': measured_coverage_rate
    },
    'bindings': street_bindings
})

# =========================================================================
# STEP 3: INDEPENDENT LOCAL SPATIAL BINDING & PHYSICAL ROAD BLOCKS
# =========================================================================
print("\n--- Step 3: Independent Local Spatial Binding ---")
pb_path = 'facade-checker/data/address_finder_bc_anchors_v1/physical_road_blocks.json'
with open(pb_path, 'r', encoding='utf-8') as f:
    pb_data = json.load(f)

physical_blocks = pb_data.get('blocks', [])
print(f"Loaded {len(physical_blocks)} physical road block polygons.")

# Load verified ground truth coordinates from prior validated phases
gt_sources = [
    'facade-checker/data/address_finder_bc_anchors_v1/dense_microarea_spatial_gt.json',
    'facade-checker/data/limited_automation_v1_audit/complete_205_ground_truth.json',
    'facade-checker/production_monitoring/2026-09_audit/complete_289_ground_truth.json'
]
verified_coords = {}
for gts in gt_sources:
    if os.path.exists(gts):
        with open(gts, 'r', encoding='utf-8') as f:
            d = json.load(f)
            items = d if isinstance(d, list) else d.get('records', d.get('parcels', []))
            for it in items:
                bc = it.get('bc') or it.get('bc_canonical') or it.get('bc_formatado')
                lat = it.get('lat') or it.get('latitude')
                lon = it.get('lon') or it.get('longitude') or it.get('lng')
                if bc and lat and lon:
                    parts = bc.split('.')
                    if len(parts) == 5:
                        dsqlll = f"{parts[0]}.{parts[1]}.{parts[2]}.{parts[3]}"
                        verified_coords[dsqlll] = {'lat': float(lat), 'lon': float(lon), 'source': os.path.basename(gts)}

print(f"Loaded {len(verified_coords)} independent verified coordinate bindings.")

# Associate DSQs and parcels to physical road blocks
dsq_block_associations = {}
parcels_by_dsq = defaultdict(list)
for p in canonical_parcels:
    parcels_by_dsq[p['dsq']].append(p)

dsq_spatial_status_counts = defaultdict(int)

for dsq, p_list in parcels_by_dsq.items():
    # Check if any parcel has independent verified coordinates
    dsq_coords = [verified_coords[p['dsqlll']] for p in p_list if p['dsqlll'] in verified_coords]
    
    # Extract resolved streets for this DSQ
    dsq_streets = set()
    for p in p_list:
        sn = p['street_norm']
        if sn in street_bindings and street_bindings[sn]['status'] in ['EXACT', 'HIGH_CONFIDENCE_UNIQUE']:
            osm_k = street_bindings[sn]['matched_osm_key']
            dsq_streets.add(osm_k)
    
    assigned_block = None
    binding_evidence = None
    
    if dsq_coords:
        # Spatial coordinate bounding box match against physical blocks
        avg_lat = sum(c['lat'] for c in dsq_coords) / len(dsq_coords)
        avg_lon = sum(c['lon'] for c in dsq_coords) / len(dsq_coords)
        
        # Find closest physical block containing or nearest to the centroid
        best_block = None
        min_dist = float('inf')
        for b in physical_blocks:
            bbox = b.get('bbox', {})
            c = b.get('centroid', {})
            if bbox and bbox.get('min_lat') <= avg_lat <= bbox.get('max_lat') and bbox.get('min_lon') <= avg_lon <= bbox.get('max_lon'):
                best_block = b
                break
            elif c and 'lat' in c and 'lon' in c:
                dist = math.hypot(c['lat'] - avg_lat, c['lon'] - avg_lon)
                if dist < min_dist:
                    min_dist = dist
                    best_block = b
        if best_block:
            assigned_block = best_block['block_id']
            binding_evidence = 'VERIFIED_COORDINATES_BBOX'
            dsq_spatial_status_counts['LOCAL_BLOCK_RESOLVED'] += 1
    elif len(dsq_streets) >= 2:
        # Candidate block matching strictly where bordering streets match the exact set of mapped streets
        matching_blocks = []
        for b in physical_blocks:
            b_streets = set(b.get('bordering_streets', []))
            if dsq_streets.issubset(b_streets):
                matching_blocks.append(b)
        if len(matching_blocks) == 1:
            assigned_block = matching_blocks[0]['block_id']
            binding_evidence = 'UNIQUE_CLOSED_PERIMETER_GRAPH_MATCH'
            dsq_spatial_status_counts['LOCAL_BLOCK_RESOLVED'] += 1
        else:
            dsq_spatial_status_counts['LOCAL_BLOCK_UNRESOLVED'] += 1
    else:
        dsq_spatial_status_counts['LOCAL_BLOCK_UNRESOLVED'] += 1

    dsq_block_associations[dsq] = {
        'dsq': dsq,
        'parcels_count': len(p_list),
        'status': 'LOCAL_BLOCK_RESOLVED' if assigned_block else 'LOCAL_BLOCK_UNRESOLVED',
        'assigned_block_id': assigned_block,
        'binding_evidence': binding_evidence,
        'mapped_streets': list(dsq_streets),
        'verified_coordinates_count': len(dsq_coords)
    }

print("DSQ Physical Block Spatial Status:", dict(dsq_spatial_status_counts))

dsq_block_file = os.path.join(OUT_DIR, 'phase_map_dsq_block_associations.json')
dsq_block_sha = write_json_and_hash(dsq_block_file, {
    'metadata': {
        'total_dsqs': len(parcels_by_dsq),
        'spatial_status_breakdown': dict(dsq_spatial_status_counts)
    },
    'associations': dsq_block_associations
})

# =========================================================================
# STEP 4: PRE-REGISTERED BLIND HOLDOUT SPLIT (SEED = 42)
# =========================================================================
print("\n--- Step 4: Pre-Registered Holdout Split ---")
all_dsqs = sorted(list(parcels_by_dsq.keys()))
random.seed(42)

# Stratify by parcel volume tiers
dsq_by_tier = {'high': [], 'med': [], 'low': []}
for dsq in all_dsqs:
    cnt = len(parcels_by_dsq[dsq])
    if cnt >= 25:
        dsq_by_tier['high'].append(dsq)
    elif cnt >= 10:
        dsq_by_tier['med'].append(dsq)
    else:
        dsq_by_tier['low'].append(dsq)

dev_dsqs = []
holdout_dsqs = []

for tier, dsq_list in dsq_by_tier.items():
    random.shuffle(dsq_list)
    n_holdout = max(1, round(len(dsq_list) * 0.25))
    holdout_dsqs.extend(dsq_list[:n_holdout])
    dev_dsqs.extend(dsq_list[n_holdout:])

dev_dsqs.sort()
holdout_dsqs.sort()

dev_parcels = [p for p in canonical_parcels if p['dsq'] in dev_dsqs]
holdout_parcels = [p for p in canonical_parcels if p['dsq'] in holdout_dsqs]

print(f"Development Split: {len(dev_dsqs)} DSQs ({len(dev_parcels)} parcels)")
print(f"Holdout Split: {len(holdout_dsqs)} DSQs ({len(holdout_parcels)} parcels)")

holdout_manifest_file = os.path.join(OUT_DIR, 'phase_map_holdout_manifest.json')
holdout_manifest_sha = write_json_and_hash(holdout_manifest_file, {
    'seed': 42,
    'protocol': 'PRE_REGISTERED_STRATIFIED_COMPLETE_DSQ_ISOLATION',
    'development_cohort': {
        'dsq_count': len(dev_dsqs),
        'parcels_count': len(dev_parcels),
        'dsq_list': dev_dsqs
    },
    'holdout_cohort': {
        'dsq_count': len(holdout_dsqs),
        'parcels_count': len(holdout_parcels),
        'dsq_list': holdout_dsqs
    }
})

print(f"Frozen Holdout Manifest SHA256: {holdout_manifest_sha}")

# =========================================================================
# STEP 5: TWO-LEVEL CONSECUTIVE LLL STREET TRANSITIONS (DEV COHORT)
# =========================================================================
print("\n--- Step 5: Two-Level Consecutive LLL Street Transitions ---")

def analyze_consecutive_transitions(parcels_subset, dsq_subset):
    parcels_by_dsq_local = defaultdict(list)
    for p in parcels_subset:
        if p['dsq'] in dsq_subset and p['lll'] is not None:
            parcels_by_dsq_local[p['dsq']].append(p)
    
    gap_buckets = {1: [], 2: [], 3: [], 4: [], 5: [], '6-10': [], '>10': []}
    
    for dsq, p_list in parcels_by_dsq_local.items():
        # Sort by LLL numeric order
        p_sorted = sorted(p_list, key=lambda x: x['lll'])
        dsq_assoc = dsq_block_associations.get(dsq, {})
        dsq_resolved = (dsq_assoc.get('status') == 'LOCAL_BLOCK_RESOLVED')
        assigned_block_id = dsq_assoc.get('assigned_block_id')
        
        # Get bordering streets of physical block if resolved
        block_bordering = []
        if dsq_resolved and assigned_block_id:
            for b in physical_blocks:
                if b['block_id'] == assigned_block_id:
                    block_bordering = b.get('bordering_streets', [])
                    break

        for i in range(len(p_sorted) - 1):
            p1 = p_sorted[i]
            p2 = p_sorted[i+1]
            delta = p2['lll'] - p1['lll']
            if delta <= 0:
                continue
            
            s1_norm = p1['street_norm']
            s2_norm = p2['street_norm']
            
            # Level 1 classification
            if not s1_norm or not s2_norm:
                level1_class = 'MAP_UNRESOLVED'
                s1_osm = None
                s2_osm = None
            elif s1_norm == s2_norm:
                level1_class = 'SAME_STREET'
                s1_osm = s1_norm
                s2_osm = s2_norm
            else:
                b1 = street_bindings.get(s1_norm, {})
                b2 = street_bindings.get(s2_norm, {})
                s1_osm = b1.get('matched_osm_key')
                s2_osm = b2.get('matched_osm_key')
                
                if b1.get('status') not in ['EXACT', 'HIGH_CONFIDENCE_UNIQUE'] or b2.get('status') not in ['EXACT', 'HIGH_CONFIDENCE_UNIQUE']:
                    level1_class = 'MAP_UNRESOLVED'
                else:
                    cross1 = b1.get('direct_cross_streets', [])
                    cross2 = b2.get('direct_cross_streets', [])
                    if s2_osm in cross1 or s1_osm in cross2 or token_jaccard(s1_osm, s2_osm) >= 0.5:
                        level1_class = 'DIFFERENT_STREET_GRAPH_INTERSECTING'
                    else:
                        level1_class = 'DIFFERENT_STREET_GRAPH_NON_INTERSECTING'

            # Level 2 classification (only for street changes)
            if level1_class == 'SAME_STREET':
                level2_class = 'SAME_STREET'
            elif not dsq_resolved:
                level2_class = 'LOCAL_BLOCK_UNRESOLVED'
            elif level1_class == 'MAP_UNRESOLVED':
                level2_class = 'LOCAL_BLOCK_UNRESOLVED'
            else:
                # Check if s1_osm and s2_osm both border the assigned physical block and intersect
                if s1_osm in block_bordering and s2_osm in block_bordering and level1_class == 'DIFFERENT_STREET_GRAPH_INTERSECTING':
                    level2_class = 'LOCAL_CORNER_CONFIRMED'
                else:
                    level2_class = 'LOCAL_CORNER_NOT_CONFIRMED'

            record = {
                'dsq': dsq,
                'p1_lll': p1['lll'],
                'p2_lll': p2['lll'],
                'delta_lll': delta,
                's1_norm': s1_norm,
                's2_norm': s2_norm,
                'level1_class': level1_class,
                'level2_class': level2_class
            }
            
            if delta in gap_buckets:
                gap_buckets[delta].append(record)
            elif 6 <= delta <= 10:
                gap_buckets['6-10'].append(record)
            else:
                gap_buckets['>10'].append(record)
                
    return gap_buckets

dev_transitions = analyze_consecutive_transitions(dev_parcels, dev_dsqs)

# Compute transition summary statistics
def summarize_transitions(gap_dict):
    summary = {}
    for gap, items in gap_dict.items():
        total = len(items)
        if total == 0:
            summary[str(gap)] = {'total_pairs': 0}
            continue
        l1_counts = defaultdict(int)
        l2_counts = defaultdict(int)
        for it in items:
            l1_counts[it['level1_class']] += 1
            l2_counts[it['level2_class']] += 1
        
        street_changes = total - l1_counts['SAME_STREET']
        resolved_l1_changes = l1_counts['DIFFERENT_STREET_GRAPH_INTERSECTING'] + l1_counts['DIFFERENT_STREET_GRAPH_NON_INTERSECTING']
        graph_intersect_rate = (l1_counts['DIFFERENT_STREET_GRAPH_INTERSECTING'] / resolved_l1_changes) if resolved_l1_changes > 0 else 0.0
        
        resolved_l2_changes = l2_counts['LOCAL_CORNER_CONFIRMED'] + l2_counts['LOCAL_CORNER_NOT_CONFIRMED']
        local_corner_rate = (l2_counts['LOCAL_CORNER_CONFIRMED'] / resolved_l2_changes) if resolved_l2_changes > 0 else 0.0

        summary[str(gap)] = {
            'total_pairs': total,
            'level1_counts': dict(l1_counts),
            'level2_counts': dict(l2_counts),
            'same_street_rate': l1_counts['SAME_STREET'] / total,
            'graph_intersect_rate_on_resolved_changes': graph_intersect_rate,
            'local_corner_rate_on_resolved_block_changes': local_corner_rate
        }
    return summary

dev_trans_summary = summarize_transitions(dev_transitions)
print("Dev Delta=1 Transition Metrics:")
print(json.dumps(dev_trans_summary.get('1', {}), indent=2))

trans_file = os.path.join(OUT_DIR, 'phase_map_consecutive_transitions.json')
trans_sha = write_json_and_hash(trans_file, {
    'metadata': {'cohort': 'DEVELOPMENT', 'total_dsqs': len(dev_dsqs)},
    'gap_summary': dev_trans_summary,
    'delta_1_details': dev_transitions[1]
})

# =========================================================================
# STEP 6: BLOCK-PERIMETER CYCLIC SEQUENCE TEST (DEV COHORT)
# =========================================================================
print("\n--- Step 6: Block-Perimeter Cyclic Traversal Tests ---")

def evaluate_perimeter_sequences(parcels_subset, dsq_subset):
    results = {}
    parcels_by_dsq_local = defaultdict(list)
    for p in parcels_subset:
        if p['dsq'] in dsq_subset and p['lll'] is not None:
            parcels_by_dsq_local[p['dsq']].append(p)
            
    status_counts = defaultdict(int)

    for dsq in dsq_subset:
        p_list = sorted(parcels_by_dsq_local[dsq], key=lambda x: x['lll'])
        assoc = dsq_block_associations.get(dsq, {})
        if assoc.get('status') != 'LOCAL_BLOCK_RESOLVED' or not assoc.get('assigned_block_id'):
            results[dsq] = {'status': 'LOCAL_BLOCK_UNRESOLVED', 'reason': 'No independent block geometry'}
            status_counts['LOCAL_BLOCK_UNRESOLVED'] += 1
            continue
            
        block_id = assoc.get('assigned_block_id')
        block_obj = next((b for b in physical_blocks if b['block_id'] == block_id), None)
        if not block_obj or len(block_obj.get('bordering_streets', [])) < 2:
            results[dsq] = {'status': 'UNRESOLVED_BLOCK_TOPOLOGY', 'reason': 'Fewer than 2 bordering streets in physical block'}
            status_counts['UNRESOLVED_BLOCK_TOPOLOGY'] += 1
            continue
            
        bordering = block_obj.get('bordering_streets', [])
        # Extract observed street sequence along LLL progression (ignoring unmapped)
        observed_streets = []
        for p in p_list:
            sn = p['street_norm']
            if sn in street_bindings and street_bindings[sn]['status'] in ['EXACT', 'HIGH_CONFIDENCE_UNIQUE']:
                osm_k = street_bindings[sn]['matched_osm_key']
                if not observed_streets or observed_streets[-1] != osm_k:
                    observed_streets.append(osm_k)
                    
        if len(observed_streets) < 2:
            results[dsq] = {'status': 'SINGLE_STREET_OBSERVED', 'bordering': bordering, 'observed': observed_streets}
            status_counts['SINGLE_STREET_OBSERVED'] += 1
            continue
            
        # Test cyclic consistency against bordering streets
        # Check if observed_streets is a cyclic sub-sequence in forward or reverse direction
        def is_cyclic_subsequence(sub, cycle):
            n = len(cycle)
            # Forward
            for start in range(n):
                idx = start
                match = True
                for item in sub:
                    # find item in cycle starting from idx
                    found = False
                    for step in range(n):
                        if cycle[(idx + step) % n] == item:
                            idx = (idx + step) % n
                            found = True
                            break
                    if not found:
                        match = False
                        break
                if match:
                    return True
            return False

        forward_match = is_cyclic_subsequence(observed_streets, bordering)
        reverse_match = is_cyclic_subsequence(observed_streets, list(reversed(bordering)))
        
        if forward_match or reverse_match:
            cat = 'PERIMETER_CONSISTENT'
        else:
            # Check partial consistency (1 transition jump)
            cat = 'PERIMETER_PARTIALLY_CONSISTENT' if len(observed_streets) <= 3 else 'PERIMETER_INCONSISTENT'
            
        status_counts[cat] += 1
        results[dsq] = {
            'status': cat,
            'bordering_streets': bordering,
            'observed_progression': observed_streets,
            'traversal_direction': 'FORWARD/CLOCKWISE' if forward_match else ('REVERSE/COUNTER_CLOCKWISE' if reverse_match else 'NON_CYCLIC')
        }
        
    return results, status_counts

dev_perimeter_res, dev_perimeter_counts = evaluate_perimeter_sequences(dev_parcels, dev_dsqs)
print("Dev Perimeter Sequence Breakdown:", dict(dev_perimeter_counts))

perimeter_file = os.path.join(OUT_DIR, 'phase_map_perimeter_sequences.json')
perimeter_sha = write_json_and_hash(perimeter_file, {
    'metadata': {'cohort': 'DEVELOPMENT', 'status_breakdown': dict(dev_perimeter_counts)},
    'dsq_evaluations': dev_perimeter_res
})

# =========================================================================
# STEP 7: STREET-RUN SEGMENTATION & ORDINAL ALIGNMENT (DEV COHORT)
# =========================================================================
print("\n--- Step 7: Street-Run Monotonic Segmentation & Ordinal Tests ---")

def compute_rank_correlations(parcels_subset, dsq_subset):
    parcels_by_dsq_local = defaultdict(list)
    for p in parcels_subset:
        if p['dsq'] in dsq_subset and p['lll'] is not None and p['house_number'] is not None:
            parcels_by_dsq_local[p['dsq']].append(p)
            
    baseline_corrs = []
    run_segmented_corrs = []
    
    for dsq in dsq_subset:
        p_list = sorted(parcels_by_dsq_local[dsq], key=lambda x: x['lll'])
        
        # Group by baseline street
        by_street = defaultdict(list)
        for p in p_list:
            by_street[p['street_norm']].append(p)
            
        for sn, s_parcels in by_street.items():
            if len(s_parcels) >= 4:
                llls = [p['lll'] for p in s_parcels]
                nums = [p['house_number'] for p in s_parcels]
                
                # Spearman Rho helper
                def spearman(x, y):
                    n = len(x)
                    rx = {v: i for i, v in enumerate(sorted(x))}
                    ry = {v: i for i, v in enumerate(sorted(y))}
                    r_x = [rx[v] for v in x]
                    r_y = [ry[v] for v in y]
                    d_sq = sum((r_x[i] - r_y[i])**2 for i in range(n))
                    return 1.0 - (6.0 * d_sq) / (n * (n**2 - 1)) if n > 1 else 1.0
                
                rho = spearman(llls, nums)
                baseline_corrs.append({'dsq': dsq, 'street': sn, 'n': len(s_parcels), 'spearman_rho': rho})

        # Map-aware contiguous street runs
        runs = []
        current_run = []
        for p in p_list:
            if not current_run or current_run[-1]['street_norm'] == p['street_norm']:
                current_run.append(p)
            else:
                runs.append(current_run)
                current_run = [p]
        if current_run:
            runs.append(current_run)
            
        for r in runs:
            if len(r) >= 4:
                llls = [p['lll'] for p in r]
                nums = [p['house_number'] for p in r]
                rho = spearman(llls, nums)
                run_segmented_corrs.append({'dsq': dsq, 'street': r[0]['street_norm'], 'n': len(r), 'spearman_rho': rho})

    return baseline_corrs, run_segmented_corrs

base_corrs, run_corrs = compute_rank_correlations(dev_parcels, dev_dsqs)

med_base_rho = sorted([abs(c['spearman_rho']) for c in base_corrs])[len(base_corrs)//2] if base_corrs else 0.0
med_run_rho = sorted([abs(c['spearman_rho']) for c in run_corrs])[len(run_corrs)//2] if run_corrs else 0.0

print(f"Median Spearman |rho| (Baseline (DSQ, Street)): {med_base_rho:.4f} (N={len(base_corrs)})")
print(f"Median Spearman |rho| (Map-Aware Street-Run): {med_run_rho:.4f} (N={len(run_corrs)})")

ordinal_file = os.path.join(OUT_DIR, 'phase_map_ordinal_correlations.json')
ordinal_sha = write_json_and_hash(ordinal_file, {
    'metadata': {'cohort': 'DEVELOPMENT'},
    'baseline_street_series': {'count': len(base_corrs), 'median_abs_rho': med_base_rho, 'series': base_corrs},
    'map_aware_runs_series': {'count': len(run_corrs), 'median_abs_rho': med_run_rho, 'series': run_corrs}
})

# =========================================================================
# STEP 8: MULTI-SIGNAL CANDIDATE RANKING SIMULATION (DEV COHORT)
# =========================================================================
print("\n--- Step 8: Multi-Signal Candidate Ranking Simulation ---")

def run_candidate_ranking_simulation(parcels_subset, dsq_subset):
    parcels_by_dsq_local = defaultdict(list)
    for p in parcels_subset:
        if p['dsq'] in dsq_subset and p['lll'] is not None:
            parcels_by_dsq_local[p['dsq']].append(p)
            
    sim_results = {
        'NO_TARGET_STREET': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0},
        'LISTING_STREET_AVAILABLE': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0},
        'ORACLE_TARGET_STREET': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0},
        'BASELINE_A_DELTA_LLL': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0},
        'BASELINE_B_SAME_STREET_FILTER': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0},
        'BASELINE_C_RANDOM_WINDOW': {'top1': 0, 'top3': 0, 'top5': 0, 'top10': 0, 'top20': 0, 'total': 0}
    }
    
    total_queries = 0
    
    for dsq, p_list in parcels_by_dsq_local.items():
        if len(p_list) < 4:
            continue
            
        assoc = dsq_block_associations.get(dsq, {})
        dsq_resolved = (assoc.get('status') == 'LOCAL_BLOCK_RESOLVED')
        assigned_block_id = assoc.get('assigned_block_id')

        # Pairwise anchor -> target simulation
        for i, anchor in enumerate(p_list):
            for j, target in enumerate(p_list):
                if i == j:
                    continue
                total_queries += 1
                
                anchor_lll = anchor['lll']
                target_lll = target['lll']
                anchor_street = anchor['street_norm']
                target_street = target['street_norm']
                
                # Evaluate candidate scores for all other parcels in DSQ
                candidates = [p for p in p_list if p['dsqlll'] != anchor['dsqlll']]
                
                # 1. NO_TARGET_STREET / BASELINE_A (Pure Delta LLL)
                scored_no_target = []
                for c in candidates:
                    delta = abs(c['lll'] - anchor_lll)
                    score = 1.0 / (1.0 + delta)
                    scored_no_target.append((c['dsqlll'], score))
                scored_no_target.sort(key=lambda x: x[1], reverse=True)
                rank_no_target = next(idx + 1 for idx, (c_id, _) in enumerate(scored_no_target) if c_id == target['dsqlll'])
                
                # 2. LISTING_STREET_AVAILABLE
                # Features:
                # - 1/(1+delta_lll)
                # - candidate matches listing target street (target_street)
                # - candidate matches anchor street (anchor_street)
                # - graph intersection between candidate street and listing target street
                scored_listing = []
                for c in candidates:
                    delta = abs(c['lll'] - anchor_lll)
                    c_street = c['street_norm']
                    
                    match_target_street = 1.0 if (c_street and c_street == target_street) else 0.0
                    match_anchor_street = 1.0 if (c_street and c_street == anchor_street) else 0.0
                    
                    graph_intersect = 0.0
                    if c_street and target_street:
                        b_c = street_bindings.get(c_street, {})
                        b_t = street_bindings.get(target_street, {})
                        osm_c = b_c.get('matched_osm_key')
                        osm_t = b_t.get('matched_osm_key')
                        if osm_c and osm_t:
                            if osm_c in b_t.get('direct_cross_streets', []) or osm_t in b_c.get('direct_cross_streets', []):
                                graph_intersect = 1.0
                                
                    score = (1.0 / (1.0 + delta)) + 2.5 * match_target_street + 0.5 * match_anchor_street + 0.8 * graph_intersect
                    scored_listing.append((c['dsqlll'], score))
                scored_listing.sort(key=lambda x: x[1], reverse=True)
                rank_listing = next(idx + 1 for idx, (c_id, _) in enumerate(scored_listing) if c_id == target['dsqlll'])
                
                # 3. ORACLE_TARGET_STREET (incorporating local block topology when available)
                scored_oracle = []
                for c in candidates:
                    delta = abs(c['lll'] - anchor_lll)
                    c_street = c['street_norm']
                    match_target_street = 1.0 if (c_street and c_street == target_street) else 0.0
                    
                    # Road block corner proximity
                    same_block = 1.0 if dsq_resolved else 0.0
                    score = (1.0 / (1.0 + delta)) + 3.0 * match_target_street + 1.0 * same_block
                    scored_oracle.append((c['dsqlll'], score))
                scored_oracle.sort(key=lambda x: x[1], reverse=True)
                rank_oracle = next(idx + 1 for idx, (c_id, _) in enumerate(scored_oracle) if c_id == target['dsqlll'])
                
                # 4. BASELINE B: Same Street Filter + Delta LLL
                scored_base_b = []
                for c in candidates:
                    delta = abs(c['lll'] - anchor_lll)
                    same_st = 1.0 if (c['street_norm'] and c['street_norm'] == anchor['street_norm']) else 0.0
                    score = same_st * 100.0 + (1.0 / (1.0 + delta))
                    scored_base_b.append((c['dsqlll'], score))
                scored_base_b.sort(key=lambda x: x[1], reverse=True)
                rank_base_b = next(idx + 1 for idx, (c_id, _) in enumerate(scored_base_b) if c_id == target['dsqlll'])

                # 5. BASELINE C: Random Same-DSQ Window
                shuffled_c = list(candidates)
                random.shuffle(shuffled_c)
                rank_base_c = next(idx + 1 for idx, c in enumerate(shuffled_c) if c['dsqlll'] == target['dsqlll'])

                # Update metric tallies
                for k, r in [
                    ('NO_TARGET_STREET', rank_no_target),
                    ('BASELINE_A_DELTA_LLL', rank_no_target),
                    ('LISTING_STREET_AVAILABLE', rank_listing),
                    ('ORACLE_TARGET_STREET', rank_oracle),
                    ('BASELINE_B_SAME_STREET_FILTER', rank_base_b),
                    ('BASELINE_C_RANDOM_WINDOW', rank_base_c)
                ]:
                    sim_results[k]['total'] += 1
                    if r <= 1: sim_results[k]['top1'] += 1
                    if r <= 3: sim_results[k]['top3'] += 1
                    if r <= 5: sim_results[k]['top5'] += 1
                    if r <= 10: sim_results[k]['top10'] += 1
                    if r <= 20: sim_results[k]['top20'] += 1

    # Convert to rates
    rates_summary = {}
    for k, v in sim_results.items():
        tot = v['total']
        rates_summary[k] = {
            'total_queries': tot,
            'top1_recall': v['top1'] / tot if tot > 0 else 0.0,
            'top3_recall': v['top3'] / tot if tot > 0 else 0.0,
            'top5_recall': v['top5'] / tot if tot > 0 else 0.0,
            'top10_recall': v['top10'] / tot if tot > 0 else 0.0,
            'top20_recall': v['top20'] / tot if tot > 0 else 0.0
        }
    return rates_summary

dev_rank_rates = run_candidate_ranking_simulation(dev_parcels, dev_dsqs)
print("Dev Candidate Ranking Rates:")
print(json.dumps(dev_rank_rates, indent=2))

rankings_file = os.path.join(OUT_DIR, 'phase_map_candidate_rankings.json')
rankings_sha = write_json_and_hash(rankings_file, {
    'metadata': {'cohort': 'DEVELOPMENT', 'total_dsqs': len(dev_dsqs)},
    'ranking_regimes': dev_rank_rates
})

# =========================================================================
# STEP 9: PRE-REGISTERED RULE FREEZING PROTOCOL
# =========================================================================
print("\n--- Step 9: Pre-Registered Rule Freezing ---")
frozen_rules = {
    'protocol': 'PRE_REGISTERED_FROZEN_RANKING_RULES',
    'seed': 42,
    'scoring_weights': {
        'NO_TARGET_STREET': {'w_delta_lll': 1.0},
        'LISTING_STREET_AVAILABLE': {
            'w_delta_lll': 1.0,
            'w_target_street_match': 2.5,
            'w_anchor_street_match': 0.5,
            'w_graph_intersection': 0.8
        },
        'ORACLE_TARGET_STREET': {
            'w_delta_lll': 1.0,
            'w_target_street_match': 3.0,
            'w_same_road_block': 1.0
        }
    },
    'evaluation_thresholds': {
        'min_consecutive_graph_intersect_rate': 0.60,
        'min_local_corner_confirmation_rate': 0.50,
        'min_top10_recall_listing': 0.85
    }
}

frozen_file = os.path.join(OUT_DIR, 'phase_map_frozen_rules.json')
frozen_sha = write_json_and_hash(frozen_file, frozen_rules)
print(f"Frozen Rules SHA256: {frozen_sha}")

# =========================================================================
# STEP 10: BLIND HOLDOUT EVALUATION
# =========================================================================
print("\n--- Step 10: Blind Holdout Evaluation ---")
holdout_transitions = analyze_consecutive_transitions(holdout_parcels, holdout_dsqs)
holdout_trans_summary = summarize_transitions(holdout_transitions)

holdout_perimeter_res, holdout_perimeter_counts = evaluate_perimeter_sequences(holdout_parcels, holdout_dsqs)
holdout_base_corrs, holdout_run_corrs = compute_rank_correlations(holdout_parcels, holdout_dsqs)
holdout_rank_rates = run_candidate_ranking_simulation(holdout_parcels, holdout_dsqs)

holdout_results_payload = {
    'metadata': {
        'cohort': 'HOLDOUT',
        'total_dsqs': len(holdout_dsqs),
        'total_parcels': len(holdout_parcels),
        'frozen_rules_sha256': frozen_sha
    },
    'delta_1_transitions': holdout_trans_summary.get('1', {}),
    'perimeter_sequences': dict(holdout_perimeter_counts),
    'ordinal_alignment': {
        'baseline_median_abs_rho': sorted([abs(c['spearman_rho']) for c in holdout_base_corrs])[len(holdout_base_corrs)//2] if holdout_base_corrs else 0.0,
        'map_aware_median_abs_rho': sorted([abs(c['spearman_rho']) for c in holdout_run_corrs])[len(holdout_run_corrs)//2] if holdout_run_corrs else 0.0
    },
    'ranking_regimes': holdout_rank_rates
}

holdout_file = os.path.join(OUT_DIR, 'phase_map_holdout_results.json')
holdout_sha = write_json_and_hash(holdout_file, holdout_results_payload)
print(f"Holdout Evaluation SHA256: {holdout_sha}")

# =========================================================================
# STEP 11: METRICS SUMMARY & GLOBAL CLASSIFICATION
# =========================================================================
print("\n--- Step 11: Metrics Summary & Global Classification ---")

# Determine classification
dev_l1_rate = dev_trans_summary.get('1', {}).get('graph_intersect_rate_on_resolved_changes', 0.0)
dev_l2_rate = dev_trans_summary.get('1', {}).get('local_corner_rate_on_resolved_block_changes', 0.0)
holdout_l1_rate = holdout_trans_summary.get('1', {}).get('graph_intersect_rate_on_resolved_changes', 0.0)
holdout_l2_rate = holdout_trans_summary.get('1', {}).get('local_corner_rate_on_resolved_block_changes', 0.0)

dev_top5_listing = dev_rank_rates['LISTING_STREET_AVAILABLE']['top5_recall']
dev_top5_base_a = dev_rank_rates['BASELINE_A_DELTA_LLL']['top5_recall']
holdout_top5_listing = holdout_rank_rates['LISTING_STREET_AVAILABLE']['top5_recall']
holdout_top5_base_a = holdout_rank_rates['BASELINE_A_DELTA_LLL']['top5_recall']

if measured_coverage_rate < 0.50:
    global_class = 'INSUFFICIENT_MAP_COVERAGE'
elif dev_l2_rate >= 0.50 and holdout_l2_rate >= 0.50 and dev_top5_listing > dev_top5_base_a:
    global_class = 'MAP_AWARE_LLL_TOPOLOGY_HIGH_VALUE'
elif dev_l1_rate >= 0.60:
    global_class = 'MAP_AWARE_LLL_TOPOLOGY_PARTIAL_VALUE'
else:
    global_class = 'MAP_AWARE_LLL_TOPOLOGY_LOW_VALUE'

print(f"\n=======================================================")
print(f"FINAL CLASSIFICATION: {global_class}")
print(f"=======================================================")

metrics_summary = {
    'classification': global_class,
    'cohort_audit': {
        'raw_records': len(raw_records),
        'unique_dsqlll_parcels': len(canonical_parcels),
        'unique_dsqs': len(parcels_by_dsq),
        'street_match_coverage': measured_coverage_rate
    },
    'level_1_street_graph_transitions': {
        'dev_delta_1_graph_intersect_rate': dev_l1_rate,
        'holdout_delta_1_graph_intersect_rate': holdout_l1_rate
    },
    'level_2_local_block_corner_confirmation': {
        'dev_local_corner_rate': dev_l2_rate,
        'holdout_local_corner_rate': holdout_l2_rate
    },
    'ranking_compression_top5': {
        'dev_baseline_a_pure_lll': dev_top5_base_a,
        'dev_listing_street_available': dev_top5_listing,
        'holdout_baseline_a_pure_lll': holdout_top5_base_a,
        'holdout_listing_street_available': holdout_top5_listing
    },
    'deliverable_hashes': {
        'phase_map_normalized_cohort.json': cohort_sha,
        'phase_map_source_manifest.json': manifest_sha,
        'phase_map_street_bindings.json': bindings_sha,
        'phase_map_dsq_block_associations.json': dsq_block_sha,
        'phase_map_holdout_manifest.json': holdout_manifest_sha,
        'phase_map_consecutive_transitions.json': trans_sha,
        'phase_map_perimeter_sequences.json': perimeter_sha,
        'phase_map_ordinal_correlations.json': ordinal_sha,
        'phase_map_candidate_rankings.json': rankings_sha,
        'phase_map_frozen_rules.json': frozen_sha,
        'phase_map_holdout_results.json': holdout_sha
    }
}

summary_file = os.path.join(OUT_DIR, 'phase_map_metrics_summary.json')
summary_sha = write_json_and_hash(summary_file, metrics_summary)
metrics_summary['deliverable_hashes']['phase_map_metrics_summary.json'] = summary_sha

print("Master pipeline execution complete!")
