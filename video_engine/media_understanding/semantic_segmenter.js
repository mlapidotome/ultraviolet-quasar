/**
 * Módulo de Segmentação Temporal Contínua — Media Understanding
 * Bali Imóveis (Fase 4A.1)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { validateTemporalSegment, clampScore } = require('./analysis_schema');

const DEFAULT_SAMPLE_INTERVAL_MS = 1200;
const DEFAULT_MIN_SEGMENT_DURATION_MS = 1200;

/**
 * Extração uniforme de frames do vídeo via FFmpeg
 */
async function extractFramesUniformly(videoPath, {
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  outputDir,
  totalDurationMs
}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`[SEGMENTER_ERROR] Arquivo de vídeo não encontrado: ${videoPath}`);
  }
  if (!outputDir) {
    throw new Error('[SEGMENTER_ERROR] outputDir é obrigatório para extração de frames');
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const durationMs = Number(totalDurationMs);
  if (isNaN(durationMs) || durationMs <= 0) {
    throw new Error(`[SEGMENTER_ERROR] totalDurationMs inválido: ${totalDurationMs}`);
  }

  const timestamps = [];
  for (let t = 0; t < durationMs; t += sampleIntervalMs) {
    timestamps.push(t);
  }
  // Garantir amostragem próxima ao final se o gap final for significativo (> sampleIntervalMs / 2)
  if (durationMs - timestamps[timestamps.length - 1] > sampleIntervalMs / 2) {
    timestamps.push(Math.max(0, durationMs - 200));
  }

  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const extractedSamples = [];

  for (let i = 0; i < timestamps.length; i++) {
    const tMs = timestamps[i];
    const sec = (tMs / 1000).toFixed(3);
    const frameFilename = `frame_${String(i).padStart(4, '0')}_${tMs}ms.jpg`;
    const framePath = path.join(outputDir, frameFilename);

    // Se já existir em cache no diretório da análise, reutilizar
    if (fs.existsSync(framePath) && fs.statSync(framePath).size > 0) {
      extractedSamples.push({ timestamp_ms: tMs, frame_path: framePath });
      continue;
    }

    const args = [
      '-y',
      '-ss', sec,
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      framePath
    ];

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (err || !fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
          return reject(new Error(`[SEGMENTER_ERROR] Falha ao extrair frame em ${sec}s: ${err ? err.message : 'Arquivo vazio'}`));
        }
        resolve();
      });
    });

    extractedSamples.push({ timestamp_ms: tMs, frame_path: framePath });
  }

  return extractedSamples;
}

/**
 * Suavização de ruído transitório em amostras temporais
 * Ex: [living_room, hallway (1 sample), living_room] -> absorve hallway para living_room
 */
function smoothTransientSamples(classifiedSamples) {
  if (!Array.isArray(classifiedSamples) || classifiedSamples.length <= 2) {
    return classifiedSamples;
  }

  const smoothed = classifiedSamples.map(s => ({ ...s }));

  for (let i = 1; i < smoothed.length - 1; i++) {
    const prev = smoothed[i - 1];
    const curr = smoothed[i];
    const next = smoothed[i + 1];

    if (prev.room_type === next.room_type && curr.room_type !== prev.room_type) {
      // Se o sample atual tem confidence menor ou igual aos vizinhos, absorve o room_type
      if (curr.confidence <= Math.max(prev.confidence, next.confidence)) {
        smoothed[i].room_type = prev.room_type;
        smoothed[i].smoothed_from = curr.room_type;
      }
    }
  }

  return smoothed;
}

/**
 * Segmentação de Tour Contínuo a partir de amostras classificadas
 */
