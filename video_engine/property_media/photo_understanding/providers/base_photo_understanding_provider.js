/**
 * Interface Abstrata para Provedores de Photo Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

class BasePhotoUnderstandingProvider {
  constructor({ providerName = 'base_photo_provider', modelId = 'unknown' } = {}) {
    this.providerName = providerName;
    this.modelId = modelId;
  }

  /**
   * Analisa uma foto e retorna predições semânticas e subscores perceptuais
   * @param {Object} params
   * @param {Buffer|string} params.imageInput - Buffer de imagem ou caminho do arquivo
   * @param {Object} params.specs - Dimensões e metadados físicos da foto
   * @param {Object} params.options - Opções adicionais
   * @returns {Promise<Object>} { primary_room_type, secondary_room_types, features, description, confidence, raw_vlm_scores }
   */
  async analyzePhoto({ imageInput, specs = {}, options = {} }) {
    throw new Error(`[PROVIDER_ERROR] Método analyzePhoto não implementado no provedor '${this.providerName}'`);
  }

  /**
   * Retorna a configuração comportamental do provedor para inclusão no photo_analysis_key
   */
  getBehavioralConfig() {
    return {
      provider: this.providerName,
      model_id: this.modelId
    };
  }
}

module.exports = BasePhotoUnderstandingProvider;
