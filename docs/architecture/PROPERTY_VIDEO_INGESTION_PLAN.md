# Plano de Arquitetura Hardened: Property Video Ingestion (CRM `link_video`)

Documento técnico de arquitetura para transformar URLs externas de vídeo do CRM (`link_video`) em **Property Video Assets** materializados, seguros, auditáveis e 100% reutilizáveis pelo `composer_v3` / Blueprint 1.2 da Bali Imóveis.

---

## 1. Contrato Exato de Ingestão & Ownership do Processo

Para eliminar race conditions, promises órfãs e chamadas fire-and-forget:

### 1.1 Contrato Determinístico da Função
```javascript
async function ensurePropertyVideo(propertyRef, options = { failOpen: true })
```

**Retornos Estritos e Inequívocos**:
- `{ status: 'READY', asset: <VideoAssetObject> }` — Vídeo ingerido, validado e disponível no disco.
- `{ status: 'NO_VIDEO', asset: null }` — Imóvel não possui `link_video` cadastrado no CRM.
- `{ status: 'FAILED', error: <String>, asset: null }` — Falha no download, timeout ou arquivo inválido.

### 1.2 Ownership do Ciclo de Vida
1. **Quem dispara**: `job_service.initializeVideoJob(params)`.
2. **Quem aguarda**: `initializeVideoJob` executa `await propertyMediaService.ensurePropertyVideo(property_ref, { failOpen: true })`.
3. **Propagação e Continuidade**:
   - Se `READY`: O asset de vídeo entra no pool de mídias do imóvel.
   - Se `NO_VIDEO` ou `FAILED`: Com `failOpen: true`, o Job continua deterministicamente gerando o snapshot e blueprints iniciais baseados exclusivamente nas **fotos reais do imóvel**, sem travar a operação.
   - O erro de ingestão é registrado no catálogo (`video_assets` com `status: 'failed'`) para auditoria.
4. **Proteção do Composer**: Se um Blueprint exigir explicitamente um `asset_id` de vídeo (`asset_type: 'video'`), o `composer_service` valida em tempo de execução se o asset está com `status: 'ready'` e se o arquivo físico existe no disco. Caso contrário, a renderização é rejeitada imediatamente (`FAIL-FAST`).

---

## 2. Claim Atômico Persistente & Stale Recovery (Schema Atual)

A autoridade de estado e concorrência reside 100% no PostgreSQL (`video_assets`), sem necessidade de migrations adicionais.

### 2.1 Algoritmo de Aquisição de Claim
$$\text{generation\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{\text{asset\_type}: \text{'property\_video'}, \text{property\_ref}, \text{provider}, \text{provider\_media\_id}, \text{canonical\_url}\}\big)\Big)$$

1. **Tentativa de Cache Hit**:
   ```sql
   SELECT * FROM video_assets WHERE generation_key = $1 AND property_ref = $2;
   ```
   Se existir com `status = 'ready'`:
   - Valida integridade física: `fs.existsSync(storage_path)` e `specs.file_hash`.
   - Se íntegro $\rightarrow$ Retorna o asset imediatamente ($O(1)$).
   - Se o arquivo físico foi apagado ou corrompido $\rightarrow$ Prossegue para re-materialização.

2. **Tentativa de Aquisição de Claim Atômico**:
   Para evitar race condition entre processos simultâneos, gera-se um ID canônico determinístico:
   `asset_id = 'ast_pvid_' || substr(generation_key, 1, 16)`
   
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
   - **Processo Ganhador** (recebeu a linha retornada): Obtém o direito exclusivo de download.
   - **Processos Concorrentes** (INSERT não retornou linha): Entram em polling ativo no DB (intervalos de 1s até timeout de 30s) aguardando o status transicionar para `ready` ou `failed`.

3. **Recuperação de Claim Stale (Crash Recovery)**:
   Se o processo ganhador morrer durante o download, o registro permanecerá com `status = 'processing'`.
   Qualquer processo subsequente detecta claim expirado (`updated_at < NOW() - INTERVAL '10 minutes'`) e recupera o claim atomicamente:
   ```sql
   UPDATE video_assets 
   SET status = 'processing', updated_at = NOW(), metadata = jsonb_set(metadata, '{stale_recovery}', 'true'::jsonb)
   WHERE id = $1 AND status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'
   RETURNING *;
   ```
   O processo que conseguir atualizar assume a materialização do arquivo.

---

## 3. Publicação Atômica do Arquivo (Zero EXDEV)

Para evitar erros de `EXDEV: cross-device link not permitted` causados por mounts/filesystems diferentes entre `/tmp` e `/var/www/...`:

