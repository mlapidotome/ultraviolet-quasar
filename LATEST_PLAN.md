# Arquitetura e Plano de Implementação — Fase 3B
## Video Composer MVP (Timeline Engine Orientada a Creative Blueprint)

**Status:** Planejamento Arquitetural (PLAN ONLY)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 3A):** `8e2bf0306f557c595e8070628ee3e646a599d759`  
**Escopo:** Definição do primeiro motor de montagem determinístico orientado por Creative Blueprint (Fase 3B), em modo Shadow/Aditivo, sem implementação de código produtivo ou migrations nesta etapa.

---

## 1. Visão Geral e Objetivo da Fase 3B

Nas Fases 2B e 2C, a montagem dos vídeos da coleção criativa é realizada de forma procedural e imperativa no arquivo `pilot_service.js`:
$$\text{Hook Clip} + \text{Body Clip} \xrightarrow{\text{hardcoded concat}} \text{Vídeo Final}$$

Na Fase 3A, consolidamos a fundação de dados com o catálogo `video_assets` e a coluna `creative_blueprints JSONB`.

O objetivo da **Fase 3B** é construir o **Video Composer MVP**: uma camada determinística de renderização onde:
$$\text{Creative Blueprint} + \text{Asset Resolver} \xrightarrow{\text{Video Composer}} \text{MP4 Final Renderizado}$$

### Princípio Fundamental do Composer
O Composer **NÃO decide criativamente**; ele é um executor puro de uma receita declarativa.
A inteligência criativa (roteiros, IA, escolha de ganchos, avatares e estilos) dita o Blueprint. O Composer apenas interpreta a timeline declarativa, valida contratos, resolve os assets físicos e comanda o FFmpeg deterministicamente:
$$\text{AI / Creative Engine} \longrightarrow \text{Creative Blueprint} \longrightarrow \text{Video Composer} \longrightarrow \text{FFmpeg}$$

---

## 2. Diagnóstico da Arquitetura Atual & Desafios da Transição

1. **Proceduralidade Hardcoded:**
   - A função `concatenateVideos(hookPath, bodyPath, outputPath, jobDir)` no `pilot_service.js` assume estritamente dois arquivos locais hardcoded.
   - Não há interpretação de camadas, início/fim de segmentos ou validação de contratos estruturados.
2. **Durações Fictícias / Placeholders nos Blueprints Iniciais (Atenção Crítica):**
   - Na Fase 3A, os blueprints iniciais foram persistidos com durações conceituais aproximadas (ex: Gancho ~9500ms, Corpo ~38200ms).
   - **Regra Fundamental do Composer:** O Composer **NUNCA** deve cortar prematuramente nem truncar áudio/vídeo confiando cegamente em números conceituais de metadata. No MVP, a duração real de cada segmento sequencial deve ser extraída da mídia física inspecionada (`specs.duration` via `Asset Resolver`), a menos que cortes (`source_in_ms` / `source_out_ms`) sejam explicitamente definidos e validados contra os limites físicos do arquivo.
3. **Isolamento e Segurança Canônica:**
   - O Composer não pode montar caminhos de disco a partir de IDs arbitrários. Toda resolução de arquivos deve passar obrigatoriamente pelo `Asset Resolver` (`resolveAndValidateAsset()`), garantindo anti-symlink, anti-path-traversal e pertencimento físico ao diretório do Job (`outputs/jobs/<job_id>/`).

---

## 3. Arquitetura do Video Composer MVP

Propomos a criação do módulo desacoplado:
`video_engine/composer_service.js`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      video_engine/composer_service.js                    │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. validateBlueprintContract(blueprint)                                 │
│    - Schema version, dimensões, fps, camadas, ordem de timeline         │
│                                                                         │
│ 2. resolveTimelineAssets(jobId, timeline)                               │
│    - Asset Resolver, status ready, realpathSync, file_hash, specs       │
│                                                                         │
│ 3. buildExecutionPlan(blueprint, resolvedAssets)                        │
│    - Duração física real (specs.duration) vs layout sequencial         │
│    - Geração segura de argumentos FFmpeg (execFile)                     │
│                                                                         │
│ 4. renderTimelineFFmpeg(plan, tempOutputPath)                           │
│    - Execução assíncrona, arquivo temporário .tmp, timeout, stderr      │
│                                                                         │
│ 5. verifyAndPromoteOutput(tempOutputPath, finalOutputPath)              │
│    - ffprobe (duration > 0, >= 1 video, >= 1 audio, 1080x1920, 30fps)   │
│    - Rename atômico (fs.renameSync)                                     │
│                                                                         │
│ 6. registerRenderedAsset(jobId, creativeId, finalPath, specs)           │
│    - Registro do asset de saída em video_assets e blueprint            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Fluxo de Execução Passo a Passo

