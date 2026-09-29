/**
 * RateLimiter Defensivo para API ImobTotal
 * Gerencia as três janelas de limites do ImobTotal:
 * - Janela curta: 20 req / 10s
 * - Janela média: 60 req / 1 min
 * - Janela longa: 600 req / 1 hora
 */

class ImobTotalRateLimiter {
  constructor(options = {}) {
    this.minDelayMs = options.minDelayMs || 500; // Espaçamento mínimo entre chamadas (ms)
    this.lastRequestTime = 0;

    // Estado das três janelas (atualizado dinamicamente pelos headers HTTP)
    this.status = {
      short: { limit: 20, remaining: 20, resetSeconds: 10 },
      minute: { limit: 60, remaining: 60, resetSeconds: 60 },
      long: { limit: 600, remaining: 600, resetSeconds: 3600 }
    };

    this.totalRequestsMade = 0;
    this.rateLimitHitCount = 0;
  }

  /**
   * Atualiza as métricas a partir dos headers de resposta da API
   */
  updateFromHeaders(headers) {
    if (!headers) return;

    if (headers['x-ratelimit-reset-short'] !== undefined) {
      this.status.short.resetSeconds = parseInt(headers['x-ratelimit-reset-short'], 10);
    }
    if (headers['x-ratelimit-remaining-short'] !== undefined) {
      this.status.short.remaining = parseInt(headers['x-ratelimit-remaining-short'], 10);
    }

    if (headers['x-ratelimit-reset'] !== undefined) {
      this.status.minute.resetSeconds = parseInt(headers['x-ratelimit-reset'], 10);
    }
    if (headers['x-ratelimit-remaining'] !== undefined) {
      this.status.minute.remaining = parseInt(headers['x-ratelimit-remaining'], 10);
    }

    if (headers['x-ratelimit-reset-long'] !== undefined) {
      this.status.long.resetSeconds = parseInt(headers['x-ratelimit-reset-long'], 10);
    }
    if (headers['x-ratelimit-remaining-long'] !== undefined) {
      this.status.long.remaining = parseInt(headers['x-ratelimit-remaining-long'], 10);
    }
  }

  /**
   * Avalia a necessidade de espera antes de disparar uma nova requisição
   */
  async throttle() {
    const now = Date.now();
    const elapsedSinceLast = now - this.lastRequestTime;

    // 1. Respeitar espaçamento mínimo fixo
    if (elapsedSinceLast < this.minDelayMs) {
      const wait = this.minDelayMs - elapsedSinceLast;
      await this.sleep(wait);
    }

    // 2. Proteção contra esgotamento da janela curta (10s)
    if (this.status.short.remaining <= 2) {
      const waitMs = (this.status.short.resetSeconds + 1) * 1000;
      console.warn(`⚠️ [RateLimit] Saldo curto baixo (${this.status.short.remaining}). Pausando por ${waitMs}ms...`);
      await this.sleep(waitMs);
      this.status.short.remaining = 20;
    }

    // 3. Proteção contra esgotamento da janela de 1 minuto
    if (this.status.minute.remaining <= 5) {
      const waitMs = (this.status.minute.resetSeconds + 1) * 1000;
      console.warn(`⚠️ [RateLimit] Saldo do minuto baixo (${this.status.minute.remaining}). Pausando por ${waitMs}ms...`);
      await this.sleep(waitMs);
      this.status.minute.remaining = 60;
    }

    // 4. Proteção contra esgotamento da janela horária (600 req/h)
    // Deixa margem de segurança de 40 requisições para outros sistemas da Bali
    if (this.status.long.remaining <= 40) {
      const waitMs = Math.min(this.status.long.resetSeconds * 1000, 60000);
      console.error(`🚨 [RateLimit] Saldo horário crítico (${this.status.long.remaining} restantes de 600). Pausando por ${waitMs}ms...`);
      await this.sleep(waitMs);
    }

    this.lastRequestTime = Date.now();
    this.totalRequestsMade++;
  }

  /**
   * Lida com erro HTTP 429
   */
  handle429(headers) {
    this.rateLimitHitCount++;
    this.updateFromHeaders(headers);
    const resetSec = this.status.minute.resetSeconds || 60;
    console.error(`❌ [RateLimit HTTP 429] Limite excedido! Janela de reset: ${resetSec}s. Operação suspensa.`);
    return resetSec * 1000;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getSnapshot() {
    return {
      totalRequestsMade: this.totalRequestsMade,
      rateLimitHitCount: this.rateLimitHitCount,
      remainingShort: this.status.short.remaining,
      remainingMinute: this.status.minute.remaining,
      remainingLong: this.status.long.remaining,
      resetShortSec: this.status.short.resetSeconds,
      resetMinuteSec: this.status.minute.resetSeconds,
      resetLongSec: this.status.long.resetSeconds
    };
  }
}

module.exports = ImobTotalRateLimiter;