1. **Diretório de Staging no Mesmo Filesystem**:
   - Destino Canônico: `/var/www/bali-gestor/outputs/properties/<property_ref>/videos/<asset_id>.mp4`
   - Staging Controlado: `/var/www/bali-gestor/outputs/properties/<property_ref>/videos/.tmp/ingest_<asset_id>_<uuid>.tmp`
2. **Ciclo de Vida da Materialização**:
   - Download grava diretamente em `.tmp/...`.
   - Validação física com `ffprobe` e magic bytes.
   - Cálculo do `file_hash` (SHA-256).
   - `fs.renameSync(stagingPath, finalPath)` (100% atômico no mesmo filesystem).
   - Atualização no PostgreSQL: `status = 'ready'`, `file_hash = $1`, `specs = $2`, `storage_path = $3`.
3. **Tratamento de Falhas e Crash Cleanup**:
   - Bloco `try / finally` garante `fs.unlinkSync(stagingPath)` caso ocorra qualquer erro antes do rename.
   - Arquivos temporários nunca recebem status `ready`.
   - Rotina de limpeza periódica de arquivos em `.tmp/` com mais de 1 hora.

---

## 4. Política Real de Output do Downloader (FFPROBE como Autoridade)

O sistema nunca presume que o downloader entregará um arquivo H.264/AAC perfeito apenas pelo parâmetro solicitado.

1. **Isolamento de Providers via Adapter**:
   - `PropertyMediaService` resolve o adapter via `resolveProvider(url)`.
   - O adapter (`YouTubeAdapter`) baixa os streams originais para o arquivo de staging.
2. **Autoridade = FFPROBE Físico**:
   - Executa `ffprobe -show_streams -show_format -of json <stagingFile>`.
   - Verifica obrigatoriamente a existência de pelo menos 1 stream de vídeo (`codec_type === 'video'`).
   - Se o container for `.webm` ou `.mkv`, ou se os codecs forem incompatíveis com o baseline padrão, executa um remux/transcode H.264/AAC determinístico e rápido via FFmpeg no próprio staging antes do hash final.
   - Se o vídeo não contiver faixa de áudio, registra `specs.audio_channels = 0` (o `composer_v3` com `broll_audio_policy: mute_all_broll` opera perfeitamente com ou sem áudio no b-roll).
   - Arquivo sem stream de vídeo é rejeitado imediatamente (`status: 'failed'`).

---

## 5. Identidade Lógica (`generation_key`) vs Identidade Física (`file_hash`)

- **`generation_key` (Identidade Lógica da Origem)**:
  Identifica deterministicamente a intenção de materializar aquela URL específica para aquele imóvel. Utilizada para lock de concorrência e deduplicação de download.
- **`file_hash` (Identidade Física dos Bytes)**:
  `SHA-256` dos bytes reais do arquivo no disco. Utilizada pelo Composer para garantir imutabilidade e integridade física de renderização (`render_key`).
- **Cache Hit Seguro**:
  Um asset só é reutilizado se `generation_key` corresponder, `status === 'ready'`, o arquivo existir no caminho `storage_path` contido dentro de `/var/www/bali-gestor/outputs/` e o tamanho/hash baterem com `specs`.

---

## 6. Alteração do `link_video` no CRM (Imutabilidade Histórica)

1. **Preservação de Jobs Antigos**:
   Se a REF 1628 possuía o vídeo $A$, o asset `ast_pvid_1628_A` permanece catalogado em `video_assets` com seus arquivos físicos preservados. Jobs históricos que referenciam $A$ continuam 100% reproduzíveis.
2. **Detecção de Mudança**:
   Quando o CRM atualizar o campo para a URL $B$, o cálculo da `generation_key` resultará em um hash diferente, gerando o asset `ast_pvid_1628_B`.
3. **Novos Jobs**:
   Passam a consumir o asset $B$, sem deletar ou corromper o asset $A$.

---

## 7. Configurações Operacionais (Env com Defaults Seguros)

Todos os limites operacionais são parametrizados via variáveis de ambiente com validação de tipo e fallback seguro:

| Variável de Ambiente | Default | Descrição |
| :--- | :--- | :--- |
| `PROPERTY_VIDEO_MAX_SIZE_MB` | `150` | Tamanho máximo permitido para download de vídeo de imóvel. |
| `PROPERTY_VIDEO_MAX_DURATION_SEC` | `300` | Duração máxima aceita (5 minutos). |
| `PROPERTY_VIDEO_DOWNLOAD_TIMEOUT_MS` | `60000` | Timeout máximo do processo de download (60s). |
| `PROPERTY_VIDEO_STALE_TIMEOUT_MINUTES` | `10` | Tempo para considerar um claim `processing` como stale. |

---

## 8. Property Media Pool & Blueprint 1.2