1. **Carga e Validação de Contrato:** Recebe `jobId` e `blueprint`. Valida se `schema_version === '1.0'`, formato 9:16 (1080x1920@30fps), timeline não-vazia e `layer === 0` (única camada suportada no MVP).
2. **Resolução de Assets (Asset Resolver):** Para cada `asset_id` presente na timeline:
   - Consulta o catálogo `video_assets`;
   - Exige `status === 'ready'`;
   - Valida existência física, tamanho > 0 e `file_hash`;
   - Valida que `fs.realpathSync(storage_path)` pertence estritamente a `outputs/jobs/<jobId>/`.
3. **Construção do Plano de Execução (Execution Plan):**
   - Extrai a duração física real de cada clip (`asset.specs.duration`).
   - Mapeia a timeline sequencial determinística:
     $$\text{Segmento 0 (Hook)}: [0 \to D_{\text{hook}}]$$
     $$\text{Segmento 1 (Body)}: [D_{\text{hook}} \to D_{\text{hook}} + D_{\text{body}}]$$
4. **Alocação de Arquivo Temporário Único:**
   - O output nunca é escrito diretamente no path final.
   - Gera path temporário isolado: `outputs/jobs/<jobId>/<targetFilename>.tmp.<uuid>.mp4`.
5. **Renderização via `execFile` (Sem Shell Injection):**
   - Tentativa 1: Concatenação direta por demuxer (`-f concat -safe 0 -c copy`) se os codecs e timebases forem 100% idênticos.
   - Tentativa 2 (Fallback Determinístico): Filtro complexo com padronização estrita de saída:
     ```bash
     ffmpeg -y -i <hookPath> -i <bodyPath> \
       -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" \
       -map "[outv]" -map "[outa]" \
       -c:v libx264 -pix_fmt yuv420p -r 30 -s 1080x1920 \
       -c:a aac -b:a 192k -ar 44100 \
       <tempOutputPath>
     ```
6. **Inspecção Pós-Render (`ffprobe`):**
   - Valida: `duration > 0`, stream de vídeo ativo, stream de áudio ativo, largura 1080, altura 1920.
7. **Promoção Atômica:**
   - `fs.renameSync(tempOutputPath, finalOutputPath)` substitui o arquivo final atomicamente.
   - Se ocorrer qualquer erro, o arquivo temporário é deletado no bloco `finally`, mantendo o arquivo final anterior intacto.
8. **Catalogação do Asset Renderizado:**
   - Registra ou atualiza o asset em `video_assets` com `asset_type = 'rendered_creative'`, `status = 'ready'`, `file_hash` SHA-256 e specs inspecionadas.

---

## 4. Contrato Formal do Blueprint para o Composer

```json
{
  "schema_version": "1.0",
  "creative_id": "crv_bbddf3ba_v1_b1",
  "job_id": "bbddf3ba-f7c6-44f5-a81a-2ac09dae611b",
  "blueprint_version": 1,
  "variant_index": 1,
  "format": {
    "aspect_ratio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "timeline": [
    {
      "segment_index": 1,
      "role": "hook",
      "asset_id": "ast_hk_bbddf3ba_01",
      "layer": 0,
      "source_in_ms": null,
      "source_out_ms": null
    },
    {
      "segment_index": 2,
      "role": "body",
      "asset_id": "ast_bd_bbddf3ba_01",
      "layer": 0,
      "source_in_ms": null,
      "source_out_ms": null
    }
  ],
  "composition_directives": {
    "transition": "cut",
    "audio_mix": {
      "speech_gain_db": 0.0
    }
  },
  "output_target": {
    "asset_id": "ast_out_pilot_bbddf3ba",
    "expected_filename": "pilot.mp4"
  }
}
```

