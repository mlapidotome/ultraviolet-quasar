/**
 * Módulo de Normalização de Texto e Alinhamento de Tokens — Script Timing (Fase 4A.2)
 * Bali Imóveis
 */

const crypto = require('crypto');

const NORMALIZATION_VERSION = '1.0.0';

/**
 * Mapeamento de números comuns em português
 */
const NUMBER_WORDS_PT = {
  '0': 'zero',
  '1': 'um',
  '2': 'dois',
  '3': 'tres',
  '4': 'quatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'sete',
  '8': 'oito',
  '9': 'nove',
  '10': 'dez',
  '1º': 'primeiro',
  '2º': 'segundo',
  '3º': 'terceiro',
  '1a': 'primeira',
  '2a': 'segunda',
  '3a': 'terceira'
};

/**
 * Remove acentos diacríticos preservando caracteres base
 */
function removeDiacritics(str) {
  if (!str || typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza moeda e abreviações financeiras em português
 * Ex: "R$ 480 mil" -> "480 mil reais", "R$ 1.200.000" -> "1200000 reais"
 */
function normalizeCurrencyAndNumbers(text) {
  if (!text || typeof text !== 'string') return '';
  let res = text;

  // Normalizar R$ 480 mil / R$ 480k / R$ 480.000
  res = res.replace(/R\$\s*(\d+(?:[.,]\d+)?)\s*(mil|milhoes|milhões|k)/gi, (match, num, mult) => {
    const cleanNum = num.replace(',', '.');
    const m = mult.toLowerCase().startsWith('milh') ? 'milhoes' : 'mil';
    return cleanNum + ' ' + m + ' reais';
  });

  res = res.replace(/R\$\s*(\d+(?:\.\d{3})*(?:,\d+)?)/gi, (match, num) => {
    const cleanNum = num.replace(/\./g, '').replace(',', '.');
    return cleanNum + ' reais';
  });

  // Normalizar m² / m2
  res = res.replace(/(\d+)\s*m[²2]/gi, '$1 metros quadrados');

  // Normalizar %
  res = res.replace(/(\d+)\s*%/gi, '$1 por cento');

  return res;
}

/**
 * Normalização fonética/textual estrita para reconciliação
 */
function normalizeForComparison(word) {
  if (!word || typeof word !== 'string') return '';
  const clean = removeDiacritics(word)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  if (NUMBER_WORDS_PT[clean]) {
    return NUMBER_WORDS_PT[clean];
  }

  return clean;
}

/**
 * Tokeniza o texto do roteiro preservando posições originais (proveniência) e pontuação de borda
 */
function tokenizeScript(scriptText) {
  if (!scriptText || typeof scriptText !== 'string') {
    return { tokens: [], normalizedScript: '', rawText: '' };
  }

  const rawText = scriptText.trim();
  const regex = /([^\s\n\r]+)/g;
  const tokens = [];
  let match;
  let tokenIndex = 0;

  while ((match = regex.exec(rawText)) !== null) {
    const rawWord = match[1];
    const startIndex = match.index;
    const endIndex = startIndex + rawWord.length;
    
    // Palavra limpa para normalização fonética
    const cleanWord = rawWord.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    const normalizedWord = normalizeForComparison(cleanWord);

    if (cleanWord.length > 0) {
      tokens.push({
        token_index: tokenIndex++,
        raw_word: rawWord, // Preserva pontuação original (ex: "dia?", "vídeos,")
        clean_word: cleanWord,
        normalized_word: normalizedWord,
        start_char: startIndex,
        end_char: endIndex
      });
    }
  }

  const normalizedScript = tokens.map(t => t.normalized_word).filter(Boolean).join(' ');

  return {
    tokens,
    normalizedScript,
    rawText
  };
}

/**
 * Calcula o hash SHA-256 do roteiro normalizado
 */
function computeNormalizedScriptHash(scriptText) {
  const { normalizedScript } = tokenizeScript(scriptText);
  return crypto.createHash('sha256').update(normalizedScript, 'utf8').digest('hex');
}

/**
 * Distância de Levenshtein entre duas strings para tolerância a pequenos erros de ASR
 */
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return d[m][n];
}

/**
 * Similaridade entre duas palavras normalizadas (0.0 a 1.0)
 */
function wordSimilarity(w1, w2) {
  if (!w1 && !w2) return 1.0;
  if (!w1 || !w2) return 0.0;
  if (w1 === w2) return 1.0;

  const maxLen = Math.max(w1.length, w2.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(w1, w2);
  return Math.max(0.0, 1.0 - (dist / maxLen));
}

/**
 * Reconcilia as palavras do ASR (Whisper) com os tokens do roteiro conhecido via Needleman-Wunsch / Dynamic Programming
 */
function reconcileScriptWithAlignedWords(scriptTokens, alignedWords, { minSimilarityThreshold = 0.65 } = {}) {
  const n = scriptTokens.length;
  const m = alignedWords.length;

  if (n === 0 || m === 0) {
    return {
      aligned_pairs: [],
      token_coverage: 0,
      aligned_word_count: 0,
      total_script_tokens: n,
      total_audio_words: m,
      unmatched_script_tokens: scriptTokens.slice(),
      unmatched_audio_words: alignedWords.slice()
    };
  }

  const score = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const traceback = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  const GAP_SCRIPT = 1;
  const GAP_AUDIO = 2;
  const MATCH = 3;

  for (let i = 1; i <= n; i++) {
    score[i][0] = i * -1;
    traceback[i][0] = GAP_AUDIO;
  }
  for (let j = 1; j <= m; j++) {
    score[0][j] = j * -1;
    traceback[0][j] = GAP_SCRIPT;
  }

  for (let i = 1; i <= n; i++) {
    const sNorm = scriptTokens[i - 1].normalized_word;
    for (let j = 1; j <= m; j++) {
      const aNorm = normalizeForComparison(alignedWords[j - 1].word);
      const sim = wordSimilarity(sNorm, aNorm);
      const matchScore = sim >= minSimilarityThreshold ? (sim * 3.0) : -1.5;

      const diagonalScore = score[i - 1][j - 1] + matchScore;
      const upScore = score[i - 1][j] - 1.0;
      const leftScore = score[i][j - 1] - 1.0;

      let bestScore = diagonalScore;
      let bestMove = MATCH;

      if (upScore > bestScore) {
        bestScore = upScore;
        bestMove = GAP_AUDIO;
      }
      if (leftScore > bestScore) {
        bestScore = leftScore;
        bestMove = GAP_SCRIPT;
      }

      score[i][j] = bestScore;
      traceback[i][j] = bestMove;
    }
  }

  let i = n;
  let j = m;
  const alignedPairs = [];
  const matchedScriptIndices = new Set();
  const matchedAudioIndices = new Set();

  while (i > 0 && j > 0) {
    if (traceback[i][j] === MATCH) {
      const sToken = scriptTokens[i - 1];
      const aWord = alignedWords[j - 1];
      const sNorm = sToken.normalized_word;
      const aNorm = normalizeForComparison(aWord.word);
      const sim = wordSimilarity(sNorm, aNorm);

      if (sim >= minSimilarityThreshold) {
        const startMs = Math.round(Number(aWord.start_ms !== undefined ? aWord.start_ms : (aWord.start || 0) * 1000));
        let endMs = Math.round(Number(aWord.end_ms !== undefined ? aWord.end_ms : (aWord.end || 0) * 1000));
        if (endMs <= startMs) {
          endMs = startMs + 80;
        }

        alignedPairs.unshift({
          script_token_index: sToken.token_index,
          raw_word: sToken.raw_word,
          clean_word: sToken.clean_word,
          normalized_word: sToken.normalized_word,
          audio_word: aWord.word,
          start_ms: startMs,
          end_ms: endMs,
          confidence: Number(aWord.confidence !== undefined ? aWord.confidence : 1.0),
          similarity: Math.round(sim * 100) / 100
        });
        matchedScriptIndices.add(i - 1);
        matchedAudioIndices.add(j - 1);
      }
      i--;
      j--;
    } else if (traceback[i][j] === GAP_AUDIO) {
      i--;
    } else {
      j--;
    }
  }

  const tokenCoverage = n > 0 ? (matchedScriptIndices.size / n) : 0;
  const unmatchedScriptTokens = scriptTokens.filter((_, idx) => !matchedScriptIndices.has(idx));
  const unmatchedAudioWords = alignedWords.filter((_, idx) => !matchedAudioIndices.has(idx));

  return {
    aligned_pairs: alignedPairs,
    token_coverage: Math.round(tokenCoverage * 1000) / 1000,
    aligned_word_count: alignedPairs.length,
    total_script_tokens: n,
    total_audio_words: m,
    unmatched_script_tokens: unmatchedScriptTokens,
    unmatched_audio_words: unmatchedAudioWords
  };
}

module.exports = {
  NORMALIZATION_VERSION,
  removeDiacritics,
  normalizeCurrencyAndNumbers,
  normalizeForComparison,
  tokenizeScript,
  computeNormalizedScriptHash,
  levenshteinDistance,
  wordSimilarity,
  reconcileScriptWithAlignedWords
};
