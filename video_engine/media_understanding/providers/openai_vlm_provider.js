/**
 * Provedor VLM Multimodal via OpenAI (GPT-4o / GPT-4o-mini) — Media Understanding
 * Bali Imóveis (Fase 4A.1)
 */

const fs = require('fs');
const axios = require('axios');
const BaseMediaUnderstandingProvider = require('./base_media_understanding_provider');
const { ALLOWED_ROOM_TYPES, ALLOWED_FEATURES, validateFrameSampleResult } = require('../analysis_schema');

class OpenAIMediaUnderstandingProvider extends BaseMediaUnderstandingProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    modelId = process.env.VLM_MODEL_ID || 'gpt-4o-mini',
    timeoutMs = 30000
  } = {}) {
    super({ modelId, providerName: 'openai_vlm' });
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async analyzeFrame(imageInput, metadata = {}) {
    if (!this.apiKey) {
      throw new Error('[OPENAI_VLM_ERROR] OPENAI_API_KEY não configurada no ambiente (.env)');
    }

    let imageBuffer = null;
    if (typeof imageInput === 'string') {
      if (!fs.existsSync(imageInput)) {
        throw new Error(`[OPENAI_VLM_ERROR] Arquivo de imagem não encontrado: ${imageInput}`);
      }
      imageBuffer = fs.readFileSync(imageInput);
    } else if (Buffer.isBuffer(imageInput)) {
      imageBuffer = imageInput;
    } else {
      throw new Error('[OPENAI_VLM_ERROR] imageInput deve ser um caminho de arquivo ou Buffer');
    }

    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    const systemPrompt = `Você é um especialista em análise visual de imóveis para edição de vídeo comercial.
Sua tarefa é classificar com precisão o ambiente mostrado neste frame de vídeo de imóvel.

TAXONOMIA OBRIGATÓRIA PARA room_type (escolha exatamente um):
${ALLOWED_ROOM_TYPES.map(t => `- "${t}"`).join('\n')}

TAXONOMIA DE FEATURES (selecione apenas as que estão visíveis):
${ALLOWED_FEATURES.map(f => `- "${f}"`).join('\n')}

REGRAS:
1. Se o ambiente não for claro ou for uma transição borrada, use room_type: "unknown".
2. Não invente cômodos. Classifique estritamente o que está visível.
3. technical_quality_score (0.0 a 1.0): nitidez, estabilidade, ausência de blur, iluminação.
4. aesthetic_score (0.0 a 1.0): beleza visual, amplitude, composição do enquadramento.
5. confidence (0.0 a 1.0): certeza da classificação do cômodo.
6. Retorne EXCLUSIVAMENTE um objeto JSON válido sem formatação markdown extra.

FORMATO JSON OBRIGATÓRIO:
{
  "room_type": "string",
  "features": ["string"],
  "technical_quality_score": number,
  "aesthetic_score": number,
  "confidence": number,
  "description": "breve descrição visual em 1 frase"
}`;

    const payload = {
      model: this.modelId,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
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
              text: `Analise este frame de vídeo do imóvel (timestamp: ${metadata.timestamp_ms || 0}ms):`
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'low' // 512x512 tile, ultra-rápido e econômico
              }
            }
          ]
        }
      ]
    };

    const res = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: this.timeoutMs
    });

    const rawContent = res.data?.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('[OPENAI_VLM_ERROR] OpenAI retornou resposta vazia');
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      throw new Error(`[OPENAI_VLM_ERROR] Falha ao interpretar JSON retornado: ${rawContent}`);
    }

    return validateFrameSampleResult(parsed);
  }
}

module.exports = OpenAIMediaUnderstandingProvider;