### Validações Pré-FFmpeg (Fail-Fast)
O Composer rejeita a execução **antes de invocar qualquer comando no sistema operacional** se:
- O Blueprint for nulo ou `schema_version` diferente de `'1.0'`;
- O formato diferir de `9:16` (1080x1920, 30fps) no MVP;
- A timeline tiver segmentos com `layer != 0` (overlays só na Fase 3C);
- Qualquer `asset_id` não existir no catálogo ou não estiver com `status = 'ready'`;
- O arquivo físico do asset não residir dentro do diretório do Job (`outputs/jobs/<job_id>/`);
- O arquivo físico for symlink para fora ou tiver hash divergente;
- Houver parâmetros de trim inválidos (`source_in_ms >= source_out_ms` ou `source_out_ms > asset.duration_ms`).

---

## 5. Duração Real vs. Metadados do Blueprint

Para evitar cortes acidentais de fala no final dos vídeos:
1. **Regra de Omissão de Trims:** Quando `source_in_ms` e `source_out_ms` forem `null` ou ausentes, o Composer consome **100% da duração física** do arquivo indicada por `asset.specs.duration`.
2. **Projeção Dinâmica da Linha do Tempo:** A timeline de saída é calculada em runtime:
   $$\text{Start}(0) = 0, \quad \text{End}(0) = D_{\text{hook}}$$
   $$\text{Start}(1) = D_{\text{hook}}, \quad \text{End}(1) = D_{\text{hook}} + D_{\text{body}}$$
   $$\text{Duração Total Esperada} = D_{\text{hook}} + D_{\text{body}}$$
3. **Tolerância a Diferenças de Container:** No pós-render, a duração final do arquivo montado deve ser compatível com a soma das partes dentro de uma tolerância estrita de $\pm 150\text{ ms}$ (compensação padrão de codecs AAC/H.264).

---

## 6. Concorrência e Idempotência

### 6.1 Idempotência Estrita
Se o Composer for chamado para um `(jobId, creativeId, blueprint_version)` cujo asset de saída já existe:
1. Verifica se o asset em `video_assets` está com `status = 'ready'`;
2. Verifica se o arquivo físico existe no disco e possui tamanho > 0;
3. Verifica se `computeFileHash(storage_path) === asset.file_hash`;
4. Se todos os invariantes forem válidos, **retorna o asset imediatamente sem chamar o FFmpeg**.
5. Se o Blueprint tiver sido alterado para uma nova versão (`blueprint_version = 2`), gera um novo output versionado sem sobrescrever o anterior.

### 6.2 Controle de Concorrência
Para evitar que duas requisições simultâneas disparem duas renderizações concorrentes do mesmo criativo (desperdiçando CPU e criando race condition no arquivo temporário):
- Implementação de um **Mutex de Renderização por Creative** (`Map<string, Promise>` em memória) dentro do `composer_service.js`.
- Se uma segunda requisição solicitar a renderização do mesmo `creative_id` enquanto a primeira estiver em andamento, a segunda requisição **aguarda a resolução da Promise existente**, retornando o mesmo resultado sem reprocessamento.

---

## 7. Estratégia de Rollout Seguro: Shadow Composer

Para garantir **zero risco de quebra** na Fase 2C e manter 100% de disponibilidade em produção:

```
[Fluxo Homologado Fase 2C]
    Hook 1 + Body ──────> FFmpeg Concat Legado ──────> pilot.mp4 (Oficial)
                                                         │
                                                         ▼
                                                Servido no Painel
                                                         
[Shadow Composer Fase 3B (Paralelo / Fail-Open)]
    Creative Blueprint ─> Video Composer MVP ────────> composer_pilot.mp4 (Shadow)
                                                         │
                                                         ▼
                                                Validador Semântico
                                                (Compara Duração, Codecs,
                                                 Streams e Ordenação)
```

