/**
 * Serviço de Compreensão Semântica de Mídia — Media Understanding Service
 * Bali Imóveis (Fase 4A.1)
 */

const fs = require('fs');
const path = require('path');
const propertyMediaService = require('../property_media/property_media_service');
const assetService = require('../asset_service');
const {
  SCHEMA_VERSION,
  DEFAULT_ANALYZER_TYPE,
  DEFAULT_ANALYZER_VERSION,
  DEFAULT_PROMPT_VERSION,
  computeAnalysisKey
} = require('./analysis_schema');
const {
  DEFAULT_SAMPLE_INTERVAL_MS,
  DEFAULT_MIN_SEGMENT_DURATION_MS,
  extractFramesUniformly,
  segmentContinuousTour
} = require('./semantic_segmenter');
const OpenAIMediaUnderstandingProvider = require('./providers/openai_vlm_provider');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const PROPERTIES_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'properties');

class MediaUnderstandingService {
  constructor() {
    this.defaultModelId = process.env.VLM_MODEL_ID || 'gpt-4o-mini';
  }

  /**
   * Ponto de entrada oficial para análise semântica do vídeo do imóvel
   */
  async analyzePropertyVideo(propertyRef, options = {}) {
    if (!propertyRef) {
      throw new Error('[MEDIA_UNDERSTANDING_ERROR] propertyRef é obrigatório');
    }

    const cleanRef = String(propertyRef).trim();
    const sampleIntervalMs = options.sampleIntervalMs || DEFAULT_SAMPLE_INTERVAL_MS;
    const minSegmentDurationMs = options.minSegmentDurationMs || DEFAULT_MIN_SEGMENT_DURATION_MS;
    const analyzerType = options.analyzerType || DEFAULT_ANALYZER_TYPE;
    const analyzerVersion = options.analyzerVersion || DEFAULT_ANALYZER_VERSION;
    const promptVersion = options.promptVersion || DEFAULT_PROMPT_VERSION;
    const modelId = options.modelId || this.defaultModelId;
    const customProvider = options.provider || null;

    // 1. Obter vídeo validado do Property Media Pool
    const pool = await propertyMediaService.getPropertyMediaPool(cleanRef);
    if (!pool || !Array.isArray(pool.videos) || pool.videos.length === 0) {
      throw new Error(`[MEDIA_UNDERSTANDING_ERROR] Nenhum property_video com status READY encontrado no pool para REF ${cleanRef}`);
    }

    const primaryVideo = pool.videos[0];
    const physicalPath = primaryVideo.storage_path;
    const physicalHash = primaryVideo.file_hash;
    const durationMs = primaryVideo.duration_ms;

    if (!physicalPath || !fs.existsSync(physicalPath)) {
      throw new Error(`[MEDIA_UNDERSTANDING_ERROR] Arquivo físico de vídeo não encontrado em: ${physicalPath}`);
    }

    // 2. Validação de integridade física imediata
    const actualHash = assetService.computeFileHash(physicalPath);
    if (actualHash !== physicalHash) {
      throw new Error(`[MEDIA_UNDERSTANDING_ERROR] Divergência de file_hash no vídeo da REF ${cleanRef}: esperado ${physicalHash}, obtido ${actualHash}`);
    }

    // 3. Cálculo determinístico do Analysis Fingerprint
    const analysisKey = computeAnalysisKey({
      physical_file_hash: physicalHash,
      analyzer_type: analyzerType,
      analyzer_version: analyzerVersion,
      model_id: modelId,
      prompt_version: promptVersion,
      schema_version: SCHEMA_VERSION
    });

    const propAnalysisDir = path.join(PROPERTIES_OUTPUTS_DIR, cleanRef, 'analysis', analysisKey);
    const analysisFilePath = path.join(propAnalysisDir, 'analysis.json');
    const framesDir = path.join(propAnalysisDir, 'frames');

    // 4. Verificação de Cache Hit Imutável
    if (fs.existsSync(analysisFilePath)) {
      try {
        const cachedRaw = fs.readFileSync(analysisFilePath, 'utf8');
        const cachedAnalysis = JSON.parse(cachedRaw);

        if (
          cachedAnalysis.analysis_key === analysisKey &&
          cachedAnalysis.physical_file_hash === physicalHash &&
          Array.isArray(cachedAnalysis.segments) &&
          cachedAnalysis.segments.length > 0
        ) {
          return {
            status: 'READY',
            source: 'cache_hit',
            analysis_key: analysisKey,
            analysis: cachedAnalysis
          };
        }
      } catch (cacheReadErr) {
        console.warn(`[MEDIA_UNDERSTANDING_WARNING] Cache corrompido em ${analysisFilePath}, re-executando análise:`, cacheReadErr.message);
      }
    }

    // 5. Cache Miss: Execução da Análise
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // A. Extração Uniforme de Frames
    const extractedSamples = await extractFramesUniformly(physicalPath, {
      sampleIntervalMs,
      outputDir: framesDir,
      totalDurationMs: durationMs
    });

    // B. Provedor VLM
    const provider = customProvider || new OpenAIMediaUnderstandingProvider({ modelId });

    // C. Classificação dos Frames
    const classifiedSamples = await provider.analyzeFramesBatch(extractedSamples);

    // D. Segmentação Temporal Contínua
    const segments = segmentContinuousTour(classifiedSamples, {
      minSegmentDurationMs,
      totalDurationMs: durationMs,
      sampleIntervalMs
    });

    // E. Sumário da Análise
    const discoveredRooms = Array.from(new Set(segments.map(s => s.room_type)));
    const avgQuality = segments.reduce((acc, s) => acc + s.technical_quality_score, 0) / (segments.length || 1);
    const avgConfidence = segments.reduce((acc, s) => acc + s.confidence, 0) / (segments.length || 1);

    const fullAnalysis = {
      analysis_key: analysisKey,
      property_ref: cleanRef,
      asset_id: primaryVideo.asset_id,
      physical_file_hash: physicalHash,
      media_type: 'video',
      duration_ms: durationMs,
      specs: primaryVideo.specs || {},
      analyzer_metadata: {
        analyzer_type: analyzerType,
        analyzer_version: analyzerVersion,
        model_id: modelId,
        prompt_version: promptVersion,
        schema_version: SCHEMA_VERSION,
        sample_interval_ms: sampleIntervalMs,
        min_segment_duration_ms: minSegmentDurationMs
      },
      summary: {
        total_samples: classifiedSamples.length,
        total_segments: segments.length,
        discovered_rooms: discoveredRooms,
        average_quality_score: Math.round(avgQuality * 100) / 100,
        average_confidence: Math.round(avgConfidence * 100) / 100
      },
      segments,
      raw_samples: classifiedSamples.map(s => ({
        timestamp_ms: s.timestamp_ms,
        frame_path: s.frame_path,
        room_type: s.room_type,
        features: s.features,
        technical_quality_score: s.technical_quality_score,
        aesthetic_score: s.aesthetic_score,
        confidence: s.confidence,
        description: s.description || ''
      })),
      created_at: new Date().toISOString()
    };

    // F. Persistência Atômica do Artefato Imutável
    const tmpFilePath = path.join(propAnalysisDir, `.tmp_${Date.now()}_analysis.json`);
    fs.writeFileSync(tmpFilePath, JSON.stringify(fullAnalysis, null, 2), 'utf8');
    fs.renameSync(tmpFilePath, analysisFilePath);

    return {
      status: 'READY',
      source: 'computed',
      analysis_key: analysisKey,
      analysis: fullAnalysis
    };
  }
}

const instance = new MediaUnderstandingService();
module.exports = instance;
