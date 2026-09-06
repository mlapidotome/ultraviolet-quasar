/**
 * Módulo de Segmentação de Semantic Beats — Script Timing (Fase 4A.2)
 * Bali Imóveis
 */

const { validateSemanticBeat } = require('./alignment_schema');
const { removeDiacritics } = require('./text_normalizer');

const BEAT_PARSER_VERSION = '1.0.0';

/**
 * Palavras-chave semânticas associadas a cômodos e atributos para matching da Fase 4A.3
 */
const ROOM_FEATURE_KEYWORDS = {
  sala: 'living_room',
  estar: 'living_room',
  jantar: 'dining_room',
  cozinha: 'kitchen',
  varanda: 'balcony',
  sacada: 'balcony',
  gourmet: 'balcony',
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
  garagem: 'garage',
  vaga: 'garage',
  vagas: 'garage',
  piscina: 'pool',
  churrasqueira: 'barbecue_grill',
  vista: 'city_view'
};

/**
 * Conjunções e preposições que indicam transição natural de oração em português
 */
const CLAUSE_TRANSITIONS = new Set(['para', 'com', 'onde', 'quando', 'porque', 'enquanto', 'alem', 'além']);

/**
 * Extrai palavras-chave ou cues semânticas de um texto
 */
function extractCueKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = removeDiacritics(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const cues = new Set();

  for (const w of words) {
    if (ROOM_FEATURE_KEYWORDS[w]) {
      cues.add(ROOM_FEATURE_KEYWORDS[w]);
    }
  }

  return Array.from(cues).sort();
}

/**
 * Segmenta uma lista de palavras alinhadas em Semantic Beats coerentes
 */
function parseSemanticBeats(alignedWords, {
  minBeatDurationMs = 1500,
  targetBeatDurationMs = 3000,
  maxBeatDurationMs = 4500,
  pauseThresholdMs = 300
} = {}) {
  if (!Array.isArray(alignedWords) || alignedWords.length === 0) {
    return [];
  }

  const beats = [];
  let currentWordIndices = [];
  let beatIndex = 0;

  for (let i = 0; i < alignedWords.length; i++) {
    const currentWord = alignedWords[i];
    currentWordIndices.push(i);

    const firstWordIndex = currentWordIndices[0];
    const firstWord = alignedWords[firstWordIndex];
    const currentDuration = currentWord.end_ms - firstWord.start_ms;

    const isLastWord = (i === alignedWords.length - 1);
    const nextWord = isLastWord ? null : alignedWords[i + 1];

    // Detecção de pausas de áudio
    const audioPauseAfterMs = nextWord ? (nextWord.start_ms - currentWord.end_ms) : 0;
    const hasAudioPause = audioPauseAfterMs >= pauseThresholdMs;

    // Detecção de pontuação no texto original da palavra
    const wordText = currentWord.raw_word || currentWord.word || '';
    const hasStrongPunctuation = /[.?!]/.test(wordText);
    const hasSoftPunctuation = /[,;:]/.test(wordText);

    // Detecção de transição de oração na próxima palavra
    const nextWordNorm = nextWord ? removeDiacritics(nextWord.raw_word || nextWord.word || '').toLowerCase() : '';
    const nextIsTransition = CLAUSE_TRANSITIONS.has(nextWordNorm);

    let shouldCloseBeat = false;

    if (isLastWord) {
      shouldCloseBeat = true;
    } else if (hasStrongPunctuation) {
      shouldCloseBeat = true;
    } else if (hasAudioPause && currentDuration >= minBeatDurationMs) {
      shouldCloseBeat = true;
    } else if (hasSoftPunctuation && currentDuration >= minBeatDurationMs) {
      shouldCloseBeat = true;
    } else if (nextIsTransition && currentDuration >= minBeatDurationMs) {
      shouldCloseBeat = true;
    } else if (currentDuration >= maxBeatDurationMs) {
      shouldCloseBeat = true;
    }

    if (shouldCloseBeat) {
      const beatWords = currentWordIndices.map(idx => alignedWords[idx]);
      const startMs = beatWords[0].start_ms;
      const endMs = beatWords[beatWords.length - 1].end_ms;
      const beatText = beatWords.map(w => w.raw_word || w.word).join(' ');

      const beat = {
        beat_index: beatIndex++,
        text: beatText,
        start_ms: startMs,
        end_ms: endMs,
        duration_ms: endMs - startMs,
        word_indices: [...currentWordIndices],
        cue_keywords: extractCueKeywords(beatText)
      };

      validateSemanticBeat(beat);
      beats.push(beat);
      currentWordIndices = [];
    }
  }

  return beats;
}

module.exports = {
  BEAT_PARSER_VERSION,
  extractCueKeywords,
  parseSemanticBeats
};
