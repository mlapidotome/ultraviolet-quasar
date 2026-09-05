/**
 * Interface Abstrata do Provedor de Compreensão de Mídia — Media Understanding
 * Bali Imóveis
 */

class BaseMediaUnderstandingProvider {
  constructor({ modelId, providerName }) {
    this.modelId = modelId;
    this.providerName = providerName || 'abstract_provider';
  }

  /**
   * Analisa um único frame/imagem
   * @param {Buffer|string} imageInput - Buffer ou caminho do arquivo JPEG
   * @param {Object} metadata - Metadados adicionais (ex: timestampMs, propertyRef)
   * @returns {Promise<{ room_type: string, features: string[], technical_quality_score: number, aesthetic_score: number, confidence: number }>}
   */
  async analyzeFrame(imageInput, metadata = {}) {
    throw new Error('Método analyzeFrame deve ser implementado pela classe concreta');
  }

  /**
   * Analisa uma lista de frames
   * @param {Array<{ timestamp_ms: number, frame_path: string }>} samples
   * @returns {Promise<Array<{ timestamp_ms: number, room_type: string, features: string[], technical_quality_score: number, aesthetic_score: number, confidence: number }>>}
   */
  async analyzeFramesBatch(samples, options = {}) {
    const results = [];
    for (const sample of samples) {
      const res = await this.analyzeFrame(sample.frame_path, { timestamp_ms: sample.timestamp_ms });
      results.push({
        timestamp_ms: sample.timestamp_ms,
        frame_path: sample.frame_path,
        ...res
      });
    }
    return results;
  }
}

module.exports = BaseMediaUnderstandingProvider;
