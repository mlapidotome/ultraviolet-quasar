/**
 * Módulo de Validação Física e Decode de Fotos — Video Engine V2
 * Bali Imóveis (Fase 4B.1)
 * 
 * Responsabilidades:
 * 1. Inspeção estrutural rigorosa via FFprobe (width, height, codec, format)
 * 2. Full decode real via FFmpeg sem interpolação de shell (execFile)
 * 3. Validação de thresholds físicos configuráveis (short-edge, aspect-ratio)
 * 4. Derivação determinística da extensão canônica baseada no codec/formato real
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_MIN_SHORT_EDGE_PX = parseInt(process.env.PHOTO_MIN_SHORT_EDGE_PX || '480', 10);
const DEFAULT_MAX_ASPECT_RATIO = parseFloat(process.env.PHOTO_MAX_ASPECT_RATIO || '3.0');

const CODEC_TO_EXTENSION = {
  'mjpeg': '.jpg',
  'jpeg': '.jpg',
  'jpg': '.jpg',
  'png': '.png',
  'webp': '.webp'
};

/**
 * Normaliza extensão canônica a partir do codec e format_name
 * @param {string} codec
 * @param {string} format
 * @returns {string} ex: '.jpg', '.png', '.webp'
 */
function normalizeCanonicalExtension(codec, format) {
  const cleanCodec = String(codec || '').toLowerCase().trim();
  if (CODEC_TO_EXTENSION[cleanCodec]) {
    return CODEC_TO_EXTENSION[cleanCodec];
  }

  const cleanFormat = String(format || '').toLowerCase().trim();
  if (cleanFormat.includes('jpeg') || cleanFormat.includes('jpg') || cleanFormat.includes('image2')) {
    return '.jpg';
  }
  if (cleanFormat.includes('png')) {
    return '.png';
  }
  if (cleanFormat.includes('webp')) {
    return '.webp';
  }

  return cleanCodec ? `.${cleanCodec}` : '.jpg';
}

/**
 * Executa ffprobe para inspeção estrutural de imagem
 * @param {string} filePath
 * @returns {Promise<Object>}
 */
async function probeImageStructure(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[PHOTO_VALIDATOR] Arquivo não encontrado: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`[PHOTO_VALIDATOR] Arquivo vazio (0 bytes): ${filePath}`);
  }

  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  const args = [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    filePath
  ];

  return new Promise((resolve, reject) => {
    execFile(ffprobePath, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`[PHOTO_VALIDATOR FFPROBE_ERROR] Falha na inspeção estrutural (${err.message}): ${stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ probe: parsed, file_size_bytes: stats.size });
      } catch (parseErr) {
        reject(new Error(`[PHOTO_VALIDATOR FFPROBE_PARSE_ERROR] Resposta JSON inválida: ${stdout}`));
      }
    });
  });
}

/**
 * Executa full decode real da imagem via FFmpeg
 * Garante que a imagem não está truncada ou com bytes corrompidos
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function fullDecodeImage(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[PHOTO_VALIDATOR] Arquivo não encontrado para decode: ${filePath}`);
  }

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const args = [
    '-v', 'error',
    '-i', filePath,
    '-f', 'null',
    '-'
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err || (stderr && stderr.trim().length > 0)) {
        const errMsg = stderr ? stderr.trim() : (err ? err.message : 'Unknown decode error');
        return reject(new Error(`[PHOTO_VALIDATOR FULL_DECODE_FAILED] Imagem corrompida ou truncada: ${errMsg}`));
      }
      resolve();
    });
  });
}

/**
 * Validação física completa de foto
 * 
 * @param {string} filePath Caminho do arquivo a validar
 * @param {Object} options Configurações de thresholds
 * @param {number} options.minShortEdgePx Menor lado mínimo em pixels
 * @param {number} options.maxAspectRatio Proporção máxima de aspecto
 * @returns {Promise<{ valid: boolean, width: number, height: number, short_edge: number, aspect_ratio: number, codec: string, format: string, normalized_ext: string, file_size_bytes: number }>}
 */
async function validatePhotoImage(filePath, options = {}) {
  const minShortEdgePx = options.minShortEdgePx !== undefined ? options.minShortEdgePx : DEFAULT_MIN_SHORT_EDGE_PX;
  const maxAspectRatio = options.maxAspectRatio !== undefined ? options.maxAspectRatio : DEFAULT_MAX_ASPECT_RATIO;

  // 1. FFprobe Estrutural
  const { probe, file_size_bytes } = await probeImageStructure(filePath);

  const streams = probe.streams || [];
  const videoStream = streams.find(s => s.codec_type === 'video');

  if (!videoStream) {
    throw new Error(`[PHOTO_VALIDATOR NO_IMAGE_STREAM] Arquivo não contém stream de imagem válido: ${filePath}`);
  }

  const width = parseInt(videoStream.width || '0', 10);
  const height = parseInt(videoStream.height || '0', 10);

  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    throw new Error(`[PHOTO_VALIDATOR INVALID_DIMENSIONS] Dimensões inválidas (${width}x${height})`);
  }

  const codec = videoStream.codec_name || 'unknown';
  const format = probe.format?.format_name || 'unknown';

  // 2. Full Decode Real via FFmpeg
  await fullDecodeImage(filePath);

  // 3. Validação de Threshold: Short Edge
  const shortEdge = Math.min(width, height);
  if (shortEdge < minShortEdgePx) {
    throw new Error(`[PHOTO_VALIDATOR SHORT_EDGE_THRESHOLD] Menor lado (${shortEdge}px) é inferior ao limite mínimo permitido (${minShortEdgePx}px)`);
  }

  // 4. Validação de Threshold: Aspect Ratio
  const aspectRatio = width / height;
  const maxRatioMetric = Math.max(aspectRatio, 1 / aspectRatio);
  if (maxRatioMetric > maxAspectRatio) {
    throw new Error(`[PHOTO_VALIDATOR ASPECT_RATIO_THRESHOLD] Aspect ratio (${maxRatioMetric.toFixed(2)}) excede o limite máximo permitido (${maxAspectRatio})`);
  }

  // 5. Extensão Canônica Normalizada
  const normalizedExt = normalizeCanonicalExtension(codec, format);

  return {
    valid: true,
    width,
    height,
    short_edge: shortEdge,
    aspect_ratio: parseFloat(aspectRatio.toFixed(4)),
    codec,
    format,
    normalized_ext: normalizedExt,
    file_size_bytes
  };
}

module.exports = {
  validatePhotoImage,
  probeImageStructure,
  fullDecodeImage,
  normalizeCanonicalExtension,
  DEFAULT_MIN_SHORT_EDGE_PX,
  DEFAULT_MAX_ASPECT_RATIO
};
