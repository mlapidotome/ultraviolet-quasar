/**
 * Serviço Principal de Script Timing e Forced Alignment — Video Engine V2
 * Bali Imóveis (Fase 4A.2)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const assetService = require('../asset_service');
const {
  SCHEMA_VERSION,
  DEFAULT_ALIGNMENT_ENGINE,
  DEFAULT_ENGINE_VERSION,
  DEFAULT_MODEL_ID,
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_BEAT_PARSER_VERSION,
  DEFAULT_BEAT_PROMPT_VERSION,
  MIN_TOKEN_COVERAGE,
  validateWordAlignment,
  validateSemanticBeat,
  computeAlignmentKey,
  computeBeatAnalysisKey
} = require('./alignment_schema');
const {
  tokenizeScript,
  computeNormalizedScriptHash,
  reconcileScriptWithAlignedWords
} = require('./text_normalizer');
const { parseSemanticBeats, BEAT_PARSER_VERSION } = require('./beat_parser');
const OpenAIWhisperAlignmentProvider = require('./providers/openai_whisper_alignment_provider');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

class ScriptTimingService {
  constructor() {
    this.defaultModelId = process.env.WHISPER_MODEL_ID || DEFAULT_MODEL_ID;
  }

  /**
   * Extrai áudio PCM mono 16kHz de arquivo de vídeo sem alterar o vídeo original
   */
  async extractAudioFromVideo(videoPath, targetAudioPath) {
    const dir = path.dirname(targetAudioPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    return new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y',
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        targetAudioPath
      ], (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`[SCRIPT_TIMING_ERROR] Falha ao extrair áudio com FFmpeg: ${err.message}`));
        }
        resolve(targetAudioPath);
      });
    });
  }

  /**
   * Ponto de entrada oficial para alinhamento de roteiro com áudio do apresentador
   */
  async alignJobScript({
    jobId,
    presenterAssetPath,
    scriptText,
    language = 'pt',
    options = {}
  } = {}) {
    if (!jobId) {
      throw new Error('[SCRIPT_TIMING_ERROR] jobId é obrigatório');
    }
    if (!presenterAssetPath || !fs.existsSync(presenterAssetPath)) {
      throw new Error(`[SCRIPT_TIMING_ERROR] presenterAssetPath não encontrado em: ${presenterAssetPath}`);
    }
    if (!scriptText || typeof scriptText !== 'string' || !scriptText.trim()) {
      throw new Error('[SCRIPT_TIMING_ERROR] scriptText é obrigatório e não pode ser vazio');
    }

    const cleanJobId = String(jobId).trim();
    const cleanScript = scriptText.trim();
    const alignmentEngine = options.alignmentEngine || DEFAULT_ALIGNMENT_ENGINE;
    const engineVersion = options.engineVersion || DEFAULT_ENGINE_VERSION;
    const normalizationVersion = options.normalizationVersion || DEFAULT_NORMALIZATION_VERSION;
    const beatParserVersion = options.beatParserVersion || DEFAULT_BEAT_PARSER_VERSION;
    const beatPromptVersion = options.beatPromptVersion || DEFAULT_BEAT_PROMPT_VERSION;
    const modelId = options.modelId || this.defaultModelId;
    const minCoverage = options.minTokenCoverage !== undefined ? options.minTokenCoverage : MIN_TOKEN_COVERAGE;
    const customProvider = options.provider || null;

    // 1. Preparação do áudio físico (extrair WAV se for MP4/MOV/etc)
    const ext = path.extname(presenterAssetPath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext);
    
    let audioPath = presenterAssetPath;
    let tempAudioCreated = false;

    const jobDir = path.join(JOBS_OUTPUTS_DIR, cleanJobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    if (isVideo) {
      const audioFileName = `presenter_audio_${cleanJobId}.wav`;
      audioPath = path.join(jobDir, audioFileName);
      if (!fs.existsSync(audioPath)) {
        await this.extractAudioFromVideo(presenterAssetPath, audioPath);
        tempAudioCreated = true;
      }
    }

    // 2. Cálculo dos hashes físicos e semânticos
    const audioPhysicalHash = assetService.computeFileHash(audioPath);
    const normalizedScriptHash = computeNormalizedScriptHash(cleanScript);
    const { tokens: scriptTokens } = tokenizeScript(cleanScript);

    // 3. Cálculo determinístico do Alignment Fingerprint
    const alignmentKey = computeAlignmentKey({
      audio_physical_hash: audioPhysicalHash,
      normalized_script_hash: normalizedScriptHash,
      alignment_engine: alignmentEngine,
      engine_version: engineVersion,
      model_id: modelId,
      normalization_version: normalizationVersion,
      schema_version: SCHEMA_VERSION
    });

    const beatAnalysisKey = computeBeatAnalysisKey({
      alignment_key: alignmentKey,
      beat_parser_version: beatParserVersion,
      prompt_version: beatPromptVersion,
      schema_version: SCHEMA_VERSION
    });

    const alignmentDir = path.join(jobDir, 'script_alignment', alignmentKey);
    const alignmentFilePath = path.join(alignmentDir, 'alignment.json');
    const beatsDir = path.join(alignmentDir, 'beats', beatAnalysisKey);
    const beatsFilePath = path.join(beatsDir, 'beats.json');

    // 4. Verificação de Cache Hit Imutável
    if (fs.existsSync(alignmentFilePath) && fs.existsSync(beatsFilePath)) {
      try {
        const cachedAlignRaw = fs.readFileSync(alignmentFilePath, 'utf8');
        const cachedBeatsRaw = fs.readFileSync(beatsFilePath, 'utf8');
        const cachedAlign = JSON.parse(cachedAlignRaw);
        const cachedBeats = JSON.parse(cachedBeatsRaw);

        if (
          cachedAlign.alignment_key === alignmentKey &&
          cachedAlign.audio_physical_hash === audioPhysicalHash &&
          cachedBeats.beat_analysis_key === beatAnalysisKey &&
          Array.isArray(cachedAlign.words) &&
          Array.isArray(cachedBeats.beats)
        ) {
          return {
            status: 'READY',
            from_cache: true,
            job_id: cleanJobId,
            alignment_key: alignmentKey,
            beat_analysis_key: beatAnalysisKey,
            token_coverage: cachedAlign.token_coverage,
            aligned_word_count: cachedAlign.aligned_word_count,
            total_script_tokens: cachedAlign.total_script_tokens,
            total_audio_words: cachedAlign.total_audio_words,
            words: cachedAlign.words,
            beats: cachedBeats.beats,
            audio_physical_hash: audioPhysicalHash,
            normalized_script_hash: normalizedScriptHash,
            alignment_path: alignmentFilePath,
            beats_path: beatsFilePath
          };
        }
      } catch (cacheErr) {
        // Cache corrompido, prosseguir com nova execução
      }
    }

    // 5. Invocação do Provedor de Alinhamento
    const provider = customProvider || new OpenAIWhisperAlignmentProvider({ modelId });
    const rawAlignedWords = await provider.alignScriptWithAudio({
      audioPath,
      scriptText: cleanScript,
      language
    });

    if (!Array.isArray(rawAlignedWords) || rawAlignedWords.length === 0) {
      throw new Error('[SCRIPT_TIMING_ERROR] Provedor de alinhamento não retornou palavras');
    }

    // 6. Reconciliação dos tokens do roteiro conhecido com as palavras identificadas
    const reconciliation = reconcileScriptWithAlignedWords(scriptTokens, rawAlignedWords);

    if (reconciliation.token_coverage < minCoverage) {
      throw new Error(
        `[SCRIPT_TIMING_ERROR] Token coverage insuficiente: ${(reconciliation.token_coverage * 100).toFixed(1)}% ` +
        `(mínimo exigido: ${(minCoverage * 100).toFixed(1)}%). ` +
        `O áudio do apresentador diverge substancialmente do roteiro fornecido.`
      );
    }

    // 7. Validação estrita de schema para cada palavra alinhada
    const alignedWords = reconciliation.aligned_pairs;
    for (const w of alignedWords) {
      validateWordAlignment(w);
    }

    // 8. Derivação e Validação dos Semantic Beats
    const beats = parseSemanticBeats(alignedWords, options.beatParserOptions);
    for (const b of beats) {
      validateSemanticBeat(b);
    }

    // 9. Persistência Atômica dos Artefatos Shadow
    if (!fs.existsSync(alignmentDir)) fs.mkdirSync(alignmentDir, { recursive: true });
    if (!fs.existsSync(beatsDir)) fs.mkdirSync(beatsDir, { recursive: true });

    const alignmentPayload = {
      schema_version: SCHEMA_VERSION,
      alignment_key: alignmentKey,
      job_id: cleanJobId,
      audio_physical_hash: audioPhysicalHash,
      normalized_script_hash: normalizedScriptHash,
      alignment_engine: alignmentEngine,
      engine_version: engineVersion,
      model_id: modelId,
      normalization_version: normalizationVersion,
      token_coverage: reconciliation.token_coverage,
      aligned_word_count: reconciliation.aligned_word_count,
      total_script_tokens: reconciliation.total_script_tokens,
      total_audio_words: reconciliation.total_audio_words,
      words: alignedWords,
      created_at: new Date().toISOString()
    };

    const beatsPayload = {
      schema_version: SCHEMA_VERSION,
      beat_analysis_key: beatAnalysisKey,
      alignment_key: alignmentKey,
      job_id: cleanJobId,
      beat_parser_version: beatParserVersion,
      prompt_version: beatPromptVersion,
      beats_count: beats.length,
      beats: beats,
      created_at: new Date().toISOString()
    };

    // Escrita atômica (temp file + rename)
    const randSuffix = crypto.randomBytes(4).toString('hex');
    const tempAlignPath = path.join(alignmentDir, `align_tmp_${randSuffix}.json`);
    const tempBeatsPath = path.join(beatsDir, `beats_tmp_${randSuffix}.json`);

    fs.writeFileSync(tempAlignPath, JSON.stringify(alignmentPayload, null, 2), 'utf8');
    fs.renameSync(tempAlignPath, alignmentFilePath);

    fs.writeFileSync(tempBeatsPath, JSON.stringify(beatsPayload, null, 2), 'utf8');
    fs.renameSync(tempBeatsPath, beatsFilePath);

    return {
      status: 'READY',
      from_cache: false,
      job_id: cleanJobId,
      alignment_key: alignmentKey,
      beat_analysis_key: beatAnalysisKey,
      token_coverage: reconciliation.token_coverage,
      aligned_word_count: reconciliation.aligned_word_count,
      total_script_tokens: reconciliation.total_script_tokens,
      total_audio_words: reconciliation.total_audio_words,
      words: alignedWords,
      beats: beats,
      audio_physical_hash: audioPhysicalHash,
      normalized_script_hash: normalizedScriptHash,
      alignment_path: alignmentFilePath,
      beats_path: beatsFilePath
    };
  }
}

const scriptTimingService = new ScriptTimingService();
module.exports = scriptTimingService;
module.exports.ScriptTimingService = ScriptTimingService;
