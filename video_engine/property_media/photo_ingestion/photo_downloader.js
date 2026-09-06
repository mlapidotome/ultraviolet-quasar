/**
 * Módulo de Download Seguro de Fotos — Video Engine V2
 * Bali Imóveis (Fase 4B.1)
 * 
 * Responsabilidades:
 * 1. Download dedicado de fotos do CRM para staging privado
 * 2. Whitelist de hostnames permitidos
 * 3. Prevenção rigorosa de SSRF (IPv4/IPv6 privados, loopback, link-local, cloud metadata)
 * 4. Mitigação de DNS Rebinding via lookup seguro no Agent
 * 5. Validação hop-by-hop de redirects
 * 6. Limite de tamanho de streaming (PHOTO_MAX_SIZE_MB) e timeout (PHOTO_DOWNLOAD_TIMEOUT_MS)
 * 7. Limpeza estrita apenas do próprio arquivo de staging em caso de erro
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const crypto = require('crypto');
const net = require('net');

const DEFAULT_ALLOWED_HOSTS = [
  'fotos.sobressai.com.br',
  'sobressai.com.br',
  'cdn.sobressai.com.br',
  'fotos2.fra1.cdn.digitaloceanspaces.com',
  'fotos2.fra1.digitaloceanspaces.com',
  'sobressai.sfo3.digitaloceanspaces.com',
  '*.digitaloceanspaces.com',
  'app.imobtotal.com.br',
  'img.imobtotal.com.br',
  'storage.googleapis.com',
  's3.amazonaws.com'
];

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PHOTO_DOWNLOAD_TIMEOUT_MS || '15000', 10);
const DEFAULT_MAX_SIZE_MB = parseInt(process.env.PHOTO_MAX_SIZE_MB || '25', 10);
const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Resolve candidatos de URLs com mirrors do CDN oficial do CRM
 * @param {string} rawUrl
 * @returns {Array<string>}
 */
function resolveCrmCandidateUrls(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return [];
  const clean = rawUrl.trim();
  const candidates = [];

  if (/fotos\.sobressai\.com\.br\/fotos\//i.test(clean)) {
    candidates.push(clean.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://fotos2.fra1.cdn.digitaloceanspaces.com/Fotos/'));
    candidates.push(clean.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://fotos2.fra1.digitaloceanspaces.com/Fotos/'));
    candidates.push(clean.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://sobressai.sfo3.digitaloceanspaces.com/fotos/'));
  }
  candidates.push(clean);
  return candidates;
}

/**
 * Verifica se um endereço IP (v4 ou v6) é privado, loopback, link-local ou reservado
 * @param {string} ipStr
 * @returns {boolean}
 */
function isIpBlocked(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return true;

  const cleanIp = ipStr.trim();

  // Tratamento de IPv4-mapped IPv6 (ex: ::ffff:127.0.0.1 ou ::ffff:10.0.0.1)
  if (cleanIp.startsWith('::ffff:')) {
    const ipv4Part = cleanIp.slice(7);
    if (net.isIPv4(ipv4Part)) {
      return isIpBlocked(ipv4Part);
    }
  }

  // IPv4
  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b, c, d] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;

    // 10.0.0.0/8 (Private RFC1918)
    if (a === 10) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && (b >= 64 && b <= 127)) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 169.254.0.0/16 (Link-local, Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 (Private RFC1918)
    if (a === 172 && (b >= 16 && b <= 31)) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;

    // 192.88.99.0/24 (6to4 Relay)
    if (a === 192 && b === 88 && c === 99) return true;

    // 192.168.0.0/16 (Private RFC1918)
    if (a === 192 && b === 168) return true;

    // 198.18.0.0/15 (Network Benchmark Tests)
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;

    // 240.0.0.0/4 (Reserved / Future Use)
    if (a >= 240) return true;

    // 255.255.255.255 (Broadcast)
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;

    return false;
  }

  // IPv6
  if (net.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    // Loopback & Unspecified
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // Unique Local (fc00::/7 -> fc.. e fd..)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    // Link-local (fe80::/10 -> fe8, fe9, fea, feb)
    if (/^fe[89ab]/i.test(lower)) {
      return true;
    }
    // Multicast (ff00::/8)
    if (lower.startsWith('ff')) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Validador de Hostname contra Allowlist
 * @param {string} hostname
 * @param {Array<string>} allowedHosts
 * @returns {boolean}
 */
function isHostAllowed(hostname, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.toLowerCase().trim();

  // Bloqueio explícito de localhost e variantes
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return false;
  }

  return allowedHosts.some(allowed => {
    const allowedLower = allowed.toLowerCase().trim();
    if (allowedLower.startsWith('*.')) {
      const suffix = allowedLower.slice(2);
      return lower === suffix || lower.endsWith('.' + suffix);
    }
    return lower === allowedLower;
  });
}

/**
 * Validação de URL inicial ou redirect
 * @param {string} rawUrl
 * @param {Array<string>} allowedHosts
 * @returns {URL}
 */
function validateUrl(rawUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error(`[PHOTO_DOWNLOADER] URL inválida: ${rawUrl}`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (e) {
    throw new Error(`[PHOTO_DOWNLOADER] URL malformada: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[PHOTO_DOWNLOADER] Protocolo não permitido: ${parsed.protocol} (apenas http e https são aceitos)`);
  }

  if (!isHostAllowed(parsed.hostname, allowedHosts)) {
    throw new Error(`[PHOTO_DOWNLOADER] Host não autorizado por whitelist: ${parsed.hostname}`);
  }

  return parsed;
}

/**
 * Criação de Agent com DNS Pinning seguro para mitigação de DNS Rebinding
 * @param {boolean} isHttps
 * @returns {http.Agent|https.Agent}
 */
function createSecureAgent(isHttps) {
  const agentOptions = {
    keepAlive: false,
    lookup: (hostname, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      const options = typeof opts === 'function' ? {} : opts;

      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses || addresses.length === 0) {
          return callback(new Error(`[PHOTO_DOWNLOADER] DNS não retornou endereços para ${hostname}`));
        }

        // Validar todos os IPs retornados contra SSRF
        for (const addr of addresses) {
          const ip = typeof addr === 'string' ? addr : addr.address;
          if (isIpBlocked(ip)) {
            return callback(new Error(`[PHOTO_DOWNLOADER SSRF_BLOCKED] IP restrito detectado para ${hostname}: ${ip}`));
          }
        }

        if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      });
    }
  };

  return isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
}

