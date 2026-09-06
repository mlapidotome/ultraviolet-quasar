/**
 * Provedor OpenAI Whisper para Word-Level Timestamp Forced Alignment — Script Timing (Fase 4A.2)
 * Bali Imóveis
 */

const fs = require('fs');
const path = require('path');
const BaseScriptAlignmentProvider = require('./base_script_alignment_provider');

class OpenAIWhisperAlignmentProvider extends BaseScriptAlignmentProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    modelId = 'whisper-1',
    timeoutMs = 60000
  } = {}) {
    super({ modelId, providerName: 'openai_whisper' });
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async alignScriptWithAudio({ audioPath, scriptText, language = 'pt' } = {}) {
    if (!this.apiKey) {
      throw new Error('[OPENAI_WHISPER_ERROR] OPENAI_API_KEY não configurada no ambiente (.env)');
    }

    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`[OPENAI_WHISPER_ERROR] Arquivo de áudio não encontrado em: ${audioPath}`);
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const fileName = path.basename(audioPath) || 'audio.wav';
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mpeg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/wav');

    const fileBlob = new Blob([audioBuffer], { type: mimeType });
    const formData = new FormData();
    formData.append('file', fileBlob, fileName);
    formData.append('model', this.modelId);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    if (language) {
      formData.append('language', language);
    }
    if (scriptText && scriptText.trim()) {
      formData.append('prompt', scriptText.trim().slice(0, 1000));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp;
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData,
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`[OPENAI_WHISPER_ERROR] Timeout de ${this.timeoutMs}ms ao chamar Whisper API`);
      }
      throw new Error(`[OPENAI_WHISPER_ERROR] Falha de rede ao conectar à Whisper API: ${err.message}`);
    }

    clearTimeout(timeoutId);

    if (!resp.ok) {
      let errBody = '';
      try {
        errBody = await resp.text();
      } catch (e) {}
      throw new Error(`[OPENAI_WHISPER_ERROR] Whisper API retornou HTTP ${resp.status}: ${errBody}`);
    }

    const data = await resp.json();
    if (!data || !Array.isArray(data.words)) {
      throw new Error('[OPENAI_WHISPER_ERROR] Resposta da Whisper API não continha array de palavras');
    }

    return data.words.map(w => {
      const startMs = Math.round(Number(w.start || 0) * 1000);
      let endMs = Math.round(Number(w.end || 0) * 1000);
      if (endMs <= startMs) {
        endMs = startMs + 80;
      }
      return {
        word: String(w.word || '').trim(),
        start_ms: startMs,
        end_ms: endMs,
        confidence: 1.0
      };
    });
  }
}

module.exports = OpenAIWhisperAlignmentProvider;
