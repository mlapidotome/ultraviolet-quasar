/**
 * Módulo de Editing Styles Versionáveis — Video Engine V2
 * Bali Imóveis (Fase 3C.1 — Final Hardening)
 * 
 * Responsabilidades:
 * 1. Catálogo canônico de presets de estilo de edição versionados em código
 * 2. Whitelist estrita de compatibilidade entre tipos de overlay e presets
 * 3. Registro imutável de fontes no servidor (FONT_REGISTRY)
 * 4. Resolução estrita com fail-fast (sem fallback silencioso)
 * 5. Cálculo determinístico do style_hash (SHA-256 da serialização canônica do preset)
 */

const fs = require('fs');
const crypto = require('crypto');
const assetService = require('../asset_service');

const FONT_REGISTRY = Object.freeze({
  'dejavu_bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'dejavu_medium': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'liberation_bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  'liberation_medium': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
});

/**
 * Validação de boot de todas as fontes cadastradas no FONT_REGISTRY
 */
function validateFontRegistry() {
  for (const [fontId, fontPath] of Object.entries(FONT_REGISTRY)) {
    if (!fs.existsSync(fontPath)) {
      throw new Error(`[COMPOSER FONT ERROR] Arquivo físico da fonte '${fontId}' não encontrado em: ${fontPath}`);
    }
  }
  return true;
}

