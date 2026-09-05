/**
 * Módulo Orquestrador de Vídeo Piloto & Coleção Criativa — Video Engine V2
 * Totalmente desacoplado de interfaces e do WhatsApp
 * Todas as operações vinculadas unicamente a job_id no PostgreSQL
 * Suporte a Fase 2B (Piloto) e Fase 2C (Aprovação, Reprovação, Restantes 2 e 3)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile } = require('child_process');
const { getPool } = require('./db');
let assetService = null;
try {
  assetService = require('./asset_service');
} catch (e) {
  console.warn('[PILOT_SERVICE] asset_service indisponível:', e.message);
}

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const MARCEL_VOICE_CLONE_ID = process.env.MARCEL_VOICE_CLONE_ID || 'dccd1a85e6b1450facf9ec953b648df2';
const OUTPUTS_BASE_DIR = path.join(__dirname, '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

// Garantir diretório base de jobs
if (!fs.existsSync(JOBS_OUTPUTS_DIR)) {
  fs.mkdirSync(JOBS_OUTPUTS_DIR, { recursive: true });
}

/* =========================================================================
 * VALIDAÇÕES DE SEGURANÇA E MÍDIA (FFPROBE / ANTI-SYMLINK)
 * ========================================================================= */

/**
 * Validação assíncrona de streams e duração via ffprobe
 * Confirma: duration > 0, >= 1 stream de vídeo, >= 1 stream de áudio
 */