1. **Não-Interferência Total:** O pipeline atual (`pilot_service.js`) continua produzindo os arquivos oficiais (`pilot.mp4`, `video_2.mp4`, `video_3.mp4`) exatamente como homologado na Fase 2C.
2. **Execução em Shadow:** Em modo de teste/homologação, o `composer_service` é acionado para os mesmos Blueprints, gerando arquivos paralelos com prefixo `composer_*.mp4`.
3. **Validação de Equivalência Semântica:** A suíte automatizada compara o vídeo do Composer com o vídeo do concat legado:
   - Presença de stream de vídeo H.264 (1080x1920@30fps);
   - Presença de stream de áudio AAC;
   - Duração dentro da tolerância de $\pm 0.15\text{s}$;
   - Sequenciamento correto de áudio e vídeo;
4. **Critério Objetivo para Futuro Cutover:**
   A substituição do concat legado pelo Composer só será autorizada após 100% de equivalência comprovada em múltiplos jobs de teste no VPS, sem nenhuma regressão.

---

## 8. Preservação das Garantias das Fases Anteriores

- **Pilot First intacto:** Estados `PILOT_SUBMITTED`, `PILOT_READY`, `REMAINDER_SUBMITTED`, `CREATIVE_SET_READY` permanecem inalterados.
- **Smart Retry & Smart Resume intactos:** A lógica de retry granular e recuperação no boot de `pilot_service.js` continua ativa.
- **Segurança:** Bloqueio 403 estático em `/outputs/jobs/`, Basic Auth no painel, Bearer na API externa e validações anti-symlink (`realpathSync`) preservadas.
- **WhatsApp V1 intacto:** Adaptador legado permanece 100% operacional.

---

## 9. Respostas Objetivas às 12 Decisões Arquiteturais

1. **Qual será o módulo/arquitetura do Composer?**  
   Módulo dedicado `video_engine/composer_service.js`, operando como função pura `composeFromBlueprint({ jobId, blueprint, options })`.
2. **Como o Blueprint será validado?**  
   Validação estrita pré-FFmpeg via `validateBlueprintContract()` verificando schema version (`1.0`), formato (9:16, 1080x1920@30fps), timeline sequencial e layer única.
3. **Como assets serão resolvidos?**  
   Exclusivamente via `assetService.resolveAndValidateAsset()`, validando `status = 'ready'`, `file_hash`, existência física e contenção canônica dentro de `outputs/jobs/<jobId>/`.
4. **Como duração real será determinada?**  
   A partir de `video_assets.specs.duration` da mídia real inspecionada, ignorando placeholders de metadata. Trims só são aplicados se explicitamente definidos e validados.
5. **Como será gerado o comando FFmpeg?**  
   Usando `child_process.execFile` com array seguro de argumentos (sem shell injection), tentando concat demuxer com fallback automático para filter_complex padronizado.
6. **Como será garantido output atômico?**  
   Renderizando em arquivo isolado `<target>.tmp.<uuid>.mp4`, inspecionando streams/duração via `ffprobe` e promovendo via `fs.renameSync()`. Em caso de erro, o arquivo temporário é deletado no `finally`.
7. **Como idempotência funcionará?**  
   Se o asset de saída já estiver `ready` com arquivo íntegro no disco e mesmo `file_hash`, retorna o asset existente sem acionar o FFmpeg.
8. **Como concorrência será controlada?**  
   Mutex de renderização em memória por `jobId:creativeId`, serializando requisições simultâneas e retornando a mesma Promise compartilhada.
9. **Onde ficará o estado de render do Composer?**  
   Exclusivamente na tabela `video_assets` (status do asset renderizado: `processing`, `ready`, `failed`), sem poluir a máquina de estados principal `video_jobs.status`.
10. **Como preservar 100% da Fase 2C?**  
    O pipeline legado da Fase 2C continua gerando os 3 vídeos oficiais inalterados. O Composer opera inicialmente em modo Shadow aditivo.
11. **Shadow Composer será utilizado? Como?**  
    Sim. O Composer gera artefatos shadow paralelos (`composer_*.mp4`) para o mesmo Job, permitindo validação automatizada de equivalência sem tocar no vídeo servido ao cliente.