const PRESETS = {
  'performance_reels_v1': {
    id: 'performance_reels_v1',
    version: 1,
    name: 'Performance Reels / TikTok',
    description: 'Foco em retenção: headlines em caixa alta, badge de preço com punch zoom e ritmo agressivo',
    typography: {
      headline_font_id: 'dejavu_bold',
      body_font_id: 'dejavu_medium',
      accent_font_id: 'dejavu_bold',
      caption_font_id: 'dejavu_medium'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#FFD700',          // Dourado Bali
      box_bg: '#000000CC',        // Preto 80% opacidade
      price_badge_bg: '#00C853',  // Verde conversão
      price_badge_text: '#FFFFFF'
    },
    motion: {
      badge_punch_scale: 1.15,
      fade_duration_ms: 200
    },
    safe_rectangles: {
      top_safe: { x_min: 60, x_max: 1020, y_min: 220, y_max: 500 },
      center: { x_min: 60, x_max: 1020, y_min: 760, y_max: 1160 },
      lower_third: { x_min: 60, x_max: 1020, y_min: 1280, y_max: 1540 },
      bottom_safe: { x_min: 60, x_max: 1020, y_min: 1540, y_max: 1720 },
      captions: { x_min: 80, x_max: 1000, y_min: 1350, y_max: 1550 }
    },
    captions_preset: {
      font_id: 'dejavu_medium',
      font_size: 42,
      max_lines: 2,
      max_chars: 60,
      max_chars_per_line: 30,
      box_padding: 16,
      box_color: '#000000B3',
      text_color: '#FFFFFF'
    },
    overlay_presets: {
      'bold_headline': {
        supported_types: ['headline'],
        font_id: 'dejavu_bold',
        font_size: 56,
        max_lines: 2,
        max_chars: 60,
        max_chars_per_line: 25,
        box_padding: 24,
        box_color: '#000000CC',
        text_color: '#FFFFFF'
      },
      'price_punch': {
        supported_types: ['price_badge'],
        font_id: 'dejavu_bold',
        font_size: 64,
        max_lines: 1,
        max_chars: 25,
        max_chars_per_line: 20,
        box_padding: 28,
        box_color: '#00C853',
        text_color: '#FFFFFF',
        punch_zoom: true
      },
      'location_badge': {
        supported_types: ['location_tag'],
        font_id: 'dejavu_medium',
        font_size: 40,
        max_lines: 1,
        max_chars: 40,
        max_chars_per_line: 35,
        box_padding: 16,
        box_color: '#000000B3',
        text_color: '#FFD700'
      },
      'cta_bar': {
        supported_types: ['cta_banner'],
        font_id: 'dejavu_bold',
        font_size: 48,
        max_lines: 2,
        max_chars: 50,
        max_chars_per_line: 28,
        box_padding: 20,
        box_color: '#000000E6',
        text_color: '#FFFFFF'
      }
    },
    pip_presets: {
      'bottom_right': {
        x: 680,
        y: 1140,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 24,
        border_width: 4,
        border_color: '#FFFFFF'
      },
      'bottom_left': {
        x: 60,
        y: 1140,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 24,
        border_width: 4,
        border_color: '#FFFFFF'
      },
      'center_right': {
        x: 680,
        y: 700,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 24,
        border_width: 4,
        border_color: '#FFFFFF'
      }
    },
    motion_presets: {
      'ken_burns_zoom_in': { start_scale: 1.00, target_scale: 1.10 },
      'ken_burns_zoom_out': { start_scale: 1.10, target_scale: 1.00 },
      'pan_left': { start_scale: 1.10, target_scale: 1.10 },
      'pan_right': { start_scale: 1.10, target_scale: 1.10 },
      'static': { start_scale: 1.00, target_scale: 1.00 }
    }
  },

  'clean_modern_v1': {
    id: 'clean_modern_v1',
    version: 1,
    name: 'Clean Modern Minimalist',
    description: 'Estética contemporânea: lower thirds refinados, tipografia elegante e transições suaves',
    typography: {
      headline_font_id: 'liberation_bold',
      body_font_id: 'liberation_medium',
      accent_font_id: 'liberation_bold',
      caption_font_id: 'liberation_medium'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#00E5FF',
      box_bg: '#1A1A1AE6',
      price_badge_bg: '#1A1A1AE6',
      price_badge_text: '#00E5FF'
    },
    motion: {
      badge_punch_scale: 1.08,
      fade_duration_ms: 300
    },
    safe_rectangles: {
      top_safe: { x_min: 70, x_max: 1010, y_min: 220, y_max: 480 },
      center: { x_min: 70, x_max: 1010, y_min: 780, y_max: 1140 },
      lower_third: { x_min: 70, x_max: 1010, y_min: 1300, y_max: 1540 },
      bottom_safe: { x_min: 70, x_max: 1010, y_min: 1540, y_max: 1700 },
      captions: { x_min: 80, x_max: 1000, y_min: 1350, y_max: 1550 }
    },
    captions_preset: {
      font_id: 'liberation_medium',
      font_size: 40,
      max_lines: 2,
      max_chars: 60,
      max_chars_per_line: 30,
      box_padding: 16,
      box_color: '#1A1A1AB3',
      text_color: '#FFFFFF'
    },
    overlay_presets: {
      'bold_headline': {
        supported_types: ['headline'],
        font_id: 'liberation_bold',
        font_size: 52,
        max_lines: 2,
        max_chars: 60,
        max_chars_per_line: 25,
        box_padding: 20,
        box_color: '#1A1A1AE6',
        text_color: '#FFFFFF'
      },
      'price_punch': {
        supported_types: ['price_badge'],
        font_id: 'liberation_bold',
        font_size: 58,
        max_lines: 1,
        max_chars: 25,
        max_chars_per_line: 20,
        box_padding: 24,
        box_color: '#1A1A1AE6',
        text_color: '#00E5FF',
        punch_zoom: false
      },
      'location_badge': {
        supported_types: ['location_tag'],
        font_id: 'liberation_medium',
        font_size: 38,
        max_lines: 1,
        max_chars: 40,
        max_chars_per_line: 35,
        box_padding: 16,
        box_color: '#1A1A1AB3',
        text_color: '#FFFFFF'
      },
      'cta_bar': {
        supported_types: ['cta_banner'],
        font_id: 'liberation_bold',
        font_size: 44,
        max_lines: 2,
        max_chars: 50,
        max_chars_per_line: 28,
        box_padding: 20,
        box_color: '#1A1A1AF2',
        text_color: '#00E5FF'
      }
    },
    pip_presets: {
      'bottom_right': {
        x: 680,
        y: 1140,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 20,
        border_width: 3,
        border_color: '#00E5FF'
      },
      'bottom_left': {
        x: 60,
        y: 1140,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 20,
        border_width: 3,
        border_color: '#00E5FF'
      },
      'center_right': {
        x: 680,
        y: 700,
        width: 340,
        height: 510,
        shape: 'rounded_rect',
        border_radius: 20,
        border_width: 3,
        border_color: '#00E5FF'
      }
    },
    motion_presets: {
      'ken_burns_zoom_in': { start_scale: 1.00, target_scale: 1.08 },
      'ken_burns_zoom_out': { start_scale: 1.08, target_scale: 1.00 },
      'pan_left': { start_scale: 1.08, target_scale: 1.08 },
      'pan_right': { start_scale: 1.08, target_scale: 1.08 },
      'static': { start_scale: 1.00, target_scale: 1.00 }
    }
  }
};