function validateMediaStreamsAndDuration(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type',
        '-show_entries', 'format=duration',
        '-of', 'json',
        filePath
      ],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Falha ao executar ffprobe: ${err.message}`));
        }

        try {
          const probe = JSON.parse(stdout);
          const duration = parseFloat(probe.format?.duration || '0');
          const streams = probe.streams || [];
          const hasVideo = streams.some(s => s.codec_type === 'video');
          const hasAudio = streams.some(s => s.codec_type === 'audio');

          if (isNaN(duration) || duration <= 0) {
            return reject(new Error('Duração inválida ou zero detectada via ffprobe'));
          }

          if (!hasVideo) {
            return reject(new Error('Stream de vídeo não encontrado no arquivo via ffprobe'));
          }

          if (!hasAudio) {
            return reject(new Error('Stream de áudio não encontrado no arquivo via ffprobe'));
          }

          resolve({ duration, hasVideo, hasAudio });
        } catch (parseErr) {
          reject(new Error(`Erro ao interpretar saída do ffprobe: ${parseErr.message}`));
        }
      }
    );
  });
}

/**
 * Verifica se um arquivo de vídeo está completo e íntegro (para Smart Retry)
 */
async function isMediaFileFullyValid(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return false;
    await validateMediaStreamsAndDuration(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validação Forte do body.mp4 reutilizado
 * - Existência de local_path
 * - Isolamento estrito de diretório e resolução canônica anti-symlink (realpathSync / lstat)
 * - Basename esperado body.mp4
 * - Tamanho > 0
 * - Streams de áudio, vídeo e duration > 0 via ffprobe
 */
async function validateStrongBody(bodyLocalPath, jobId) {
  if (!bodyLocalPath || typeof bodyLocalPath !== 'string') {
    throw new Error('Caminho do body.mp4 ausente no metadata do Job');
  }

  const jobDir = path.resolve(JOBS_OUTPUTS_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
    throw new Error(`Diretório do Job não encontrado: ${jobDir}`);
  }

  const realJobDir = fs.realpathSync(jobDir);
  const expectedBodyPath = path.join(jobDir, 'body.mp4');
  const resolvedGivenPath = path.resolve(bodyLocalPath);

  // 1. Exigir correspondência exata com o asset canônico esperado do Job (rejeita subpasta/body.mp4 ou outro nome)
  if (resolvedGivenPath !== path.resolve(expectedBodyPath)) {
    throw new Error(`Divergência de asset de body: esperado exatamente ${expectedBodyPath}, obtido ${bodyLocalPath}`);
  }

  if (!fs.existsSync(resolvedGivenPath)) {
    throw new Error(`Arquivo físico do body não encontrado: ${resolvedGivenPath}`);
  }

  // 2. Validação estrita de contenção física real e anti-symlink
  const realGivenBodyPath = fs.realpathSync(resolvedGivenPath);
  const realExpectedBodyPath = fs.realpathSync(expectedBodyPath);

  if (realGivenBodyPath !== realExpectedBodyPath) {
    throw new Error(`Divergência canônica: caminho físico real não coincide com o esperado do Job`);
  }

  if (!realGivenBodyPath.startsWith(realJobDir + path.sep)) {
    throw new Error(`Violação de segurança: body aponta para fora do diretório do Job (${realGivenBodyPath})`);
  }

  if (path.basename(realGivenBodyPath) !== 'body.mp4' || path.basename(resolvedGivenPath) !== 'body.mp4') {
    throw new Error(`Basename inválido para o arquivo de body: esperado body.mp4, obtido ${path.basename(realGivenBodyPath)}`);
  }

  const stats = fs.statSync(realGivenBodyPath);
  if (stats.size === 0) {
    throw new Error('Arquivo body.mp4 com tamanho zero bytes');
  }

  // 3. Validação de streams e duração via ffprobe
  await validateMediaStreamsAndDuration(realGivenBodyPath);

  return realGivenBodyPath;
}

/* =========================================================================
 * 1. INTEGRAÇÃO HEYGEN & OPERAÇÕES DE MÍDIA
 * ========================================================================= */

/**
 * Submissão de Clip para a HeyGen
 */
async function submitHeyGenClip({ lookId, text, bgImageUrl = null, avatarStyle = 'normal' }) {
  if (!HEYGEN_API_KEY) {
    throw new Error('HEYGEN_API_KEY não configurada no ambiente (.env)');
  }

  const bgConfig = bgImageUrl ? {
    type: 'image',
    url: bgImageUrl,
    fit: 'cover'
  } : {
    type: 'color',
    value: '#0b1329'
  };

  const characterConfig = {
    type: 'avatar',
    avatar_id: lookId,
    avatar_style: avatarStyle
  };

  if (bgImageUrl && avatarStyle === 'circle') {
    characterConfig.scale = 0.9;
    characterConfig.offset = { x: 0.0, y: 0.35 };
  }

  const payload = {
    title: `Clip_V2_${Date.now()}`,
    dimension: { width: 1080, height: 1920 },
    video_inputs: [
      {
        character: characterConfig,
        voice: {
          type: 'text',
          input_text: text,
          voice_id: MARCEL_VOICE_CLONE_ID,
          speed: 1.05
        },
        background: bgConfig
      }
    ]
  };

  const headers = {
    'X-Api-Key': HEYGEN_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const res = await axios.post('https://api.heygen.com/v2/video/generate', payload, { headers, timeout: 30000 });
  const videoId = res.data?.data?.video_id;
  if (!videoId) {
    throw new Error('HeyGen não retornou video_id válido');
  }

  return videoId;
}

/**
 * Consulta pontual de status de um video_id na HeyGen
 * Permite identificar estado terminal de falha sem polling infinito
 */
async function getHeyGenVideoStatus(videoId) {
  if (!HEYGEN_API_KEY) {
    throw new Error('HEYGEN_API_KEY não configurada no ambiente (.env)');
  }

  const headers = {
    'X-Api-Key': HEYGEN_API_KEY,
    'Accept': 'application/json'
  };

  try {
    const checkRes = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers, timeout: 20000 });
    const status = checkRes.data?.data?.status?.toLowerCase();
    const videoUrl = checkRes.data?.data?.video_url;
    const error = checkRes.data?.data?.error;
    return { status, videoUrl, error };
  } catch (err) {
    return { status: 'invalid', error: err.message };
  }
}

/**
 * Polling de Status na HeyGen por video_id
 */
async function pollHeyGenClip(videoId, maxRetries = 90, intervalMs = 8000) {
  if (!HEYGEN_API_KEY) {
    throw new Error('HEYGEN_API_KEY não configurada no ambiente (.env)');
  }

  const headers = {
    'X-Api-Key': HEYGEN_API_KEY,
    'Accept': 'application/json'
  };

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const checkRes = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers, timeout: 20000 });
    const status = checkRes.data?.data?.status?.toLowerCase();

    if (status === 'completed') {
      const videoUrl = checkRes.data?.data?.video_url;
      if (!videoUrl) throw new Error('HeyGen completou mas não forneceu video_url');
      return videoUrl;
    }

    if (status === 'failed') {
      const errMsg = checkRes.data?.data?.error || 'Erro desconhecido retornado pela HeyGen';
      throw new Error(`Renderização falhou na HeyGen para video_id ${videoId}: ${errMsg}`);
    }
  }

  throw new Error(`Tempo limite excedido na HeyGen para video_id ${videoId}`);
}

/**
 * Download Stream para Arquivo em Disco
 */
async function downloadToFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 60000
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Concatenação de Vídeos via FFmpeg de forma assíncrona (spawn / execFile)
 */
function concatenateVideos(hookFilePath, bodyFilePath, outputFilePath, jobDir) {
  return new Promise((resolve, reject) => {
    const listFilePath = path.join(jobDir, `concat_list_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const cleanHookPath = hookFilePath.replace(/\\/g, '/');
    const cleanBodyPath = bodyFilePath.replace(/\\/g, '/');

    fs.writeFileSync(listFilePath, `file '${cleanHookPath}'\nfile '${cleanBodyPath}'\n`, 'utf-8');

    execFile('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFilePath, '-c', 'copy', outputFilePath], (err) => {
      if (fs.existsSync(listFilePath)) {
        try { fs.unlinkSync(listFilePath); } catch (e) {}
      }

      if (!err && fs.existsSync(outputFilePath) && fs.statSync(outputFilePath).size > 0) {
        return resolve(outputFilePath);
      }

      // Fallback com re-encode assíncrono se direct copy divergir
      execFile('ffmpeg', [
        '-y',
        '-i', hookFilePath,
        '-i', bodyFilePath,
        '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]',
        '-map', '[outv]',
        '-map', '[outa]',
        outputFilePath
      ], (reencodeErr) => {
        if (reencodeErr || !fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
          return reject(new Error(`Falha na montagem FFmpeg: ${reencodeErr ? reencodeErr.message : 'Arquivo de saída vazio ou ausente'}`));
        }
        resolve(outputFilePath);
      });
    });
  });
}

/* =========================================================================
 * 2. FASE 2B: ORQUESTRAÇÃO DO VÍDEO PILOTO
 * ========================================================================= */

/**
 * Transição Atômica de Concorrência no PostgreSQL para Geração de Piloto
 */
