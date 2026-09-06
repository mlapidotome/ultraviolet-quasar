/**
 * Módulo de Extração de Intenção Semântica — Creative Director (Fase 4A.3)
 * Bali Imóveis
 */

const { removeDiacritics } = require('../script_timing/text_normalizer');

const INTENT_EXTRACTOR_VERSION = '1.0.0';

/**
 * Mapeamento de termos lexicais para taxonomia canônica de cômodos (ALLOWED_ROOM_TYPES)
 */
const ROOM_TAXONOMY_MAP = {
  cozinha: 'kitchen',
  cozinhas: 'kitchen',
  varanda: 'balcony',
  varandas: 'balcony',
  sacada: 'balcony',
  sacadas: 'balcony',
  gourmet: 'balcony',
  sala: 'living_room',
  salas: 'living_room',
  estar: 'living_room',
  jantar: 'dining_room',
  quarto: 'bedroom',
  quartos: 'bedroom',
  dormitorio: 'bedroom',
  dormitorios: 'bedroom',
  suite: 'suite',
  suites: 'suite',
  banheiro: 'bathroom',
  banheiros: 'bathroom',
  lavabo: 'bathroom',
  fachada: 'facade',
  predio: 'facade',
  hall: 'hallway',
  corredor: 'hallway',
  garagem: 'garage',
  vaga: 'garage',
  vagas: 'garage',
  piscina: 'pool',
  lazer: 'leisure',
  vista: 'city_view'
};

/**
 * Mapeamento de termos compostos e expressões para features canônicas (ALLOWED_FEATURES)
 */
const FEATURE_EXPRESSIONS_MAP = [
  { regex: /armarios?\s+planejados?|moveis\s+planejados?|planejados?/i, feature: 'planned_cabinets' },
  { regex: /piso\s+(?:em\s+)?madeira|madeira\s+macica|taco|parquet/i, feature: 'wooden_floor' },
  { regex: /porcelanato|piso\s+em\s+porcelanato/i, feature: 'porcelain_tile' },
  { regex: /vista\s+(?:espetacular|incrivel|panoramica|linda)?\s*(?:da\s+cidade|livre)?|vista\s+da\s+cidade/i, feature: 'city_view' },
  { regex: /iluminad[ao]|iluminacao\s+natural|ensolarad[ao]|luz\s+natural/i, feature: 'natural_lighting' },
  { regex: /arejad[ao]|amplo|ampla|espacos[ao]|espaco/i, feature: 'spacious' },
  { regex: /mobiliad[ao]|decorad[ao]|moveis/i, feature: 'furnished' },
  { regex: /acabamento\s+moderno|modern[ao]|luminarias/i, feature: 'modern_fixtures' },
  { regex: /churrasqueira/i, feature: 'barbecue_grill' },
  { regex: /ar\s+condicionado/i, feature: 'air_conditioning' },
  { regex: /pe\s+direito\s+duplo|pe\s+direito\s+alto/i, feature: 'high_ceiling' },
  { regex: /fechamento\s+(?:em\s+)?vidro|cortina\s+de\s+vidro/i, feature: 'glass_enclosure' }
];

/**
 * Extrai a intenção semântica de um beat de texto
 * @param {string} beatText
 * @returns {Object} { requested_room_types, requested_features, visual_cues }
 */
function extractSemanticIntent(beatText) {
  if (!beatText || typeof beatText !== 'string') {
    return {
      requested_room_types: [],
      requested_features: [],
      visual_cues: []
    };
  }

  const normalizedText = removeDiacritics(beatText).toLowerCase();
  const words = normalizedText.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

  const requestedRoomTypes = new Set();
  const requestedFeatures = new Set();
  const visualCues = new Set();

  // 1. Detecção de cômodos por tokens
  for (const w of words) {
    if (ROOM_TAXONOMY_MAP[w]) {
      const room = ROOM_TAXONOMY_MAP[w];
      requestedRoomTypes.add(room);
      visualCues.add(w);
    }
  }

  // 2. Detecção de features por expressões e regex
  for (const item of FEATURE_EXPRESSIONS_MAP) {
    if (item.regex.test(normalizedText)) {
      requestedFeatures.add(item.feature);
      visualCues.add(item.feature);
    }
  }

  return {
    requested_room_types: Array.from(requestedRoomTypes).sort(),
    requested_features: Array.from(requestedFeatures).sort(),
    visual_cues: Array.from(visualCues).sort()
  };
}

module.exports = {
  INTENT_EXTRACTOR_VERSION,
  ROOM_TAXONOMY_MAP,
  FEATURE_EXPRESSIONS_MAP,
  extractSemanticIntent
};
