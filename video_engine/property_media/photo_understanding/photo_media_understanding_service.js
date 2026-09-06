/**
 * Serviço Orquestrador de Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  SCHEMA_VERSION,
  DEFAULT_ANALYZER_TYPE,
  DEFAULT_ANALYZER_VERSION,
  DEFAULT_PROMPT_VERSION,
  DEFAULT_QUALITY_RULES_VERSION,
  TAXONOMY_VERSION,
  computePhotoAnalysisKey,
  validateGlobalPhotoAnalysis,
  validateStrictRoomType,
  normalizeAndValidateSecondaryRooms,
  normalizeAndValidateFeatures,
  validateStrictScore
} = require('./photo_analysis_schema');

const { QualityEvaluator, QUALITY_RULES_VERSION } = require('./quality_evaluator');
const { CrmCategoryReconciler } = require('./crm_category_reconciler');
const OpenAIPhotoUnderstandingProvider = require('./providers/openai_photo_understanding_provider');
const MockPhotoUnderstandingProvider = require('./providers/mock_photo_understanding_provider');

const PHOTO_ANALYSIS_BASE_DIR = path.join(__dirname, '..', '..', '..', 'outputs', 'media_analysis', 'photos');
const PHOTO_ANALYSIS_TMP_DIR = path.join(PHOTO_ANALYSIS_BASE_DIR, '.tmp');

class PhotoMediaUnderstandingService {
  constructor({
    provider = null,
    baseOutputDir = PHOTO_ANALYSIS_BASE_DIR,
    tmpDir = PHOTO_ANALYSIS_TMP_DIR
  } = {}) {
    if (provider) {
      this.provider = provider;
    } else if (process.env.OPENAI_API_KEY) {
      this.provider = new OpenAIPhotoUnderstandingProvider();
    } else {
      this.provider = new MockPhotoUnderstandingProvider();
    }

    this.baseOutputDir = baseOutputDir;
    this.tmpDir = tmpDir;
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.baseOutputDir)) {
      fs.mkdirSync(this.baseOutputDir, { recursive: true });
    }
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  getCanonicalCachePath(photoAnalysisKey) {
    return path.join(this.baseOutputDir, photoAnalysisKey, 'analysis.json');
  }

  /**
   * Analisa um blob físico de imagem e persiste o resultado canônico global
   * Retorna estritamente GlobalPhotoAnalysis (zero dados de propriedade)
   */
  async analyzePhotoBlob({ physical_file_hash, storage_path, specs = {}, options = {} }) {
    if (!physical_file_hash || typeof physical_file_hash !== 'string') {
      throw new Error('[PHOTO_UNDERSTANDING_ERROR] physical_file_hash é obrigatório');
    }
    if (!storage_path || !fs.existsSync(storage_path)) {
      throw new Error(`[PHOTO_UNDERSTANDING_ERROR] Arquivo físico não encontrado: ${storage_path}`);
    }

    const providerConfig = this.provider.getBehavioralConfig ? this.provider.getBehavioralConfig() : {};

    // 1. Cálculo Determinístico do Analysis Key
    const photoAnalysisKey = computePhotoAnalysisKey({
      physical_file_hash,
      analyzer_type: DEFAULT_ANALYZER_TYPE,
      analyzer_version: DEFAULT_ANALYZER_VERSION,
      model_id: this.provider.modelId || 'unknown',
      prompt_version: DEFAULT_PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
      quality_rules_version: QUALITY_RULES_VERSION,
      taxonomy_version: TAXONOMY_VERSION,
      provider_config: providerConfig
    });

    const canonicalPath = this.getCanonicalCachePath(photoAnalysisKey);

    // 2. Verificação de Cache Hit Global
    if (fs.existsSync(canonicalPath)) {
      try {
        const cachedRaw = fs.readFileSync(canonicalPath, 'utf8');
        const cachedJson = JSON.parse(cachedRaw);
        const validated = validateGlobalPhotoAnalysis(cachedJson);
        return {
          photo_analysis_key: photoAnalysisKey,
          analysis: validated,
          cache_hit: true
        };
      } catch (cacheErr) {
        console.warn(`[PHOTO_UNDERSTANDING_WARN] Cache existente corrompido para key ${photoAnalysisKey}:`, cacheErr.message);
      }
    }

    // 3. Cache Miss: Execução da Análise Visual via Provider
    const rawResult = await this.provider.analyzePhoto({
      imageInput: storage_path,
      specs,
      options: { ...options, physical_file_hash }
    });

    if (!rawResult || typeof rawResult !== 'object') {
      throw new Error('[PHOTO_UNDERSTANDING_ERROR] Provedor retornou resposta inválida');
    }

    // 4. Validação e Normalização Semântica Estrita
    const primaryRoom = validateStrictRoomType(rawResult.primary_room_type, 'primary_room_type');
    const secondaryRooms = normalizeAndValidateSecondaryRooms(rawResult.secondary_room_types, primaryRoom);
    const features = normalizeAndValidateFeatures(rawResult.features);
    const confidence = validateStrictScore(rawResult.confidence, 'confidence');
    const description = rawResult.description ? String(rawResult.description).slice(0, 500) : '';

    // 5. Avaliação Determinística de Qualidade
    const evaluatedQuality = QualityEvaluator.evaluateQuality({
      rawVlmScores: rawResult.raw_vlm_scores || rawResult,
      specs
    });

    // 6. Montagem do GlobalPhotoAnalysis
    const globalAnalysis = {
      photo_analysis_key: photoAnalysisKey,
      physical_file_hash: physical_file_hash.toLowerCase().trim(),
      semantic: {
        primary_room_type: primaryRoom,
        secondary_room_types: secondaryRooms,
        features: features,
        description: description,
        confidence: confidence
      },
      quality: evaluatedQuality,
      analyzer_provenance: {
        analyzer_type: DEFAULT_ANALYZER_TYPE,
        analyzer_version: DEFAULT_ANALYZER_VERSION,
        provider: this.provider.providerName || 'unknown',
        model_id: this.provider.modelId || 'unknown',
        prompt_version: DEFAULT_PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
        quality_rules_version: QUALITY_RULES_VERSION,
        taxonomy_version: TAXONOMY_VERSION,
        provider_config: providerConfig,
        analyzed_at: new Date().toISOString()
      }
    };

    // Validação estrita do schema global (fail-fast)
    validateGlobalPhotoAnalysis(globalAnalysis);

    // 7. Publicação Atômica No-Clobber no Cache Global
    await this.publishGlobalAnalysisNoClobber(photoAnalysisKey, globalAnalysis);

    return {
      photo_analysis_key: photoAnalysisKey,
      analysis: globalAnalysis,
      cache_hit: false
    };
  }

  /**
   * Publicação No-Clobber com Staging Privado e Resolução Segura de Concorrência
   */
  async publishGlobalAnalysisNoClobber(photoAnalysisKey, globalAnalysis) {
    const canonicalDir = path.join(this.baseOutputDir, photoAnalysisKey);
    const canonicalPath = path.join(canonicalDir, 'analysis.json');
    const stagingPath = path.join(this.tmpDir, `analysis_${photoAnalysisKey}_${crypto.randomUUID()}.tmp`);

    if (!fs.existsSync(canonicalDir)) {
      fs.mkdirSync(canonicalDir, { recursive: true });
    }

    const payloadStr = JSON.stringify(globalAnalysis, null, 2);
    fs.writeFileSync(stagingPath, payloadStr, 'utf8');

    try {
      // Cópia atômica exclusiva (falha com EEXIST se já existir)
      fs.copyFileSync(stagingPath, canonicalPath, fs.constants.COPYFILE_EXCL);
      try { fs.unlinkSync(stagingPath); } catch (e) {}
    } catch (copyErr) {
      // Concorrência: outro worker publicou simultaneamente
      if (copyErr.code === 'EEXIST') {
        try {
          const existingRaw = fs.readFileSync(canonicalPath, 'utf8');
          const existingJson = JSON.parse(existingRaw);
          validateGlobalPhotoAnalysis(existingJson);
          // Arquivo existente é válido -> remove staging próprio e segue
          try { fs.unlinkSync(stagingPath); } catch (e) {}
          return;
        } catch (valErr) {
          // Arquivo existente corrompido: NÃO deletar arquivo canônico compartilhado
          try { fs.unlinkSync(stagingPath); } catch (e) {}
          throw new Error(`[CANONICAL_ANALYSIS_INTEGRITY_ERROR] Arquivo canônico existente inválido em ${canonicalPath}: ${valErr.message}`);
        }
      } else {
        try { fs.unlinkSync(stagingPath); } catch (e) {}
        throw copyErr;
      }
    }
  }

  /**
   * Analisa uma foto de propriedade específica e projeta a PropertyPhotoSemanticView
   */
  async analyzePropertyPhoto(propertyPhotoAsset, options = {}) {
    const physicalHash = propertyPhotoAsset.file_hash || propertyPhotoAsset.physical_file_hash;
    const storagePath = propertyPhotoAsset.storage_path;
    const specs = propertyPhotoAsset.specs || {};

    const { photo_analysis_key, analysis, cache_hit } = await this.analyzePhotoBlob({
      physical_file_hash: physicalHash,
      storage_path: storagePath,
      specs,
      options
    });

    const semanticView = CrmCategoryReconciler.projectSemanticView(propertyPhotoAsset, analysis);

    return {
      photo_analysis_key,
      semantic_view: semanticView,
      cache_hit
    };
  }

  /**
   * Analisa todas as fotos aceitas de um imóvel
   */
  async analyzePropertyPhotos(propertyRef, options = {}) {
    const propertyMediaService = require('../property_media_service');
    const pool = await propertyMediaService.getPropertyMediaPool(propertyRef);

    let photos = pool.photos || [];

    // Se pool não tem fotos prontas, acionar ingestão prévia
    if (photos.length === 0 || photos.some(p => p.asset_type !== 'property_photo')) {
      const { PhotoIngestionService } = require('../photo_ingestion');
      const ingestService = new PhotoIngestionService();
      await ingestService.ingestPropertyPhotos(propertyRef);
      const recheckPool = await propertyMediaService.getPropertyMediaPool(propertyRef);
      photos = recheckPool.photos || [];
    }

    const results = [];
    let cacheHits = 0;
    let computedCount = 0;

    for (const photoAsset of photos) {
      const res = await this.analyzePropertyPhoto(photoAsset, options);
      if (res.cache_hit) {
        cacheHits++;
      } else {
        computedCount++;
      }
      results.push(res.semantic_view);
    }

    return {
      property_ref: String(propertyRef),
      total_photos: results.length,
      cache_hits: cacheHits,
      computed_count: computedCount,
      photos: results
    };
  }

  /**
   * Ranking Intra-Ambiente (Comparativo entre fotos do mesmo cômodo)
   */
  rankIntraRoomPhotos(semanticViews = []) {
    if (!Array.isArray(semanticViews) || semanticViews.length === 0) {
      return [];
    }

    // Agrupar por primary_room_type
    const byRoom = new Map();
    for (const view of semanticViews) {
      const room = view.semantic?.primary_room_type || 'unknown';
      if (!byRoom.has(room)) {
        byRoom.set(room, []);
      }
      byRoom.get(room).push(view);
    }

    const allRanked = [];

    for (const [room, items] of byRoom.entries()) {
      const scoredItems = items.map(item => {
        const editScore = item.quality?.editorial_utility?.score || 0;
        const aestScore = item.quality?.aesthetic_score?.score || 0;
        const techScore = item.quality?.technical_quality?.score || 0;
        const confidence = item.semantic?.confidence || 0;
        const fileHash = String(item.physical_file_hash || '').toLowerCase();

        const intraScore = Math.round((
          0.45 * editScore +
          0.30 * aestScore +
          0.25 * techScore
        ) * 100) / 100;

        return {
          ...item,
          intra_rank_score: intraScore,
          confidence_tiebreak: confidence,
          hash_tiebreak: fileHash
        };
      });

      // Ordenação Determinística:
      // 1. intra_rank_score DESC
      // 2. confidence DESC
      // 3. physical_file_hash ASC (ordem lexicográfica)
      scoredItems.sort((a, b) => {
        if (b.intra_rank_score !== a.intra_rank_score) {
          return b.intra_rank_score - a.intra_rank_score;
        }
        if (b.confidence_tiebreak !== a.confidence_tiebreak) {
          return b.confidence_tiebreak - a.confidence_tiebreak;
        }
        return a.hash_tiebreak.localeCompare(b.hash_tiebreak);
      });

      scoredItems.forEach((item, idx) => {
        item.intra_rank = idx + 1;
        delete item.confidence_tiebreak;
        delete item.hash_tiebreak;
        allRanked.push(item);
      });
    }

    return allRanked;
  }
}

const defaultPhotoMediaUnderstandingService = new PhotoMediaUnderstandingService();

module.exports = {
  PhotoMediaUnderstandingService,
  defaultPhotoMediaUnderstandingService,
  PHOTO_ANALYSIS_BASE_DIR,
  PHOTO_ANALYSIS_TMP_DIR
};
