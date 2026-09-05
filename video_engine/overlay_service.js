/**
 * Módulo Overlay Engine — Video Engine V2
 * Bali Imóveis (Fase 3C.1 — Final Hardening)
 * 
 * Responsabilidades:
 * 1. Sanitização estrita de strings contra filter injection
 * 2. Whitelist estrita de compatibilidade entre tipo de overlay e preset
 * 3. Cálculo de métricas físicas REAIS lendo o arquivo TTF (.ttf) do FONT_REGISTRY (sem heurísticas manuais)
 * 4. Quebra de linha determinística (text wrapping) e fail-fast por layout overflow
 * 5. Validação rigorosa de bounding boxes contra Safe Rectangles (overlays e captions)
 * 6. Compilação de nós de drawtext no filtergraph do FFmpeg
 * 7. Ordenação estrita por layer_order (sem ambiguidades de sobreposição)
 * 8. Modulação de transparência (fade) e punch zoom determinísticos
 */

const fs = require('fs');
const { FONT_REGISTRY } = require('./styles/presets');

const ALLOWED_OVERLAY_TYPES = Object.freeze(['headline', 'price_badge', 'location_tag', 'cta_banner']);
const ALLOWED_POSITIONS = Object.freeze(['top_safe', 'center', 'lower_third', 'bottom_safe']);
const MAX_OVERLAYS_COUNT = 20;
const MAX_OVERLAY_CHARS = 250;
const MAX_CAPTIONS_COUNT = 60;

/**
 * Leitor determinístico de métricas físicas de fontes TrueType (.ttf)
 * Lê tabelas 'head', 'hhea', 'cmap' (format 4 e 12) e 'hmtx' diretamente do arquivo binário da fonte no servidor.
 * Zero dependências externas, 100% determinístico e thread-safe.
 */
class TrueTypeFontMetrics {
  constructor(fontFilePath) {
    this.fontFilePath = fontFilePath;
    const buffer = fs.readFileSync(fontFilePath);
    this.buffer = buffer;
    this.tables = {};

    const numTables = buffer.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16;
      const tag = buffer.toString('ascii', offset, offset + 4);
      const tableOffset = buffer.readUInt32BE(offset + 8);
      const tableLength = buffer.readUInt32BE(offset + 12);
      this.tables[tag] = { offset: tableOffset, length: tableLength };
    }

    // 1. Ler unitsPerEm de 'head'
    const headOffset = this.tables['head']?.offset;
    if (headOffset === undefined) throw new Error(`[TTF ERROR] Tabela 'head' não encontrada em ${fontFilePath}`);
    this.unitsPerEm = buffer.readUInt16BE(headOffset + 18);

    // 2. Ler numberOfHMetrics de 'hhea'
    const hheaOffset = this.tables['hhea']?.offset;
    if (hheaOffset === undefined) throw new Error(`[TTF ERROR] Tabela 'hhea' não encontrada em ${fontFilePath}`);
    this.numberOfHMetrics = buffer.readUInt16BE(hheaOffset + 34);

    // 3. Tabela 'hmtx'
    const hmtxOffset = this.tables['hmtx']?.offset;
    if (hmtxOffset === undefined) throw new Error(`[TTF ERROR] Tabela 'hmtx' não encontrada em ${fontFilePath}`);
    this.hmtxOffset = hmtxOffset;

    // 4. Mapear 'cmap'
    this.cmap = this._parseCmap();

