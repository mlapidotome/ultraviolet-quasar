/**
 * Módulo Orquestrador de Vídeo Piloto — Video Engine V2
 * Totalmente desacoplado de interfaces e do WhatsApp
 * Todas as operações vinculadas unicamente a job_id no PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const { getPool } = require('./db');

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const MARCEL_VOICE_CLONE_ID = process.env.MARCEL_VOICE_CLONE_ID || 'dccd1a85e6b1450facf9ec953b648df2';
const OUTPUTS_BASE_DIR = path.join(__dirname, '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

// Garantir diretório base de jobs
if (!fs.existsSync(JOBS_OUTPUTS_DIR)) {
  fs.mkdirSync(JOBS_OUTPUTS_DIR, { recursive: true });
}

/**
 * 1. Transição Atômica de Concorrência no PostgreSQL
 * Garante que somente UMA requisição adquire o direito de renderizar o piloto
 */
async function lockAndSubmitPilot(jobId) {
  const pool = getPool();

  // Bloqueio atômico em nível de instrução SQL
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

  // Se nenhuma linha foi atualizada, verificar o estado atual
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
 * 2. Submissão de Clip para a HeyGen
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
 * 3. Polling de Status na HeyGen por video_id
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
 * 4. Download Stream para Arquivo em Disco
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
 * 5. Concatenação de Vídeos via FFmpeg com Validação
 */
async function concatenateVideos(hookFilePath, bodyFilePath, outputFilePath, jobDir) {
  const listFilePath = path.join(jobDir, `concat_list_${Date.now()}.txt`);
  const cleanHookPath = hookFilePath.replace(/\\/g, '/');
  const cleanBodyPath = bodyFilePath.replace(/\\/g, '/');

  fs.writeFileSync(listFilePath, `file '${cleanHookPath}'\nfile '${cleanBodyPath}'\n`, 'utf-8');

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputFilePath}"`;
    execSync(cmd, { stdio: 'pipe' });
  } catch (e) {
    // Fallback com re-encode se codecs ou taxas de amostragem divergirem
    const cmdReencode = `ffmpeg -y -i "${hookFilePath}" -i "${bodyFilePath}" -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" "${outputFilePath}"`;
    execSync(cmdReencode, { stdio: 'pipe' });
  } finally {
    if (fs.existsSync(listFilePath)) {
      try { fs.unlinkSync(listFilePath); } catch (e) {}
    }
  }

  // Validação estrita do arquivo de saída
  if (!fs.existsSync(outputFilePath) || fs.statSync(outputFilePath).size === 0) {
    throw new Error('Falha na geração do arquivo concatenado via FFmpeg (arquivo vazio ou inexistente)');
  }

  return outputFilePath;
}

/**
 * 6. Orquestrador Principal do Piloto (vinculado a job_id)
 * Suporta execução inicial e Smart Resume parcial seguro
 */
