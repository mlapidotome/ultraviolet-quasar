/**
 * Módulo Overlay Engine — Video Engine V2
 * Bali Imóveis (Fase 3C.1)
 * 
 * Responsabilidades:
 * 1. Sanitização estrita de strings contra filter injection
 * 2. Validação declarativa de overlays e captions
 * 3. Cálculo determinístico de quebra de linha (text wrapping)
 * 4. Validação rigorosa de bounding boxes contra Safe Rectangles
 * 5. Compilação de nós de drawtext/drawbox no filtergraph do FFmpeg
 * 6. Ordenação estrita por layer_order (sem ambiguidades de sobreposição)
 * 7. Modulação de transparência (fade) e punch zoom determinísticos
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
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * Quebra de linha determinística para texto de overlay respeitando max_chars e max_lines
 * @param {string} text Texto sanitizado
 * @param {number} maxCharsPerLine
 * @param {number} maxLines
 * @returns {{ lines: string[], formattedText: string }}
 */
function wrapText(text, maxCharsPerLine, maxLines) {
  if (!text) return { lines: [], formattedText: '' };
  
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
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
 * Validação de bounding box contra o retângulo seguro (Safe Rectangle)
 * @param {Object} params
 */
function validateBoundingBoxInSafeRect({ lines, fontSize, padding, safeRect, positionName }) {
  const lineCount = lines.length;
  const maxLineLength = Math.max(...lines.map(l => l.length), 0);

  // Estimativa determinística de dimensões em pixels (média de 0.60 * font_size por char em fontes sans-serif bold)
  const estimatedTextWidth = Math.round(maxLineLength * fontSize * 0.60);
  const totalBoxWidth = estimatedTextWidth + (padding * 2);

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
  const charWidth = preset.font_size * 0.60;
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

    // 7. Preset
    const preset = style.overlay_presets?.[ov.preset];
    if (!preset) {
      throw new Error(`[OVERLAY VALIDATION ERROR] Preset '${ov.preset}' não encontrado no estilo '${style.id}'. Presets disponíveis: ${Object.keys(style.overlay_presets || {}).join(', ')}`);
    }

    // 8. Validação de layout contra Safe Rectangle
    const safeRect = style.safe_rectangles?.[ov.position];
    if (!safeRect) {
      throw new Error(`[STYLE ERROR] safe_rectangles não definido para a posição '${ov.position}' no estilo '${style.id}'`);
    }

    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);
    const { lines } = wrapText(ov.text, maxCharsPerLine, preset.max_lines);
    validateBoundingBoxInSafeRect({
      lines,
      fontSize: preset.font_size,
      padding: preset.box_padding,
      safeRect,
      positionName: ov.position
    });
  }

  return true;
}

/**
 * Validação estrutural do array de captions do Blueprint 1.1
 * @param {Array} captions
 * @param {number} totalDurationMs
 */
function validateCaptions(captions, totalDurationMs) {
  if (!captions) return true;
  if (!Array.isArray(captions)) {
    throw new Error('[CAPTIONS VALIDATION ERROR] captions deve ser um array');
  }

  if (captions.length > MAX_CAPTIONS_COUNT) {
    throw new Error(`[CAPTIONS VALIDATION ERROR] Quantidade de legendas (${captions.length}) excede o limite máximo de ${MAX_CAPTIONS_COUNT}`);
  }

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
    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);
    const { formattedText } = wrapText(ov.text, maxCharsPerLine, preset.max_lines);
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

    // Suporte a Punch Zoom exclusivo no badge de preço
    let fontSizeExpr = String(preset.font_size);
    if (ov.type === 'price_badge' && preset.punch_zoom) {
      const punchScale = style.motion?.badge_punch_scale || 1.15;
      const punchFontSize = Math.round(preset.font_size * punchScale);
      fontSizeExpr = `if(lt(t\\,${t0}+0.15)\\,${punchFontSize}\\,${preset.font_size})`;
    }

    const nextStream = `[v_ov_${streamCounter++}]`;
    const boxColorStr = formatFFmpegColor(preset.box_color);
    const fontColorStr = formatFFmpegColor(preset.text_color);

    const drawtextFilter = `${currentStream}drawtext=fontfile='${fontPath}':text='${sanitizedText}':fontcolor=${fontColorStr}:fontsize=${fontSizeExpr}:box=1:boxcolor=${boxColorStr}:boxborderw=${preset.box_padding}:x=${xPosExpr}:y=${yPosExpr}:enable='between(t\\,${t0}\\,${t1})':alpha='${alphaExpr}'${nextStream}`;

    filterNodes.push(drawtextFilter);
    currentStream = nextStream;
  }

  // 2. Compilar Captions (se existirem)
  const sortedCaptions = [...captions].sort((a, b) => a.start_ms - b.start_ms);
  const captionFontPath = FONT_REGISTRY[style.typography?.body_font_id] || FONT_REGISTRY['dejavu_medium'];

  for (const cap of sortedCaptions) {
    const { formattedText } = wrapText(cap.text, 36, 2);
    const sanitizedText = sanitizeDrawtextString(formattedText);
    const c0 = (cap.start_ms / 1000).toFixed(3);
    const c1 = (cap.end_ms / 1000).toFixed(3);

    const nextStream = `[v_cap_${streamCounter++}]`;
    const captionFilter = `${currentStream}drawtext=fontfile='${captionFontPath}':text='${sanitizedText}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.75:boxborderw=16:x=(w-text_w)/2:y=1400:enable='between(t\\,${c0}\\,${c1})'${nextStream}`;

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
  wrapText,
  validateBoundingBoxInSafeRect,
  validateOverlays,
  validateCaptions,
  compileOverlayFiltergraph
};
