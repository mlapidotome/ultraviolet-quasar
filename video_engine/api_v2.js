/**
 * Roteador Express da Video Engine V2 — Bali Imóveis
 * Adaptador HTTP para o Job Core (job_service.js) e Pilot Service (pilot_service.js)
 * Independente do WhatsApp
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jobService = require('./job_service');
const pilotService = require('./pilot_service');
const { panelAuthMiddleware } = require('./panel_auth');
const { getPool } = require('./db');

const UUID_REGEX = /^[0-9a-fA-F-]{36}$/;

/**
 * Middleware de Autenticação Estrita via Bearer Token
 * Utilizado exclusivamente pela API pública externa
 */
function requireBearerAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Header Authorization: Bearer <TOKEN> obrigatório'
    });
  }

  const token = authHeader.slice(7).trim();
  const configuredKey = process.env.VIDEO_ENGINE_API_KEY;

  if (!configuredKey) {
    console.error('[API_V2 ERROR] VIDEO_ENGINE_API_KEY não configurada no .env');
    return res.status(500).json({
      success: false,
      error: 'SERVER_MISCONFIGURED',
      message: 'Configuração de segurança pendente no servidor'
    });
  }

  if (token !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Token de autorização inválido'
    });
  }

  next();
}

/* =========================================================================
 * 1. ROTAS DO PAINEL WEB (BFF — Protegidas por HTTP Basic Auth)
 * ========================================================================= */

/**
 * POST /api/v2/panel/video-jobs
 * Criação de Jobs pelo Painel Web
 */
router.post('/panel/video-jobs', panelAuthMiddleware, async (req, res) => {
  const { property_ref } = req.body || {};

  if (!property_ref || String(property_ref).trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_PARAMS',
      message: 'property_ref é obrigatório'
    });
  }

  try {
    const result = await jobService.initializeVideoJob({
      property_ref: String(property_ref).trim(),
      broker_id: 'marcel',
      source: 'web_panel',
      metadata: {
        client_ip: req.ip,
        user_agent: req.headers['user-agent']
      }
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'PROPERTY_NOT_FOUND',
        message: 'Imóvel não encontrado na carteira para a referência informada'
      });
    }

    if (!result.job) {
      return res.status(503).json({
        success: false,
        error: 'PERSISTENCE_UNAVAILABLE',
        message: 'Os dados e roteiros foram processados, mas o Job não pôde ser persistido no banco de dados',
        job_id: null,
        property: result.imovel,
        scripts: result.scripts
      });
    }

    return res.status(201).json({
      success: true,
      job_id: result.job.id,
      status: result.job.status,
      source: result.job.source,
      property: result.imovel,
      scripts: result.scripts
    });
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Erro inesperado:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao processar criação de job pelo painel'
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id
 * Consulta de estado do Job (Estritamente Read-Only, sem efeitos colaterais)
 */
router.get('/panel/video-jobs/:id', panelAuthMiddleware, async (req, res) => {
  const { id } = req.params;

  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM video_jobs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'JOB_NOT_FOUND',
        message: 'Job não encontrado'
      });
    }

    const job = result.rows[0];
    return res.json({
      success: true,
      job_id: job.id,
      status: job.status,
      property_ref: job.property_ref,
      broker_id: job.broker_id,
      source: job.source,
      property: job.property_snapshot,
      scripts: job.scripts_snapshot,
      pilot_video_url: job.pilot_video_url,
      error_message: job.error_message,
      metadata: job.metadata,
      created_at: job.created_at,
      updated_at: job.updated_at
    });
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Erro ao consultar Job:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao consultar Job'
    });
  }
});

/**
 * POST /api/v2/panel/video-jobs/:id/generate-pilot
 * Início da geração do Piloto com Proteção Atômica contra Concorrência
 */
