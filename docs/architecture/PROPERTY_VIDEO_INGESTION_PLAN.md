# Plano de Arquitetura Hardened: Property Video Ingestion (CRM `link_video`)

Documento técnico de arquitetura para transformar URLs externas de vídeo do CRM (`link_video`) em **Property Video Assets** materializados, seguros, auditáveis e 100% reutilizáveis pelo `composer_v3` / Blueprint 1.2 da Bali Imóveis.

---

## 1. Contrato Exato de Ingestão & Ownership do Processo

Para eliminar race conditions, promises órfãs e chamadas fire-and-forget:

### 1.1 Contrato Determinístico da Função
```javascript
async function ensurePropertyVideo(propertyRef, options = { failOpen: true, timeoutMs: 30000 })
```

**Retornos Estritos e Inequívocos**:
- `{ status: 'READY', asset: <VideoAssetObject> }` — Vídeo ingerido, validado fisicamente e disponível no disco.
- `{ status: 'NO_VIDEO', asset: null }` — Imóvel não possui `link_video` cadastrado no CRM ou URL vazia.
- `{ status: 'INGESTION_IN_PROGRESS', asset: null }` — Outro processo está materializando o vídeo e o tempo limite de polling expirou sem stale claim.
- `{ status: 'FAILED', error: <String>, asset: null }` — Falha irrecuperável no download, validação ou arquivo inválido.

### 1.2 Ownership do Ciclo de Vida
1. **Quem dispara**: `job_service.initializeVideoJob(params)`.
2. **Quem aguarda**: `initializeVideoJob` executa `await propertyMediaService.ensurePropertyVideo(property_ref, { failOpen: true })`.
3. **Propagação e Continuidade**:
   - Se `READY`: O asset de vídeo entra no pool de mídias do imóvel (`PropertyMediaPool`).
   - Se `NO_VIDEO`, `INGESTION_IN_PROGRESS` ou `FAILED`: Com `failOpen: true`, o Job continua deterministicamente gerando o snapshot e blueprints iniciais baseados exclusivamente nas **fotos reais do imóvel**, sem travar a operação do usuário.
   - Erros definitivos de ingestão são registrados no catálogo (`video_assets` com `status: 'failed'`) para auditoria.
4. **Proteção do Composer**: Se um Blueprint exigir explicitamente um `asset_id` de vídeo (`asset_type: 'video'`), o `composer_service` valida em tempo de execução se o asset está com `status: 'ready'` e se o arquivo físico existe no disco e bate com `file_hash`. Caso contrário, a renderização é rejeitada imediatamente (`FAIL-FAST`).

---

## 2. Claim Atômico Persistente & Stale Recovery (Schema Atual)

A autoridade de estado e concorrência reside 100% no PostgreSQL (`video_assets`), sem necessidade de migrations adicionais ou tabelas auxiliares.

### 2.1 Identificador Canônico Determinístico (`asset_id`)
Para garantir que a cláusula `ON CONFLICT (id)` funcione como um mutex atômico universal mesmo entre processos concorrentes com instâncias e memórias isoladas:

$$\text{generation\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{\text{asset\_type}: \text{'property\_video'}, \text{property\_ref}, \text{provider}, \text{provider\_media\_id}, \text{canonical\_url}\}\big)\Big)$$

$$\text{asset\_id} = \text{"ast\_pvid\_"} + \text{SHA-256}\big(\text{property\_ref} + \text{":"} + \text{generation\_key}\big)\text{.slice}(0, 32)$$

- **Comprimento Total**: $9 + 32 = 41 \text{ caracteres} \le 64 \text{ caracteres}$ (`VARCHAR(64)` da coluna `id` na tabela `video_assets`).
- **Determinismo**: Processos concorrentes calculam exatamente o **mesmo `asset_id`** e o **mesmo `generation_key`** para a mesma URL/imóvel.

### 2.2 Algoritmo de Aquisição de Claim

1. **Tentativa de Cache Hit**:
   ```sql
   SELECT * FROM video_assets WHERE generation_key = $1 AND property_ref = $2;
   ```
   Se existir linha com `status = 'ready'`:
   - Executa a política estrita de validação de cache hit (ver Seção 3).
   - Se válida $\rightarrow$ Retorna `{ status: 'READY', asset }`.
   - Se arquivo ausente ou corrompido $\rightarrow$ Invalida status para `failed` e prossegue para re-materialização.

2. **Tentativa de Inserção com Mutex Atômico**:
   ```sql
   INSERT INTO video_assets (
     id, property_ref, asset_type, storage_type, status, generation_key,
     provider_ref, remote_url, metadata, created_at, updated_at
   ) VALUES (
     $1, $2, 'property_video', 'local_file', 'processing', $3,
     $4, $5, $6, NOW(), NOW()
   )
   ON CONFLICT (id) DO NOTHING
   RETURNING *;
   ```
   - **Processo Ganhador** (recebeu a linha retornada): Obtém o direito exclusivo de materializar o vídeo.
   - **Processos Concorrentes** (receberam 0 linhas retornadas): Bloqueados de baixar; entram em polling ativo no DB.

