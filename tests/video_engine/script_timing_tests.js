/**
 * Suíte de Testes Formais: Script Timing & Forced Alignment (Fase 4A.2)
 * Cenários A a W
 * Bali Imóveis
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { execFile } = require('child_process');

const scriptTimingService = require('../../video_engine/script_timing/script_timing_service');
const {
  SCHEMA_VERSION,
  DEFAULT_ALIGNMENT_ENGINE,
  DEFAULT_ENGINE_VERSION,
  DEFAULT_MODEL_ID,
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_BEAT_PARSER_VERSION,
  DEFAULT_BEAT_PROMPT_VERSION,
  validateWordAlignment,
  validateSemanticBeat,
  computeAlignmentKey,
  computeBeatAnalysisKey
} = require('../../video_engine/script_timing/alignment_schema');
const {
  removeDiacritics,
  normalizeCurrencyAndNumbers,
  normalizeForComparison,
  tokenizeScript,
  computeNormalizedScriptHash,
  wordSimilarity,
  reconcileScriptWithAlignedWords
} = require('../../video_engine/script_timing/text_normalizer');
const { parseSemanticBeats, extractCueKeywords } = require('../../video_engine/script_timing/beat_parser');
const MockScriptAlignmentProvider = require('../../video_engine/script_timing/providers/mock_script_alignment_provider');
const OpenAIWhisperAlignmentProvider = require('../../video_engine/script_timing/providers/openai_whisper_alignment_provider');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

let passCount = 0;
let failCount = 0;

function reportPass(name) {
  passCount++;
  console.log(`  [PASS] ${name}`);
}

function reportFail(name, err) {
  failCount++;
  console.error(`  [FAIL] ${name}:`, err.message);
}

// Criação de áudio WAV sintético para testes
async function createDummyAudio(targetPath, durationSec = 3) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `sine=frequency=1000:duration=${durationSec}`,
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      targetPath
    ], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  return targetPath;
}

// Criação de vídeo MP4 sintético para testes
async function createDummyVideo(targetPath, durationSec = 3) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc=duration=${durationSec}:size=320x240:rate=30`,
      '-f', 'lavfi',
      '-i', `sine=frequency=1000:duration=${durationSec}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      targetPath
    ], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  return targetPath;
}

async function runAllTests() {
  console.log('==================================================');
  console.log('INICIANDO SUÍTE FORMAL SCRIPT TIMING (FASE 4A.2)');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // Cenário A: Normalização de Texto em Português
  // ----------------------------------------------------
  try {
    const raw = 'Apartamento de R$ 480 mil, com 85m² e 100% reformado!';
    const norm = normalizeCurrencyAndNumbers(raw);
    assert(norm.includes('480 mil reais'), 'Deve expandir R$ 480 mil');
    assert(norm.includes('85 metros quadrados'), 'Deve expandir m²');
    assert(norm.includes('100 por cento'), 'Deve expandir %');

    const clean = removeDiacritics('Atenção, suíte incrível com varanda gourmet!');
    assert.strictEqual(clean, 'Atencao, suite incrivel com varanda gourmet!');
    reportPass('Cenário A — Normalização de Texto em Português');
  } catch (e) { reportFail('Cenário A', e); }

  // ----------------------------------------------------
  // Cenário B: Tokenização com Proveniência de Caracteres
  // ----------------------------------------------------
  try {
    const text = 'Venha conhecer este imóvel.';
    const { tokens, normalizedScript } = tokenizeScript(text);
    assert.strictEqual(tokens.length, 4, 'Deve conter 4 tokens');
    assert.strictEqual(tokens[0].clean_word, 'Venha');
    assert.strictEqual(tokens[0].normalized_word, 'venha');
    assert.strictEqual(tokens[3].clean_word, 'imóvel');
    assert.strictEqual(tokens[3].raw_word, 'imóvel.');
    assert.strictEqual(tokens[3].normalized_word, 'imovel');
    assert.strictEqual(tokens[3].start_char, 20);
    assert.strictEqual(normalizedScript, 'venha conhecer este imovel');
    reportPass('Cenário B — Tokenização com Proveniência de Caracteres');
  } catch (e) { reportFail('Cenário B', e); }

  // ----------------------------------------------------
  // Cenário C: Hash SHA-256 Determinístico do Roteiro
  // ----------------------------------------------------
  try {
    const s1 = 'Imóvel espetacular em Taubaté!';
    const s2 = 'Imóvel    espetacular   em Taubaté!   ';
    const s3 = 'Imovel espetacular em Taubate';
    const h1 = computeNormalizedScriptHash(s1);
    const h2 = computeNormalizedScriptHash(s2);
    const h3 = computeNormalizedScriptHash(s3);
    assert.strictEqual(h1, h2, 'Espaços extras não devem mudar hash normalizado');
    assert.strictEqual(h1, h3, 'Variações de acento não devem mudar hash normalizado');
    reportPass('Cenário C — Hash SHA-256 Determinístico do Roteiro');
  } catch (e) { reportFail('Cenário C', e); }

  // ----------------------------------------------------
  // Cenário D: Alignment Key Determinism
  // ----------------------------------------------------
  try {
    const params1 = {
      audio_physical_hash: 'a'.repeat(64),
      normalized_script_hash: 'b'.repeat(64),
      alignment_engine: 'whisper_word_timestamp',
      engine_version: '1.0.0',
      model_id: 'whisper-1',
      normalization_version: '1.0.0',
      schema_version: '1.0.0'
    };
    const k1 = computeAlignmentKey(params1);
    const k2 = computeAlignmentKey({ ...params1 });
    assert.strictEqual(k1, k2, 'Mesmos parâmetros devem gerar mesma key');

    const kDiff = computeAlignmentKey({ ...params1, model_id: 'whisper-large-v3' });
    assert.notStrictEqual(k1, kDiff, 'Model ID diferente deve gerar key diferente');
    reportPass('Cenário D — Alignment Key Determinism');
  } catch (e) { reportFail('Cenário D', e); }

  // ----------------------------------------------------
  // Cenário E: Beat Analysis Key Determinism
  // ----------------------------------------------------
  try {
    const params1 = {
      alignment_key: 'c'.repeat(64),
      beat_parser_version: '1.0.0',
      prompt_version: 'beat_v1',
      schema_version: '1.0.0'
    };
    const bk1 = computeBeatAnalysisKey(params1);
    const bk2 = computeBeatAnalysisKey({ ...params1 });
    assert.strictEqual(bk1, bk2, 'Mesmos parâmetros devem gerar mesma beat_analysis_key');

    const bkDiff = computeBeatAnalysisKey({ ...params1, beat_parser_version: '2.0.0' });
    assert.notStrictEqual(bk1, bkDiff, 'Versão do parser diferente deve gerar key diferente');
    reportPass('Cenário E — Beat Analysis Key Determinism');
  } catch (e) { reportFail('Cenário E', e); }

  // ----------------------------------------------------
  // Cenário F: Validação de Word Alignment — Casos Positivos
  // ----------------------------------------------------
  try {
    const word = {
      raw_word: 'Apartamento',
      start_ms: 100,
      end_ms: 600,
      confidence: 0.99
    };
    assert.strictEqual(validateWordAlignment(word, 1000), true);
    reportPass('Cenário F — Validação de Word Alignment (Casos Positivos)');
  } catch (e) { reportFail('Cenário F', e); }

  // ----------------------------------------------------
  // Cenário G: Validação de Word Alignment — Casos Negativos (Rejeição Estrita)
  // ----------------------------------------------------
  try {
    assert.throws(() => validateWordAlignment({ raw_word: 'teste', start_ms: -10, end_ms: 100 }), /start_ms/);
    assert.throws(() => validateWordAlignment({ raw_word: 'teste', start_ms: 500, end_ms: 400 }), /start_ms/);
    assert.throws(() => validateWordAlignment({ raw_word: '', start_ms: 0, end_ms: 100 }), /sem texto/);
    assert.throws(() => validateWordAlignment({ raw_word: 'teste', start_ms: 0, end_ms: 2000 }, 1000), /extrapola/);
    reportPass('Cenário G — Validação de Word Alignment (Casos Negativos)');
  } catch (e) { reportFail('Cenário G', e); }

  // ----------------------------------------------------
  // Cenário H: Validação de Semantic Beat — Casos Positivos
  // ----------------------------------------------------
  try {
    const beat = {
      beat_index: 0,
      text: 'Você ainda perde horas criando vídeos?',
      start_ms: 0,
      end_ms: 2500,
      duration_ms: 2500,
      word_indices: [0, 1, 2, 3, 4, 5]
    };
    assert.strictEqual(validateSemanticBeat(beat, 3000), true);
    reportPass('Cenário H — Validação de Semantic Beat (Casos Positivos)');
  } catch (e) { reportFail('Cenário H', e); }

  // ----------------------------------------------------
  // Cenário I: Validação de Semantic Beat — Casos Negativos
  // ----------------------------------------------------
  try {
    assert.throws(() => validateSemanticBeat({ beat_index: -1, text: 'abc', start_ms: 0, end_ms: 1000 }), /beat_index/);
    assert.throws(() => validateSemanticBeat({ beat_index: 0, text: '', start_ms: 0, end_ms: 1000 }), /sem texto/);
    assert.throws(() => validateSemanticBeat({ beat_index: 0, text: 'abc', start_ms: 1000, end_ms: 500 }), /start_ms/);
    assert.throws(() => validateSemanticBeat({ beat_index: 0, text: 'abc', start_ms: 0, end_ms: 500, word_indices: [] }), /sem lista/);
    reportPass('Cenário I — Validação de Semantic Beat (Casos Negativos)');
  } catch (e) { reportFail('Cenário I', e); }

  // ----------------------------------------------------
  // Cenário J: Mock Alignment Provider Determinístico
  // ----------------------------------------------------
  try {
    const provider = new MockScriptAlignmentProvider({ wpm: 120 });
    const words = await provider.alignScriptWithAudio({ scriptText: 'Casa moderna com piscina e área gourmet.' });
    assert(words.length === 7, 'Deve gerar 7 palavras alinhadas');
    assert(words[0].start_ms >= 0);
    assert(words[words.length - 1].end_ms > words[0].start_ms);
    for (let i = 1; i < words.length; i++) {
      assert(words[i].start_ms >= words[i - 1].end_ms, 'Palavras devem ser sequenciais no tempo');
    }
    reportPass('Cenário J — Mock Alignment Provider Determinístico');
  } catch (e) { reportFail('Cenário J', e); }

  // ----------------------------------------------------
  // Cenário K: OpenAI Whisper Provider — Validações e Erros de Ambiente
  // ----------------------------------------------------
  try {
    const badProvider = new OpenAIWhisperAlignmentProvider({ apiKey: '' });
    await assert.rejects(
      () => badProvider.alignScriptWithAudio({ audioPath: 'fake.wav', scriptText: 'teste' }),
      /OPENAI_API_KEY/
    );

    const goodKeyProvider = new OpenAIWhisperAlignmentProvider({ apiKey: 'sk-dummy' });
    await assert.rejects(
      () => goodKeyProvider.alignScriptWithAudio({ audioPath: 'non_existent_path.wav', scriptText: 'teste' }),
      /Arquivo de áudio não encontrado/
    );
    reportPass('Cenário K — OpenAI Whisper Provider (Validações e Tratamento de Erros)');
  } catch (e) { reportFail('Cenário K', e); }

  // ----------------------------------------------------
  // Cenário L: Reconciliação de Sequência (Needleman-Wunsch)
  // ----------------------------------------------------
  try {
    const scriptText = 'Conheça esta linda casa com 3 quartos em Taubaté.';
    const { tokens } = tokenizeScript(scriptText);
    const audioWords = [
      { word: 'Conheça', start_ms: 0, end_ms: 500 },
      { word: 'esta', start_ms: 510, end_ms: 800 },
      { word: 'linda', start_ms: 810, end_ms: 1200 },
      { word: 'casa', start_ms: 1210, end_ms: 1600 },
      { word: 'com', start_ms: 1610, end_ms: 1800 },
      { word: 'três', start_ms: 1810, end_ms: 2200 },
      { word: 'quartos', start_ms: 2210, end_ms: 2700 },
      { word: 'em', start_ms: 2710, end_ms: 2900 },
      { word: 'Taubaté', start_ms: 2910, end_ms: 3500 }
    ];
    const rec = reconcileScriptWithAlignedWords(tokens, audioWords);
    assert(rec.token_coverage >= 0.90, `Coverage deve ser >= 90%, obteve: ${rec.token_coverage}`);
    assert.strictEqual(rec.aligned_word_count, tokens.length);
    reportPass('Cenário L — Reconciliação de Sequência (Needleman-Wunsch)');
  } catch (e) { reportFail('Cenário L', e); }

  // ----------------------------------------------------
  // Cenário M: Cálculo de Token Coverage
  // ----------------------------------------------------
  try {
    const scriptText = 'Um dois três quatro cinco seis sete oito nove dez';
    const { tokens } = tokenizeScript(scriptText);
    const audioWords = [
      { word: 'Um', start_ms: 0, end_ms: 200 },
      { word: 'dois', start_ms: 210, end_ms: 400 },
      { word: 'três', start_ms: 410, end_ms: 600 },
      { word: 'quatro', start_ms: 610, end_ms: 800 },
      { word: 'cinco', start_ms: 810, end_ms: 1000 },
      { word: 'seis', start_ms: 1010, end_ms: 1200 },
      { word: 'sete', start_ms: 1210, end_ms: 1400 },
      { word: 'oito', start_ms: 1410, end_ms: 1600 },
      { word: 'nove', start_ms: 1610, end_ms: 1800 },
      { word: 'dez', start_ms: 1810, end_ms: 2000 }
    ];
    const rec = reconcileScriptWithAlignedWords(tokens, audioWords);
    assert.strictEqual(rec.token_coverage, 1.0, 'Coverage deve ser 100%');
    reportPass('Cenário M — Cálculo de Token Coverage');
  } catch (e) { reportFail('Cenário M', e); }

  // ----------------------------------------------------
  // Cenário N: Fail-Fast em Áudio Divergente do Roteiro (< 90%)
  // ----------------------------------------------------
  try {
    const scriptText = 'Apartamento duplex cinematográfico de alto padrão em Taubaté';
    const { tokens } = tokenizeScript(scriptText);
    const audioWords = [
      { word: 'Receita', start_ms: 0, end_ms: 500 },
      { word: 'de', start_ms: 510, end_ms: 700 },
      { word: 'bolo', start_ms: 710, end_ms: 1200 },
      { word: 'de', start_ms: 1210, end_ms: 1400 },
      { word: 'chocolate', start_ms: 1410, end_ms: 2000 }
    ];
    const rec = reconcileScriptWithAlignedWords(tokens, audioWords);
    assert(rec.token_coverage < 0.20, 'Coverage deve ser baixa em áudio totalmente divergente');
    reportPass('Cenário N — Detecção de Divergência Roteiro vs Áudio');
  } catch (e) { reportFail('Cenário N', e); }

  // ----------------------------------------------------
  // Cenário O: Invariante de Word Boundaries no Beat Parser
  // ----------------------------------------------------
  try {
    const words = [
      { raw_word: 'Você', start_ms: 100, end_ms: 600, confidence: 1 },
      { raw_word: 'gostou?', start_ms: 650, end_ms: 1200, confidence: 1 },
      { raw_word: 'Agende', start_ms: 1500, end_ms: 2000, confidence: 1 },
      { raw_word: 'sua', start_ms: 2050, end_ms: 2300, confidence: 1 },
      { raw_word: 'visita.', start_ms: 2350, end_ms: 2900, confidence: 1 }
    ];
    const beats = parseSemanticBeats(words);
    assert.strictEqual(beats.length, 2, 'Deve segmentar em 2 beats devido a pontuação ? e .');
    assert.strictEqual(beats[0].start_ms, 100, 'Início do beat 0 deve ser exato ao start_ms da 1ª palavra');
    assert.strictEqual(beats[0].end_ms, 1200, 'Fim do beat 0 deve ser exato ao end_ms da última palavra do beat');
    assert.strictEqual(beats[1].start_ms, 1500, 'Início do beat 1 deve ser exato ao start_ms da 1ª palavra do 2º beat');
    assert.strictEqual(beats[1].end_ms, 2900, 'Fim do beat 1 deve ser exato ao end_ms da última palavra do 2º beat');
    reportPass('Cenário O — Invariante de Word Boundaries no Beat Parser');
  } catch (e) { reportFail('Cenário O', e); }

  // ----------------------------------------------------
  // Cenário P: Segmentação de Cláusulas e Extração de Cue Keywords
  // ----------------------------------------------------
  try {
    const text = 'Sala ampla integrada com varanda gourmet e suíte principal.';
    const cues = extractCueKeywords(text);
    assert(cues.includes('living_room'), 'Deve identificar living_room para sala');
    assert(cues.includes('balcony'), 'Deve identificar balcony para varanda gourmet');
    assert(cues.includes('suite'), 'Deve identificar suite');
    reportPass('Cenário P — Segmentação de Cláusulas e Extração de Cue Keywords');
  } catch (e) { reportFail('Cenário P', e); }

  // ----------------------------------------------------
  // Cenário Q: Extração de Áudio de Vídeo MP4 via FFmpeg
  // ----------------------------------------------------
  const testJobIdQ = `job_test_q_${Date.now()}`;
  const videoQPath = path.join(JOBS_OUTPUTS_DIR, testJobIdQ, 'presenter.mp4');
  const targetAudioPath = path.join(JOBS_OUTPUTS_DIR, testJobIdQ, 'extracted.wav');

  try {
    await createDummyVideo(videoQPath, 2);
    await scriptTimingService.extractAudioFromVideo(videoQPath, targetAudioPath);
    assert(fs.existsSync(targetAudioPath), 'Arquivo WAV extraído deve existir fisicamente');
    const stats = fs.statSync(targetAudioPath);
    assert(stats.size > 1000, 'WAV extraído deve conter bytes de áudio');
    reportPass('Cenário Q — Extração de Áudio de Vídeo MP4 via FFmpeg');
  } catch (e) { reportFail('Cenário Q', e); }

  // ----------------------------------------------------
  // Cenário R: Persistência Atômica de Artefatos Shadow
  // ----------------------------------------------------
  const testJobIdR = `job_test_r_${Date.now()}`;
  const audioRPath = path.join(JOBS_OUTPUTS_DIR, testJobIdR, 'presenter.wav');
  const scriptR = 'Excelente casa com piscina e varanda gourmet à venda.';

  try {
    await createDummyAudio(audioRPath, 4);
    const mockProvider = new MockScriptAlignmentProvider();
    const result = await scriptTimingService.alignJobScript({
      jobId: testJobIdR,
      presenterAssetPath: audioRPath,
      scriptText: scriptR,
      options: { provider: mockProvider }
    });

    assert.strictEqual(result.status, 'READY');
    assert(fs.existsSync(result.alignment_path), 'alignment.json deve existir');
    assert(fs.existsSync(result.beats_path), 'beats.json deve existir');

    const alignJSON = JSON.parse(fs.readFileSync(result.alignment_path, 'utf8'));
    assert.strictEqual(alignJSON.job_id, testJobIdR);
    assert.strictEqual(alignJSON.alignment_key, result.alignment_key);
    assert(alignJSON.words.length > 0);

    const beatsJSON = JSON.parse(fs.readFileSync(result.beats_path, 'utf8'));
    assert.strictEqual(beatsJSON.beat_analysis_key, result.beat_analysis_key);
    assert(beatsJSON.beats.length > 0);
    reportPass('Cenário R — Persistência Atômica de Artefatos Shadow');
  } catch (e) { reportFail('Cenário R', e); }

  // ----------------------------------------------------
  // Cenário S: Cache Hit Imutável (Idempotência sem Re-execução)
  // ----------------------------------------------------
  try {
    let providerCalls = 0;
    class SpyingProvider extends MockScriptAlignmentProvider {
      async alignScriptWithAudio(params) {
        providerCalls++;
        return super.alignScriptWithAudio(params);
      }
    }

    const spyProvider = new SpyingProvider();
    const res1 = await scriptTimingService.alignJobScript({
      jobId: testJobIdR,
      presenterAssetPath: audioRPath,
      scriptText: scriptR,
      options: { provider: spyProvider }
    });

    assert.strictEqual(res1.from_cache, true, 'Segunda chamada deve vir do cache');
    assert.strictEqual(providerCalls, 0, 'Provider não deve ter sido executado no cache hit');
    reportPass('Cenário S — Cache Hit Imutável (Idempotência)');
  } catch (e) { reportFail('Cenário S', e); }

  // ----------------------------------------------------
  // Cenário T: Invalidação de Cache por Alteração de Roteiro
  // ----------------------------------------------------
  try {
    const scriptDiff = 'Outro roteiro completamente modificado para o mesmo áudio.';
    const mockProvider = new MockScriptAlignmentProvider();
    const resDiff = await scriptTimingService.alignJobScript({
      jobId: testJobIdR,
      presenterAssetPath: audioRPath,
      scriptText: scriptDiff,
      options: { provider: mockProvider }
    });

    assert.strictEqual(resDiff.from_cache, false, 'Novo roteiro não deve dar cache hit');
    reportPass('Cenário T — Invalidação de Cache por Alteração de Roteiro');
  } catch (e) { reportFail('Cenário T', e); }

  // ----------------------------------------------------
  // Cenário U: Invalidação de Cache por Alteração de Áudio
  // ----------------------------------------------------
  try {
    const audioUPath = path.join(JOBS_OUTPUTS_DIR, testJobIdR, 'presenter_diff.wav');
    await createDummyAudio(audioUPath, 6);
    const mockProvider = new MockScriptAlignmentProvider();
    const resAudioDiff = await scriptTimingService.alignJobScript({
      jobId: testJobIdR,
      presenterAssetPath: audioUPath,
      scriptText: scriptR,
      options: { provider: mockProvider }
    });

    assert.strictEqual(resAudioDiff.from_cache, false, 'Novo áudio não deve dar cache hit');
    assert.notStrictEqual(resAudioDiff.audio_physical_hash, (await scriptTimingService.alignJobScript({
      jobId: testJobIdR,
      presenterAssetPath: audioRPath,
      scriptText: scriptR,
      options: { provider: mockProvider }
    })).audio_physical_hash);
    reportPass('Cenário U — Invalidação de Cache por Alteração de Áudio');
  } catch (e) { reportFail('Cenário U', e); }

  // ----------------------------------------------------
  // Cenário V: Pipeline End-to-End com Mock Provider
  // ----------------------------------------------------
  const testJobIdV = `job_test_v_${Date.now()}`;
  const videoVPath = path.join(JOBS_OUTPUTS_DIR, testJobIdV, 'presenter_avatar.mp4');
  const scriptV = 'Descubra a casa dos seus sonhos com 3 suítes, piscina e área gourmet completa. Agende agora!';

  try {
    await createDummyVideo(videoVPath, 5);
    const mockProvider = new MockScriptAlignmentProvider();
    const resV = await scriptTimingService.alignJobScript({
      jobId: testJobIdV,
      presenterAssetPath: videoVPath,
      scriptText: scriptV,
      options: { provider: mockProvider }
    });

    assert.strictEqual(resV.status, 'READY');
    assert(resV.token_coverage >= 0.90);
    assert(resV.words.length >= 10);
    assert(resV.beats.length >= 2);
    reportPass('Cenário V — Pipeline End-to-End com Mock Provider');
  } catch (e) { reportFail('Cenário V', e); }

  // ----------------------------------------------------
  // Cenário W: Concorrência e Isolamento Físico de Escrita
  // ----------------------------------------------------
  const testJobIdW = `job_test_w_${Date.now()}`;
  const audioWPath = path.join(JOBS_OUTPUTS_DIR, testJobIdW, 'audio.wav');
  const scriptW = 'Teste de alta concorrência para script timing.';

  try {
    await createDummyAudio(audioWPath, 3);
    const mockProvider = new MockScriptAlignmentProvider();

    // Disparar 5 alinhamentos simultâneos para o mesmo Job
    const promises = Array.from({ length: 5 }, () =>
      scriptTimingService.alignJobScript({
        jobId: testJobIdW,
        presenterAssetPath: audioWPath,
        scriptText: scriptW,
        options: { provider: mockProvider }
      })
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.strictEqual(r.status, 'READY');
      assert(fs.existsSync(r.alignment_path));
      assert(fs.existsSync(r.beats_path));
    }
    reportPass('Cenário W — Concorrência e Isolamento Físico de Escrita');
  } catch (e) { reportFail('Cenário W', e); }

  // Cleanup de jobs temporários de teste
  try {
    for (const jid of [testJobIdQ, testJobIdR, testJobIdV, testJobIdW]) {
      const p = path.join(JOBS_OUTPUTS_DIR, jid);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {}

  console.log('\n==================================================');
  console.log(`RESULTADO DA SUÍTE: ${passCount} PASS / ${failCount} FAIL`);
  console.log('==================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('[FATAL ERROR IN TEST RUNNER]:', err);
  process.exit(1);
});
