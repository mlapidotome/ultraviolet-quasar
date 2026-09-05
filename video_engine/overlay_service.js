/**
 * Módulo Overlay Engine — Video Engine V2
 * Bali Imóveis (Fase 3C.1 — Final Hardening)
 * 
 * Responsabilidades:
 * 1. Sanitização estrita de strings contra filter injection (11 caracteres)
 * 2. Whitelist estrita de compatibilidade entre tipo de overlay e preset
 * 3. Cálculo determinístico de métricas de largura para fontes proporcionais
 * 4. Quebra de linha determinística (text wrapping) e fail-fast por layout overflow
 * 5. Validação rigorosa de bounding boxes contra Safe Rectangles (overlays e captions)
 * 6. Compilação de nós de drawtext/drawbox no filtergraph do FFmpeg
 * 7. Ordenação estrita por layer_order (sem ambiguidades de sobreposição)
 * 8. Modulação de transparência (fade) e punch zoom determinísticos
 */

const { FONT_REGISTRY } = require('./styles/presets');

const ALLOWED_OVERLAY_TYPES = Object.freeze(['headline', 'price_badge', 'location_tag', 'cta_banner']);
const ALLOWED_POSITIONS = Object.freeze(['top_safe', 'center', 'lower_third', 'bottom_safe']);
const MAX_OVERLAYS_COUNT = 20;
const MAX_OVERLAY_CHARS = 250;
const MAX_CAPTIONS_COUNT = 60;

/**
 * Sanitiza texto para uso seguro no drawtext do FFmpeg (Defesa em Profundidade)
 * Escapa: \ : ' % [ ] , ; = e normaliza quebras de linha
 * @param {string} rawText
 * @returns {string}
 */
function sanitizeDrawtextString(rawText) {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/'/g, '’')
    .replace(/%/g, '\\%')
    .trim();
}

/**
 * Retorna o fator de largura proporcional do glifo para fontes sans-serif (DejaVu/Liberation)
 * @param {string} char
 * @param {boolean} isBold
 * @returns {number} Fator multiplicado pelo font_size
 */
function getCharacterWidthFactor(char, isBold = true) {
  if ('WM@%—©'.includes(char)) return isBold ? 0.95 : 0.88;
  if ('wm'.includes(char)) return isBold ? 0.82 : 0.75;
  if ('iljtfI!.:;\'|[]() '.includes(char)) return isBold ? 0.32 : 0.27;
  if ('ABCDEFGHJKLNOPQRSTUVWXYZ0123456789#$&+?'.includes(char)) return isBold ? 0.70 : 0.64;
  return isBold ? 0.58 : 0.52; // caracteres minúsculos padrão e acentos PT-BR (ç, ã, é, ó, ú, etc.)
}

/**
 * Calcula a largura física proporcional de uma linha de texto em pixels
 * @param {string} line
 * @param {number} fontSize
 * @param {boolean} isBold
 * @returns {number} Largura em pixels
 */
function calculateProportionalLineWidth(line, fontSize, isBold = true) {
  if (!line || typeof line !== 'string') return 0;
  let totalWidth = 0;
  for (const char of line) {
    totalWidth += fontSize * getCharacterWidthFactor(char, isBold);
  }
  return Math.round(totalWidth);
}

/**
 * Quebra de linha determinística para texto de overlay respeitando maxCharsPerLine, maxLines e safeWidth
 * @param {string} text
 * @param {number} maxCharsPerLine
 * @param {number} maxLines
 * @param {number} fontSize
 * @param {number} maxLineWidthPx
 * @param {boolean} isBold
 * @returns {{ lines: string[], formattedText: string }}
 */
function wrapText(text, maxCharsPerLine, maxLines, fontSize = 50, maxLineWidthPx = 900, isBold = true) {
  if (!text) return { lines: [], formattedText: '' };
  
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = calculateProportionalLineWidth(candidate, fontSize, isBold);

    if (!currentLine) {
      currentLine = word;
    } else if (candidate.length <= maxCharsPerLine && candidateWidth <= maxLineWidthPx) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    throw new Error(`[LAYOUT ERROR] Texto ('${text.slice(0, 30)}...') gerou ${lines.length} linhas, excedendo o limite permitido de ${maxLines} linhas`);
  }

  return {
    lines,
    formattedText: lines.join('\n')
  };
}

/**
 * Validação de bounding box proporcional contra o retângulo seguro (Safe Rectangle)
 * @param {Object} params
 */