    // Cache de larguras de glyphs para performance instantânea
    this._glyphWidthCache = new Map();
  }

  _parseCmap() {
    const cmapOffset = this.tables['cmap']?.offset;
    if (cmapOffset === undefined) throw new Error(`[TTF ERROR] Tabela 'cmap' não encontrada em ${this.fontFilePath}`);
    const numSubtables = this.buffer.readUInt16BE(cmapOffset + 2);

    let format4Offset = null;
    let format12Offset = null;

    for (let i = 0; i < numSubtables; i++) {
      const subOffset = cmapOffset + 4 + i * 8;
      const platformId = this.buffer.readUInt16BE(subOffset);
      const encodingId = this.buffer.readUInt16BE(subOffset + 2);
      const tableOffset = cmapOffset + this.buffer.readUInt32BE(subOffset + 4);
      const format = this.buffer.readUInt16BE(tableOffset);

      if (format === 4 && (platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 0)))) {
        format4Offset = tableOffset;
      } else if (format === 12 && (platformId === 0 || (platformId === 3 && encodingId === 10))) {
        format12Offset = tableOffset;
      }
    }

    if (format12Offset !== null) {
      return this._parseCmapFormat12(format12Offset);
    }
    if (format4Offset !== null) {
      return this._parseCmapFormat4(format4Offset);
    }
    throw new Error(`[TTF ERROR] Nenhum subtable de cmap compatível (format 4 ou 12) encontrado em ${this.fontFilePath}`);
  }

  _parseCmapFormat4(offset) {
    const segCountX2 = this.buffer.readUInt16BE(offset + 6);
    const segCount = segCountX2 / 2;
    const endCodes = [];
    const startCodes = [];
    const idDeltas = [];
    const idRangeOffsets = [];

    const endCodesOffset = offset + 14;
    for (let i = 0; i < segCount; i++) {
      endCodes.push(this.buffer.readUInt16BE(endCodesOffset + i * 2));
    }

    const startCodesOffset = endCodesOffset + segCountX2 + 2;
    for (let i = 0; i < segCount; i++) {
      startCodes.push(this.buffer.readUInt16BE(startCodesOffset + i * 2));
    }

    const idDeltasOffset = startCodesOffset + segCountX2;
    for (let i = 0; i < segCount; i++) {
      idDeltas.push(this.buffer.readInt16BE(idDeltasOffset + i * 2));
    }

    const idRangeOffsetsOffset = idDeltasOffset + segCountX2;
    for (let i = 0; i < segCount; i++) {
      idRangeOffsets.push(this.buffer.readUInt16BE(idRangeOffsetsOffset + i * 2));
    }

    return (charCode) => {
      for (let i = 0; i < segCount; i++) {
        if (charCode <= endCodes[i]) {
          if (charCode >= startCodes[i]) {
            if (idRangeOffsets[i] === 0) {
              return (charCode + idDeltas[i]) & 0xFFFF;
            } else {
              const rangeOffsetLocation = idRangeOffsetsOffset + i * 2;
              const glyphIndexAddress = rangeOffsetLocation + idRangeOffsets[i] + (charCode - startCodes[i]) * 2;
              const glyphId = this.buffer.readUInt16BE(glyphIndexAddress);
              return glyphId !== 0 ? (glyphId + idDeltas[i]) & 0xFFFF : 0;
            }
          }
          break;
        }
      }
      return 0;
    };
  }

  _parseCmapFormat12(offset) {
    const nGroups = this.buffer.readUInt32BE(offset + 12);
    const groups = [];
    for (let i = 0; i < nGroups; i++) {
      const gOffset = offset + 16 + i * 12;
      const startCharCode = this.buffer.readUInt32BE(gOffset);
      const endCharCode = this.buffer.readUInt32BE(gOffset + 4);
      const startGlyphId = this.buffer.readUInt32BE(gOffset + 8);
      groups.push({ startCharCode, endCharCode, startGlyphId });
    }

    return (charCode) => {
      for (const g of groups) {
        if (charCode >= g.startCharCode && charCode <= g.endCharCode) {
          return g.startGlyphId + (charCode - g.startCharCode);
        }
      }
      return 0;
    };
  }

  getGlyphAdvanceWidth(glyphIndex) {
    if (this._glyphWidthCache.has(glyphIndex)) {
      return this._glyphWidthCache.get(glyphIndex);
    }
    let advance = 0;
    if (glyphIndex < this.numberOfHMetrics) {
      advance = this.buffer.readUInt16BE(this.hmtxOffset + glyphIndex * 4);
    } else {
      advance = this.buffer.readUInt16BE(this.hmtxOffset + (this.numberOfHMetrics - 1) * 4);
    }
    this._glyphWidthCache.set(glyphIndex, advance);
    return advance;
  }

  getCharWidth(char, fontSize) {
    const code = char.codePointAt(0);
    const glyphIndex = this.cmap(code);
    const advance = this.getGlyphAdvanceWidth(glyphIndex);
    return (advance / this.unitsPerEm) * fontSize;
  }

  getTextWidth(text, fontSize) {
    if (!text || typeof text !== 'string') return 0;
    let total = 0;
    for (const char of text) {
      total += this.getCharWidth(char, fontSize);
    }
    return total;
  }
}

// Cache global em memória das métricas físicas das fontes
const _fontMetricsCache = new Map();

/**
 * Obtém a instância de métricas da fonte física correspondente ao font_id
 * @param {string} fontId
 * @returns {TrueTypeFontMetrics}
 */
function getFontMetrics(fontId = 'dejavu_bold') {
  const fontPath = FONT_REGISTRY[fontId] || FONT_REGISTRY['dejavu_medium'] || FONT_REGISTRY['dejavu_bold'];
  if (!fontPath || !fs.existsSync(fontPath)) {
    throw new Error(`[FONT METRICS ERROR] Arquivo físico da fonte '${fontId}' não encontrado em: ${fontPath}`);
  }
  let metrics = _fontMetricsCache.get(fontPath);
  if (!metrics) {
    metrics = new TrueTypeFontMetrics(fontPath);
    _fontMetricsCache.set(fontPath, metrics);
  }
  return metrics;
}

/**
 * Mede a largura física real de um texto em pixels baseando-se no arquivo TTF físico da fonte
 * @param {string} text
 * @param {number} fontSize
 * @param {string} fontId
 * @returns {number} Largura exata em pixels
 */
function measurePhysicalTextWidth(text, fontSize, fontId = 'dejavu_bold') {
  if (!text || typeof text !== 'string') return 0;
  const metrics = getFontMetrics(fontId);
  return metrics.getTextWidth(text, fontSize);
}

/**
 * Sanitiza texto para uso seguro no drawtext do FFmpeg (Defesa em Profundidade)
 * Escapa % e normaliza quebras de linha e apóstrofes
 * @param {string} rawText
 * @returns {string}
 */
