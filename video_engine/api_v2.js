/**
 * Roteador Express da Video Engine V2 — Bali Imóveis
 * Adaptador HTTP para o Job Core (job_service.js)
 * Independente do WhatsApp
 */

const express = require('express');
const router = express.Router();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jobService = require('./job_service');
const { panelAuthMiddleware } = require('./panel_auth');

/**
 * Middleware de Autenticação Estrita via Bearer Token
 * Utilizado exclusivamente pela API pública externa (POST /api/v2/video-jobs)
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

/**
 * POST /api/v2/video-jobs
 * Rota pública externa para criação de Video Job via HTTP Bearer Token
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
 * POST /api/v2/panel/video-jobs
 * Endpoint BFF para criação de Jobs pelo Painel Web (video-painel.html)
 * Protegido com HTTP Basic Auth server-side (panelAuthMiddleware)
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

module.exports = router;