function segmentContinuousTour(classifiedSamples, {
  minSegmentDurationMs = DEFAULT_MIN_SEGMENT_DURATION_MS,
  totalDurationMs,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS
} = {}) {
  if (!Array.isArray(classifiedSamples) || classifiedSamples.length === 0) {
    throw new Error('[SEGMENTER_ERROR] classifiedSamples não pode estar vazio');
  }

  const durationMs = Number(totalDurationMs);
  if (isNaN(durationMs) || durationMs <= 0) {
    throw new Error(`[SEGMENTER_ERROR] totalDurationMs inválido: ${totalDurationMs}`);
  }

  // 1. Suavizar ruídos transitórios isolados
  const smoothed = smoothTransientSamples(classifiedSamples);

  // 2. Agrupar samples contíguos com mesmo room_type
  const rawClusters = [];
  let currentCluster = {
    room_type: smoothed[0].room_type,
    samples: [smoothed[0]]
  };

  for (let i = 1; i < smoothed.length; i++) {
    const sample = smoothed[i];
    if (sample.room_type === currentCluster.room_type) {
      currentCluster.samples.push(sample);
    } else {
      rawClusters.push(currentCluster);
      currentCluster = {
        room_type: sample.room_type,
        samples: [sample]
      };
    }
  }
  rawClusters.push(currentCluster);

  // 3. Converter clusters em segmentos temporais iniciais
  const initialSegments = [];
  let currentStartMs = 0;

  for (let c = 0; c < rawClusters.length; c++) {
    const cluster = rawClusters[c];
    const isLast = c === rawClusters.length - 1;

    let endMs = durationMs;
    if (!isLast) {
      const lastSampleInCluster = cluster.samples[cluster.samples.length - 1];
      const nextClusterFirstSample = rawClusters[c + 1].samples[0];
      // Ponto de corte na metade do intervalo entre o último sample do cluster e o primeiro do próximo
      const midpoint = Math.round((lastSampleInCluster.timestamp_ms + nextClusterFirstSample.timestamp_ms) / 2);
      endMs = Math.min(durationMs, Math.max(currentStartMs + 100, midpoint));
    }

    initialSegments.push({
      start_ms: currentStartMs,
      end_ms: endMs,
      room_type: cluster.room_type,
      samples: cluster.samples
    });

    currentStartMs = endMs;
  }

  // 4. Absorver segmentos que ficaram menores que minSegmentDurationMs
  const consolidatedSegments = [];
  for (let i = 0; i < initialSegments.length; i++) {
    const seg = initialSegments[i];
    const segDur = seg.end_ms - seg.start_ms;

    if (segDur < minSegmentDurationMs && consolidatedSegments.length > 0) {
      // Fundir com o segmento anterior
      const prev = consolidatedSegments[consolidatedSegments.length - 1];
      prev.end_ms = seg.end_ms;
      prev.samples.push(...seg.samples);
    } else if (segDur < minSegmentDurationMs && i < initialSegments.length - 1) {
      // Se for o primeiro e for curto, fundir com o próximo
      const next = initialSegments[i + 1];
      next.start_ms = seg.start_ms;
      next.samples.unshift(...seg.samples);
    } else {
      consolidatedSegments.push(seg);
    }
  }

  // Garantir que o último segmento termine exatamente em durationMs
  if (consolidatedSegments.length > 0) {
    consolidatedSegments[consolidatedSegments.length - 1].end_ms = durationMs;
  }

  // 5. Montar objetos finais dos segmentos e selecionar keyframe representativo
  const finalSegments = [];

  for (let sIdx = 0; sIdx < consolidatedSegments.length; sIdx++) {
    const cSeg = consolidatedSegments[sIdx];
    const startMs = cSeg.start_ms;
    const endMs = cSeg.end_ms;
    const segDuration = endMs - startMs;

    // Selecionar keyframe com maior technical_quality_score
    let bestKeyframe = cSeg.samples[0];
    let bestScore = -1;

    const allFeaturesSet = new Set();
    let sumTech = 0;
    let sumAes = 0;
    let sumConf = 0;

    for (const sample of cSeg.samples) {
      (sample.features || []).forEach(f => allFeaturesSet.add(f));
      sumTech += sample.technical_quality_score || 0.5;
      sumAes += sample.aesthetic_score || 0.5;
      sumConf += sample.confidence || 0.5;

      const sampleScore = (sample.technical_quality_score * 0.6) + (sample.confidence * 0.4);
      if (sampleScore > bestScore) {
        bestScore = sampleScore;
        bestKeyframe = sample;
      }
    }

    const n = cSeg.samples.length;
    const avgTech = clampScore(sumTech / n);
    const avgAes = clampScore(sumAes / n);
    const avgConf = clampScore(sumConf / n);

    const finalSeg = {
      segment_index: sIdx,
      start_ms: startMs,
      end_ms: endMs,
      duration_ms: segDuration,
      room_type: cSeg.room_type,
      features: Array.from(allFeaturesSet),
      technical_quality_score: avgTech,
      aesthetic_score: avgAes,
      confidence: avgConf,
      representative_keyframe: {
        timestamp_ms: bestKeyframe.timestamp_ms,
        frame_path: bestKeyframe.frame_path
      },
      sample_count: n
    };

    validateTemporalSegment(finalSeg, durationMs);
    finalSegments.push(finalSeg);
  }

  return finalSegments;
}

module.exports = {
  DEFAULT_SAMPLE_INTERVAL_MS,
  DEFAULT_MIN_SEGMENT_DURATION_MS,
  extractFramesUniformly,
  smoothTransientSamples,
  segmentContinuousTour
};