router.post('/panel/video-jobs/:id/generate-pilot', panelAuthMiddleware, async (req, res) => {
  const { id } = req.params;

  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const lockResult = await pilotService.lockAndSubmitPilot(id);

    if (!lockResult.success) {
      if (lockResult.code === 'JOB_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: lockResult.code,
          message: lockResult.error
        });
      }

      if (lockResult.code === 'PILOT_ALREADY_IN_PROGRESS') {
        return res.status(409).json({
          success: false,
          error: lockResult.code,
          message: lockResult.error,
          job_id: id,
          status: lockResult.job?.status
        });
      }

      return res.status(400).json({
        success: false,
        error: lockResult.code,
        message: lockResult.error
      });
    }

    if (lockResult.code === 'PILOT_ALREADY_READY') {
      return res.status(200).json({
        success: true,
        message: 'O piloto deste Job já foi gerado e está pronto.',
        job_id: id,
        status: 'PILOT_READY',
        pilot_video_url: lockResult.job?.pilot_video_url
      });
    }

    // Lock Atômico adquirido com sucesso (status agora PILOT_SUBMITTED)
    // Disparar a orquestração do piloto assincronamente em background
    pilotService.generatePilot(id).catch(err => {
      console.error(`[API_V2 ASYNC ERROR] Erro ao gerar piloto para ${id}:`, err.message);
    });

    return res.status(202).json({
      success: true,
      status: 'PILOT_SUBMITTED',
      job_id: id,
      message: 'Solicitação de geração do piloto aceita e em processamento.'
    });
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Erro ao iniciar piloto:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao iniciar geração do piloto'
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id/pilot
 * Rota Autenticada para Streaming e Download do Vídeo Piloto
 * Protegida contra path traversal e sem exposição estática pública
 */
router.get('/panel/video-jobs/:id/pilot', panelAuthMiddleware, async (req, res) => {
  const { id } = req.params;

  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT id, status, pilot_video_url FROM video_jobs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'JOB_NOT_FOUND',
        message: 'Job não encontrado'
      });
    }

    const job = result.rows[0];

    if (job.status !== 'PILOT_READY') {
      return res.status(409).json({
        success: false,
        error: 'PILOT_NOT_READY',
        message: 'O vídeo piloto deste Job ainda não está pronto.'
      });
    }

    // Validação estrita de diretório e anti-path-traversal
    const expectedJobDir = path.resolve(path.join(__dirname, '..', 'outputs', 'jobs', id));
    const filePath = path.resolve(path.join(expectedJobDir, 'pilot.mp4'));

    if (!filePath.startsWith(expectedJobDir) || path.dirname(filePath) !== expectedJobDir) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Tentativa de acesso a caminho não autorizado.'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'Arquivo físico do vídeo piloto não encontrado no servidor.'
      });
    }

    return res.sendFile(filePath);
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Erro ao servir vídeo do piloto:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao servir vídeo do piloto'
    });
  }
});

/* =========================================================================
 * 2. ROTAS DA API PÚBLICA EXTERNA (Protegidas por Bearer Token)
 * ========================================================================= */

/**
 * POST /api/v2/video-jobs
 * Criação de Video Job via HTTP Bearer Token
 */
router.post('/video-jobs', requireBearerAuth, async (req, res) => {
  const { property_ref } = req.body || {};

  if (!property_ref || String(property_ref).trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_PARAMS',
      message: 'property_ref é obrigatório'
    });
  }

  try {
    const result = await jobService.initializeVideoJob({
      property_ref: String(property_ref).trim(),
      broker_id: 'marcel',
      source: 'web',
      metadata: {
        client_ip: req.ip,
        user_agent: req.headers['user-agent']
      }
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'PROPERTY_NOT_FOUND',
        message: 'Imóvel não encontrado na carteira para a referência informada'
      });
    }

    if (!result.job) {
      return res.status(503).json({
        success: false,
        error: 'PERSISTENCE_UNAVAILABLE',
        message: 'Os dados e roteiros foram processados, mas o Job não pôde ser persistido no banco de dados',
        job_id: null,
        property: result.imovel,
        scripts: result.scripts
      });
    }

    return res.status(201).json({
      success: true,
      job_id: result.job.id,
      status: result.job.status,
      source: result.job.source,
      property: result.imovel,
      scripts: result.scripts
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro inesperado na criação de job:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao processar criação de job'
    });
  }
});

/**
 * GET /api/v2/video-jobs/:id
 * Consulta de Video Job via Bearer Token
 */
router.get('/video-jobs/:id', requireBearerAuth, async (req, res) => {
  const { id } = req.params;

  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM video_jobs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'JOB_NOT_FOUND',
        message: 'Job não encontrado'
      });
    }

    const job = result.rows[0];
    return res.json({
      success: true,
      job_id: job.id,
      status: job.status,
      property_ref: job.property_ref,
      broker_id: job.broker_id,
      source: job.source,
      property: job.property_snapshot,
      scripts: job.scripts_snapshot,
      pilot_video_url: job.pilot_video_url,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao consultar Job via Bearer:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro interno ao consultar Job'
    });
  }
});

module.exports = router;