/**
 * Calcula o hash SHA-256 canônico de um preset de estilo
 * @param {Object} presetObj
 * @returns {string} SHA-256 hex
 */
function computeStyleHash(presetObj) {
  const canonicalJSON = assetService.canonicalStringify(presetObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

/**
 * Resolve estritamente um editing_style a partir de style_id e version
 * @param {string} styleId
 * @param {number} version
 * @returns {Object} Objeto imutável do preset com style_hash embutido
 */
function resolveEditingStyle(styleId, version) {
  if (!styleId || typeof styleId !== 'string') {
    throw new Error(`[STYLE VALIDATION ERROR] style_id inválido ou ausente: '${styleId}'`);
  }

  const rawPreset = PRESETS[styleId];
  if (!rawPreset) {
    throw new Error(`[STYLE VALIDATION ERROR] Editing Style desconhecido: '${styleId}'. Estilos disponíveis: ${Object.keys(PRESETS).join(', ')}`);
  }

  const expectedVersion = Number(version);
  if (isNaN(expectedVersion) || expectedVersion !== rawPreset.version) {
    throw new Error(`[STYLE VALIDATION ERROR] Versão ${version} incompatível para o estilo '${styleId}' (versão oficial suportada: ${rawPreset.version})`);
  }

  // Validação estrita de todas as fontes utilizadas pelo estilo
  const typographyFonts = Object.values(rawPreset.typography || {});
  const overlayFonts = Object.values(rawPreset.overlay_presets || {}).map(p => p.font_id);
  const captionFont = rawPreset.captions_preset?.font_id ? [rawPreset.captions_preset.font_id] : [];
  const allReferencedFonts = new Set([...typographyFonts, ...overlayFonts, ...captionFont]);

  for (const fontId of allReferencedFonts) {
    const fontPath = FONT_REGISTRY[fontId];
    if (!fontPath) {
      throw new Error(`[STYLE VALIDATION ERROR] Estilo '${styleId}' referencia font_id não cadastrado no FONT_REGISTRY: '${fontId}'`);
    }
    if (!fs.existsSync(fontPath)) {
      throw new Error(`[STYLE VALIDATION ERROR] Arquivo da fonte '${fontId}' não existe no servidor: ${fontPath}`);
    }
  }

  // Clonar para garantir isolamento e calcular style_hash sobre as propriedades físicas puras
  const cloned = JSON.parse(JSON.stringify(rawPreset));
  const styleHash = computeStyleHash(cloned);

  const resolved = {
    ...cloned,
    style_hash: styleHash
  };

  return Object.freeze(resolved);
}

module.exports = {
  FONT_REGISTRY,
  PRESETS,
  validateFontRegistry,
  computeStyleHash,
  resolveEditingStyle
};