async function lockAndSubmitPilot(jobId) {
  const pool = getPool();

  const updateQuery = `
    UPDATE video_jobs
    SET status = 'PILOT_SUBMITTED', updated_at = NOW()
    WHERE id = $1
      AND status IN ('SCRIPT_READY', 'PILOT_FAILED')
    RETURNING *;
  `;

  const res = await pool.query(updateQuery, [jobId]);

  if (res.rows.length === 1) {
    return {
      success: true,
      code: 'LOCK_ACQUIRED',
      job: res.rows[0]
    };
  }

  const checkQuery = `
    SELECT id, status, pilot_video_url, error_message, updated_at
    FROM video_jobs
    WHERE id = $1;
  `;
  const checkRes = await pool.query(checkQuery, [jobId]);

  if (checkRes.rows.length === 0) {
    return {
      success: false,
      code: 'JOB_NOT_FOUND',
      error: 'Job não encontrado no sistema'
    };
  }

  const currentJob = checkRes.rows[0];

  if (currentJob.status === 'PILOT_SUBMITTED' || currentJob.status === 'PILOT_RENDERING') {
    return {
      success: false,
      code: 'PILOT_ALREADY_IN_PROGRESS',
      error: 'A geração do piloto já está em andamento para este Job',
      job: currentJob
    };
  }

  if (currentJob.status === 'PILOT_READY') {
    return {
      success: true,
      code: 'PILOT_ALREADY_READY',
      job: currentJob
    };
  }

  return {
    success: false,
    code: 'INVALID_STATUS_TRANSITION',
    error: `Transição inválida a partir do estado: ${currentJob.status}`,
    job: currentJob
  };
}

/**
 * Orquestrador Principal do Piloto (vinculado a job_id)
 */
