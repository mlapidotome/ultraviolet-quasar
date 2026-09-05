/**
 * Base Video Adapter — Video Engine V2
 * Bali Imóveis (Property Video Ingestion)
 * 
 * Interface base para adapters de provedores de vídeo externos.
 */

class BaseVideoAdapter {
  constructor(name) {
    if (!name) throw new Error('[BASE_ADAPTER] Nome do adapter é obrigatório');
    this.name = name;
  }

  getName() {
    return this.name;
  }

  /**
   * Verifica se o adapter suporta a URL fornecida
   * @param {string} url
   * @returns {boolean}
   */
  canHandle(url) {
    throw new Error(`[BASE_ADAPTER] Método canHandle deve ser implementado pelo adapter ${this.name}`);
  }

  /**
   * Extrai o ID canônico do vídeo
   * @param {string} url
   * @returns {string|null}
   */
  parseVideoId(url) {
    throw new Error(`[BASE_ADAPTER] Método parseVideoId deve ser implementado pelo adapter ${this.name}`);
  }

  /**
   * Constrói a URL canônica normalizada
   * @param {string} videoId
   * @returns {string}
   */
  getCanonicalUrl(videoId) {
    throw new Error(`[BASE_ADAPTER] Método getCanonicalUrl deve ser implementado pelo adapter ${this.name}`);
  }

  /**
   * Baixa e materializa o vídeo no arquivo de staging
   * @param {Object} options
   * @param {string} options.canonicalUrl
   * @param {string} options.videoId
   * @param {string} options.stagingPath
   * @param {number} [options.timeoutMs=60000]
   * @param {number} [options.maxSizeMb=150]
   * @returns {Promise<{ localPath: string, format: string }>}
   */
  async materialize(options) {
    throw new Error(`[BASE_ADAPTER] Método materialize deve ser implementado pelo adapter ${this.name}`);
  }
}

module.exports = BaseVideoAdapter;