3. **Polling Ativo & Política de Timeout Sem Roubo de Claim Ativo**:
   - Processos concorrentes executam polling em intervalos de 1s:
     ```sql
     SELECT * FROM video_assets WHERE id = $1;
     ```
   - Se transicionar para `ready`: Retorna o asset pronto.
   - Se transicionar para `failed`: Retorna falha / fallback fotos.
   - Se atingir o timeout de polling (30s) e o processo ganhador ainda estiver processando ativamente (`updated_at > NOW() - INTERVAL '10 minutes'`):
     - **O Processo B NÃO rouba o claim de A**.
     - O Processo B encerra seu polling e retorna `{ status: 'INGESTION_IN_PROGRESS', asset: null }`.
     - O claim de A permanece íntegro e continua seu download.

4. **Recuperação de Claim Stale (Crash Recovery)**:
   Se o processo ganhador morrer durante o download (Node crash / SIGKILL), o registro permanecerá `processing`.
   Qualquer processo subsequente detecta claim expirado (`updated_at < NOW() - INTERVAL '10 minutes'`) e assume o claim atomicamente:
   ```sql
   UPDATE video_assets 
   SET status = 'processing', updated_at = NOW(), metadata = jsonb_set(metadata, '{stale_recovery}', 'true'::jsonb)
   WHERE id = $1 AND status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'
   RETURNING *;
   ```
   Apenas o processo que conseguir atualizar a linha assume a re-materialização.

---

## 3. Política Rigorosa de Cache Hit (Validação Física $O(N)$)

A integridade do cache não é presumida por consulta ao banco de dados; ela requer validação física determinística dos bytes reais no disco:

### 3.1 Critérios Obrigatórios de Validação
Um asset em cache só é considerado válido (`READY`) se **todos** os seguintes requisitos forem satisfeitos:
1. `generation_key` bate com a canonical URL e `property_ref`.
2. `property_ref` bate com o imóvel do job.
3. `asset_type = 'property_video'` e `status = 'ready'`.
4. `storage_path` está contido dentro do diretório seguro:
   `/var/www/bali-gestor/outputs/properties/<property_ref>/videos/` (proteção contra path traversal).
5. O arquivo físico existe no filesystem (`fs.existsSync(storage_path)`).
6. **Validação de Hash Físico ($O(N)$)**: O hash SHA-256 calculado sobre todos os bytes do arquivo físico no disco coincide exatamente com o `file_hash` registrado na tabela `video_assets`.
7. `specs.duration > 0` e `specs.width > 0`.

### 3.2 Tratamento de Corrupção ou Arquivo Físico Removido
Se a linha no PostgreSQL estiver com `status = 'ready'`, mas o arquivo físico for inexistente no disco ou o hash SHA-256 for divergente:
- O cache hit é **rejeitado**.
- O registro é marcado como `status = 'failed'`, `metadata.error = 'PHYSICAL_FILE_CORRUPTED_OR_MISSING'`.
- O sistema tenta nova materialização via claim atômico ou faz fallback seguro para fotos se `failOpen: true`.

---

## 4. Publicação Atômica do Arquivo (Zero EXDEV)

Para garantir que o Composer nunca leia um arquivo em gravação parcial e evitar falhas de `EXDEV: cross-device link not permitted` causadas por partições diferentes entre `/tmp` e `/var/www/...`:

1. **Diretório de Staging no Mesmo Filesystem**:
   - Destino Canônico: `/var/www/bali-gestor/outputs/properties/<property_ref>/videos/<asset_id>.<ext>`
   - Staging Controlado: `/var/www/bali-gestor/outputs/properties/<property_ref>/videos/.tmp/ingest_<asset_id>_<uuid>.tmp`
2. **Ciclo de Vida da Materialização**:
   - Download grava os streams diretamente no arquivo `.tmp/...`.
   - Validação física com `ffprobe` (magic bytes, streams de vídeo).
   - Cálculo do `file_hash` (SHA-256 via stream).
   - Extração de specs reais (`width`, `height`, `duration`, `fps`, `codec_video`, `codec_audio`).
   - `fs.renameSync(stagingPath, finalPath)` (operação atômica garantida no mesmo filesystem).
   - Atualização no PostgreSQL: `status = 'ready'`, `file_hash = $1`, `specs = $2`, `storage_path = $3`, `updated_at = NOW()`.
3. **Tratamento de Falhas e Cleanup**:
   - Bloco `try / finally` garante `fs.unlinkSync(stagingPath)` em caso de qualquer exceção antes do rename.
   - Rotina periódica limpa arquivos residuais em `.tmp/` com mais de 1 hora.