function sanitizeDrawtextString(rawText) {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/'/g, '’')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .trim();
}

/**
 * Quebra de linha determinística para texto de overlay respeitando maxCharsPerLine, maxLines e safeWidth
 * Usa as métricas físicas REAIS do arquivo TTF da fonte.
 * @param {string} text
 * @param {number} maxCharsPerLine
 * @param {number} maxLines
 * @param {number} fontSize
 * @param {number} maxLineWidthPx
 * @param {string} fontId
 * @returns {{ lines: string[], formattedText: string, maxLineWidthPx: number }}
 */
function wrapText(text, maxCharsPerLine, maxLines, fontSize = 50, maxLineWidthPx = 900, fontId = 'dejavu_bold') {
  if (!text) return { lines: [], formattedText: '', maxLineWidthPx: 0 };
  
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = measurePhysicalTextWidth(candidate, fontSize, fontId);

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

  let measuredMaxLine = 0;
  for (const l of lines) {
    const w = measurePhysicalTextWidth(l, fontSize, fontId);
    if (w > measuredMaxLine) measuredMaxLine = w;
  }

  return {
    lines,
    formattedText: lines.join('\n'),
    maxLineWidthPx: Math.round(measuredMaxLine)
  };
}

/**
 * Validação de bounding box física contra o retângulo seguro (Safe Rectangle)
 * @param {Object} params
 */
function validateBoundingBoxInSafeRect({ lines, fontSize, padding, safeRect, positionName, fontId = 'dejavu_bold' }) {
  const lineCount = lines.length;
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = measurePhysicalTextWidth(line, fontSize, fontId);
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const totalBoxWidth = Math.round(maxLineWidth + (padding * 2));
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

    // 8. Validação de layout contra Safe Rectangle usando fontes físicas reais
    const safeRect = style.safe_rectangles?.[ov.position];
    if (!safeRect) {
      throw new Error(`[STYLE ERROR] safe_rectangles não definido para a posição '${ov.position}' no estilo '${style.id}'`);
    }

    const safeWidth = (safeRect.x_max - safeRect.x_min) - (preset.box_padding * 2);
    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);

    const { lines } = wrapText(ov.text, maxCharsPerLine, preset.max_lines, preset.font_size, safeWidth, preset.font_id);
    validateBoundingBoxInSafeRect({
      lines,
      fontSize: preset.font_size,
      padding: preset.box_padding,
      safeRect,
      positionName: ov.position,
      fontId: preset.font_id
    });
  }

  return true;
}

/**
 * Validação estrutural do array de captions do Blueprint 1.1 com safe area layout check baseado em fonte física
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
    max_chars: 60,
    max_chars_per_line: 30,
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

    // Validação de layout de caption contra safe area usando fonte física real
    const { lines } = wrapText(cap.text, captionPreset.max_chars_per_line || 30, captionPreset.max_lines || 2, captionPreset.font_size, safeWidth, captionPreset.font_id);
    validateBoundingBoxInSafeRect({
      lines,
      fontSize: captionPreset.font_size,
      padding: captionPreset.box_padding,
      safeRect: captionSafeRect,
      positionName: 'captions',
      fontId: captionPreset.font_id
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
    const rawFontPath = FONT_REGISTRY[preset.font_id];
    const fontPath = rawFontPath ? rawFontPath.replace(/\\/g, '/').replace(/:/g, '\\:') : '';
    const safeRect = style.safe_rectangles[ov.position];
    const safeWidth = (safeRect.x_max - safeRect.x_min) - (preset.box_padding * 2);
    const maxCharsPerLine = getEffectiveMaxCharsPerLine(preset, safeRect);

    const { formattedText } = wrapText(ov.text, maxCharsPerLine, preset.max_lines, preset.font_size, safeWidth, preset.font_id);
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
    max_chars: 60,
    max_chars_per_line: 30,
    box_padding: 16,
    box_color: '#000000B3',
    text_color: '#FFFFFF'
  };
  const rawCaptionFontPath = FONT_REGISTRY[captionPreset.font_id] || FONT_REGISTRY['dejavu_medium'];
  const captionFontPath = rawCaptionFontPath ? rawCaptionFontPath.replace(/\\/g, '/').replace(/:/g, '\\:') : '';
  const captionSafeRect = style.safe_rectangles?.captions || { x_min: 80, x_max: 1000, y_min: 1350, y_max: 1550 };
  const safeCaptionWidth = (captionSafeRect.x_max - captionSafeRect.x_min) - (captionPreset.box_padding * 2);

  for (const cap of sortedCaptions) {
    const { formattedText } = wrapText(cap.text, captionPreset.max_chars_per_line || 30, captionPreset.max_lines || 2, captionPreset.font_size, safeCaptionWidth, captionPreset.font_id);
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
  TrueTypeFontMetrics,
  getFontMetrics,
  measurePhysicalTextWidth,
  sanitizeDrawtextString,
  wrapText,
  validateBoundingBoxInSafeRect,
  validateOverlays,
  validateCaptions,
  compileOverlayFiltergraph
};
