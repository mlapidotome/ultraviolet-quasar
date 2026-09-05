/**
 * Middleware de Autenticação HTTP Basic Auth para o Painel Web (Video Engine V2)
 * Protege GET /video-painel e POST /api/v2/panel/*
 */

const crypto = require('crypto');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function panelAuthMiddleware(req, res, next) {
  const configuredUser = process.env.PANEL_USER;
  const configuredPass = process.env.PANEL_PASSWORD;

  // Regra 1: PANEL_USER e PANEL_PASSWORD são ambos estritamente obrigatórios
  if (!configuredUser || !configuredPass || configuredUser.trim() === '' || configuredPass.trim() === '') {
    console.error('[PANEL_AUTH ERROR] PANEL_USER ou PANEL_PASSWORD não configurados no servidor (.env)');
    const isHtml = req.accepts && req.accepts('html') && !req.path.startsWith('/api/');
    if (isHtml) {
      return res.status(500).send('Configuração de autenticação pendente no servidor.');
    }
    return res.status(500).json({
      success: false,
      error: 'SERVER_MISCONFIGURED',
      message: 'Configuração de autenticação pendente no servidor'
    });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
    const isHtml = req.accepts && req.accepts('html') && !req.path.startsWith('/api/');
    if (isHtml) {
      return res.status(401).send('Acesso não autorizado ao painel.');
    }
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED_PANEL_ACCESS',
      message: 'Autenticação requerida'
    });
  }

  // Regra 2: Parser Base64 separando somente no PRIMEIRO ':'
  const base64Payload = authHeader.slice(6).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(base64Payload, 'base64').toString('utf-8');
  } catch (e) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Falha na decodificação de credenciais'
    });
  }

  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Formato de credencial inválido'
    });
  }

  const user = decoded.substring(0, colonIndex);
  const pass = decoded.substring(colonIndex + 1);

  const userValid = safeCompare(user, configuredUser);
  const passValid = safeCompare(pass, configuredPass);

  if (!userValid || !passValid) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
    const isHtml = req.accepts && req.accepts('html') && !req.path.startsWith('/api/');
    if (isHtml) {
      return res.status(401).send('Credenciais inválidas.');
    }
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Credenciais inválidas'
    });
  }

  next();
}

module.exports = {
  panelAuthMiddleware
};