---

## 5. Política de Storage & Codecs: Source Original Preservado

### 5.1 Preservação do Source Asset Original
- **Princípio**: O vídeo baixado é a matéria-prima (Source Asset). Ele é salvo em seu container e codecs originais de melhor qualidade entregues pelo provedor (ex: `.mp4` com H.264 ou `.webm` com VP9/Opus).
- **Sem Recompressão Destrutiva na Ingestão**: Não transcodificamos o vídeo na ingestão para evitar perda de qualidade geracional e consumo desnecessário de CPU/tempo.
- **Normalização no Composer v3**: O pipeline de renderização do `composer_v3` (via libavfilter / FFmpeg graph) já decodifica e normaliza nativamente múltiplos formatos e codecs (H.264, VP9, WebM, MP4) para a saída final 1080x1920 @ 30fps H.264/AAC.

### 5.2 Distinção Clara: Remux vs Transcode
- **Remux (Stream Copy / Container Repackaging)**:
  - Mudança de empacotamento de container (ex: de `.mkv` para `.mp4`) utilizando `-c:v copy -c:a copy`.
  - Os bitstreams de vídeo e áudio **não são decodificados nem re-encodados**.
  - Operação ultrarrápida ($O(N)$ em I/O), sem perda de qualidade visual.
  - Utilizado apenas quando o container de origem for incompatível com leitura direta mas os codecs internos já forem compatíveis.
- **Transcode (Re-encoding)**:
  - Decodificação completa dos quadros de vídeo para YUV e re-encoding através de encoder (ex: `libx264`).
  - Custo computacional elevado e potencial perda de qualidade por recompressão.
  - **Não executado no estágio de ingestão**. Fica restrito à renderização final do Composer.

---

## 6. Autoridade do FFPROBE Físico

O sistema nunca presume metadados ou compatibilidade com base na extensão ou headers HTTP:

1. **Inspeção Física Obrigatória**:
   - Executa `ffprobe -show_streams -show_format -of json <stagingFile>`.
   - Valida obrigatoriamente a existência de pelo menos 1 stream de vídeo (`codec_type === 'video'`).
   - Se o arquivo for apenas áudio ou imagem estática renomeada $\rightarrow$ Rejeita com `status: 'failed'`.
2. **Tratamento de Áudio**:
   - Se o vídeo original não contiver stream de áudio, registra `specs.audio_channels = 0`.
   - O `composer_v3` opera perfeitamente com ou sem áudio de b-roll, aplicando `broll_audio_policy: mute_all_broll`.

---

## 7. Identidade Lógica (`generation_key`) vs Identidade Física (`file_hash`)

- **`generation_key` (Identidade Lógica da Origem)**:
  Identifica deterministicamente a intenção de materializar aquela URL específica para aquele imóvel. Utilizada para lock de concorrência e deduplicação de download.
- **`file_hash` (Identidade Física dos Bytes)**:
  `SHA-256` dos bytes reais do arquivo no disco. Utilizada pelo Composer para garantir imutabilidade e integridade física de renderização (`render_key`).
- **Segurança de Reutilização**:
  Um asset só é reutilizado se `generation_key` corresponder, `status === 'ready'`, o arquivo existir no caminho `storage_path` contido dentro de `/var/www/bali-gestor/outputs/` e o hash SHA-256 for idêntico ao `file_hash`.

---

## 8. Alteração do `link_video` no CRM (Imutabilidade Histórica)

1. **Preservação de Jobs Antigos**:
   Se a REF 1628 possuía o vídeo $A$, o asset `ast_pvid_1628_A` permanece catalogado em `video_assets` com seus arquivos físicos preservados. Jobs históricos que referenciam $A$ continuam 100% reproduzíveis.
2. **Detecção de Mudança**:
   Quando o CRM atualizar o campo para a URL $B$, o cálculo da `generation_key` resultará em um hash diferente, gerando o asset `ast_pvid_1628_B`.
3. **Novos Jobs**:
   Passam a consumir o asset $B$, sem deletar ou corromper o asset $A$.

---

## 9. Configurações Operacionais (Env com Defaults Seguros)

Todos os limites operacionais são parametrizados via variáveis de ambiente com validação de tipo e fallback seguro:

| Variável de Ambiente | Default | Descrição |
| :--- | :--- | :--- |
| `PROPERTY_VIDEO_MAX_SIZE_MB` | `150` | Tamanho máximo permitido para download de vídeo de imóvel. |
| `PROPERTY_VIDEO_MAX_DURATION_SEC` | `300` | Duração máxima aceita (5 minutos). |
| `PROPERTY_VIDEO_DOWNLOAD_TIMEOUT_MS` | `60000` | Timeout máximo do processo de download (60s). |
| `PROPERTY_VIDEO_POLL_TIMEOUT_MS` | `30000` | Timeout máximo de polling para processos concorrentes (30s). |
| `PROPERTY_VIDEO_STALE_TIMEOUT_MINUTES` | `10` | Tempo para considerar um claim `processing` como stale. |

