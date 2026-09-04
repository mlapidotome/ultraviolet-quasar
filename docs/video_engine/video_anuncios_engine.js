/**
 * Motor Unificado de Geração Automática de Anúncios em Vídeo (HeyGen + FFmpeg + WhatsApp)
 * Integrado ao Sistema Multi-Corretor e Copiloto Executivo da Bali Imóveis
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MessageMedia } = require('whatsapp-web.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY || 'sk_V2_REDACTED';
const IMOBTOTAL_API_KEY = process.env.IMOBTOTAL_API_KEY || 'REDACTED';
const IMOBTOTAL_BASE_URL = 'https://app.imobtotal.com.br/api/v1';

const OUTPUTS_DIR = path.join(__dirname, 'outputs');
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// 3 Looks oficiais do Marcel para alternar nos ganchos
const MARCEL_LOOKS = [
  { id: 'a2cfb3ad10054e6f87c5ce6ca8ab483b', nome: 'Terno Executivo Escuro', emoji: '👔' },
  { id: 'dc74498f5f5c45619fd7cb6a9ff905a8', nome: 'Estúdio / Podcaster no Microfone', emoji: '🎙️' },
  { id: '14f2350c0a6f4e2c8b6669b3a255782e', nome: 'Casual / Ao Ar Livre', emoji: '🌿' }
];

// Look padrão para o Desenvolvimento do Imóvel
const MARCEL_BODY_LOOK = { id: 'a2cfb3ad10054e6f87c5ce6ca8ab483b', nome: 'Terno Executivo' };
const MARCEL_VOICE_CLONE_ID = 'dccd1a85e6b1450facf9ec953b648df2';

// Configuração Cloudflare R2 / Storage
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || 'https://27414adaa46eae739436f24a1f4f90b3.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '9f11796c659d0af383c6d8c4582a0b42',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'REDACTED',
  }
});
const S3_BUCKET = process.env.S3_BUCKET || 'bali-cards';
const S3_PUBLIC_PREFIX = process.env.S3_PUBLIC_URL_PREFIX || 'https://pub-3ea8f719e24f4099b810e22aae627d8c.r2.dev';

// Sessões ativas de geração por remetente
const activeVideoSessions = {};

// Helper: Formatação de Moeda
function formatMoney(num) {
  return Number(num || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// 1. Buscar Dados do Imóvel no CRM (com fallback para base local banco_imoveis_carteira.json)
async function fetchImovelData(ref) {
  const cleanRef = String(ref).trim().replace(/\D/g, '');
  
  // Tentativa 1: API Externa ImobTotal
  try {
    const res = await axios.get(`${IMOBTOTAL_BASE_URL}/imoveis/${cleanRef}`, {
      headers: { 'x-api-key': IMOBTOTAL_API_KEY },
      timeout: 10000
    });
    if (res.data && (res.data.id || res.data.codigo || res.data.referencia)) {
      return res.data;
    }
  } catch (err) {
    console.log(`[IMOVEL] API externa indisponível para ref ${cleanRef}, consultando banco local...`);
  }

  // Tentativa 2: Banco Local banco_imoveis_carteira.json
  try {
    const dbPath = path.join(__dirname, 'data', 'banco_imoveis_carteira.json');
    if (fs.existsSync(dbPath)) {
      const imoveis = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      const found = imoveis.find(i => String(i.referencia || i.codigo || i.id_crm) === cleanRef);
      if (found) {
        return {
          codigo: found.codigo || found.referencia,
          referencia: found.referencia || found.codigo,
          titulo: found.titulo || `${found.tipo || 'Imóvel'} no ${found.bairro || 'bairro'}`,
          valor_venda: found.valor_anunciado || found.valor_atualizado || found.valor_venda || 0,
          preco: found.valor_anunciado || found.valor_atualizado || found.valor_venda || 0,
          bairro: found.bairro || 'em ótima localização',
          dormitorios: found.dormitorios || found.quartos || null,
          suites: found.suites || null,
          area_construida: found.area_construida || found.area_util || null,
          fotos: found.foto_capa ? [{ url: found.foto_capa }] : []
        };
      }
    }
  } catch (e) {
    console.error(`[IMOVEL] Erro no fallback do banco local:`, e.message);
  }

  return null;
}

// 2. Gerar Roteiros Inteligentes (3 Ganchos + 1 Desenvolvimento)
function generateCompleteScripts(imovel) {
  const valorVenda = Number(imovel.preco_venda || imovel.valor_venda || imovel.preco || imovel.valor_anunciado || 300000);
  
  // Regras de Entrada e Financiamento por Faixa de Preço
  let percEntrada = 0.20;
  let coefParcela = 0.0090;
  let rendaComprometimento = 3.3;

  if (valorVenda <= 200000) {
    // MCMV Faixas 1 e 2
    percEntrada = 0.10;
    coefParcela = 0.0055;
  } else if (valorVenda <= 350000) {
    // MCMV Faixa 3
    percEntrada = 0.15;
    coefParcela = 0.0070;
  }

  const entrada = Math.round(valorVenda * percEntrada);
  const valorFinanciado = valorVenda - entrada;
  const parcelaEstimada = Math.round(valorFinanciado * coefParcela);
  const rendaMinima = Math.round(parcelaEstimada * rendaComprometimento);

  // Formatação em texto puro e natural em português falado
  const formatExtenso = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace('.0', '')} milhão`;
    if (num >= 1000 && num % 1000 === 0) return `${num / 1000} mil`;
    if (num >= 1000) return `${num.toLocaleString('pt-BR')} reais`;
    return `${num} reais`;
  };

  const valorTexto = formatExtenso(valorVenda);
  const entradaTexto = formatExtenso(entrada);
  const parcelaTexto = formatExtenso(parcelaEstimada);
  const rendaTexto = formatExtenso(rendaMinima);

  const bairro = imovel.bairro || 'em excelente localização';
  const quartos = imovel.dormitorios || imovel.quartos ? `${imovel.dormitorios || imovel.quartos} quartos` : 'espaço amplo';
  const suites = imovel.suites ? `sendo ${imovel.suites} suíte(s)` : '';
  const area = imovel.area_construida || imovel.area_util || imovel.terreno ? `${imovel.area_construida || imovel.area_util || imovel.terreno} metros quadrados` : 'ótima metragem';
  const titulo = imovel.titulo || '';

  // Extrair condomínio / empreendimento
  let destaqueLoc = `no ${bairro}`;
  if (titulo.toLowerCase().includes('condomínio') || titulo.toLowerCase().includes('condominio') || titulo.toLowerCase().includes('residencial') || titulo.toLowerCase().includes('edifício') || titulo.toLowerCase().includes('edificio') || titulo.toLowerCase().includes('parque')) {
    const match = titulo.match(/(?:condom[íi]nio|residencial|edif[íi]cio|parque)\s+([A-Za-zÀ-ÿ\s]+?)(?:[-,\.]|$)/i);
    if (match && match[1]) {
      destaqueLoc = `no ${match[1].trim()}`;
    }
  }

  // 3 Ganchos de Retenção Agressiva (10s) - ZERO CTA
  const hooks = [
    {
      index: 1,
      tipo: 'Choque / Entrada',
      look: MARCEL_LOOKS[0], // Terno
      text: `${valorTexto} num imóvel completo ${destaqueLoc} com entrada de apenas ${entradaTexto}? Esse imóvel aqui é a maior oportunidade para sair do aluguel hoje. Olha isso:`
    },
    {
      index: 2,
      tipo: 'Aluguel vs Parcela',
      look: MARCEL_LOOKS[1], // Podcaster
      text: `Parcela de ${parcelaTexto} num imóvel de ${quartos} todinho seu? Se você tem ${entradaTexto} de FGTS ou reserva, continuar pagando aluguel por aí é loucura. Dá só uma olhada:`
    },
    {
      index: 3,
      tipo: 'Renda Familiar / Oportunidade',
      look: MARCEL_LOOKS[2], // Casual
      text: `Com uma renda familiar a partir de ${rendaTexto} e ${entradaTexto} de entrada, você já conquista esse imóvel ${destaqueLoc}. Olha como ele tá pronto por dentro:`
    }
  ];

  // 1 Desenvolvimento do Imóvel & Bairro (30s) - COM CTA
  const bodyText = `Estamos falando de uma oportunidade com ${area}, muito bem distribuídos em ${quartos} ${suites}, com acabamento moderno e excelente iluminação. A localização ${destaqueLoc} é perfeita, com fácil acesso aos melhores serviços, comércios e comodidades da região. Quer fazer uma simulação personalizada e agendar sua visita? Toque no botão Saiba Mais abaixo e fale com a nossa equipe agora mesmo!`;

  return {
    hooks,
    body: {
      look: MARCEL_BODY_LOOK,
      text: bodyText
    },
    financeiro: {
      valorVenda,
      entrada,
      parcelaEstimada,
      rendaMinima
    }
  };
}

// 3. Upload de Áudio para Cloudflare R2
async function uploadAudioToR2(buffer, filename) {
  const key = `audios-anuncios/${Date.now()}_${filename}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'audio/mp4'
  }));
  return `${S3_PUBLIC_PREFIX}/${key}`;
}

// 4. Renderização na HeyGen
async function renderHeyGenVideo(lookId, text, audioUrl = null, bgImageUrl = null, avatarStyle = 'normal') {
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
    title: `Clip_${Date.now()}`,
    dimension: { width: 1080, height: 1920 },
    video_inputs: [
      {
        character: characterConfig,
        voice: audioUrl ? {
          type: 'audio',
          audio_url: audioUrl
        } : {
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
  if (!videoId) throw new Error('Não retornou video_id da HeyGen');

  // Polling
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const checkRes = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers, timeout: 20000 });
    const status = checkRes.data?.data?.status?.toLowerCase();
    
    if (status === 'completed') {
      return checkRes.data?.data?.video_url;
    }
    if (status === 'failed') {
      throw new Error(`Renderização falhou na HeyGen: ${checkRes.data?.data?.error}`);
    }
  }

  throw new Error('Tempo limite excedido na HeyGen');
}

// 5. Concatenação FFmpeg
async function concatenateVideos(hookFilePath, bodyFilePath, outputFilePath) {
  const listFilePath = path.join(OUTPUTS_DIR, `concat_list_${Date.now()}.txt`);
  const cleanHookPath = hookFilePath.replace(/\\/g, '/');
  const cleanBodyPath = bodyFilePath.replace(/\\/g, '/');
  
  fs.writeFileSync(listFilePath, `file '${cleanHookPath}'\nfile '${cleanBodyPath}'\n`, 'utf-8');

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputFilePath}"`;
    execSync(cmd, { stdio: 'pipe' });
    if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
    return outputFilePath;
  } catch (e) {
    // Fallback com re-encode se codecs divergirem
    const cmdReencode = `ffmpeg -y -i "${hookFilePath}" -i "${bodyFilePath}" -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" "${outputFilePath}"`;
    execSync(cmdReencode, { stdio: 'pipe' });
    if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
    return outputFilePath;
  }
}

// 6. Download para disco
async function downloadToFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * 7. Processador de Mensagens do WhatsApp para Marcel
 * Trata referências de imóveis, escolha de looks, comando CLONE, os 4 áudios e Copiloto Executivo
 */