async function generatePilot(jobId) {
  const pool = getPool();

  try {
    const jobRes = await pool.query('SELECT * FROM video_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
      throw new Error(`Job ${jobId} não encontrado no banco`);
    }

    const job = jobRes.rows[0];
    const scripts = job.scripts_snapshot;
    const property = job.property_snapshot;

    if (!scripts || !scripts.hooks || !scripts.hooks[0] || !scripts.body) {
      throw new Error(`Dados de scripts_snapshot ausentes ou corrompidos no Job ${jobId}`);
    }

    const hook1 = scripts.hooks[0];
    const bodyScript = scripts.body;

    const jobDir = path.join(JOBS_OUTPUTS_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    let metadata = job.metadata || {};
    if (!metadata.pilot) {
      metadata.pilot = {
        started_at: new Date().toISOString(),
        attempts: 1
      };
    } else {
      metadata.pilot.attempts = (metadata.pilot.attempts || 1) + 1;
    }

    await pool.query(
      'UPDATE video_jobs SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
      ['PILOT_RENDERING', metadata, jobId]
    );

    // ETAPA 1: Gancho 1
    let hook1VideoId = metadata.pilot.hook1?.heygen_video_id;
    if (!hook1VideoId) {
      console.log(`[PILOT_SERVICE] Submetendo Gancho 1 na HeyGen para Job ${jobId}...`);
      hook1VideoId = await submitHeyGenClip({
        lookId: hook1.look.id,
        text: hook1.text,
        bgImageUrl: null,
        avatarStyle: 'normal'
      });

      metadata.pilot.hook1 = {
        heygen_video_id: hook1VideoId,
        submitted_at: new Date().toISOString()
      };
      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );

      // Fase 3A: Catalogar Hook 1 como processing (fail-open)
      if (assetService) {
        await assetService.safeCatalogOperation('catalog_hook1_submitted', async () => {
          const genKey = assetService.computeGenerationKey({
            asset_type: 'hook_clip',
            text: hook1.text,
            look_id: hook1.look?.id,
            voice_id: MARCEL_VOICE_CLONE_ID
          });
          await assetService.createAsset({
            id: `ast_hk_${jobId.slice(0, 8)}_01`,
            job_id: jobId,
            property_ref: job.property_ref,
            asset_type: 'hook_clip',
            provider_ref: hook1VideoId,
            generation_key: genKey,
            status: 'processing',
            metadata: { hook_index: 1, hook_type: hook1.tipo }
          });
        });
      }
    }

    // ETAPA 2: Desenvolvimento / Corpo
    let bodyVideoId = metadata.pilot.body?.heygen_video_id;
    if (!bodyVideoId) {
      console.log(`[PILOT_SERVICE] Submetendo Corpo na HeyGen para Job ${jobId}...`);
      const rawFoto = property?.fotos?.[0]?.url || property?.foto_capa || '';
      const fotoImovel = rawFoto.replace('fotos.sobressai.com.br/fotos/', 'fotos2.fra1.cdn.digitaloceanspaces.com/Fotos/') || null;

      bodyVideoId = await submitHeyGenClip({
        lookId: bodyScript.look.id,
        text: bodyScript.text,
        bgImageUrl: fotoImovel,
        avatarStyle: 'circle'
      });

      metadata.pilot.body = {
        heygen_video_id: bodyVideoId,
        submitted_at: new Date().toISOString()
      };
      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );

      // Fase 3A: Catalogar Body como processing (fail-open)
      if (assetService) {
        await assetService.safeCatalogOperation('catalog_body_submitted', async () => {
          const genKey = assetService.computeGenerationKey({
            asset_type: 'body_clip',
            text: bodyScript.text,
            look_id: bodyScript.look?.id,
            voice_id: MARCEL_VOICE_CLONE_ID
          });
          await assetService.createAsset({
            id: `ast_bd_${jobId.slice(0, 8)}_01`,
            job_id: jobId,
            property_ref: job.property_ref,
            asset_type: 'body_clip',
            provider_ref: bodyVideoId,
            generation_key: genKey,
            status: 'processing',
            metadata: { look_name: bodyScript.look?.nome }
          });
        });
      }
    }

    // ETAPA 3: Polling
    console.log(`[PILOT_SERVICE] Aguardando renderização do Gancho 1 (${hook1VideoId})...`);
    const hook1VideoUrl = await pollHeyGenClip(hook1VideoId);
    metadata.pilot.hook1.heygen_video_url = hook1VideoUrl;
    metadata.pilot.hook1.completed_at = new Date().toISOString();

    console.log(`[PILOT_SERVICE] Aguardando renderização do Corpo (${bodyVideoId})...`);
    const bodyVideoUrl = await pollHeyGenClip(bodyVideoId);
    metadata.pilot.body.heygen_video_url = bodyVideoUrl;
    metadata.pilot.body.completed_at = new Date().toISOString();

    await pool.query(
      'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
      [metadata, jobId]
    );

    // ETAPA 4: Download dos Clips
    const hook1Path = path.join(jobDir, 'hook_1.mp4');
    const bodyPath = path.join(jobDir, 'body.mp4');
    const finalPilotPath = path.join(jobDir, 'pilot.mp4');

    console.log(`[PILOT_SERVICE] Baixando Gancho 1 para ${hook1Path}...`);
    await downloadToFile(hook1VideoUrl, hook1Path);
    metadata.pilot.hook1.local_path = hook1Path;

    console.log(`[PILOT_SERVICE] Baixando Corpo para ${bodyPath}...`);
    await downloadToFile(bodyVideoUrl, bodyPath);
    metadata.pilot.body.local_path = bodyPath;

    // Fase 3A: Marcar Hook 1 e Body como READY no catálogo (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_hook1_ready', async () => {
        const specs = await validateMediaStreamsAndDuration(hook1Path).catch(() => ({}));
        await assetService.markAssetReady(`ast_hk_${jobId.slice(0, 8)}_01`, {
          localPath: hook1Path,
          specs,
          metadata: { heygen_video_url: hook1VideoUrl }
        });
      });
      await assetService.safeCatalogOperation('catalog_body_ready', async () => {
        const specs = await validateMediaStreamsAndDuration(bodyPath).catch(() => ({}));
        await assetService.markAssetReady(`ast_bd_${jobId.slice(0, 8)}_01`, {
          localPath: bodyPath,
          specs,
          metadata: { heygen_video_url: bodyVideoUrl }
        });
      });
    }

    // ETAPA 5: Montagem FFmpeg
    console.log(`[PILOT_SERVICE] Concatenando Piloto com FFmpeg para ${finalPilotPath}...`);
    await concatenateVideos(hook1Path, bodyPath, finalPilotPath, jobDir);

    const pilotStats = fs.statSync(finalPilotPath);
    const authenticatedPilotUrl = `/api/v2/panel/video-jobs/${jobId}/pilot`;

    metadata.pilot.completed_at = new Date().toISOString();
    metadata.pilot.final = {
      local_path: finalPilotPath,
      size_bytes: pilotStats.size,
      authenticated_url: authenticatedPilotUrl
    };

    // Fase 3A: Catalogar Piloto como rendered_creative e atualizar blueprints (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_pilot_ready', async () => {
        const pilotGenKey = assetService.computeGenerationKey({
          asset_type: 'rendered_creative',
          params: { variant_index: 1, name: 'pilot' }
        });
        const pilotAssetId = `ast_out_pilot_${jobId.slice(0, 8)}`;
        await assetService.createAsset({
          id: pilotAssetId,
          job_id: jobId,
          property_ref: job.property_ref,
          asset_type: 'rendered_creative',
          generation_key: pilotGenKey,
          status: 'processing'
        });
        const specs = await validateMediaStreamsAndDuration(finalPilotPath).catch(() => ({}));
        await assetService.markAssetReady(pilotAssetId, {
          localPath: finalPilotPath,
          specs,
          metadata: { filename: 'pilot.mp4', authenticated_url: authenticatedPilotUrl }
        });

        const blueprints = assetService.buildCreativeBlueprints(job, {
          hook1_asset_id: `ast_hk_${jobId.slice(0, 8)}_01`,
          body_asset_id: `ast_bd_${jobId.slice(0, 8)}_01`,
          pilot_asset_id: pilotAssetId
        });
        await assetService.saveBlueprintsToJob(jobId, blueprints);
      });
    }

    // ETAPA 6: Persistência de Sucesso Total
    await pool.query(
      `UPDATE video_jobs 
       SET status = 'PILOT_READY', 
           pilot_video_url = $1, 
           error_message = NULL, 
           metadata = $2, 
           updated_at = NOW() 
       WHERE id = $3`,
      [authenticatedPilotUrl, metadata, jobId]
    );

    console.log(`[PILOT_SERVICE] Piloto concluído com sucesso para Job ${jobId}: ${authenticatedPilotUrl}`);
    return {
      success: true,
      jobId,
      status: 'PILOT_READY',
      pilotVideoUrl: authenticatedPilotUrl
    };
  } catch (err) {
    console.error(`[PILOT_SERVICE ERROR] Falha no piloto para Job ${jobId}:`, err.message);

    try {
      await pool.query(
        `UPDATE video_jobs 
         SET status = 'PILOT_FAILED', 
             error_message = $1, 
             updated_at = NOW() 
         WHERE id = $2`,
        [err.message, jobId]
      );
    } catch (dbErr) {
      console.error(`[PILOT_SERVICE FATAL] Erro ao registrar falha no banco para ${jobId}:`, dbErr.message);
    }

    return {
      success: false,
      jobId,
      status: 'PILOT_FAILED',
      error: err.message
    };
  }
}

/* =========================================================================
 * 3. FASE 2C: APROVAÇÃO, REPROVAÇÃO E GERAÇÃO DOS VÍDEOS RESTANTES (2 E 3)
 * ========================================================================= */