function validateBoundingBoxInSafeRect({ lines, fontSize, padding, safeRect, positionName, isBold = true }) {
  const lineCount = lines.length;
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = calculateProportionalLineWidth(line, fontSize, isBold);
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const totalBoxWidth = maxLineWidth + (padding * 2);
  const estimatedTextHeight = Math.round(lineCount * fontSize * 1.25);
  const totalBoxHeight = estimatedTextHeight + (padding * 2);

  const allowedWidth = safeRect.x_max - safeRect.x_min;
  const allowedHeight = safeRect.y_max - safeRect.y_min;

  if (totalBoxWidth > allowedWidth) {
    throw new Error(`[LAYOUT OVERFLOW ERROR] Largura calculada do overlay (${totalBoxWidth}px) excede a safe area '${positionName}' (${allowedWidth}px)`);
  }

  if (totalBoxHeight > allowedHeight) {
    throw new Error(`[LAYOUT OVERFLOW ERROR] Altura calculada do overlay (${totalBoxHeight}px) excede a safe area '${positionName}' (${allowedHeight}px)`);
  }

  return { totalBoxWidth, totalBoxHeight };
}

/**
 * Calcula determinísticamente o limite seguro de caracteres por linha com base na safe area
 */
function getEffectiveMaxCharsPerLine(preset, safeRect) {
  if (preset.max_chars_per_line) return preset.max_chars_per_line;
  const safeWidth = (safeRect.x_max - safeRect.x_min) - (preset.box_padding * 2);
  const charWidth = preset.font_size * 0.65;
  const maxCharsFittingInWidth = Math.floor(safeWidth / charWidth);
  if (preset.max_lines > 1) {
    return Math.min(maxCharsFittingInWidth, Math.ceil(preset.max_chars / preset.max_lines));
  }
  return Math.min(maxCharsFittingInWidth, preset.max_chars);
}

/**
 * Validação estrutural rigorosa do array de overlays do Blueprint 1.1
 * @param {Array} overlays
 * @param {Object} style
 * @param {number} totalDurationMs
 */