/**
 * Download de foto única do CRM para staging privado
 * 
 * @param {string} url URL da foto
 * @param {Object} options Configurações opcionais
 * @param {string} options.stagingDir Diretório temporário base
 * @param {string} options.token Identificador do claim/job/worker
 * @param {Array<string>} options.allowedHosts Whitelist de hosts
 * @param {number} options.timeoutMs Timeout em milissegundos
 * @param {number} options.maxSizeMb Tamanho máximo em megabytes
 * @param {number} options.maxRedirects Quantidade máxima de redirects
 * @returns {Promise<{ stagingPath: string, bytesDownloaded: number, contentType: string, sourceUrl: string, finalUrl: string }>}
 */
async function downloadPhotoToStaging(url, options = {}) {
  const stagingBaseDir = options.stagingDir || path.join(__dirname, '..', '..', '..', 'outputs', 'media_blobs', 'photos', '.tmp');
  const token = options.token || 'worker';
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const allowedHosts = options.allowedHosts ? options.allowedHosts : DEFAULT_ALLOWED_HOSTS;
  const maxSizeBytes = (options.maxSizeMb || DEFAULT_MAX_SIZE_MB) * 1024 * 1024;
  const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : DEFAULT_MAX_REDIRECTS;

  if (!fs.existsSync(stagingBaseDir)) {
    fs.mkdirSync(stagingBaseDir, { recursive: true });
  }

  // Nome único do arquivo de staging pertencente exclusivamente a esta execução
  const uniqueId = crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : crypto.randomBytes(6).toString('hex');
  const stagingFilename = `ingest_${token}_${uniqueId}.tmp`;
  const stagingPath = path.join(stagingBaseDir, stagingFilename);

  const candidateUrls = resolveCrmCandidateUrls(url);
  let lastError = null;

  for (const candidate of candidateUrls) {
    let currentUrl = candidate;
    let redirectCount = 0;

    try {
      while (redirectCount <= maxRedirects) {
        const parsedUrl = validateUrl(currentUrl, allowedHosts);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const agent = createSecureAgent(isHttps);

        const downloadPromise = new Promise((resolve, reject) => {
          const reqOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + (parsedUrl.search || ''),
            method: 'GET',
            agent: agent,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bali-VideoEngine/1.0',
              'Accept': 'image/jpeg,image/png,image/webp,image/*;q=0.8',
              'Referer': 'https://app.imobtotal.com.br/'
            },
            timeout: timeoutMs
          };

        const req = client.request(reqOptions, (res) => {
          // 1. Tratamento de Redirects (301, 302, 303, 307, 308)
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const redirectLocation = res.headers.location;
            res.resume(); // Consumir stream para liberar socket
            if (!redirectLocation) {
              return reject(new Error(`[PHOTO_DOWNLOADER] Redirecionamento ${res.statusCode} sem cabeçalho Location`));
            }
            try {
              const nextUrl = new URL(redirectLocation, currentUrl).toString();
              return resolve({ isRedirect: true, nextUrl });
            } catch (err) {
              return reject(new Error(`[PHOTO_DOWNLOADER] URL de redirecionamento inválida (${redirectLocation}): ${err.message}`));
            }
          }

          // 2. Validação de Status HTTP
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return reject(new Error(`[PHOTO_DOWNLOADER HTTP_ERROR] Servidor retornou HTTP ${res.statusCode} ${res.statusMessage || ''}`));
          }

          // 3. Validação de Content-Length prévia
          const contentLengthHeader = res.headers['content-length'];
          if (contentLengthHeader) {
            const parsedLength = parseInt(contentLengthHeader, 10);
            if (!isNaN(parsedLength) && parsedLength > maxSizeBytes) {
              res.resume();
              return reject(new Error(`[PHOTO_DOWNLOADER SIZE_EXCEEDED] Content-Length (${(parsedLength / 1024 / 1024).toFixed(2)}MB) excede o limite máximo permitido (${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB)`));
            }
          }

          const contentType = res.headers['content-type'] || 'image/jpeg';
          const fileWriteStream = fs.createWriteStream(stagingPath);
          let bytesReceived = 0;

          res.on('data', (chunk) => {
            bytesReceived += chunk.length;
            if (bytesReceived > maxSizeBytes) {
              req.destroy(new Error(`[PHOTO_DOWNLOADER SIZE_EXCEEDED] Streaming ultrapassou o limite máximo de ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB`));
            }
          });

          res.pipe(fileWriteStream);

          fileWriteStream.on('finish', () => {
            fileWriteStream.close(() => {
              if (bytesReceived === 0) {
                return reject(new Error(`[PHOTO_DOWNLOADER EMPTY_FILE] Arquivo baixado possui 0 bytes`));
              }
              resolve({
                isRedirect: false,
                result: {
                  stagingPath,
                  bytesDownloaded: bytesReceived,
                  contentType,
                  sourceUrl: url,
                  finalUrl: currentUrl
                }
              });
            });
          });

          fileWriteStream.on('error', (err) => {
            reject(err);
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error(`[PHOTO_DOWNLOADER TIMEOUT] Download excedeu timeout de ${timeoutMs}ms`));
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.end();
      });

      const outcome = await downloadPromise;

        if (outcome.isRedirect) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new Error(`[PHOTO_DOWNLOADER REDIRECT_LIMIT] Quantidade de redirecionamentos excedeu o limite máximo (${maxRedirects})`);
          }
          currentUrl = outcome.nextUrl;
        } else {
          return outcome.result;
        }
      }
    } catch (error) {
      lastError = error;
      // Limpar staging temporário antes de tentar próximo candidato
      if (fs.existsSync(stagingPath)) {
        try { fs.unlinkSync(stagingPath); } catch (cleanupErr) {}
      }
    }
  }

  throw lastError || new Error(`[PHOTO_DOWNLOADER] Falha ao baixar foto de ${url}`);
}

module.exports = {
  downloadPhotoToStaging,
  isIpBlocked,
  isHostAllowed,
  validateUrl,
  createSecureAgent,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_SIZE_MB,
  DEFAULT_MAX_REDIRECTS
};
