/**
 * Provedor Mock Determinístico — Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const BasePhotoUnderstandingProvider = require('./base_photo_understanding_provider');

class MockPhotoUnderstandingProvider extends BasePhotoUnderstandingProvider {
  constructor({
    modelId = 'mock-vlm-v1',
    defaultResponse = null,
    responseMap = {},
    behavioralConfig = {}
  } = {}) {
    super({ providerName: 'mock_photo_provider', modelId });
    this.callCount = 0;
    this.defaultResponse = defaultResponse || {
      primary_room_type: 'living_room',
      secondary_room_types: ['dining_room'],
      features: ['open_concept', 'porcelain_tile', 'natural_lighting'],
      description: 'Sala de estar ampla e iluminada integrada à sala de jantar.',
      confidence: 0.95,
      raw_vlm_scores: {
        sharpness: 0.90,
        exposure: 0.85,
        noise_compression: 0.95,
        perspective_alignment: 0.80,
        composition: 0.85,
        framing: 0.80,
        visual_balance: 0.85,
        lighting_atmosphere: 0.90,
        cleanliness_staging: 0.95,
        room_coverage: 0.90,
        feature_clarity: 0.85,
        spaciousness_perception: 0.90,
        obstruction_level: 1.00
      }
    };
    this.responseMap = new Map(Object.entries(responseMap));
    this.behavioralConfig = behavioralConfig;
    this.shouldFail = false;
    this.failureError = new Error('[MOCK_ERROR] Falha simulada no provider');
  }

  setResponseForHash(hash, response) {
    this.responseMap.set(hash, response);
  }

  getBehavioralConfig() {
    return {
      provider: this.providerName,
      model_id: this.modelId,
      ...this.behavioralConfig
    };
  }

  async analyzePhoto({ imageInput, specs = {}, options = {} }) {
    this.callCount++;

    if (this.shouldFail) {
      throw this.failureError;
    }

    const hash = options.physical_file_hash || specs.physical_file_hash || null;
    if (hash && this.responseMap.has(hash)) {
      return JSON.parse(JSON.stringify(this.responseMap.get(hash)));
    }

    return JSON.parse(JSON.stringify(this.defaultResponse));
  }
}

module.exports = MockPhotoUnderstandingProvider;
