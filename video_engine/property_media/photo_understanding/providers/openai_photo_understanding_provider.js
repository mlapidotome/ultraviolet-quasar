/**
 * Provedor VLM Multimodal via OpenAI — Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const fs = require('fs');
const axios = require('axios');
const BasePhotoUnderstandingProvider = require('./base_photo_understanding_provider');
const { ALLOWED_ROOM_TYPES, ALLOWED_FEATURES } = require('../photo_analysis_schema');

class OpenAIPhotoUnderstandingProvider extends BasePhotoUnderstandingProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    modelId = process.env.VLM_PHOTO_MODEL_ID || process.env.VLM_MODEL_ID || 'gpt-4o-mini',
    detail = 'high',
    temperature = 0.1,
    timeoutMs = 45000
  } = {}) {
    super({ providerName: 'openai_photo_vlm', modelId });
    this.apiKey = apiKey;
    this.detail = detail;
    this.temperature = temperature;
    this.timeoutMs = timeoutMs;
    this.totalCalls = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalCostUsd = 0.0;
  }

  getBehavioralConfig() {
    return {
      provider: this.providerName,
      model_id: this.modelId,
      detail: this.detail,
      temperature: this.temperature
    };
  }

  async analyzePhoto({ imageInput, specs = {}, options = {} }) {
    if (!this.apiKey) {
      throw new Error('[OPENAI_PHOTO_VLM_ERROR] OPENAI_API_KEY não configurada no ambiente (.env)');
    }

    let imageBuffer = null;
    let mimeType = 'image/jpeg';

    if (typeof imageInput === 'string') {
      if (!fs.existsSync(imageInput)) {
        throw new Error(`[OPENAI_PHOTO_VLM_ERROR] Arquivo de imagem não encontrado: ${imageInput}`);
      }
      imageBuffer = fs.readFileSync(imageInput);
      if (imageInput.endsWith('.png')) mimeType = 'image/png';
      else if (imageInput.endsWith('.webp')) mimeType = 'image/webp';
    } else if (Buffer.isBuffer(imageInput)) {
      imageBuffer = imageInput;
      if (specs.format === 'png' || specs.normalized_ext === '.png') mimeType = 'image/png';
      else if (specs.format === 'webp' || specs.normalized_ext === '.webp') mimeType = 'image/webp';
    } else {
      throw new Error('[OPENAI_PHOTO_VLM_ERROR] imageInput deve ser um caminho de arquivo ou Buffer');
    }

    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const systemPrompt = `Você é um especialista em análise visual imobiliária e direção de fotografia para produção de vídeos de anúncios de imóveis.
Sua tarefa é analisar esta fotografia real de um imóvel e extrair de forma precisa e objetiva a classificação do ambiente, diferenciais visuais e notas perceptuais de qualidade.

TAXONOMIA OBRIGATÓRIA PARA primary_room_type (escolha exatamente um da lista):
${ALLOWED_ROOM_TYPES.map(t => `- "${t}"`).join('\n')}

TAXONOMIA PARA secondary_room_types (se houver ambientes contíguos/integrados visíveis, escolha apenas da lista acima; caso contrário deixe array vazio []):
Exemplos:
- Sala integrada com jantar: primary "living_room", secondary ["dining_room"]
- Cozinha americana com sala: primary "kitchen", secondary ["living_room"]
- Varanda com vista ampla: primary "balcony", secondary ["city_view"]
- Suíte com banheiro visível: primary "suite", secondary ["bathroom"]
- Fachada com garagem/jardim: primary "facade", secondary ["exterior", "garage"]

TAXONOMIA DE FEATURES (selecione estritamente apenas as que estão claramente visíveis na foto):
${ALLOWED_FEATURES.map(f => `- "${f}"`).join('\n')}

AVALIAÇÃO DE SUBSCORES PERCEPTUAIS (valores decimais estritos entre 0.0 e 1.0):
1. Technical Quality:
   - sharpness (0.0 a 1.0): nitidez dos contornos e foco óptico.
   - exposure (0.0 a 1.0): equilíbrio tonal de luzes e sombras sem áreas estouradas ou escuras demais.
   - noise_compression (0.0 a 1.0): ausência de granulação ISO alta ou artefatos de compressão.
   - perspective_alignment (0.0 a 1.0): nivelamento vertical das paredes e ausência de distorção extrema.

2. Aesthetic Quality:
   - composition (0.0 a 1.0): harmonia do enquadramento e regra dos terços.
   - framing (0.0 a 1.0): elegância dos cortes da cena (sem cortar móveis principais bruscamente).
   - visual_balance (0.0 a 1.0): distribuição uniforme de massas e elementos visuais.
   - lighting_atmosphere (0.0 a 1.0): clima agradável, sensação acolhedora e bem iluminada.
   - cleanliness_staging (0.0 a 1.0): organização, limpeza e ausência de desordem ou objetos pessoais invasivos.

3. Editorial Utility:
   - room_coverage (0.0 a 1.0): quão ampla é a visão do cômodo (foto angular ampla = 0.90+; close fechado num detalhe = 0.30-0.50).
   - feature_clarity (0.0 a 1.0): nitidez e evidência dos acabamentos e diferenciais do imóvel.
   - spaciousness_perception (0.0 a 1.0): quão bem a foto transmite a real amplitude do espaço.
   - obstruction_level (0.0 a 1.0): 1.0 = visão totalmente desobstruída; 0.2 = coluna ou porta bloqueando a visão principal.

FORMATO JSON OBRIGATÓRIO (retorne EXCLUSIVAMENTE este JSON sem markdown):
{
  "primary_room_type": "string",
  "secondary_room_types": ["string"],
  "features": ["string"],
  "description": "breve descrição visual factual em 1 frase em português",
  "confidence": number,
  "raw_vlm_scores": {
    "sharpness": number,
    "exposure": number,
    "noise_compression": number,
    "perspective_alignment": number,
    "composition": number,
    "framing": number,
    "visual_balance": number,
    "lighting_atmosphere": number,
    "cleanliness_staging": number,
    "room_coverage": number,
    "feature_clarity": number,
    "spaciousness_perception": number,
    "obstruction_level": number
  }
}`;

    const payload = {
      model: this.modelId,
      response_format: { type: 'json_object' },
      temperature: this.temperature,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analise detalhadamente esta fotografia do imóvel e produza a classificação estruturada:'
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: this.detail
              }
            }
          ]
        }
      ]
    };

    let res = null;
    let attempts = 0;
    const maxRetries = 4;

    while (attempts <= maxRetries) {
      try {
        attempts++;
        res = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: this.timeoutMs
        });
        break;
      } catch (err) {
        const isRateLimit = err.response?.status === 429;
        const isServerError = err.response?.status >= 500;
        if ((isRateLimit || isServerError) && attempts <= maxRetries) {
          const delayMs = Math.min(10000, 1500 * Math.pow(2, attempts - 1));
          console.warn(`[OPENAI_PHOTO_VLM_WARN] Rate limit / server error (${err.response?.status}). Tentativa ${attempts}/${maxRetries}. Aguardando ${delayMs}ms...`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }

    this.totalCalls++;
    const usage = res?.data?.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      this.totalPromptTokens += promptTokens;
      this.totalCompletionTokens += completionTokens;

      // Estimativa gpt-4o-mini ($0.15/1M prompt, $0.60/1M completion)
      const cost = (promptTokens * 0.00000015) + (completionTokens * 0.00000060);
      this.totalCostUsd += cost;
    }

    const rawContent = res.data?.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('[OPENAI_PHOTO_VLM_ERROR] OpenAI retornou resposta vazia');
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      throw new Error(`[OPENAI_PHOTO_VLM_ERROR] Falha ao interpretar JSON retornado: ${rawContent}`);
    }

    return parsed;
  }
}

module.exports = OpenAIPhotoUnderstandingProvider;
