/**
 * Provedor Mock Determinístico de Alinhamento Forçado — Script Timing (Fase 4A.2)
 * Bali Imóveis
 */

const BaseScriptAlignmentProvider = require('./base_script_alignment_provider');
const { tokenizeScript } = require('../text_normalizer');

class MockScriptAlignmentProvider extends BaseScriptAlignmentProvider {
  constructor({
    modelId = 'mock-aligner-v1',
    mockWords = null,
    wpm = 150, // Palavras por minuto simuladas (~400ms por palavra)
    pauseAfterPunctuationMs = 300
  } = {}) {
    super({ modelId, providerName: 'mock_script_aligner' });
    this.mockWords = mockWords;
    this.wpm = wpm;
    this.pauseAfterPunctuationMs = pauseAfterPunctuationMs;
  }

  async alignScriptWithAudio({ audioPath, scriptText, language = 'pt' } = {}) {
    if (this.mockWords) {
      return this.mockWords.map(w => ({
        word: String(w.word || w.raw_word || ''),
        start_ms: Math.round(Number(w.start_ms !== undefined ? w.start_ms : (w.start || 0) * 1000)),
        end_ms: Math.round(Number(w.end_ms !== undefined ? w.end_ms : (w.end || 0) * 1000)),
        confidence: Number(w.confidence !== undefined ? w.confidence : 1.0)
      }));
    }

    // Gerar palavras sintéticas baseadas no scriptText
    const { tokens } = tokenizeScript(scriptText || '');
    if (tokens.length === 0) return [];

    const msPerWord = Math.round((60000 / this.wpm) * 0.85);
    const words = [];
    let currentCursorMs = 100;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const wordLen = token.raw_word.length;
      // Duração proporcional ao tamanho da palavra
      const wordDurationMs = Math.max(180, Math.round(msPerWord * (0.6 + (wordLen / 10))));
      const startMs = currentCursorMs;
      const endMs = startMs + wordDurationMs;

      words.push({
        word: token.raw_word,
        start_ms: startMs,
        end_ms: endMs,
        confidence: 0.98
      });

      const isPunctuationBreak = /[.,!?;:]/.test(token.raw_word);
      const gap = isPunctuationBreak ? this.pauseAfterPunctuationMs : 60;
      currentCursorMs = endMs + gap;
    }

    return words;
  }
}

module.exports = MockScriptAlignmentProvider;