function validateOverlays(overlays, style, totalDurationMs) {
  if (!Array.isArray(overlays)) {
    throw new Error('[OVERLAY VALIDATION ERROR] overlays deve ser um array');
  }

  if (overlays.length > MAX_OVERLAYS_COUNT) {
    throw new Error(`[OVERLAY VALIDATION ERROR] Quantidade de overlays (${overlays.length}) excede o limite máximo permitido de ${MAX_OVERLAYS_COUNT}`);
  }

  const seenIds = new Set();
  const seenLayers = new Set();

  for (let i = 0; i < overlays.length; i++) {
    const ov = overlays[i];
    if (!ov || typeof ov !== 'object') {
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay no índice ${i} é nulo ou inválido`);
    }

    // 1. ID único
    if (!ov.id || typeof ov.id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(ov.id)) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay ${i + 1} possui id inválido ('${ov.id}'). Deve coincidir com /^[a-zA-Z0-9_-]{1,32}$/`);
    }
    if (seenIds.has(ov.id)) {
      throw new Error(`[OVERLAY VALIDATION ERROR] id duplicado detectado: '${ov.id}'`);
    }
    seenIds.add(ov.id);

    // 2. layer_order único inteiro
    if (ov.layer_order === undefined || !Number.isInteger(ov.layer_order) || ov.layer_order < 0) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay '${ov.id}' exige layer_order inteiro não-negativo`);
    }
    if (seenLayers.has(ov.layer_order)) {
      throw new Error(`[OVERLAY VALIDATION ERROR] layer_order duplicado detectado: ${ov.layer_order} (no overlay '${ov.id}')`);
    }
    seenLayers.add(ov.layer_order);

    // 3. Type
    if (!ALLOWED_OVERLAY_TYPES.includes(ov.type)) {
      if (ov.type === 'caption_segment') {
        throw new Error(`[OVERLAY VALIDATION ERROR] 'caption_segment' é proibido dentro de overlays. Use o array 'captions' no nível raiz do Blueprint`);
      }
      throw new Error(`[OVERLAY VALIDATION ERROR] Tipo de overlay desconhecido: '${ov.type}'. Tipos permitidos: ${ALLOWED_OVERLAY_TYPES.join(', ')}`);
    }

    // 4. Texto
    if (!ov.text || typeof ov.text !== 'string' || ov.text.trim().length === 0) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay '${ov.id}' possui texto vazio ou nulo`);
    }
    if (ov.text.length > MAX_OVERLAY_CHARS) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Texto do overlay '${ov.id}' (${ov.text.length} chars) excede o limite máximo de ${MAX_OVERLAY_CHARS} caracteres`);
    }

    // 5. Timings
    const startMs = Number(ov.start_ms);
    const endMs = Number(ov.end_ms);
    if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay '${ov.id}' possui timing inválido: 0 <= start_ms (${ov.start_ms}) < end_ms (${ov.end_ms}) obrigatório`);
    }
    if (endMs > totalDurationMs + 250) { // tolerância de borda
      throw new Error(`[OVERLAY VALIDATION ERROR] Overlay '${ov.id}' termina em ${endMs}ms, excedendo a duração total do vídeo (${totalDurationMs}ms)`);
    }

    // 6. Position
    if (!ALLOWED_POSITIONS.includes(ov.position)) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Posição desconhecida '${ov.position}' no overlay '${ov.id}'. Posições permitidas: ${ALLOWED_POSITIONS.join(', ')}`);
    }

    // 7. Preset e Whitelist de Compatibilidade
    const preset = style.overlay_presets?.[ov.preset];
    if (!preset) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Preset '${ov.preset}' não encontrado no estilo '${style.id}'. Presets disponíveis: ${Object.keys(style.overlay_presets || {}).join(', ')}`);
    }

    const supportedTypes = preset.supported_types || [];
    if (supportedTypes.length > 0 && !supportedTypes.includes(ov.type)) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Preset '${ov.preset}' não é compatível com o tipo de overlay '${ov.type}'. Tipos suportados pelo preset: [${supportedTypes.join(', ')}]`);
    }

    // 8. Validação de layout contra Safe Rectangle
    const safeRect = style.safe_rectangles?.[ov.position];
    if (!safeRect) {
      throw new Error(`[STYLE ERROR] safe_rectangles não definido para a posição '${ov.position}' no estilo '${style.id}'`);
    }

    const safeWidth = (safeRect.x_max - safeRect.x_min) - (preset.box_padding * 2);
    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);
    const isBold = preset.font_id?.includes('bold') ?? true;

    const { lines } = wrapText(ov.text, maxCharsPerLine, preset.max_lines, preset.font_size, safeWidth, isBold);
    validateBoundingBoxInSafeRect({
      lines,
      fontSize: preset.font_size,
      padding: preset.box_padding,
      safeRect,
      positionName: ov.position,
      isBold
    });
  }

  return true;
}

/**
 * Validação estrutural do array de captions do Blueprint 1.1 com safe area layout check
 * @param {Array} captions
 * @param {Object} style
 * @param {number} totalDurationMs
 */
function validateCaptions(captions, style, totalDurationMs) {
  if (!captions) return true;
  if (!Array.isArray(captions)) {
    throw new Error('[CAPTIONS VALIDATION ERROR] captions deve ser um array');
  }

  if (captions.length > MAX_CAPTIONS_COUNT) {
    throw new Error(`[CAPTIONS VALIDATION ERROR] Quantidade de legendas (${captions.length}) excede o limite máximo de ${MAX_CAPTIONS_COUNT}`);
  }

  const captionPreset = style.captions_preset || {
    font_id: 'dejavu_medium',
    font_size: 42,
    max_lines: 2,
    max_chars: 40,
    max_chars_per_line: 20,
    box_padding: 16
  };
  const captionSafeRect = style.safe_rectangles?.captions || { x_min: 80, x_max: 1000, y_min: 1350, y_max: 1550 };
  const safeWidth = (captionSafeRect.x_max - captionSafeRect.x_min) - (captionPreset.box_padding * 2);

  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    if (!cap || typeof cap !== 'object') {
      throw new Error(`[CAPTIONS VALIDATION ERROR] Legenda no índice ${i} é inválida`);
    }

    if (!cap.text || typeof cap.text !== 'string' || cap.text.trim().length === 0) {
      throw new Error(`[CAPTIONS VALIDATION ERROR] Legenda ${i + 1} possui texto vazio`);
    }
    if (cap.text.length > 200) {
      throw new Error(`[CAPTIONS VALIDATION ERROR] Legenda ${i + 1} (${cap.text.length} chars) excede o limite de 200 caracteres`);
    }

    const startMs = Number(cap.start_ms);
    const endMs = Number(cap.end_ms);
    if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
      throw new Error(`[CAPTIONS VALIDATION ERROR] Legenda ${i + 1} possui timing inválido: 0 <= start_ms (${cap.start_ms}) < end_ms (${cap.end_ms})`);
    }
    if (endMs > totalDurationMs + 250) {
      throw new Error(`[CAPTIONS VALIDATION ERROR] Legenda ${i + 1} termina em ${endMs}ms, excedendo a duração total do vídeo (${totalDurationMs}ms)`);
    }

    // Validação de layout de caption contra safe area
    const { lines } = wrapText(cap.text, captionPreset.max_chars_per_line || 20, captionPreset.max_lines || 2, captionPreset.font_size, safeWidth, false);
    validateBoundingBoxInSafeRect({
      lines,
      fontSize: captionPreset.font_size,
      padding: captionPreset.box_padding,
      safeRect: captionSafeRect,
      positionName: 'captions',
      isBold: false
    });
  }

  return true;
}

/**
 * Converte cor hex (#RRGGBB ou #RRGGBBAA) para formato aceito pelo FFmpeg drawtext/drawbox
 * @param {string} hexColor
 * @returns {string} ex: "white@1.0", "black@0.8", "0x00C853"
 */
function formatFFmpegColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return 'white';
  const cleanHex = hexColor.replace('#', '');
  
  if (cleanHex.length === 8) {
    const rgb = cleanHex.slice(0, 6);
    const alphaHex = cleanHex.slice(6, 8);
    const alphaFloat = (parseInt(alphaHex, 16) / 255).toFixed(2);
    return `0x${rgb}@${alphaFloat}`;
  }
  if (cleanHex.length === 6) {
    return `0x${cleanHex}`;
  }
  return hexColor;
}

/**
 * Compila a cadeia de nós de drawtext e overlays para o filter_complex do FFmpeg
 * @param {Object} params
 * @returns {{ filterNodes: string[], outputStreamLabel: string }}
 */
function compileOverlayFiltergraph({
  inputStreamLabel,
  overlays = [],
  captions = [],
  style
}) {
  const filterNodes = [];
  let currentStream = inputStreamLabel;
  let streamCounter = 1;

  // 1. Ordenar overlays estritamente por layer_order ASC
  const sortedOverlays = [...overlays].sort((a, b) => a.layer_order - b.layer_order);

  for (const ov of sortedOverlays) {
    const preset = style.overlay_presets[ov.preset];
    const fontPath = FONT_REGISTRY[preset.font_id];
    const safeRect = style.safe_rectangles[ov.position];
    const safeWidth = (safeRect.x_max - safeRect.x_min) - (preset.box_padding * 2);
    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);
    const isBold = preset.font_id?.includes('bold') ?? true;

    const { formattedText } = wrapText(ov.text, maxCharsPerLine, preset.max_lines, preset.font_size, safeWidth, isBold);
    const sanitizedText = sanitizeDrawtextString(formattedText);

    const t0 = (ov.start_ms / 1000).toFixed(3);
    const t1 = (ov.end_ms / 1000).toFixed(3);
    const fadeDelta = ((style.motion?.fade_duration_ms || 200) / 1000).toFixed(3);

    // Expressão de modulação de transparência suave (fade in / fade out)
    const alphaExpr = `if(lt(t\\,${t0}+${fadeDelta})\\,(t-${t0})/${fadeDelta}\\,if(gt(t\\,${t1}-${fadeDelta})\\,(${t1}-t)/${fadeDelta}\\,1))`;

    // Posicionamento vertical matemático
    let yPosExpr = '240';
    if (ov.position === 'top_safe') {
      yPosExpr = `${safeRect.y_min} + 20`;
    } else if (ov.position === 'center') {
      yPosExpr = `(h-text_h)/2`;
    } else if (ov.position === 'lower_third') {
      yPosExpr = `${safeRect.y_min} + 20`;
    } else if (ov.position === 'bottom_safe') {
      yPosExpr = `${safeRect.y_min} + 20`;
    }

    const xPosExpr = '(w-text_w)/2'; // Centralizado horizontalmente

    const boxColorStr = formatFFmpegColor(preset.box_color);
    const fontColorStr = formatFFmpegColor(preset.text_color);

    // Suporte a Punch Zoom EXCLUSIVO no badge de preço quando preset.punch_zoom === true
    if (ov.type === 'price_badge' && preset.punch_zoom === true) {
      const punchScale = style.motion?.badge_punch_scale || 1.15;
      const punchFontSize = Math.round(preset.font_size * punchScale);
      const punchEndSec = (Number(t0) + 0.15).toFixed(3);

      const nextStream1 = `[v_ov_${streamCounter++}]`;
      const filter1 = `${currentStream}drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=${fontColorStr}:fontsize=${punchFontSize}:box=1:boxcolor=${boxColorStr}:boxborderw=${preset.box_padding}:x=${xPosExpr}:y=${yPosExpr}:enable='between(t\\,${t0}\\,${punchEndSec})':alpha='${alphaExpr}'${nextStream1}`;
      filterNodes.push(filter1);
      currentStream = nextStream1;

      const nextStream2 = `[v_ov_${streamCounter++}]`;
      const filter2 = `${currentStream}drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=${fontColorStr}:fontsize=${preset.font_size}:box=1:boxcolor=${boxColorStr}:boxborderw=${preset.box_padding}:x=${xPosExpr}:y=${yPosExpr}:enable='between(t\\,${punchEndSec}\\,${t1})':alpha='${alphaExpr}'${nextStream2}`;
      filterNodes.push(filter2);
      currentStream = nextStream2;
    } else {
      const nextStream = `[v_ov_${streamCounter++}]`;
      const drawtextFilter = `${currentStream}drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=${fontColorStr}:fontsize=${preset.font_size}:box=1:boxcolor=${boxColorStr}:boxborderw=${preset.box_padding}:x=${xPosExpr}:y=${yPosExpr}:enable='between(t\\,${t0}\\,${t1})':alpha='${alphaExpr}'${nextStream}`;
      filterNodes.push(drawtextFilter);
      currentStream = nextStream;
    }
  }

  // 2. Compilar Captions (se existirem)
  const sortedCaptions = [...captions].sort((a, b) => a.start_ms - b.start_ms);
  const captionPreset = style.captions_preset || {
    font_id: 'dejavu_medium',
    font_size: 42,
    max_lines: 2,
    max_chars: 40,
    max_chars_per_line: 20,
    box_padding: 16,
    box_color: '#000000B3',
    text_color: '#FFFFFF'
  };
  const captionFontPath = FONT_REGISTRY[captionPreset.font_id] || FONT_REGISTRY['dejavu_medium'];
  const captionSafeRect = style.safe_rectangles?.captions || { x_min: 80, x_max: 1000, y_min: 1350, y_max: 1550 };
  const safeCaptionWidth = (captionSafeRect.x_max - captionSafeRect.x_min) - (captionPreset.box_padding * 2);

  for (const cap of sortedCaptions) {
    const { formattedText } = wrapText(cap.text, captionPreset.max_chars_per_line || 20, captionPreset.max_lines || 2, captionPreset.font_size, safeCaptionWidth, false);
    const sanitizedText = sanitizeDrawtextString(formattedText);
    const c0 = (cap.start_ms / 1000).toFixed(3);
    const c1 = (cap.end_ms / 1000).toFixed(3);

    const nextStream = `[v_cap_${streamCounter++}]`;
    const boxColor = formatFFmpegColor(captionPreset.box_color);
    const fontColor = formatFFmpegColor(captionPreset.text_color);

    const captionFilter = `${currentStream}drawtext=fontfile='${captionFontPath}':text='${sanitizedText}':fontcolor=${fontColor}:fontsize=${captionPreset.font_size}:box=1:boxcolor=${boxColor}:boxborderw=${captionPreset.box_padding}:x=(w-text_w)/2:y=${captionSafeRect.y_min + 10}:enable='between(t\\,${c0}\\,${c1})'${nextStream}`;

    filterNodes.push(captionFilter);
    currentStream = nextStream;
  }

  return {
    filterNodes,
    outputStreamLabel: currentStream
  };
}

module.exports = {
  ALLOWED_OVERLAY_TYPES,
  ALLOWED_POSITIONS,
  MAX_OVERLAYS_COUNT,
  MAX_OVERLAY_CHARS,
  MAX_CAPTIONS_COUNT,
  sanitizeDrawtextString,
  getCharacterWidthFactor,
  calculateProportionalLineWidth,
  wrapText,
  validateBoundingBoxInSafeRect,
  validateOverlays,
  validateCaptions,
  compileOverlayFiltergraph
};
