/**
 * Roteador Express da Video Engine V2 — Bali Imóveis
 * Adaptador HTTP para o Job Core (job_service.js), Pilot Service (pilot_service.js) e Composer Engine (composer_service.js)
 * Independente do WhatsApp
 * Suporte completo às Fases 2A, 2B, 2C, 3A, 3B e 3C.1
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
const composerService = require('./composer_service');
const { PRESETS } = require('./styles/presets');

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
 * Consulta de estado do Job
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
      video2_url: job.video2_url,
      video3_url: job.video3_url,
      error_message: job.error_message,
      metadata: job.metadata,
      created_at: job.created_at,
      updated_at: job.updated_at,
      creative_blueprints: job.creative_blueprints || []
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
 * GET /api/v2/panel/video-jobs/:id/blueprints
 * Consulta dos Creative Blueprints declarativos do Job
 */
router.get('/panel/video-jobs/:id/blueprints', panelAuthMiddleware, async (req, res) => {
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
    const result = await pool.query('SELECT id, creative_blueprints FROM video_jobs WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'JOB_NOT_FOUND',
        message: 'Job não encontrado'
      });
    }

    return res.json({
      success: true,
      job_id: id,
      creative_blueprints: result.rows[0].creative_blueprints || []
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao consultar blueprints:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro ao consultar blueprints'
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id/assets
 * Catálogo de assets registrados para o Job
 */
router.get('/panel/video-jobs/:id/assets', panelAuthMiddleware, async (req, res) => {
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
    const result = await pool.query(
      'SELECT id, job_id, property_ref, asset_type, storage_type, storage_path, provider_ref, file_hash, generation_key, status, specs, metadata, created_at, updated_at FROM video_assets WHERE job_id = $1 ORDER BY created_at ASC',
      [id]
    );

    return res.json({
      success: true,
      job_id: id,
      total_assets: result.rows.length,
      assets: result.rows
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao consultar assets do Job:', err.message);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Erro ao consultar assets'
    });
  }
});

/**
 * GET /api/v2/panel/editing-styles
 * Lista de Editing Styles oficiais disponíveis (Fase 3C.1)
 */
router.get('/panel/editing-styles', panelAuthMiddleware, async (req, res) => {
  try {
    const stylesList = Object.values(PRESETS).map(s => ({
      id: s.id,
      version: s.version,
      name: s.name,
      description: s.description,
      typography: s.typography,
      colors: s.colors
    }));
    return res.json({
      success: true,
      styles: stylesList
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/v2/panel/video-jobs/:id/generate-pilot
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
    const result = await pilotService.processPilotVideo(id);
    return res.status(result.status === 'FAILED' ? 500 : 200).json(result);
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Falha inesperada no piloto:', err.message);
    return res.status(500).json({
      success: false,
      error: 'PILOT_PIPELINE_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/v2/panel/video-jobs/:id/approve-pilot
 */
router.post('/panel/video-jobs/:id/approve-pilot', panelAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const result = await pilotService.approvePilot(id, 'marcel');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Falha ao aprovar piloto:', err.message);
    const status = err.message.includes('não pode ser aprovado') ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: 'APPROVAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/v2/panel/video-jobs/:id/reject-pilot
 */
router.post('/panel/video-jobs/:id/reject-pilot', panelAuthMiddleware, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};

  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JOB_ID',
      message: 'ID de Job inválido'
    });
  }

  try {
    const result = await pilotService.rejectPilot(id, 'marcel', reason);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[API_V2 PANEL ERROR] Falha ao rejeitar piloto:', err.message);
    const status = err.message.includes('não pode ser rejeitado') ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: 'REJECTION_ERROR',
      message: err.message
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id/video/:index
 * Streaming autenticado dos 3 vídeos oficiais da Fase 2C
 */
router.get('/panel/video-jobs/:id/video/:index', panelAuthMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const numIndex = parseInt(index, 10);
  if (![1, 2, 3].includes(numIndex)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INDEX',
      message: 'Índice de vídeo deve ser 1, 2 ou 3'
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
    const filename = numIndex === 1 ? 'pilot.mp4' : `video_${numIndex}.mp4`;
    const filePath = path.resolve(__dirname, '..', 'outputs', 'jobs', id, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: `Arquivo de vídeo ${numIndex} não encontrado no disco`
      });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao servir vídeo:', err.message);
    return res.status(500).json({
      success: false,
      error: 'STREAMING_ERROR',
      message: 'Erro ao servir streaming do vídeo'
    });
  }
});

/* =========================================================================
 * 2. ROTAS DO SHADOW COMPOSER (Fase 3B e Fase 3C.1)
 * ========================================================================= */

/**
 * POST /api/v2/panel/video-jobs/:id/compose-shadow/:index
 * Disparo do Shadow Composer 3B (Blueprint 1.0 sequencial)
 */
router.post('/panel/video-jobs/:id/compose-shadow/:index', panelAuthMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const numIndex = parseInt(index, 10);
  if (![1, 2, 3].includes(numIndex)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INDEX',
      message: 'Índice deve ser 1, 2 ou 3'
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
    const blueprints = job.creative_blueprints || [];
    const blueprint = blueprints.find(bp => bp.creative_id === `crv_${id.slice(0, 8)}_var${numIndex}`) || blueprints[numIndex - 1];

    if (!blueprint) {
      return res.status(404).json({
        success: false,
        error: 'BLUEPRINT_NOT_FOUND',
        message: `Blueprint da variante ${numIndex} não encontrado`
      });
    }

    const composeResult = await composerService.composeCreative({
      jobId: id,
      blueprint: {
        ...blueprint,
        schema_version: '1.0' // Forçar caminho 3B
      },
      isShadow: true
    });

    return res.status(200).json({
      success: true,
      result: composeResult
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro no compose-shadow:', err.message);
    const statusCode = err.statusCode || (err.message.includes('VALIDATION') ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      error: 'COMPOSER_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /api/v2/panel/video-jobs/:id/compose-shadow-3c/:index
 * Disparo do Shadow Composer 3C.1 (Blueprint 1.1 com Editing Style e Overlays)
 */
router.post('/panel/video-jobs/:id/compose-shadow-3c/:index', panelAuthMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const numIndex = parseInt(index, 10);
  const { style_id = 'performance_reels_v1', style_version = 1 } = req.body || req.query || {};

  if (![1, 2, 3].includes(numIndex)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INDEX',
      message: 'Índice deve ser 1, 2 ou 3'
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
    const blueprints = job.creative_blueprints || [];
    const baseBp = blueprints.find(bp => bp.creative_id === `crv_${id.slice(0, 8)}_var${numIndex}`) || blueprints[numIndex - 1];

    if (!baseBp) {
      return res.status(404).json({
        success: false,
        error: 'BLUEPRINT_NOT_FOUND',
        message: `Blueprint base da variante ${numIndex} não encontrado`
      });
    }

    // Montar Blueprint 1.1 com Overlays declarativos derivados dos dados do imóvel e roteiro
    const prop = job.property_snapshot || {};
    const scripts = job.scripts_snapshot || {};
    const hookKey = `gancho_${numIndex}`;
    const hookTitle = (scripts[hookKey]?.title || prop.bairro || 'IMÓVEL EXCLUSIVO').toUpperCase();
    const priceText = prop.valor ? `R$ ${prop.valor}` : 'VALOR SOB CONSULTA';
    const locationText = prop.cidade ? `${prop.bairro || 'Centro'}, ${prop.cidade}` : 'BALNEÁRIO PIÇARRAS';

    const blueprint11 = {
      ...baseBp,
      schema_version: '1.1',
      creative_id: `crv_${id.slice(0, 8)}_var${numIndex}`,
      blueprint_version: 1,
      editing_style: {
        style_id: String(style_id),
        version: parseInt(style_version, 10)
      },
      overlays: [
        {
          id: 'ov_headline',
          layer_order: 10,
          type: 'headline',
          text: hookTitle.slice(0, 55),
          start_ms: 200,
          end_ms: 2800,
          position: 'top_safe',
          preset: 'bold_headline'
        },
        {
          id: 'ov_price',
          layer_order: 20,
          type: 'price_badge',
          text: priceText.slice(0, 24),
          start_ms: 3200,
          end_ms: 5500,
          position: 'lower_third',
          preset: 'price_punch'
        },
        {
          id: 'ov_location',
          layer_order: 25,
          type: 'location_tag',
          text: locationText.slice(0, 38),
          start_ms: 3200,
          end_ms: 5500,
          position: 'top_safe',
          preset: 'location_badge'
        },
        {
          id: 'ov_cta',
          layer_order: 30,
          type: 'cta_banner',
          text: 'SAIBA MAIS - BALI IMÓVEIS',
          start_ms: 5800,
          end_ms: 7800,
          position: 'bottom_safe',
          preset: 'cta_bar'
        }
      ],
      captions: [
        { start_ms: 0, end_ms: 2900, text: (scripts[hookKey]?.text || 'Confira esta oportunidade exclusiva.').slice(0, 70) },
        { start_ms: 3000, end_ms: 7800, text: (scripts.corpo?.text || 'Entre em contato com nossos consultores.').slice(0, 70) }
      ]
    };

    const composeResult = await composerService.composeCreative({
      jobId: id,
      blueprint: blueprint11,
      isShadow: true
    });

    return res.status(200).json({
      success: true,
      result: composeResult
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro no compose-shadow-3c:', err.message);
    const statusCode = err.statusCode || (err.message.includes('VALIDATION') ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      error: 'COMPOSER_3C_ERROR',
      message: err.message
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id/shadow-3c-video/:index
 * Streaming autenticado do vídeo gerado pelo Shadow Composer 3C (Fase 3C.1)
 */
router.get('/panel/video-jobs/:id/shadow-3c-video/:index', panelAuthMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const numIndex = parseInt(index, 10);
  if (![1, 2, 3].includes(numIndex)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INDEX',
      message: 'Índice deve ser 1, 2 ou 3'
    });
  }

  try {
    const pool = getPool();
    const shadowRes = await pool.query(
      `SELECT * FROM video_assets 
       WHERE job_id = $1 AND asset_type = 'shadow_creative_3c' AND status = 'ready'
       AND metadata->>'creative_id' LIKE $2
       ORDER BY updated_at DESC LIMIT 1`,
      [id, `%var${numIndex}%`]
    );

    if (shadowRes.rows.length === 0 || !shadowRes.rows[0].storage_path) {
      return res.status(404).json({
        success: false,
        error: 'SHADOW_3C_NOT_FOUND',
        message: 'Vídeo Shadow 3C não encontrado ou não está pronto'
      });
    }

    const filePath = shadowRes.rows[0].storage_path;
    const expectedJobDir = path.resolve(__dirname, '..', 'outputs', 'jobs', id);
    if (!filePath.startsWith(expectedJobDir)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Acesso não autorizado'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'Arquivo físico do Shadow 3C não encontrado'
      });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao servir shadow 3c video:', err.message);
    return res.status(500).json({
      success: false,
      error: 'STREAMING_ERROR',
      message: 'Erro ao servir vídeo shadow 3c'
    });
  }
});

/**
 * GET /api/v2/panel/video-jobs/:id/compare-shadow-3c/:index
 * Comparação Técnica entre vídeo legado e vídeo do Shadow Composer 3C (Fase 3C.1)
 */
router.get('/panel/video-jobs/:id/compare-shadow-3c/:index', panelAuthMiddleware, async (req, res) => {
  const { id, index } = req.params;
  const numIndex = parseInt(index, 10);
  if (![1, 2, 3].includes(numIndex)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INDEX',
      message: 'Índice deve ser 1, 2 ou 3'
    });
  }

  try {
    const legacyFilename = numIndex === 1 ? 'pilot.mp4' : `video_${numIndex}.mp4`;
    const legacyPath = path.resolve(__dirname, '..', 'outputs', 'jobs', id, legacyFilename);

    const pool = getPool();
    const shadowRes = await pool.query(
      `SELECT * FROM video_assets 
       WHERE job_id = $1 AND asset_type = 'shadow_creative_3c' AND status = 'ready'
       AND metadata->>'creative_id' LIKE $2
       ORDER BY updated_at DESC LIMIT 1`,
      [id, `%var${numIndex}%`]
    );

    if (shadowRes.rows.length === 0 || !shadowRes.rows[0].storage_path) {
      return res.status(404).json({
        success: false,
        error: 'SHADOW_3C_NOT_FOUND',
        message: 'Asset Shadow 3C não encontrado ou não está pronto'
      });
    }

    const shadowPath = shadowRes.rows[0].storage_path;
    const comparison = await composerService.compareShadow3cWithLegacy(legacyPath, shadowPath);

    return res.json({
      success: true,
      comparison,
      shadow_asset: shadowRes.rows[0]
    });
  } catch (err) {
    console.error('[API_V2 ERROR] Erro ao comparar shadow 3c:', err.message);
    return res.status(500).json({
      success: false,
      error: 'COMPARE_ERROR',
      message: err.message
    });
  }
});

module.exports = router;