async function generatePilot(jobId) {
  const pool = getPool();

  try {
    // Buscar dados do Job no PostgreSQL
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

    // Criar diretório exclusivo do Job
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

    // Atualizar status para PILOT_RENDERING no início da orquestração
    await pool.query(
      'UPDATE video_jobs SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
      ['PILOT_RENDERING', metadata, jobId]
    );

    // ETAPA 1: Gancho 1 (Hook 1)
    let hook1VideoId = metadata.pilot.hook1?.heygen_video_id;
    if (!hook1VideoId) {
      console.log(`[PILOT_SERVICE] Submetendo Gancho 1 na HeyGen para Job ${jobId}...`);
      hook1VideoId = await submitHeyGenClip({
        lookId: hook1.look.id,
        text: hook1.text,
        bgImageUrl: null,
        avatarStyle: 'normal'
      });

      // Gravar imediatamente o ID do Gancho 1 no banco
      metadata.pilot.hook1 = {
        heygen_video_id: hook1VideoId,
        submitted_at: new Date().toISOString()
      };
      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );
      console.log(`[PILOT_SERVICE] Gancho 1 gravado: ${hook1VideoId} para Job ${jobId}`);
    } else {
      console.log(`[PILOT_SERVICE] Smart Resume: reutilizando Gancho 1 existente ${hook1VideoId} para Job ${jobId}`);
    }

    // ETAPA 2: Desenvolvimento / Corpo (Body)
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

      // Gravar imediatamente o ID do Corpo no banco
      metadata.pilot.body = {
        heygen_video_id: bodyVideoId,
        submitted_at: new Date().toISOString()
      };
      await pool.query(
        'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
        [metadata, jobId]
      );
      console.log(`[PILOT_SERVICE] Corpo gravado: ${bodyVideoId} para Job ${jobId}`);
    } else {
      console.log(`[PILOT_SERVICE] Smart Resume: reutilizando Corpo existente ${bodyVideoId} para Job ${jobId}`);
    }

    // ETAPA 3: Polling de Conclusão na HeyGen
    console.log(`[PILOT_SERVICE] Aguardando renderização do Gancho 1 (${hook1VideoId})...`);
    const hook1VideoUrl = await pollHeyGenClip(hook1VideoId);
    metadata.pilot.hook1.heygen_video_url = hook1VideoUrl; // URLs são transitórias/temporárias
    metadata.pilot.hook1.completed_at = new Date().toISOString();

    console.log(`[PILOT_SERVICE] Aguardando renderização do Corpo (${bodyVideoId})...`);
    const bodyVideoUrl = await pollHeyGenClip(bodyVideoId);
    metadata.pilot.body.heygen_video_url = bodyVideoUrl; // URLs são transitórias/temporárias
    metadata.pilot.body.completed_at = new Date().toISOString();

    await pool.query(
      'UPDATE video_jobs SET metadata = $1, updated_at = NOW() WHERE id = $2',
      [metadata, jobId]
    );

    // ETAPA 4: Download dos Clips para o Diretório Exclusivo do Job
    const hook1Path = path.join(jobDir, 'hook_1.mp4');
    const bodyPath = path.join(jobDir, 'body.mp4');
    const finalPilotPath = path.join(jobDir, 'pilot.mp4');

    console.log(`[PILOT_SERVICE] Baixando Gancho 1 para ${hook1Path}...`);
    await downloadToFile(hook1VideoUrl, hook1Path);
    metadata.pilot.hook1.local_path = hook1Path;

    console.log(`[PILOT_SERVICE] Baixando Corpo para ${bodyPath}...`);
    await downloadToFile(bodyVideoUrl, bodyPath);
    metadata.pilot.body.local_path = bodyPath;

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

    // ETAPA 6: Persistência de Sucesso Total no PostgreSQL
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

/**
 * 7. Rotina de Inicialização do Servidor (Smart Resume no Boot)
 * Varre Jobs pendentes e retoma com segurança usando IDs gravados
 */
async function initStartupRecovery() {
  const pool = getPool();
  try {
    const query = `
      SELECT id, status, metadata, updated_at
      FROM video_jobs
      WHERE status IN ('PILOT_SUBMITTED', 'PILOT_RENDERING')
      ORDER BY created_at ASC;
    `;
    const res = await pool.query(query);

    if (res.rows.length === 0) {
      console.log('[PILOT_RECOVERY] Nenhum Job pendente de recuperação no boot.');
      return;
    }

    console.log(`[PILOT_RECOVERY] Encontrados ${res.rows.length} Job(s) em andamento para recuperação...`);

    for (const row of res.rows) {
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos

      if (ageMs > MAX_AGE_MS) {
        console.log(`[PILOT_RECOVERY] Job ${row.id} estagnado há mais de 30 minutos. Marcando PILOT_FAILED.`);
        await pool.query(
          `UPDATE video_jobs 
           SET status = 'PILOT_FAILED', 
               error_message = 'Renderização interrompida por reinício do servidor excedeu o tempo limite (30m). Por favor, tente novamente.', 
               updated_at = NOW() 
           WHERE id = $1`,
          [row.id]
        );
      } else {
        console.log(`[PILOT_RECOVERY] Retomando com segurança Job ${row.id}...`);
        // Disparar em background para não travar o boot
        generatePilot(row.id).catch(err => {
          console.error(`[PILOT_RECOVERY ERROR] Falha ao retomar Job ${row.id}:`, err.message);
        });
      }
    }
  } catch (err) {
    console.error('[PILOT_RECOVERY ERROR] Erro na varredura de recuperação no boot:', err.message);
  }
}

module.exports = {
  lockAndSubmitPilot,
  submitHeyGenClip,
  pollHeyGenClip,
  downloadToFile,
  concatenateVideos,
  generatePilot,
  initStartupRecovery
};