A função `getPropertyMediaPool(propertyRef)` retorna a coleção validada de mídias do imóvel:

```javascript
{
  property_ref: "1628",
  photos: [ /* ast_crm_photo_1639_1, ... */ ],
  videos: [
    {
      asset_id: "ast_pvid_1628_fa583eee00",
      asset_type: "property_video",
      role: "property_footage",
      storage_path: "/var/www/bali-gestor/outputs/properties/1628/videos/ast_pvid_1628_fa583eee00.mp4",
      duration_ms: 51000,
      specs: { width: 478, height: 850, fps: 30, codec_video: "h264", file_size_bytes: 6116378 },
      file_hash: "ab9f57fe..."
    }
  ]
}
```

### 8.1 Zero Criação de Clipes Físicos Derivados
O vídeo físico original é mantido íntegro. O Blueprint 1.2 define recortes lógicos através de `source_in_ms` e `source_out_ms` apontando para o mesmo `asset_id`.

---

## 9. Suíte de Testes Automatizados (22 Cenários Formais: A a V)

- **A.** REF sem `link_video` $\rightarrow$ Comportamento normal, sem erro, apenas fotos registradas.
- **B.** REF com YouTube Short válido $\rightarrow$ Materialização, validação física e registro `ready`.
- **C.** Mesma REF + mesmo `link_video` novamente $\rightarrow$ Reutiliza asset em cache $O(1)$ sem novo download.
- **D.** REF muda `link_video` $\rightarrow$ Nova `generation_key` produz novo asset isolado.
- **E.** URL de domínio não homologado $\rightarrow$ Rejeição imediata por whitelist.
- **F.** Tentativa de SSRF / IPs privados / `file://` $\rightarrow$ Bloqueio imediato.
- **G.** Download interrompido $\rightarrow$ Staging limpo, nenhum asset inválido recebe `ready`.
- **H.** Arquivo retornado não é vídeo $\rightarrow$ Rejeitado no MIME/magic bytes.
- **I.** Arquivo excede limites operacionais $\rightarrow$ Rejeitado por tamanho/duração máxima.
- **J.** `ffprobe` inválido / streams corrompidos $\rightarrow$ Rejeição imediata com status `failed`.
- **K.** Hash físico divergente $\rightarrow$ Invalidação de cache e recuperação segura.
- **L.** Dois processos tentando ingerir o mesmo vídeo simultaneamente $\rightarrow$ Apenas 1 materializa; segundo aguarda e reutiliza.
- **M.** Composer utiliza trechos com `source_in_ms`/`source_out_ms` $\rightarrow$ Duração física exata dos cortes.
- **N.** Áudio do property video $\rightarrow$ Mutado conforme política `broll_audio_policy: mute_all_broll`.
- **O.** Zero regressão $\rightarrow$ Suítes 1.0, 1.1 e 3C.2 continuam 100% PASS.
- **P.** Processo morre após adquirir claim $\rightarrow$ Recuperação segura de claim stale pós-timeout.
- **Q.** Crash após materializar arquivo mas antes de registrar READY $\rightarrow$ Recuperação atômica sem corrupção.
- **R.** Staging e destination no mesmo filesystem $\rightarrow$ Rename atômico sem dependência cross-device.
- **S.** Downloader produz container inesperado $\rightarrow$ Identificação e remux pelo FFmpeg antes do hash final.
- **T.** Linha SQL está READY mas arquivo físico sumiu $\rightarrow$ Detecção de ausência física e re-materialização.
- **U.** Blueprint referencia `property_video` não READY $\rightarrow$ Rejeição imediata antes do render.
- **V.** REF sem vídeo / falha de ingestão com `failOpen: true` $\rightarrow$ Job continua normalmente com fotos sem background race.

---

## 10. Showcase Futuro Previsto

Após implementação autorizada, o showcase técnico será executado com a **REF 1628** (*Edifício Wide*), inspecionando previamente os timestamps físicos dos cômodos para compor:
- Apresentador Fullscreen (0-2s)
- B-Roll Vídeo Real Corte 1 (Sala / Varanda)
- Foto Real com Ken Burns
- B-Roll Vídeo Real Corte 2 (Cozinha / Área Íntima) + Presenter PIP
- Foto com Tag de Localização
- B-Roll Vídeo Real Corte 3 (Vista Panorâmica) + Banner CTA

---

## 11. Confirmações de Isolamento e Não-Execução

- [x] **NENHUMA implementação de código foi realizada nesta rodada.**
- [x] **NENHUMA migration foi criada (schema atual é 100% suficiente).**
- [x] **NENHUMA dependência foi instalada em produção.**
- [x] **NENHUMA fase futura (Diretor Criativo / 3C.3) foi iniciada.**