---

## 10. Property Media Pool & Blueprint 1.2

A função `getPropertyMediaPool(propertyRef)` retorna a coleção validada de mídias do imóvel:

```javascript
{
  property_ref: "1628",
  photos: [ /* ast_crm_photo_1639_1, ... */ ],
  videos: [
    {
      asset_id: "ast_pvid_1628_fa583eee00112233445566778899aabb",
      asset_type: "property_video",
      role: "property_footage",
      storage_path: "/var/www/bali-gestor/outputs/properties/1628/videos/ast_pvid_1628_fa583eee00112233445566778899aabb.mp4",
      duration_ms: 51000,
      specs: { width: 478, height: 850, fps: 30, codec_video: "h264", file_size_bytes: 6116378 },
      file_hash: "ab9f57fe7788..."
    }
  ]
}
```

### 10.1 Zero Criação de Clipes Físicos Derivados
O vídeo físico original é mantido íntegro. O Blueprint 1.2 define recortes lógicos através de `source_in_ms` e `source_out_ms` apontando para o mesmo `asset_id`.

---

## 11. Suíte de Testes Automatizados (22 Cenários Formais: A a V)

- **A.** REF sem `link_video` $\rightarrow$ Retorno `NO_VIDEO`, comportamento normal, apenas fotos registradas.
- **B.** REF com YouTube Short válido $\rightarrow$ Materialização, validação física $O(N)$, extração de specs e registro `ready`.
- **C.** Mesma REF + mesmo `link_video` novamente $\rightarrow$ Reutiliza asset em cache com validação física SHA-256 sem novo download.
- **D.** REF muda `link_video` $\rightarrow$ Nova `generation_key` produz novo asset isolado sem afetar o anterior.
- **E.** URL de domínio não homologado $\rightarrow$ Rejeição imediata por whitelist de provedores.
- **F.** Tentativa de SSRF / IPs privados / `file://` $\rightarrow$ Bloqueio imediato na validação da URL.
- **G.** Download interrompido $\rightarrow$ Staging limpo, nenhum asset inválido recebe `ready`.
- **H.** Arquivo retornado não é vídeo $\rightarrow$ Rejeitado no MIME/magic bytes e ffprobe.
- **I.** Arquivo excede limites operacionais $\rightarrow$ Rejeitado por tamanho ou duração máxima.
- **J.** `ffprobe` inválido / streams corrompidos $\rightarrow$ Rejeição imediata com status `failed`.
- **K.** Hash físico divergente $\rightarrow$ Invalidação de cache e recuperação segura.
- **L.** Dois processos tentando ingerir o mesmo vídeo simultaneamente $\rightarrow$ Apenas 1 adquire o claim com `asset_id` determinístico; segundo aguarda via polling.
- **M.** Composer utiliza trechos com `source_in_ms`/`source_out_ms` $\rightarrow$ Duração física exata dos recortes lógicos.
- **N.** Áudio do property video $\rightarrow$ Mutado conforme política `broll_audio_policy: mute_all_broll`.
- **O.** Zero regressão $\rightarrow$ Suítes 1.0, 1.1 e 3C.2 continuam 100% PASS.
- **P.** Processo morre após adquirir claim $\rightarrow$ Recuperação segura de claim stale pós-timeout (10 min).
- **Q.** Crash após materializar arquivo mas antes de registrar READY $\rightarrow$ Recuperação atômica sem corrupção.
- **R.** Staging e destination no mesmo filesystem $\rightarrow$ Rename atômico sem dependência cross-device (Zero EXDEV).
- **S.** Downloader produz container alternativo (ex: WebM) $\rightarrow$ Source original preservado; Composer decodifica nativamente.
- **T.** Linha SQL está READY mas arquivo físico sumiu $\rightarrow$ Detecção de ausência física e re-materialização.
- **U.** Blueprint referencia `property_video` não READY $\rightarrow$ Rejeição imediata antes do render (Fail-Fast).
- **V.** REF sem vídeo / falha de ingestão com `failOpen: true` $\rightarrow$ Job continua normalmente com fotos sem background race.

---

## 12. Confirmações de Isolamento e Não-Execução

- [x] **NENHUMA implementação de código foi realizada nesta rodada.**
- [x] **NENHUMA migration foi criada (schema atual é 100% suficiente com asset_id determinístico).**
- [x] **NENHUMA dependência foi instalada em produção.**
- [x] **NENHUMA fase futura (Diretor Criativo / 3C.3) foi iniciada.**
