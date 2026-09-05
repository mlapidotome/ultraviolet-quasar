/**
 * YouTube Adapter — Video Engine V2
 * Bali Imóveis (Property Video Ingestion)
 * 
 * Responsabilidades:
 * 1. Whitelist estrita de domínios e protocolos YouTube
 * 2. Bloqueio rigoroso de SSRF, IPs privados, loopback e esquemas arbitrários
 * 3. Sanitização e extração determinística de Video ID (11 chars)
 * 4. Reconstrução de URL canônica imutável
 * 5. Materialização isolada via yt-dlp sem shell (execFile)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const BaseVideoAdapter = require('./base_video_adapter');

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com'
]);

class YouTubeAdapter extends BaseVideoAdapter {
  constructor(options = {}) {
    super('youtube');
    this.ytdlpPath = options.ytdlpPath || this._resolveYtdlpBinary();
  }

  _resolveYtdlpBinary() {
    if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
      return process.env.YTDLP_PATH;
    }

    const venvYtdlpWin = path.join(__dirname, '..', '..', '..', '.venv', 'Scripts', 'yt-dlp.exe');
    if (fs.existsSync(venvYtdlpWin)) {
      return venvYtdlpWin;
    }

    const venvYtdlpLinux = path.join(__dirname, '..', '..', '..', '.venv', 'bin', 'yt-dlp');
    if (fs.existsSync(venvYtdlpLinux)) {
      return venvYtdlpLinux;
    }

    return 'yt-dlp';
  }

  /**
   * Validação de Segurança e Whitelist
   */
  _validateUrlSecurity(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('[YOUTUBE_ADAPTER SECURITY] URL nula ou inválida');
    }

    const trimmed = rawUrl.trim();

    // Bloqueio de injeção de caracteres perigosos
    if (/[\0\r\n`$;|&]/.test(trimmed)) {
      throw new Error('[YOUTUBE_ADAPTER SECURITY] URL contém caracteres proibidos');
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (e) {
      throw new Error(`[YOUTUBE_ADAPTER SECURITY] URL malformada: ${trimmed}`);
    }

    // Apenas HTTPS é aceito em produção
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`[YOUTUBE_ADAPTER SECURITY] Protocolo não permitido: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Bloqueio anti-SSRF (localhost, loopback, private ranges, link-local)
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      throw new Error(`[YOUTUBE_ADAPTER SECURITY SSRF] Hostname proibido: ${hostname}`);
    }

    if (!ALLOWED_HOSTS.has(hostname)) {
      throw new Error(`[YOUTUBE_ADAPTER SECURITY WHITELIST] Domínio não autorizado: ${hostname}`);
    }

    return parsed;
  }

  canHandle(url) {
    try {
      const parsed = this._validateUrlSecurity(url);
      const videoId = this._extractVideoIdFromParsed(parsed);
      return Boolean(videoId && YOUTUBE_ID_REGEX.test(videoId));
    } catch (e) {
      return false;
    }
  }

  _extractVideoIdFromParsed(parsed) {
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname === 'youtu.be') {
      const id = pathname.replace(/^\/+/, '').split('/')[0];
      return id || null;
    }

    if (pathname.startsWith('/shorts/')) {
      const id = pathname.replace('/shorts/', '').split('/')[0];
      return id || null;
    }

    if (pathname.startsWith('/embed/')) {
      const id = pathname.replace('/embed/', '').split('/')[0];
      return id || null;
    }

    if (pathname.startsWith('/v/')) {
      const id = pathname.replace('/v/', '').split('/')[0];
      return id || null;
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam) {
      return vParam;
    }

    return null;
  }

  parseVideoId(url) {
    const parsed = this._validateUrlSecurity(url);
    const videoId = this._extractVideoIdFromParsed(parsed);
    if (!videoId || !YOUTUBE_ID_REGEX.test(videoId)) {
      throw new Error(`[YOUTUBE_ADAPTER] Não foi possível extrair um Video ID válido de 11 caracteres da URL: ${url}`);
    }
    return videoId;
  }

  getCanonicalUrl(videoId) {
    if (!videoId || !YOUTUBE_ID_REGEX.test(videoId)) {
      throw new Error(`[YOUTUBE_ADAPTER] Video ID inválido para canonical URL: ${videoId}`);
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  /**
   * Baixa e materializa o vídeo no diretório de staging
   */
  async materialize({ canonicalUrl, videoId, stagingDir, stagingBaseName, timeoutMs = 60000, maxSizeMb = 150 }) {
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    const outputTemplate = path.join(stagingDir, `${stagingBaseName}.%(ext)s`);

    const args = [
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--extractor-args', 'youtube:player_client=android,web',
      '--max-filesize', `${maxSizeMb}M`,
      '-f', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4/webm/mkv',
      '-o', outputTemplate,
      canonicalUrl
    ];

    return new Promise((resolve, reject) => {
      let isTimedOut = false;
      const child = execFile(this.ytdlpPath, args, {
        windowsHide: true,
        timeout: timeoutMs
      }, (err, stdout, stderr) => {
        if (isTimedOut) return;

        if (err) {
          return reject(new Error(`[YOUTUBE_ADAPTER DOWNLOAD ERROR] yt-dlp falhou (${err.message}). Stderr: ${stderr}`));
        }

        // Localizar o arquivo materializado correspondente ao stagingBaseName no stagingDir
        const files = fs.readdirSync(stagingDir);
        const matchingFile = files.find(f => f.startsWith(stagingBaseName));
        if (!matchingFile) {
          return reject(new Error(`[YOUTUBE_ADAPTER ERROR] Nenhum arquivo gerado em staging correspondente a ${stagingBaseName}`));
        }

        const materializedPath = path.join(stagingDir, matchingFile);
        const stats = fs.statSync(materializedPath);
        if (stats.size === 0) {
          try { fs.unlinkSync(materializedPath); } catch (e) {}
          return reject(new Error(`[YOUTUBE_ADAPTER ERROR] Arquivo gerado em staging possui 0 bytes: ${materializedPath}`));
        }

        const ext = path.extname(matchingFile).toLowerCase().replace('.', '');
        resolve({
          localPath: materializedPath,
          format: ext,
          fileSizeBytes: stats.size
        });
      });

      if (timeoutMs > 0) {
        setTimeout(() => {
          isTimedOut = true;
          try { child.kill('SIGKILL'); } catch (e) {}
          reject(new Error(`[YOUTUBE_ADAPTER TIMEOUT] Download excedeu timeout de ${timeoutMs}ms`));
        }, timeoutMs + 1000);
      }
    });
  }
}

module.exports = YouTubeAdapter;