12. **Qual é o critério objetivo para futuramente substituir o concat legado pelo Composer?**  
    Aprovação de 100% dos testes da suíte de equivalência semântica (resolução, fps, duração $\pm 0.15$s, integridade de áudio/vídeo) e validação formal externa.

---

## 10. Suíte de Homologação Planejada para a Fase 3B (28 Cenários)

A implementação futura exigirá a aprovação de pelo menos 28 testes automatizados no VPS:

1. Blueprint válido Hook+Body renderiza com sucesso -> PASS
2. Ordem sequencial dos clips respeitada -> PASS
3. Asset inexistente rejeitado antes de invocar FFmpeg -> PASS
4. Asset não-ready rejeitado antes do FFmpeg -> PASS
5. Asset de outro Job rejeitado por violação de ownership físico -> PASS
6. Symlink externo rejeitado -> PASS
7. `file_hash` divergente (adulteração de bytes) rejeitado -> PASS
8. Blueprint vazio ou corrompido rejeitado -> PASS
9. `schema_version` não suportada rejeitada -> PASS
10. Camada não suportada (`layer > 0`) rejeitada no MVP -> PASS
11. Parâmetros de trim inválidos (`source_in >= source_out`) rejeitados -> PASS
12. Arquivo de saída contém stream de vídeo -> PASS
13. Arquivo de saída contém stream de áudio -> PASS
14. Duração de saída > 0 e equivalente à soma dos componentes -> PASS
15. Resolução de saída estritamente 1080x1920 -> PASS
16. Taxa de quadros de saída 30 fps -> PASS
17. Arquivo temporário `.tmp` deletado em caso de falha de renderização -> PASS
18. Arquivo final existente não corrompido em caso de erro no retry -> PASS
19. Chamada idempotente retorna asset pronto existente sem reprocessar -> PASS
20. Concorrência controlada impede dois renders simultâneos do mesmo criativo -> PASS
21. Shadow Composer gera arquivo paralelo sem alterar o vídeo oficial da 2C -> PASS
22. Comparação semântica entre Composer e concat legado demonstra equivalência -> PASS
23. Job showcase da Fase 2C permanece com os 3 vídeos intactos (HTTP 200) -> PASS
24. Smart Retry e Smart Resume da 2C preservados -> PASS
25. WhatsApp V1 permanece 100% íntegro -> PASS
26. Bloqueio estático 403 em `/outputs/jobs` mantido -> PASS
27. Endpoints da API V2 continuam protegidos por Basic Auth e Bearer -> PASS
28. PM2 `bali-gestor` e PostgreSQL saudáveis -> PASS

---

## 11. Roadmap Pós-Fase 3B

```
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3A (Homologada): Asset Model & Creative Blueprint Foundation      │
│ - Tabela video_assets, creative_blueprints, generation_key, file_hash  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3B (Atual Planejamento): Video Composer MVP (Timeline Engine)     │
│ - composer_service.js orientado a Blueprint declarativo                │
│ - Resolução de assets, render FFmpeg determinístico, modo Shadow       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3C: Editing Styles & Overlays Dinâmicos                           │
│ - Camadas adicionais (layer > 0): B-roll de fotos sobre o áudio do body│
│ - Legendas automáticas com destaque de palavras e ducking de áudio     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3D: Reutilização Controlada de Assets & Reference Library         │
│ - Ativação controlada de reuso de assets por generation_key            │
│ - Decomposição de anúncios campeões em blueprints de Video DNA         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3E: Creative Variations & Multi-Armed Combinatorics               │
│ - Geração combinatória de N variantes com custo de renderização mínimo │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3F: Creative IDs & Meta Ads Feedback Loop                         │
│ - Correlação analítica de Creative IDs com CPA/CTR no Facebook Ads API │
└────────────────────────────────────────────────────────────────────────┘
```

---

> [!IMPORTANT]
> **Status da Entrega:** Este plano representa exclusivamente o planejamento técnico e arquitetural da Fase 3B (**PLAN ONLY**). Nenhuma linha de código produtivo, migration, alteração no banco de dados ou deploy foi executada no VPS.