/**
 * Transição Atômica de Concorrência no PostgreSQL para Início dos Restantes
 * Permite aprovar a partir de PILOT_READY ou tentar novamente a partir de REMAINDER_FAILED
 */
async function lockAndSubmitRemainder(jobId) {
  const pool = getPool();

  const updateQuery = `
    UPDATE video_jobs
    SET status = 'REMAINDER_SUBMITTED', updated_at = NOW()
    WHERE id = $1
      AND status IN ('PILOT_READY', 'REMAINDER_FAILED')
    RETURNING *;
  `;

  const res = await pool.query(updateQuery, [jobId]);

  if (res.rows.length === 1) {
    return {
      success: true,
      code: 'LOCK_ACQUIRED',
      job: res.rows[0]
    };
  }

  const checkQuery = `
    SELECT id, status, video2_url, video3_url, error_message, updated_at
    FROM video_jobs
    WHERE id = $1;
  `;
  const checkRes = await pool.query(checkQuery, [jobId]);

  if (checkRes.rows.length === 0) {
    return {
      success: false,
      code: 'JOB_NOT_FOUND',
      error: 'Job não encontrado no sistema'
    };
  }

  const currentJob = checkRes.rows[0];

  if (currentJob.status === 'REMAINDER_SUBMITTED' || currentJob.status === 'REMAINDER_RENDERING') {
    return {
      success: false,
      code: 'REMAINDER_ALREADY_IN_PROGRESS',
      error: 'A geração dos vídeos restantes já está em andamento para este Job',
      job: currentJob
    };
  }

  if (currentJob.status === 'CREATIVE_SET_READY') {
    return {
      success: true,
      code: 'CREATIVE_SET_ALREADY_READY',
      message: 'A coleção criativa deste Job já está pronta',
      job: currentJob
    };
  }

  return {
    success: false,
    code: 'INVALID_STATUS_TRANSITION',
    error: `Transição inválida para geração de restantes a partir do estado: ${currentJob.status}`,
    job: currentJob
  };
}

/**
 * Reprovação limpa do Piloto (PILOT_READY -> PILOT_REJECTED)
 */
async function rejectPilot(jobId) {
  const pool = getPool();

  const query = `
    UPDATE video_jobs
    SET status = 'PILOT_REJECTED',
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{pilot,rejected_at}', to_jsonb(NOW()::text)),
        updated_at = NOW()
    WHERE id = $1 AND status = 'PILOT_READY'
    RETURNING *;
  `;

  const res = await pool.query(query, [jobId]);

  if (res.rows.length === 1) {
    return {
      success: true,
      status: 'PILOT_REJECTED',
      job: res.rows[0]
    };
  }

  const check = await pool.query('SELECT id, status FROM video_jobs WHERE id = $1', [jobId]);
  if (check.rows.length === 0) {
    return {
      success: false,
      code: 'JOB_NOT_FOUND',
      error: 'Job não encontrado'
    };
  }

  return {
    success: false,
    code: 'INVALID_STATUS_TRANSITION',
    error: `Não é possível reprovar o piloto a partir do estado atual: ${check.rows[0].status}`
  };
}

/**
 * Orquestrador da Fase 2C: Geração dos Vídeos Restantes (Ganchos 2 e 3)
 * Reutiliza estritamente o body.mp4 validado de forma forte
 * Smart Retry Granular: Nunca refaz o que já estiver concluído e íntegro
 * Trata IDs terminais da HeyGen permitindo ressubmissão deliberada em retry
 */