async function handleIncomingMessage(client, msg, brokerId = 'marcel_teste') {
  console.log('[VIDEO_ENGINE] Incoming:', {
    fromMe: msg.fromMe,
    from: msg.from,
    to: msg.to,
    author: msg.author,
    type: msg.type,
    hasMedia: msg.hasMedia,
    body: msg.body
  });

  // 1. REGRA DE OURO: NUNCA responder em grupos (@g.us)!
  if ((msg.from && msg.from.includes('@g.us')) || 
      (msg.to && msg.to.includes('@g.us')) || 
      msg.isGroupMsg) {
    console.log('[VIDEO_ENGINE] Bloqueado: mensagem de grupo (@g.us).');
    return false;
  }

  // 2. REGRA DE OURO: Deve ser enviada pelo próprio Marcel (fromMe: true)
  if (!msg.fromMe) {
    return false;
  }

  // 3. REGRA DE OURO: Deve ser no chat consigo mesmo ("Marcel Tomé (você)")
  const MARCEL_IDS = ['5511941610601', '551141610601', '11941610601', '1141610601', '213649004212310'];
  const toClean = (msg.to || '').replace(/\D/g, '');
  const fromClean = (msg.from || '').replace(/\D/g, '');

  const isSelfChat = MARCEL_IDS.some(id => toClean.includes(id)) || 
                     (toClean === fromClean) || 
                     (!toClean);

  if (!isSelfChat) {
    console.log('[VIDEO_ENGINE] Ignorado: mensagem enviada para outro contato, não é chat próprio.');
    return false;
  }

  const body = (msg.body || '').trim();
  const targetChat = '5511941610601@c.us';
  const sessionKey = 'marcel';

  // Evitar loops em auto-respostas do próprio robô
  if (body.startsWith('🏠 *IMÓVEL') ||
      body.startsWith('🔍 Consultando') ||
      body.startsWith('🎬 *') ||
      body.startsWith('🚀 *') ||
      body.startsWith('✅ *') ||
      body.startsWith('💡 *') ||
      body.startsWith('🔥 *') ||
      body.startsWith('🎙️ *') ||
      body.startsWith('📋 *') ||
      body.startsWith('🤖 *') ||
      body.startsWith('👔 *') ||
      body.startsWith('💼 *') ||
      body.startsWith('❌ *')) {
    return false;
  }

  // Helper interno para obter ou recuperar sessão
  async function getOrInitSession(defaultRef = '1639') {
    let session = activeVideoSessions[sessionKey];
    if (!session) {
      console.log('[VIDEO_ENGINE] Recuperando sessão do imóvel #' + defaultRef + '...');
      const imovel = await fetchImovelData(defaultRef);
      if (imovel) {
        session = {
          imovelRef: defaultRef,
          imovelData: imovel,
          scripts: generateCompleteScripts(imovel),
          waitingAudios: true,
          audiosReceived: []
        };
        activeVideoSessions[sessionKey] = session;
      }
    }
    return session;
  }

  // A. MENU / AJUDA
  if (/^(menu|ajuda|comandos|help|oi|ola)$/i.test(body)) {
    const menuText = '🤖 *CO-PILOTO & ROBÔ HEYGEN BALI*\n\n' +
      'Olá Marcel! Aqui estão os seus comandos disponíveis diretamente pelo WhatsApp:\n\n' +
      '🏠 *1. Gerador de Vídeos de Anúncio:*\n' +
      '• Envie *#1639* (ou qualquer código/ref do imóvel)\n' +
      '• O robô traz valores, simulação e 3 ganchos agressivos.\n\n' +
      '👔 *2. Escolha de Looks dos Ganchos:*\n' +
      '• *LOOKS 1, 2, 3* (ou qualquer combinação, ex: *LOOKS 2, 2, 2*)\n' +
      '  1 = Terno Executivo 👔\n' +
      '  2 = Podcaster no Microfone 🎙️\n' +
      '  3 = Casual / Ao Ar Livre 🌿\n\n' +
      '🎙️ *3. Renderizar Vídeos:*\n' +
      '• Responda *CLONE* -> Gera os 3 vídeos com sua voz clonada na HeyGen\n' +
      '• Ou grave o *Áudio 1 (Gancho 1)* diretamente aqui no WhatsApp!\n\n' +
      '💼 *4. Copiloto Executivo de IA (Gemini):*\n' +
      '• Envie *? <sua pergunta>* a qualquer momento!';

    await client.sendMessage(targetChat, menuText);
    return true;
  }

  // B. PERGUNTA AO COPILOTO EXECUTIVO DE IA (Gemini)
  if (body.startsWith('?') || /^gestor:/i.test(body) || /^copiloto:/i.test(body)) {
    const question = body.replace(/^(\?|gestor:|copiloto:)\s*/i, '').trim();
    if (!question) {
      await client.sendMessage(targetChat, '💡 Envie sua pergunta executiva após a interrogação. Ex: *? como estão os corretores hoje?*');
      return true;
    }

    await client.sendMessage(targetChat, '🔍 *Consultando Copiloto Executivo Bali...*');
    try {
      const gestorChat = require('./gestor_chat');
      const answerObj = await gestorChat.ask(question);
      if (answerObj.success) {
        await client.sendMessage(targetChat, '💼 *RESPOSTA EXECUTIVA:*\n\n' + answerObj.answer);
      } else {
        await client.sendMessage(targetChat, '❌ Erro no copiloto: ' + answerObj.error);
      }
    } catch (e) {
      await client.sendMessage(targetChat, '❌ Falha ao consultar copiloto: ' + e.message);
    }
    return true;
  }

  // C. PERSONALIZAÇÃO DE LOOKS (Ex: "Looks 1,2,3" ou "Looks 1,2,3\nOpção 2")
  if (/looks?\b/i.test(body)) {
    const session = await getOrInitSession('1639');
    if (session) {
      const nums = body.replace(/\D/g, '').split('').map(n => parseInt(n)).filter(n => n >= 1 && n <= 3);
      if (nums.length > 0) {
        const l1 = MARCEL_LOOKS[(nums[0] || 1) - 1];
        const l2 = MARCEL_LOOKS[(nums[1] || nums[0] || 2) - 1];
        const l3 = MARCEL_LOOKS[(nums[2] || nums[1] || 3) - 1];

        session.scripts.hooks[0].look = l1;
        session.scripts.hooks[1].look = l2;
        session.scripts.hooks[2].look = l3;

        let confirmText = '👔 *LOOKS ATUALIZADOS PARA O IMÓVEL #' + session.imovelRef + ':*\n\n' +
          '• *Gancho 1:* ' + l1.emoji + ' ' + l1.nome + '\n' +
          '• *Gancho 2:* ' + l2.emoji + ' ' + l2.nome + '\n' +
          '• *Gancho 3:* ' + l3.emoji + ' ' + l3.nome + '\n\n';

        if (/op[cç][aã]o\s*2|voz\s*real/i.test(body)) {
          confirmText += '🎙️ *MODO SUA VOZ REAL SELECIONADO!*\n\n' +
            '👉 Grave agora o *Áudio 1 (Gancho 1)* aqui no WhatsApp:\n\n' +
            '\"' + session.scripts.hooks[0].text + '\"';
        } else if (/clone|op[cç][aã]o\s*1/i.test(body)) {
          confirmText += '👉 Responda *CLONE* para gerar na HeyGen com sua voz clonada!';
        } else {
          confirmText += '👉 *Próximo passo:*\n' +
            '• Responda *CLONE* para voz clonada na HeyGen\n' +
            '• Ou grave o *Áudio 1 (Gancho 1)* aqui no WhatsApp!';
        }

        await client.sendMessage(targetChat, confirmText);
        return true;
      }
    }
  }

  // D. ESCOLHA DE OPÇÃO 2 ISOLADA ("Opção 2")
  if (/^op[cç][aã]o\s*2\b/i.test(body)) {
    const session = await getOrInitSession('1639');
    if (session) {
      const text = '🎙️ *MODO SUA VOZ REAL SELECIONADO!*\n\n' +
        '👉 Grave agora o *Áudio 1 (Gancho 1)* aqui no WhatsApp:\n\n' +
        '\"' + session.scripts.hooks[0].text + '\"';
      await client.sendMessage(targetChat, text);
      return true;
    }
  }

  // E. TRATAMENTO DOS 4 ÁUDIOS REAIS DO WHATSAPP (ptt ou audio)
  const isAudioMsg = msg.hasMedia || msg.type === 'ptt' || msg.type === 'audio';
  if (isAudioMsg) {
    console.log('[VIDEO_ENGINE] 🎙️ Áudio detectado! Processando...');
    const session = await getOrInitSession('1639');

    if (session && session.waitingAudios !== false) {
      try {
        console.log('[VIDEO_ENGINE] Baixando mídia do áudio com retry loop...');
        let media = null;
        for (let attempt = 1; attempt <= 6; attempt++) {
          try {
            console.log('[VIDEO_ENGINE] Tentativa ' + attempt + '/6 de baixar mídia do áudio...');
            media = await msg.downloadMedia();
            if (media && media.data) {
              console.log('[VIDEO_ENGINE] Mídia obtida com sucesso na tentativa ' + attempt + '!');
              break;
            }
          } catch (e) {
            console.log('[VIDEO_ENGINE] Tentativa ' + attempt + ' aguardando sync: ' + e.message);
          }
          await new Promise(r => setTimeout(r, 2000));
        }

        if (media && media.data) {
          const audioBuffer = Buffer.from(media.data, 'base64');
          console.log('[VIDEO_ENGINE] Áudio baixado (' + audioBuffer.length + ' bytes). Fazendo upload para R2...');
          const audioUrl = await uploadAudioToR2(audioBuffer, 'audio_' + (session.audiosReceived.length + 1) + '.mp4');
          console.log('[VIDEO_ENGINE] Upload R2 concluído com sucesso:', audioUrl);

          session.audiosReceived.push(audioUrl);
          const audioNum = session.audiosReceived.length;

          if (audioNum <= 3) {
            const nextLabel = audioNum === 3 ? 'Áudio 4 (Desenvolvimento do Imóvel & Bairro)' : 'Áudio ' + (audioNum + 1) + ' (Gancho ' + (audioNum + 1) + ')';
            const nextText = session.scripts.hooks[audioNum]?.text || session.scripts.body.text;
            await client.sendMessage(targetChat, '✅ *Áudio ' + audioNum + '/4 Recebido com Sucesso!* (Gancho ' + audioNum + ')\n\n' +
              '👉 Agora grave e envie o *' + nextLabel + '*:\n\n' +
              '\"' + nextText + '\"');
          } else if (audioNum === 4) {
            session.waitingAudios = false;
            await client.sendMessage(targetChat, '🎉 *Todos os 4 áudios recebidos com sucesso!*\n\nIniciando a renderização na HeyGen com a sua voz real e a montagem dos 3 vídeos finais com FFmpeg...');

            // Disparar renderização em background para não travar o socket
            (async () => {
              try {
                const rawFoto = session.imovelData?.fotos?.[0]?.url || session.imovelData?.foto_capa || '';
                const fotoImovel = rawFoto.replace('fotos.sobressai.com.br/fotos/', 'fotos2.fra1.cdn.digitaloceanspaces.com/Fotos/') || null;
                await client.sendMessage(targetChat, '🎬 *Renderizando Desenvolvimento com a sua Voz Real e FOTO DO IMÓVEL ao fundo...*');
                const bodyUrl = await renderHeyGenVideo(session.scripts.body.look.id, session.scripts.body.text, session.audiosReceived[3], fotoImovel, 'circle');
                const bodyPath = path.join(OUTPUTS_DIR, 'body_real_' + session.imovelRef + '_' + Date.now() + '.mp4');
                await downloadToFile(bodyUrl, bodyPath);

                for (let i = 0; i < 3; i++) {
                  const hook = session.scripts.hooks[i];
                  const hookAudio = session.audiosReceived[i];

                  await client.sendMessage(targetChat, '🎬 *Renderizando Gancho ' + (i + 1) + '* (' + hook.look.emoji + ' ' + hook.look.nome + ')...');
                  const hookUrl = await renderHeyGenVideo(hook.look.id, hook.text, hookAudio);
                  const hookPath = path.join(OUTPUTS_DIR, 'hook_real_' + (i + 1) + '_' + session.imovelRef + '_' + Date.now() + '.mp4');
                  await downloadToFile(hookUrl, hookPath);

                  const finalVideoPath = path.join(OUTPUTS_DIR, 'Anuncio_Completo_Real_' + (i + 1) + '_Imovel_' + session.imovelRef + '.mp4');
                  await concatenateVideos(hookPath, bodyPath, finalVideoPath);

                  const vMedia = MessageMedia.fromFilePath(finalVideoPath);
                  await client.sendMessage(targetChat, vMedia, {
                    caption: '✅ *VÍDEO COMPLETO ' + (i + 1) + ' (SUA VOZ REAL)!*\n\n• Gancho: ' + hook.tipo + ' (' + hook.look.emoji + ' ' + hook.look.nome + ')\n• Desenvolvimento: Imóvel + Bairro\n• Imóvel: #' + session.imovelRef
                  });
                }

                await client.sendMessage(targetChat, '🚀 *Os 3 vídeos completos com a sua voz real foram entregues!* Prontos para campanhas.');
                delete activeVideoSessions[sessionKey];
              } catch (err) {
                console.error('[VIDEO_ENGINE] Erro na renderização real:', err);
                await client.sendMessage(targetChat, '❌ Erro na renderização: ' + err.message);
              }
            })();
          }
          return true;
        } else {
          console.error('[VIDEO_ENGINE] Mídia não retornou dados base64 válidos após retries.');
          await client.sendMessage(targetChat, '⚠️ O WhatsApp Web ainda não sincronizou este áudio do seu celular.\n\n👉 *Você pode reenviar o áudio em instantes* ou digitar *CLONE* para gerar o anúncio agora com sua voz clonada!');
          return true;
        }
      } catch (err) {
        console.error('[VIDEO_ENGINE] Erro ao processar áudio:', err.message);
        await client.sendMessage(targetChat, '❌ Erro ao processar o seu áudio: ' + err.message);
        return true;
      }
    }
  }

  // F. DETECTAR CÓDIGO OU LINK DO IMÓVEL (Exige '#' ou dígitos)
  let ref = null;
  const hashMatch = body.match(/#([0-9]{3,7})\b/);
  const linkMatch = body.match(/(?:imovel\/|imoveis\/)([0-9]{3,7})\b/i);
  const pureDigitsMatch = body.match(/^\s*([0-9]{3,7})\s*$/);

  if (hashMatch) {
    ref = hashMatch[1];
  } else if (linkMatch) {
    ref = linkMatch[1];
  } else if (pureDigitsMatch && !activeVideoSessions[sessionKey]?.waitingAudios) {
    ref = pureDigitsMatch[1];
  }

  if (ref && !msg.hasMedia && !isAudioMsg) {
    await client.sendMessage(targetChat, '🔍 Consultando imóvel *#' + ref + '* no estoque da Bali Imóveis...');

    const imovel = await fetchImovelData(ref);
    if (!imovel) {
      await client.sendMessage(targetChat, '❌ Não encontrei nenhum imóvel ativo com a referência *#' + ref + '* na carteira.');
      return true;
    }

    const scripts = generateCompleteScripts(imovel);
    activeVideoSessions[sessionKey] = {
      imovelRef: ref,
      imovelData: imovel,
      scripts: scripts,
      waitingAudios: true,
      audiosReceived: []
    };

    const fin = scripts.financeiro;
    const replyText = '🏠 *IMÓVEL ENCONTRADO: ' + (imovel.titulo || 'Referência ' + ref) + '*\n' +
      '📍 *Local:* ' + (imovel.bairro || 'Taubaté') + '\n' +
      '💰 *Valor:* ' + formatMoney(fin.valorVenda) + '\n' +
      '🔑 *Entrada estimada:* ' + formatMoney(fin.entrada) + '\n' +
      '📉 *Parcela estimada:* ' + formatMoney(fin.parcelaEstimada) + '\n' +
      '👥 *Renda familiar mínima:* ' + formatMoney(fin.rendaMinima) + '\n\n' +
      'Aqui está o seu roteiro (*3 Ganchos de Retenção + 1 Desenvolvimento*):\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '💡 *GANCHO 1 (Look: ' + scripts.hooks[0].look.emoji + ' ' + scripts.hooks[0].look.nome + ')*\n' +
      '\"' + scripts.hooks[0].text + '\"\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '🔥 *GANCHO 2 (Look: ' + scripts.hooks[1].look.emoji + ' ' + scripts.hooks[1].look.nome + ')*\n' +
      '\"' + scripts.hooks[1].text + '\"\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '🚀 *GANCHO 3 (Look: ' + scripts.hooks[2].look.emoji + ' ' + scripts.hooks[2].look.nome + ')*\n' +
      '\"' + scripts.hooks[2].text + '\"\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '📖 *DESENVOLVIMENTO DO IMÓVEL & BAIRRO (Corpo com CTA)*\n' +
      '\"' + scripts.body.text + '\"\n\n' +
      '━━━━━━━━━━━━━━━━━━━━\n' +
      '👔 *QUER MUDAR OS LOOKS DOS GANCHOS?*\n' +
      'Looks disponíveis: 1️⃣ Terno 2️⃣ Podcaster 3️⃣ Casual\n' +
      'Para opinar, basta responder: *LOOKS 1, 2, 3* ou *LOOKS 2, 2, 2*\n\n' +
      '🎙️ *COMO GERAR OS 3 VÍDEOS?*\n' +
      '👉 *Opção 1 (100% Automático):* Responda apenas *CLONE* (voz clonada na HeyGen)\n' +
      '👉 *Opção 2 (Sua Voz Real):* Grave os 4 áudios no WhatsApp (Áudio 1, 2, 3 e 4). O robô monta tudo com FFmpeg!';

    await client.sendMessage(targetChat, replyText);
    return true;
  }

  // G. TRATAMENTO DO COMANDO CLONE (MODO PILOTO PRIMEIRO)
  if (body.toUpperCase() === "CLONE") {
    const session = await getOrInitSession("1639");
    session.waitingAudios = false;
    await client.sendMessage(targetChat, "🚀 *Iniciando a renderização do VÍDEO 1 (Piloto) com sua voz clonada...*\nAssim que assistir, você decide se quer renderizar os outros 2!");

    try {
      // 1. Reutilizar body existente ou renderizar novo
      let bodyPath = session.bodyPath;
      if (!bodyPath || !fs.existsSync(bodyPath)) {
        const existingBodies = fs.existsSync(OUTPUTS_DIR) ? fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith("body_" + session.imovelRef) && f.endsWith(".mp4")).sort().reverse() : [];
        if (existingBodies.length > 0) {
          bodyPath = path.join(OUTPUTS_DIR, existingBodies[0]);
          console.log("[VIDEO_ENGINE] Reutilizando body existente:", bodyPath);
        }
      }

      if (!bodyPath || !fs.existsSync(bodyPath)) {
        const rawFoto = session.imovelData?.fotos?.[0]?.url || session.imovelData?.foto_capa || "";
        const fotoImovel = rawFoto.replace("fotos.sobressai.com.br/fotos/", "fotos2.fra1.cdn.digitaloceanspaces.com/Fotos/") || null;
        await client.sendMessage(targetChat, "🎬 *Renderizando o Desenvolvimento com a FOTO DO IMÓVEL ao fundo e avatar no rodapé...*");
        const bodyUrl = await renderHeyGenVideo(session.scripts.body.look.id, session.scripts.body.text, null, fotoImovel, "circle");
        bodyPath = path.join(OUTPUTS_DIR, "body_" + session.imovelRef + "_" + Date.now() + ".mp4");
        await downloadToFile(bodyUrl, bodyPath);
      }
      session.bodyPath = bodyPath;

      // 2. Renderizar Gancho 1 (Piloto)
      const hook1 = session.scripts.hooks[0];
      await client.sendMessage(targetChat, "🎬 *Renderizando Gancho 1 (Piloto)* (" + hook1.look.emoji + " " + hook1.look.nome + ")...");
      const hookUrl = await renderHeyGenVideo(hook1.look.id, hook1.text, null);
      const hookPath = path.join(OUTPUTS_DIR, "hook_" + hook1.index + "_" + session.imovelRef + "_" + Date.now() + ".mp4");
      await downloadToFile(hookUrl, hookPath);

      // 3. Montar com FFmpeg
      await client.sendMessage(targetChat, "⚙️ *Montando o Vídeo Piloto com FFmpeg...*");
      const finalVideoPath = path.join(OUTPUTS_DIR, "Anuncio_Completo_1_Imovel_" + session.imovelRef + ".mp4");
      await concatenateVideos(hookPath, bodyPath, finalVideoPath);

      // 4. Enviar para aprovação
      const media = MessageMedia.fromFilePath(finalVideoPath);
      await client.sendMessage(targetChat, media, { 
        caption: "🎬 *VÍDEO 1 (PILOTO) ENTREGUE COM SUCESSO!*\n\n" +
          "• Gancho 1: " + hook1.tipo + " (" + hook1.look.emoji + " " + hook1.look.nome + ")\n" +
          "• Desenvolvimento: Imóvel #" + session.imovelRef + " + Avatar em círculo\n" +
          "• Montagem: Concatenação via FFmpeg 100% perfeita!\n\n" +
          "👉 Se gostou do resultado, responda *OK* ou *GERAR RESTANTE* para eu renderizar os outros 2 vídeos (Ganchos 2 e 3)!"
      });

      session.waitingApproval = true;
      activeVideoSessions[sessionKey] = session;
    } catch (err) {
      console.error("[VIDEO_ENGINE] Erro no piloto:", err);
      await client.sendMessage(targetChat, "❌ Erro na geração do piloto: " + err.message);
    }
    return true;
  }

  // H. TRATAMENTO DA APROVAÇÃO (GERAR RESTANTE)
  const cleanBodyUpper = body.trim().toUpperCase();
  const approvalTriggers = ["OK", "GERAR RESTANTE", "GERAR O RESTANTE", "APROVADO", "PODE GERAR", "CONTINUAR", "RESTANTE"];
  if (approvalTriggers.includes(cleanBodyUpper) || cleanBodyUpper.startsWith("OK") || cleanBodyUpper.startsWith("GERAR RESTANTE")) {
    const session = activeVideoSessions[sessionKey] || await getOrInitSession("1639");
    
    // Garantir bodyPath
    if (!session.bodyPath) {
      const existingBodies = fs.existsSync(OUTPUTS_DIR) ? fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith("body_" + session.imovelRef) && f.endsWith(".mp4")).sort().reverse() : [];
      if (existingBodies.length > 0) {
        session.bodyPath = path.join(OUTPUTS_DIR, existingBodies[0]);
      }
    }

    if (session && session.bodyPath && fs.existsSync(session.bodyPath)) {
      session.waitingApproval = false;
      await client.sendMessage(targetChat, "🚀 *Vídeo 1 aprovado! Renderizando agora os Ganchos 2 e 3 na HeyGen...*");

      try {
        const remainingHooks = session.scripts.hooks.slice(1); // Gancho 2 e 3
        for (const hook of remainingHooks) {
          await client.sendMessage(targetChat, "🎬 *Renderizando Gancho " + hook.index + "* (" + hook.look.emoji + " " + hook.look.nome + ")...");
          const hookUrl = await renderHeyGenVideo(hook.look.id, hook.text, null);
          const hookPath = path.join(OUTPUTS_DIR, "hook_" + hook.index + "_" + session.imovelRef + "_" + Date.now() + ".mp4");
          await downloadToFile(hookUrl, hookPath);

          const finalVideoPath = path.join(OUTPUTS_DIR, "Anuncio_Completo_" + hook.index + "_Imovel_" + session.imovelRef + ".mp4");
          await concatenateVideos(hookPath, session.bodyPath, finalVideoPath);

          const media = MessageMedia.fromFilePath(finalVideoPath);
          await client.sendMessage(targetChat, media, { 
            caption: "✅ *VÍDEO COMPLETO " + hook.index + " MONTADO COM SUCESSO!*\n\n• Gancho: " + hook.tipo + " (" + hook.look.emoji + " " + hook.look.nome + ")\n• Desenvolvimento: Imóvel + Bairro\n• Imóvel: #" + session.imovelRef 
          });
        }

        await client.sendMessage(targetChat, "🎉 *Todos os 3 vídeos completos e montados foram entregues!* Prontos para anunciar. Pode mandar o próximo imóvel!");
        delete activeVideoSessions[sessionKey];
      } catch (err) {
        console.error("[VIDEO_ENGINE] Erro na geração dos vídeos restantes:", err);
        await client.sendMessage(targetChat, "❌ Erro na geração dos vídeos restantes: " + err.message);
      }
      return true;
    }
  }

  return false;
}

module.exports = {
  activeVideoSessions,
  fetchImovelData,
  generateCompleteScripts,
  renderHeyGenVideo,
  concatenateVideos,
  handleIncomingMessage
};
