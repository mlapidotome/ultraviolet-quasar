/**
 * Interface Base de Provedor de Alinhamento Forçado / Script Timing
 * Bali Imóveis (Fase 4A.2)
 */

class BaseScriptAlignmentProvider {
  constructor({ modelId = 'whisper-1', providerName = 'base_alignment' } = {}) {
    this.modelId = modelId;
    this.providerName = providerName;
  }

  /**
   * Alinha áudio físico com o script fornecido e retorna timestamps em nível de palavra
   * @param {Object} params
   * @param {string} params.audioPath Caminho físico do arquivo de áudio
   * @param {string} params.scriptText Texto original conhecido do script
   * @param {string} params.language Código do idioma (default: 'pt')
   * @returns {Promise<Array<{ word: string, start_ms: number, end_ms: number, confidence: number }>>}
   */
  async alignScriptWithAudio({ audioPath, scriptText, language = 'pt' } = {}) {
    throw new Error(`[PROVIDER_ERROR] alignScriptWithAudio não implementado no provedor ${this.providerName}`);
  }
}

module.exports = BaseScriptAlignmentProvider;