async function generateRemainderVideos(jobId) {
  const pool = getPool();

  try {
    const jobRes = await pool.query('SELECT * FROM video_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
      throw new Error(`Job ${jobId} não encontrado no banco`);
    }

    const job = jobRes.rows[0];
    const scripts = job.scripts_snapshot;

    if (!scripts || !scripts.hooks || scripts.hooks.length < 3) {
      throw new Error(`Roteiros insuficientes para Ganchos 2 e 3 no Job ${jobId}`);
    }

    const hook2 = scripts.hooks[1];
    const hook3 = scripts.hooks[2];

    const jobDir = path.join(JOBS_OUTPUTS_DIR, jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    let metadata = job.metadata || {};
    if (!metadata.remainder) {
      metadata.remainder = {
        approved_at: new Date().toISOString(),
        attempts: 1
      };
    } else {
      metadata.remainder.attempts = (metadata.remainder.attempts || 1) + 1;
    }

    // 1. VALIDAÇÃO FORTE DO BODY REUTILIZADO (Anti-Symlink + Streams V/A + Duração)
    const bodyLocalPath = metadata.pilot?.body?.local_path;
    let validBodyPath;
    try {
      validBodyPath = await validateStrongBody(bodyLocalPath, jobId);
      console.log(`[REMAINDER_SERVICE] Body validado com sucesso para Job ${jobId}: ${validBodyPath}`);
    } catch (valErr) {
      console.error(`[REMAINDER_SERVICE] Falha na validação do body para Job ${jobId}:`, valErr.message);
      metadata.remainder.error_message = `INVALID_OR_CORRUPT_PILOT_BODY: ${valErr.message}`;
      await pool.query(
        `UPDATE video_jobs SET status = 'REMAINDER_FAILED', error_message = $1, metadata = $2, updated_at = NOW() WHERE id = $3`,
        [`Falha na validação do body: ${valErr.message}`, metadata, jobId]
      );
      return { success: false, jobId, status: 'REMAINDER_FAILED', error: valErr.message };
    }

    // 2. Atualizar status para REMAINDER_RENDERING
    await pool.query(
      'UPDATE video_jobs SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
      ['REMAINDER_RENDERING', metadata, jobId]
    );

    // 3. GERENCIAMENTO DO GANCHO 2 (HOOK 2) COM TRATAMENTO DE FALHA TERMINAL
    let hook2VideoId = metadata.remainder.hook2?.heygen_video_id;
    let hook2NeedsSubmission = !hook2VideoId;

    if (hook2VideoId) {
      // Inspecionar se o ID existente terminou em erro terminal
      const statusCheck2 = await getHeyGenVideoStatus(hook2VideoId);
      if (statusCheck2.status === 'failed' || statusCheck2.status === 'invalid') {
        console.warn(`[REMAINDER_SERVICE] Hook 2 ID ${hook2VideoId} terminou em estado terminal de erro (${statusCheck2.error}). Disparando nova submissão em retry.`);
        hook2NeedsSubmission = true;
      }
    }

    if (hook2NeedsSubmission) {
      console.log(`[REMAINDER_SERVICE] Submetendo Gancho 2 na HeyGen para Job ${jobId}...`);
      hook2VideoId = await submitHeyGenClip({
        lookId: hook2.look.id,
        text: hook2.text,
        bgImageUrl: null,
        avatarStyle: 'normal'
      });

      metadata.remainder.hook2 = {
        heygen_video_id: hook2VideoId,
        submitted_at: new Date().toISOString(),
        attempts: (metadata.remainder.hook2?.attempts || 0) + 1
      };

      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );

      // Fase 3A: Catalogar Hook 2 como processing (fail-open)
      if (assetService) {
        await assetService.safeCatalogOperation('catalog_hook2_submitted', async () => {
          const genKey = assetService.computeGenerationKey({
            asset_type: 'hook_clip',
            text: hook2.text,
            look_id: hook2.look?.id,
            voice_id: MARCEL_VOICE_CLONE_ID
          });
          await assetService.createAsset({
            id: `ast_hk_${jobId.slice(0, 8)}_02`,
            job_id: jobId,
            property_ref: job.property_ref,
            asset_type: 'hook_clip',
            provider_ref: hook2VideoId,
            generation_key: genKey,
            status: 'processing',
            metadata: { hook_index: 2, hook_type: hook2.tipo }
          });
        });
      }
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: reutilizando Hook 2 existente ${hook2VideoId} para Job ${jobId}`);
    }

    // 4. GERENCIAMENTO DO GANCHO 3 (HOOK 3) COM TRATAMENTO DE FALHA TERMINAL
    let hook3VideoId = metadata.remainder.hook3?.heygen_video_id;
    let hook3NeedsSubmission = !hook3VideoId;

    if (hook3VideoId) {
      const statusCheck3 = await getHeyGenVideoStatus(hook3VideoId);
      if (statusCheck3.status === 'failed' || statusCheck3.status === 'invalid') {
        console.warn(`[REMAINDER_SERVICE] Hook 3 ID ${hook3VideoId} terminou em estado terminal de erro (${statusCheck3.error}). Disparando nova submissão em retry.`);
        hook3NeedsSubmission = true;
      }
    }

    if (hook3NeedsSubmission) {
      console.log(`[REMAINDER_SERVICE] Submetendo Gancho 3 na HeyGen para Job ${jobId}...`);
      hook3VideoId = await submitHeyGenClip({
        lookId: hook3.look.id,
        text: hook3.text,
        bgImageUrl: null,
        avatarStyle: 'normal'
      });

      metadata.remainder.hook3 = {
        heygen_video_id: hook3VideoId,
        submitted_at: new Date().toISOString(),
        attempts: (metadata.remainder.hook3?.attempts || 0) + 1
      };

      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );

      // Fase 3A: Catalogar Hook 3 como processing (fail-open)
      if (assetService) {
        await assetService.safeCatalogOperation('catalog_hook3_submitted', async () => {
          const genKey = assetService.computeGenerationKey({
            asset_type: 'hook_clip',
            text: hook3.text,
            look_id: hook3.look?.id,
            voice_id: MARCEL_VOICE_CLONE_ID
          });
          await assetService.createAsset({
            id: `ast_hk_${jobId.slice(0, 8)}_03`,
            job_id: jobId,
            property_ref: job.property_ref,
            asset_type: 'hook_clip',
            provider_ref: hook3VideoId,
            generation_key: genKey,
            status: 'processing',
            metadata: { hook_index: 3, hook_type: hook3.tipo }
          });
        });
      }
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: reutilizando Hook 3 existente ${hook3VideoId} para Job ${jobId}`);
    }

    // 5. POLLING E DOWNLOAD GRANULAR
    const hook2Local = path.join(jobDir, 'hook_2.mp4');
    if (!fs.existsSync(hook2Local) || fs.statSync(hook2Local).size === 0) {
      console.log(`[REMAINDER_SERVICE] Aguardando renderização do Gancho 2 (${hook2VideoId})...`);
      const hook2Url = await pollHeyGenClip(hook2VideoId);
      metadata.remainder.hook2.heygen_video_url = hook2Url;
      metadata.remainder.hook2.completed_at = new Date().toISOString();

      console.log(`[REMAINDER_SERVICE] Baixando Gancho 2 para ${hook2Local}...`);
      await downloadToFile(hook2Url, hook2Local);
      metadata.remainder.hook2.local_path = hook2Local;

      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: Gancho 2 local já existente e com tamanho válido.`);
      metadata.remainder.hook2.local_path = hook2Local;
    }

    // Fase 3A: Marcar Hook 2 como ready no catálogo (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_hook2_ready', async () => {
        const specs = await validateMediaStreamsAndDuration(hook2Local).catch(() => ({}));
        await assetService.markAssetReady(`ast_hk_${jobId.slice(0, 8)}_02`, {
          localPath: hook2Local,
          specs
        });
      });
    }

    const hook3Local = path.join(jobDir, 'hook_3.mp4');
    if (!fs.existsSync(hook3Local) || fs.statSync(hook3Local).size === 0) {
      console.log(`[REMAINDER_SERVICE] Aguardando renderização do Gancho 3 (${hook3VideoId})...`);
      const hook3Url = await pollHeyGenClip(hook3VideoId);
      metadata.remainder.hook3.heygen_video_url = hook3Url;
      metadata.remainder.hook3.completed_at = new Date().toISOString();

      console.log(`[REMAINDER_SERVICE] Baixando Gancho 3 para ${hook3Local}...`);
      await downloadToFile(hook3Url, hook3Local);
      metadata.remainder.hook3.local_path = hook3Local;

      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: Gancho 3 local já existente e com tamanho válido.`);
      metadata.remainder.hook3.local_path = hook3Local;
    }

    // Fase 3A: Marcar Hook 3 como ready no catálogo (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_hook3_ready', async () => {
        const specs = await validateMediaStreamsAndDuration(hook3Local).catch(() => ({}));
        await assetService.markAssetReady(`ast_hk_${jobId.slice(0, 8)}_03`, {
          localPath: hook3Local,
          specs
        });
      });
    }

    // 6. CONCATENAÇÃO FFMPEG GRANULAR (VÍDEO 2)
    const video2Local = path.join(jobDir, 'video_2.mp4');
    const isVideo2Valid = await isMediaFileFullyValid(video2Local);

    if (!isVideo2Valid) {
      console.log(`[REMAINDER_SERVICE] Concatenando Vídeo 2 com FFmpeg para ${video2Local}...`);
      await concatenateVideos(hook2Local, validBodyPath, video2Local, jobDir);
      await validateMediaStreamsAndDuration(video2Local);

      const v2Stats = fs.statSync(video2Local);
      const v2AuthUrl = `/api/v2/panel/video-jobs/${jobId}/video/2`;

      metadata.remainder.video2 = {
        local_path: video2Local,
        size_bytes: v2Stats.size,
        authenticated_url: v2AuthUrl,
        concatenated_at: new Date().toISOString()
      };

      await pool.query(
        'UPDATE video_jobs SET video2_url = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
        [v2AuthUrl, metadata, jobId]
      );
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: Vídeo 2 já existente e validado no disco.`);
    }

    // Fase 3A: Catalogar Vídeo 2 como rendered_creative (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_video2_ready', async () => {
        const v2GenKey = assetService.computeGenerationKey({
          asset_type: 'rendered_creative',
          params: { variant_index: 2, name: 'video_2' }
        });
        const v2AssetId = `ast_out_vid2_${jobId.slice(0, 8)}`;
        await assetService.createAsset({
          id: v2AssetId,
          job_id: jobId,
          property_ref: job.property_ref,
          asset_type: 'rendered_creative',
          generation_key: v2GenKey,
          status: 'processing'
        });
        const specs = await validateMediaStreamsAndDuration(video2Local).catch(() => ({}));
        await assetService.markAssetReady(v2AssetId, {
          localPath: video2Local,
          specs,
          metadata: { filename: 'video_2.mp4', authenticated_url: v2AuthUrl }
        });
      });
    }

    // 7. CONCATENAÇÃO FFMPEG GRANULAR (VÍDEO 3)
    const video3Local = path.join(jobDir, 'video_3.mp4');
    const isVideo3Valid = await isMediaFileFullyValid(video3Local);

    if (!isVideo3Valid) {
      console.log(`[REMAINDER_SERVICE] Concatenando Vídeo 3 com FFmpeg para ${video3Local}...`);
      await concatenateVideos(hook3Local, validBodyPath, video3Local, jobDir);
      await validateMediaStreamsAndDuration(video3Local);

      const v3Stats = fs.statSync(video3Local);
      const v3AuthUrl = `/api/v2/panel/video-jobs/${jobId}/video/3`;

      metadata.remainder.video3 = {
        local_path: video3Local,
        size_bytes: v3Stats.size,
        authenticated_url: v3AuthUrl,
        concatenated_at: new Date().toISOString()
      };

      await pool.query(
        'UPDATE video_jobs SET video3_url = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
        [v3AuthUrl, metadata, jobId]
      );
    } else {
      console.log(`[REMAINDER_SERVICE] Smart Retry: Vídeo 3 já existente e validado no disco.`);
    }

    // Fase 3A: Catalogar Vídeo 3 como rendered_creative (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_video3_ready', async () => {
        const v3GenKey = assetService.computeGenerationKey({
          asset_type: 'rendered_creative',
          params: { variant_index: 3, name: 'video_3' }
        });
        const v3AssetId = `ast_out_vid3_${jobId.slice(0, 8)}`;
        await assetService.createAsset({
          id: v3AssetId,
          job_id: jobId,
          property_ref: job.property_ref,
          asset_type: 'rendered_creative',
          generation_key: v3GenKey,
          status: 'processing'
        });
        const specs = await validateMediaStreamsAndDuration(video3Local).catch(() => ({}));
        await assetService.markAssetReady(v3AssetId, {
          localPath: video3Local,
          specs,
          metadata: { filename: 'video_3.mp4', authenticated_url: v3AuthUrl }
        });
      });
    }

    // 8. FINALIZAÇÃO TOTAL: CREATIVE_SET_READY
    const v2Url = `/api/v2/panel/video-jobs/${jobId}/video/2`;
    const v3Url = `/api/v2/panel/video-jobs/${jobId}/video/3`;
    metadata.remainder.completed_at = new Date().toISOString();

    await pool.query(
      `UPDATE video_jobs 
       SET status = 'CREATIVE_SET_READY', 
           video2_url = $1, 
           video3_url = $2, 
           error_message = NULL, 
           metadata = $3, 
           updated_at = NOW() 
       WHERE id = $4`,
      [v2Url, v3Url, metadata, jobId]
    );

    // Fase 3A: Atualizar os 3 Blueprints com todos os assets finais (fail-open)
    if (assetService) {
      await assetService.safeCatalogOperation('catalog_final_collection_blueprints', async () => {
        const blueprints = assetService.buildCreativeBlueprints(job, {
          hook1_asset_id: `ast_hk_${jobId.slice(0, 8)}_01`,
          hook2_asset_id: `ast_hk_${jobId.slice(0, 8)}_02`,
          hook3_asset_id: `ast_hk_${jobId.slice(0, 8)}_03`,
          body_asset_id: `ast_bd_${jobId.slice(0, 8)}_01`,
          pilot_asset_id: `ast_out_pilot_${jobId.slice(0, 8)}`,
          video2_asset_id: `ast_out_vid2_${jobId.slice(0, 8)}`,
          video3_asset_id: `ast_out_vid3_${jobId.slice(0, 8)}`
        });
        await assetService.saveBlueprintsToJob(jobId, blueprints);
      });
    }

    console.log(`[REMAINDER_SERVICE] Coleção criativa concluída com sucesso para Job ${jobId}`);
    return {
      success: true,
      jobId,
      status: 'CREATIVE_SET_READY',
      video2Url: v2Url,
      video3Url: v3Url
    };
  } catch (err) {
    console.error(`[REMAINDER_SERVICE ERROR] Falha no restante para Job ${jobId}:`, err.message);

    try {
      const pool = getPool();
      await pool.query(
        `UPDATE video_jobs 
         SET status = 'REMAINDER_FAILED', 
             error_message = $1, 
             updated_at = NOW() 
         WHERE id = $2`,
        [err.message, jobId]
      );
    } catch (dbErr) {
      console.error(`[REMAINDER_SERVICE FATAL] Erro ao gravar erro no banco para ${jobId}:`, dbErr.message);
    }

    return {
      success: false,
      jobId,
      status: 'REMAINDER_FAILED',
      error: err.message
    };
  }
}

/* =========================================================================
 * 4. ROTINA DE INICIALIZAÇÃO DO SERVIDOR (SMART RESUME NO BOOT)
 * ========================================================================= */

/**
 * Varre Jobs pendentes tanto da Fase 2B quanto da Fase 2C e retoma com segurança
 */
async function initStartupRecovery() {
  const pool = getPool();
  try {
    const query = `
      SELECT id, status, metadata, updated_at
      FROM video_jobs
      WHERE status IN ('PILOT_SUBMITTED', 'PILOT_RENDERING', 'REMAINDER_SUBMITTED', 'REMAINDER_RENDERING')
      ORDER BY created_at ASC;
    `;
    const res = await pool.query(query);

    if (res.rows.length === 0) {
      console.log('[RECOVERY] Nenhum Job pendente de recuperação no boot.');
      return;
    }

    console.log(`[RECOVERY] Encontrados ${res.rows.length} Job(s) em andamento para recuperação...`);

    for (const row of res.rows) {
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos

      if (ageMs > MAX_AGE_MS) {
        const failedStatus = row.status.startsWith('PILOT') ? 'PILOT_FAILED' : 'REMAINDER_FAILED';
        console.log(`[RECOVERY] Job ${row.id} (${row.status}) estagnado há mais de 30 minutos. Marcando ${failedStatus}.`);
        await pool.query(
          `UPDATE video_jobs 
           SET status = $1, 
               error_message = 'Processamento interrompido por reinício do servidor excedeu o tempo limite (30m). Por favor, tente novamente.', 
               updated_at = NOW() 
           WHERE id = $2`,
          [failedStatus, row.id]
        );
      } else {
        if (row.status === 'PILOT_SUBMITTED' || row.status === 'PILOT_RENDERING') {
          console.log(`[RECOVERY] Retomando com segurança Piloto do Job ${row.id}...`);
          generatePilot(row.id).catch(err => {
            console.error(`[RECOVERY ERROR] Falha ao retomar Piloto do Job ${row.id}:`, err.message);
          });
        } else if (row.status === 'REMAINDER_SUBMITTED' || row.status === 'REMAINDER_RENDERING') {
          console.log(`[RECOVERY] Retomando com segurança Restantes do Job ${row.id}...`);
          generateRemainderVideos(row.id).catch(err => {
            console.error(`[RECOVERY ERROR] Falha ao retomar Restantes do Job ${row.id}:`, err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[RECOVERY ERROR] Erro na varredura de recuperação no boot:', err.message);
  }
}

module.exports = {
  // Funções de validação e mídia
  validateMediaStreamsAndDuration,
  isMediaFileFullyValid,
  validateStrongBody,
  submitHeyGenClip,
  getHeyGenVideoStatus,
  pollHeyGenClip,
  downloadToFile,
  concatenateVideos,

  // Fase 2B
  lockAndSubmitPilot,
  generatePilot,

  // Fase 2C
  lockAndSubmitRemainder,
  rejectPilot,
  generateRemainderVideos,

  // Recovery
  initStartupRecovery
};