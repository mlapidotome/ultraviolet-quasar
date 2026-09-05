/**
 * Provedor Mock de Compreensão de Mídia para Testes Determinísticos
 * Bali Imóveis (Fase 4A.1)
 */

const BaseMediaUnderstandingProvider = require('./base_media_understanding_provider');
const { validateFrameSampleResult } = require('../analysis_schema');

class MockMediaUnderstandingProvider extends BaseMediaUnderstandingProvider {
  constructor({
    modelId = 'mock_vlm_v1',
    mockMapping = null,
    defaultRoom = 'living_room',
    failMode = false
  } = {}) {
    super({ modelId, providerName: 'mock_vlm' });
    this.mockMapping = mockMapping || new Map();
    this.defaultRoom = defaultRoom;
    this.failMode = failMode;
    this.callsCount = 0;
  }

  setMockForTimestamp(timestampMs, result) {
    this.mockMapping.set(timestampMs, result);
  }

  async analyzeFrame(imageInput, metadata = {}) {
    this.callsCount++;

    if (this.failMode) {
      throw new Error('[MOCK_VLM_ERROR] Simulated provider failure');
    }

    const t = metadata.timestamp_ms || 0;
    if (this.mockMapping.has(t)) {
      return validateFrameSampleResult(this.mockMapping.get(t));
    }

    // Default mock response
    return validateFrameSampleResult({
      room_type: this.defaultRoom,
      features: ['natural_lighting'],
      technical_quality_score: 0.85,
      aesthetic_score: 0.80,
      confidence: 0.90,
      description: `Mock frame at ${t}ms`
    });
  }
}

module.exports = MockMediaUnderstandingProvider;
