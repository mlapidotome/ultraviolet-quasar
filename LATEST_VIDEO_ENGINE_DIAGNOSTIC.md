# Diagnóstico Técnico Completo: Sistema de Geração Automática de Vídeos Imobiliários (Bali Imóveis)

---

## 1. ARQUITETURA ATUAL

O sistema opera atualmente sob um modelo **orientado a eventos de mensageria**, em que a interface de controle do usuário é o próprio WhatsApp (conversa consigo mesmo no WhatsApp Web), orquestrado por um processo único em Node.js gerenciado pelo PM2 no servidor VPS.

### Fluxograma Textual Ponta a Ponta

```
[ Usuário / Marcel no WhatsApp ]
   │
   │ 1. Envia "#1639" ou link do imóvel
   ▼
[ multi_corretor_whatsapp_service.js ]
   │ client.on('message_create')
   │ Filtros: fromMe=true, isolamento contra grupos (@g.us), self-chat
   ▼
[ video_anuncios_engine.js : handleIncomingMessage() ]
   │
   │ 2. Consulta de Dados
   ├──► fetchImovelData('1639')
   │      ├── [API Externa ImobTotal] GET /api/v1/imoveis/1639 (timeout 10s)
   │      └── (Fallback) [Disco Local] /data/banco_imoveis_carteira.json
   │
   │ 3. Roteirização e Cálculos
   ├──► generateCompleteScripts(imovel)
   │      ├── Cálculo financeiro (MCMV / SBPE: Entrada, Parcela Price, Renda Mínima)
   │      ├── Montagem de 3 Ganchos (10s) com Looks variados (Terno, Podcaster, Casual)
   │      └── Montagem de 1 Desenvolvimento (30s com CTA)
   │
   │ 4. Resposta Inicial
   ├──► client.sendMessage(targetChat, roteiro + opções de comando)
   │      Armazena na memória RAM: activeVideoSessions['marcel']
   │
   │ 5. Usuário envia "CLONE"
   ▼
[ video_anuncios_engine.js : Bloco CLONE (Fluxo Piloto Primeiro) ]
   │
   │ 6. Renderização do Desenvolvimento (Corpo)
   ├──► renderHeyGenVideo(lookBody, textoBody, null, fotoImovel, 'circle')
   │      ├── POST https://api.heygen.com/v2/video/generate
   │      │     (Payload 1080x1920, Avatar em círculo no rodapé, Foto ao fundo, Voz Clonada)
   │      ├── Polling de Status: GET /v1/video_status.get (intervalo 8s, até 90 retries = 12 min)
   │      └── downloadToFile(bodyUrl, '/outputs/body_1639_<timestamp>.mp4')
   │
   │ 7. Renderização do Gancho 1 (Piloto)
   ├──► renderHeyGenVideo(lookHook1, textoHook1, null, null, 'normal')
   │      ├── POST https://api.heygen.com/v2/video/generate
   │      ├── Polling de Status HeyGen
   │      └── downloadToFile(hookUrl, '/outputs/hook_1_1639_<timestamp>.mp4')
   │
   │ 8. Concatenação de Mídia
   ├──► concatenateVideos(hookPath, bodyPath, finalVideoPath)
   │      ├── Cria lista temporária /outputs/concat_list_<timestamp>.txt
   │      ├── Executa ffmpeg -c copy (demuxer concat) via execSync
   │      └── (Fallback se codecs divergirem) Re-encode via -filter_complex concat
   │
   │ 9. Entrega do Piloto
   ├──► MessageMedia.fromFilePath(finalVideoPath)
   ├──► client.sendMessage(targetChat, media, { caption: "Vídeo 1 Piloto..." })
   └──► Atualiza estado: session.waitingApproval = true
   │
   │ 10. Usuário envia "OK" / "GERAR RESTANTE"
   ▼
[ video_anuncios_engine.js : Bloco APROVAÇÃO ]
   │
   │ 11. Renderização dos Ganchos 2 e 3
   ├──► Para cada hook restante (Gancho 2 e Gancho 3):
   │      ├── HeyGen renderiza Gancho individual (com os respectivos Looks)
   │      ├── Download do Gancho gerado
   │      ├── FFmpeg concatena Gancho N + Desenvolvimento (reaproveitando o body já em disco)
   │      └── Envio imediato do MP4 correspondente no WhatsApp com legenda
   │
   │ 12. Finalização
   ├──► client.sendMessage(targetChat, "🎉 Todos os 3 vídeos entregues!")
   └──► delete activeVideoSessions['marcel']
```

---

## 2. ESTRUTURA DE ARQUIVOS

| Arquivo / Diretório | Responsabilidade Atual |
| :--- | :--- |
| `/var/www/bali-gestor/video_anuncios_engine.js` | **Núcleo monolítico do gerador de vídeos.** Concentra: parser de comandos do WhatsApp, integração ImobTotal, regras matemáticas de financiamento, geração de roteiros, chamadas à API da HeyGen (render e polling), upload para Cloudflare R2, execução do FFmpeg e orquestração da máquina de estados em memória. |
| `/var/www/bali-gestor/multi_corretor_whatsapp_service.js` | **Gerenciador de sessões WhatsApp Web (Puppeteer).** Gerencia as instâncias do `whatsapp-web.js` para múltiplos corretores, executa autenticação/QR Code, gerencia reconexões e intercepta o evento `message_create` para repassar mensagens de `marcel_teste` ao `video_anuncios_engine.js`. |
| `/var/www/bali-gestor/gestor_server.js` | **Servidor HTTP Express (Porta 3005).** Expõe painéis de monitoramento de leads, rotas de status dos corretores, capturas de tela (screenshots) e endpoints auxiliares de envio (`/api/marcel/send-self`, `/api/marcel/send-pilot-now`). |
| `/var/www/bali-gestor/data/banco_imoveis_carteira.json` | **Base de dados local em arquivo JSON.** Utilizada como fallback estático quando a API do ImobTotal falha ou o imóvel não é retornado pelo endpoint online. |
| `/var/www/bali-gestor/outputs/` | **Diretório de armazenamento local.** Recebe os downloads brutos dos ganchos (`hook_*.mp4`), do corpo (`body_*.mp4`), das listas de concatenação (`concat_list_*.txt`) e dos vídeos finais montados (`Anuncio_Completo_*.mp4`). |
| `/var/www/bali-gestor/gestor_chat.js` | **Módulo do Copiloto Executivo (Google Gemini).** Acionado quando o usuário envia comandos iniciados por `?` no WhatsApp. |
| `/var/www/bali-gestor/.wwebjs_auth/` | **Armazenamento de sessão do WhatsApp Web.** Mantém tokens, LocalStorage e IndexedDB do Chromium persistidos para o Puppeteer. |

---

## 3. ESTADOS

### Onde os estados são armazenados?
* Os estados são armazenados exclusivamente na **memória RAM do processo Node.js**, através do objeto JavaScript global `const activeVideoSessions = {};` declarado no topo de `video_anuncios_engine.js`.

### Sobrevivem a restart do Node/PM2?
* **Não nativamente.** Se o processo for reiniciado (`pm2 restart`), o objeto `activeVideoSessions` é zerado.
* **Recuperação Heurística Parcial:** Foi implementada uma salvaguarda em código que inspeciona o sistema de arquivos: caso o estado em memória seja perdido após o envio do piloto, o comando de aprovação (`OK` / `GERAR RESTANTE`) faz uma busca em `/outputs/` por arquivos com o padrão `body_1639_*.mp4` e tenta reconstruir a referência do imóvel para não precisar re-renderizar o desenvolvimento. No entanto, não há persistência formal em banco de dados ou Redis.

### Como são associados ao usuário / imóvel?
* A chave do mapa de sessões é **estática e fixa**: `const sessionKey = 'marcel'`.
* Não existe particionamento por número de telefone de múltiplos corretores no motor de vídeo atual; qualquer mensagem de comando recebida sob a sessão `marcel_teste` concorre sobre a mesma chave `'marcel'`.

### Quais estados existem atualmente?

1. **`IDLE` (Inexistente no dicionário)**: Nenhuma geração em andamento para a chave.
2. **`waitingAudios: true`**: Imóvel consultado; roteiro montado; o sistema aguarda a decisão do usuário entre gravar os 4 áudios reais ou disparar `CLONE`.
3. **`audiosReceived: [...]`**: Lista contendo as URLs no Cloudflare R2 dos áudios recebidos via WhatsApp (de 1 a 4).
4. **`rendering (implícito)`**: Loop síncrono/assíncrono executando chamadas HTTP para HeyGen e comandos FFmpeg (sem bloqueio de concorrência formal).
5. **`waitingApproval: true`**: O Vídeo 1 (Piloto) foi gerado e entregue; a sessão mantém `imovelRef`, `scripts` e o caminho do `bodyPath` local aguardando os comandos `OK` ou `GERAR RESTANTE`.

---

## 4. PIPELINE DE PRODUÇÃO

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ A. Busca     │────►│ B. Cálculo   │────►│ C. Roteiro   │────►│ D. HeyGen    │
│ Imóvel       │     │ Financeiro   │     │ (Ganchos)    │     │ Generate     │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                      │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│ H. WhatsApp  │◄────│ G. FFmpeg    │◄────│ F. R2 Upload │◄───────────┘
│ Delivery     │     │ Concatenação │     │ (se áudio)   │     E. Polling &
└──────────────┘     └──────────────┘     └──────────────┘        Download
```

### A. Busca do Imóvel
* **Entrada**: String contendo dígitos ou formato `#1639`.
* **Processamento**: Sanitização regex (`/\D/g`); requisição HTTP `GET https://app.imobtotal.com.br/api/v1/imoveis/${ref}` com header de autenticação e timeout de 10 segundos. Se houver falha, realiza busca linear em `/data/banco_imoveis_carteira.json`.
* **Saída**: Objeto JSON com dados cadastrais do imóvel (preço, bairro, quartos, suítes, metragem, array de fotos).

### B. Cálculo Financeiro
* **Entrada**: Objeto do imóvel com valor venal (`valor_venda` / `preco`).
* **Processamento**: Regras de crédito imobiliário baseadas em faixas de preço:
  * Valor <= R$ 200.000: Entrada 10%, Coeficiente 0.0055.
  * Valor <= R$ 350.000: Entrada 15%, Coeficiente 0.0070.
  * Valor > R$ 350.000: Entrada 20%, Coeficiente 0.0090, Comprometimento de renda 3.3x.
* **Saída**: Dicionário com `valorVenda`, `entrada`, `parcelaEstimada`, `rendaMinima`.

### C. Geração do Roteiro
* **Entrada**: Dados do imóvel e cálculos financeiros.
* **Processamento**: Formatação de valores numéricos para linguagem falada por extenso (ex: R$ 450.000 vira *"450 mil reais"*); injeção em 4 templates pré-definidos:
  * Gancho 1 (Choque / Entrada - Look Terno);
  * Gancho 2 (Aluguel vs Parcela - Look Podcaster);
  * Gancho 3 (Renda Familiar - Look Casual);
  * Desenvolvimento (Descritivo técnico + Bairro + CTA de agendamento).
* **Saída**: Objeto estruturado com arrays de roteiro, IDs dos avatares associados e textos formatados.

### D. Geração HeyGen
* **Entrada**: `lookId`, `text`, `audioUrl` (opcional), `bgImageUrl` (opcional), `avatarStyle` (`normal` ou `circle`).
* **Processamento**: Montagem do payload JSON para a API HeyGen v2 (`dimensions: 1080x1920`).
  * No modo `circle` (desenvolvimento), aplica `scale: 0.9` e `offset: { x: 0.0, y: 0.35 }` com a foto do imóvel no plano de fundo.
  * No modo `CLONE`, injeta o `voice_id` correspondente ao clone vocal com `speed: 1.05`.
  * Realiza `POST https://api.heygen.com/v2/video/generate` (timeout de 30s).
* **Saída**: String com o identificador único da renderização: `video_id`.

### E. Polling / Download do HeyGen
* **Entrada**: `video_id` gerado na etapa anterior.
* **Processamento**:
  * Loop de até 90 iterações com pausa assíncrona de 8 segundos (`sleep(8000)`), totalizando até 12 minutos de tolerância.
  * Consulta `GET https://api.heygen.com/v1/video_status.get?video_id=${videoId}` (timeout de 20s).
  * Ao detectar status `completed`, extrai o `video_url` (CDN HeyGen/AWS).
  * Executa streaming HTTP via Axios (`responseType: 'stream'`) direto para arquivo no disco local (`outputs/`).
* **Saída**: Caminho absoluto do arquivo `.mp4` no sistema de arquivos local (`/outputs/body_*.mp4` ou `/outputs/hook_*.mp4`).

### F. Armazenamento R2 (Cloudflare)
* **Entrada**: Buffer binário de áudio e nome do arquivo de destino.
* **Processamento**: Execução do comando `PutObjectCommand` do SDK `@aws-sdk/client-s3` apontando para o endpoint S3 do Cloudflare R2 com `ContentType: audio/mp4`.
* **Saída**: URL pública HTTPS permanente do áudio hospedado no bucket R2 (usado no modo de voz real para alimentar a HeyGen).

### G. FFmpeg (Montagem e Concatenação)
* **Entrada**: Caminho do Gancho (`hookFilePath`), caminho do Desenvolvimento (`bodyFilePath`) e destino final (`outputFilePath`).
* **Processamento**:
  * Gera um arquivo de manifesto temporário `concat_list_<timestamp>.txt`.
  * **Tentativa 1 (Demuxer rápido sem reprocessamento)**:
    `ffmpeg -y -f concat -safe 0 -i list.txt -c copy output.mp4` via `execSync`.
  * **Tentativa 2 (Fallback com re-encode total)**:
    Se os codecs ou resoluções divergirem e o passo 1 falhar, dispara o filtro de composição:
    `ffmpeg -y -i hook.mp4 -i body.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" output.mp4`.
  * Remove o arquivo manifesto de texto.
* **Saída**: Arquivo final concatenado em `/outputs/Anuncio_Completo_<N>_Imovel_<REF>.mp4`.

### H. Entrega pelo WhatsApp
* **Entrada**: Caminho do arquivo final montado (`outputFilePath`) e texto de legenda formatado.
* **Processamento**: Leitura do arquivo em Base64 através de `MessageMedia.fromFilePath(finalVideoPath)` e disparo via Puppeteer usando `client.sendMessage(targetChat, media, { caption })`.
* **Saída**: Mensagem de mídia com o vídeo recebida pelo usuário no aplicativo do WhatsApp.

---

## 5. TRATAMENTO DE ERROS

| Ponto de Falha Potencial | Tratamento Atual | Existe Retry? | Timeout Configurado? | Pode Travar o Pipeline? | Risco de Perda de Trabalho? | Risco de Duplicidade? |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **API ImobTotal fora do ar / indisponível** | Bloco `try/catch` que redireciona a consulta para o arquivo local `banco_imoveis_carteira.json`. | Não | Sim (10s) | Não | Não | Baixo |
| **Download de Áudio no WhatsApp Web** | Loop de 6 tentativas com intervalo de 2s capturando exceções do `downloadMedia()`. | Sim (6x) | Não explícito | Sim (trava a esteira de áudio real) | Sim (descarta áudio se falhar 6x) | Médio |
| **API HeyGen: POST /v2/video/generate** | Bloco `try/catch` que interrompe a execução e envia mensagem de erro textual no WhatsApp. | Não | Sim (30s) | Sim (aborta a geração) | Sim (crédito não debitado se rejeitado) | Baixo |
| **API HeyGen: Polling / Status Check** | Loop de 90 tentativas com `timeout: 20000` por requisição; se retornar `failed`, lança exceção. | Sim (90x a cada 8s) | Sim (20s por requisição / 12min total) | Sim (bloqueia o fluxo até atingir 12 min) | **Alto** (se falhar após 10 min, consome o crédito na HeyGen sem entregar o vídeo) | Não |
| **Download do MP4 da HeyGen para o Disco** | Stream Axios encapsulado em Promise; rejeição capturada pelo `catch` global. | Não | Não (timeout indefinido no stream) | Sim (se o download congelar) | Sim (vídeo gerado na HeyGen é perdido localmente) | Não |
| **FFmpeg: Concatenação via Demuxer** | Bloco `try/catch` com fallback imediato para re-encode total via `-filter_complex`. | Sim (1 fallback) | Não | Sim (se ambos falharem, dispara erro) | Não (os arquivos parciais continuam em `/outputs/`) | Não |
| **Envio do Vídeo pelo WhatsApp Web** | Chamada direta a `client.sendMessage()`; se o Chrome/Puppeteer falhar, lança exceção para o catch. | Não | Não | Sim (interrompe o lote) | Não (o vídeo continua gerado e salvo no disco do servidor) | **Alto** (o usuário pode reenviar comando e gerar tudo de novo) |

---

## 6. DEPENDÊNCIAS ENTRE ETAPAS

### 1. Se o FFmpeg falhar, a HeyGen precisa ser gerada novamente?
* **Não.** Os arquivos individuais (`hook_*.mp4` e `body_*.mp4`) já foram baixados e persistem no diretório `/outputs/`. A montagem pode ser reexecutada localmente via FFmpeg a qualquer momento sem realizar novas chamadas à API da HeyGen.

### 2. Se o WhatsApp falhar ao enviar o vídeo, o vídeo continua disponível?
* **Sim.** O arquivo MP4 completo permanece gravado com caminho determinístico (ex: `/outputs/Anuncio_Completo_1_Imovel_1639.mp4`). Ele pode ser inspecionado, baixado via SCP/SFTP ou reenviado por rota interna da API sem novo processamento.

### 3. Se o PM2 reiniciar durante uma renderização, o job consegue continuar?
* **Não.** Como o pipeline é executado em memória através de Promises assíncronas atreladas ao ciclo de vida do processo, se o PM2 reiniciar durante o polling da HeyGen ou durante a concatenação:
  * A Promise é destruída;
  * O estado em memória é apagado;
  * O HeyGen concluirá o vídeo nos servidores deles, mas o servidor local perderá o ponteiro (`video_id`) e não fará o download nem a montagem;
  * O crédito na HeyGen será debitado sem conclusão da entrega.

---

## 7. ARQUIVOS E ASSETS

| Categoria do Asset | Localização Física Atual | Política de Limpeza / Exclusão | Diagnóstico de Risco |
| :--- | :--- | :--- | :--- |
| **Fotos dos Imóveis** | URLs remotas do CDN do ImobTotal (`fotos2.fra1.cdn.digitaloceanspaces.com`). Não são salvas localmente; a URL é passada diretamente para o payload da HeyGen. | Gerenciado pelo CDN externo. | Nulo no servidor local. |
| **Áudios Gravados (Voz Real)** | Bucket Cloudflare R2 (`bali-cards/audios-anuncios/`) e memória transitória do Node.js. | **Nenhuma limpeza configurada.** Os áudios enviados acumulam indefinidamente no R2. | Acúmulo silencioso de dados no bucket R2 ao longo do tempo. |
| **Vídeos Brutos da HeyGen** | Servidores da HeyGen (remoto) e baixados para `/var/www/bali-gestor/outputs/`. | A HeyGen retém conforme a política deles. No servidor local, **nunca são excluídos**. | **Acúmulo progressivo de disco** no VPS Linux. |
| **Vídeos Intermediários (Ganchos / Body)** | `/var/www/bali-gestor/outputs/hook_*.mp4` e `/outputs/body_*.mp4`. | **Nunca são excluídos.** | Ocupam de 2 MB a 8 MB por arquivo a cada geração. |
| **Vídeos Finais Montados** | `/var/www/bali-gestor/outputs/Anuncio_Completo_*.mp4`. | **Nunca são excluídos.** São mantidos sobrescrevendo o mesmo nome caso a referência seja idêntica. | Ocupam cerca de 5 MB a 15 MB por vídeo. |
| **Arquivos Temporários de Concatenação** | `/var/www/bali-gestor/outputs/concat_list_*.txt`. | Removidos pelo código apenas quando o comando FFmpeg é bem-sucedido (`fs.unlinkSync`). Se o comando falhar antes de atingir a limpeza, o arquivo `.txt` permanece no disco. | Baixo impacto em bytes, mas poluição visual de diretório. |

---

## 8. SEGREDOS E CONFIGURAÇÕES

O sistema adota uma estratégia mista de leitura: verifica se a variável existe em `process.env` e, caso não encontre, recorre a valores padrão (*fallbacks*) definidos estaticamente no código-fonte.

* **API Key da HeyGen**:
  * Variável de ambiente: `process.env.HEYGEN_API_KEY`
  * Local de carregamento: Declaração no topo de `video_anuncios_engine.js`.
* **API Key do ImobTotal**:
  * Variável de ambiente: `process.env.IMOBTOTAL_API_KEY`
  * Local de carregamento: Declaração no topo de `video_anuncios_engine.js`.
* **Identificadores de Looks & Avatares da HeyGen**:
  * Constantes estruturadas: `MARCEL_LOOKS` e `MARCEL_BODY_LOOK`
  * Local de carregamento: Codificados de forma estática (*hardcoded*) no topo de `video_anuncios_engine.js`.
* **ID do Clone de Voz da HeyGen**:
  * Constante: `MARCEL_VOICE_CLONE_ID`
  * Local de carregamento: Codificado de forma estática no topo de `video_anuncios_engine.js`.
* **Credenciais do Cloudflare R2**:
  * Variáveis de ambiente: `process.env.S3_REGION`, `process.env.S3_ENDPOINT`, `process.env.S3_ACCESS_KEY_ID`, `process.env.S3_SECRET_ACCESS_KEY`, `process.env.S3_BUCKET`, `process.env.S3_PUBLIC_PREFIX`
  * Local de carregamento: Inicialização do `S3Client` em `video_anuncios_engine.js`.
* **Configurações de Sessão e Credenciais do WhatsApp**:
  * Sistema de arquivos: Diretório local persistido `.wwebjs_auth/session-broker_marcel_teste/` gerenciado pelo pacote `whatsapp-web.js`.

---

## 9. PRINCIPAIS FRAGILIDADES

### [CRÍTICO] Ausência de Fila Assíncrona e Persistência de Jobs (Single Point of Failure)
* **Por que é Crítico**: Toda a esteira de renderização (que pode durar de 3 a 15 minutos) depende da sobrevivência do processo em memória RAM. Qualquer reinício não programado, atualização de código via PM2 ou crash de processo cancela a geração em andamento, desperdiçando créditos da API HeyGen e deixando o usuário sem resposta.

### [CRÍTICO] Concorrência e Sessão Única (`sessionKey = 'marcel'`)
* **Por que é Crítico**: O estado está atrelado a uma chave estática única. Se o usuário digitar outro código enquanto uma renderização está acontecendo, os dados da sessão anterior são sobrescritos em memória, causando comportamento imprevisível ou entrega de vídeos trocados.

### [ALTO] Fallbacks de Segredos Sensíveis Codificados Diretamente no Código
* **Por que é Alto**: As chaves de API da HeyGen, ImobTotal e credenciais mestre de escrita no Cloudflare R2 estão presentes como strings literais nos arquivos JavaScript da aplicação, tornando o repositório vulnerável caso seja compartilhado ou versionado publicamente.

### [ALTO] Inexistência de Garbage Collector / Limpeza de Disco no Servidor
* **Por que é Alto**: Cada geração produz entre 3 e 6 arquivos MP4 (vídeos brutos intermediários + vídeo final). Com o uso diário, o disco da VPS (DigitalOcean Droplet) se esgotará progressivamente, o que pode paralisar o sistema operacional e derrubar todos os serviços do servidor.

### [MÉDIO] Dependência de `execSync` para o FFmpeg
* **Por que é Médio**: A execução do FFmpeg é feita via `child_process.execSync`. Trata-se de uma chamada bloqueante para a *Event Loop* do Node.js. Enquanto o FFmpeg re-codifica um vídeo de 40 segundos, a API Express e o listener do WhatsApp podem ficar temporariamente lentos ou perder pacotes de websocket.

### [MÉDIO] Polling Síncrono Bloqueante da HeyGen sem Webhook
* **Por que é Médio**: O sistema realiza dezenas de requisições sequenciais a cada 8 segundos para consultar o status. Se a HeyGen suportar webhooks de notificação de conclusão, o consumo de banda e a complexidade do loop poderiam ser eliminados.

### [BAIXO] Tratamento Frágil na Extração de Nome de Bairro / Condomínio
* **Por que é Baixo**: A detecção do condomínio depende de expressões regulares pontuais (`/(?:condom[íi]nio|residencial...)/i`). Se o título do imóvel estiver cadastrado de forma não convencional no CRM, o texto narrado pode apresentar pequenas incoerências gramaticais, embora não quebre a execução do vídeo.

---

## 10. DÍVIDA TÉCNICA

O arquivo `video_anuncios_engine.js` (com mais de 750 linhas) tornou-se um **God Module** que acumula responsabilidades demais:

1. **Camada de Transporte e Parser de Mensagens**: Avalia strings de chat, comandos regex (`#1639`, `LOOKS`, `CLONE`, `OK`), quarentena de grupos e interações com o usuário.
2. **Camada de Integração de Dados (CRM)**: Contém lógica de consumo de API REST externa e leitura de arquivo JSON local.
3. **Camada de Regras de Negócio e Financiamento**: Regras de crédito imobiliário, coeficientes de financiamento Price e formatação de moeda falada.
4. **Camada de Copywriting / Roteirização**: Templates de marketing, copywriting de ganchos e corpo hardcoded dentro de funções utilitárias.
5. **Camada de Integração com IA e Cloud**: Chamadas de baixo nível para HeyGen, controle de polling manual e uploads via AWS S3 SDK.
6. **Camada de Edição e Processamento de Mídia**: Orquestração de comandos shell do FFmpeg, manipulação de streams e escrita no sistema de arquivos.

---

## 11. O QUE JÁ ESTÁ BOM

Componentes e lógicas que foram bem estruturados e que devem ser integralmente aproveitados ou encapsulados na V2:

* **Matemática de Financiamento e Conversão Falada**: A função de conversão de valores numéricos para linguagem coloquial falada (`formatExtenso`) e as regras escalonadas de entrada e parcela funcionam com alta precisão e naturalidade.
* **Estratégia de Composição Visual Picture-in-Picture**: A configuração do avatar HeyGen em estilo circular (`avatarStyle: 'circle'`, `scale: 0.9`, `offset: { x: 0.0, y: 0.35 }`) sobreposto à foto em tela cheia do imóvel provou ser viável e com excelente estética comercial.
* **Fallback Inteligente de Concatenação do FFmpeg**: O mecanismo em duas etapas — tentar primeiro a junção instantânea sem perda via *demuxer* (`-c copy`) e, caso haja divergência de codec/taxa de quadros, aplicar o fallback para `-filter_complex` — é robusto e garante que o vídeo sempre seja entregue.
* **Regra de Negócio "Piloto Primeiro"**: A estratégia de gerar o Gancho 1 + Desenvolvimento primeiro, aguardar a aprovação do usuário e só depois renderizar os outros dois ganchos é essencial para otimização de custos e retenção de créditos de IA.
* **Blindagem de Segurança do WhatsApp**: O filtro rígido de mensagens que descarta solenemente qualquer menção em grupos (`@g.us`) e restringe comandos exclusivamente ao próprio usuário é um mecanismo de isolamento indispensável.

---

## 12. RECOMENDAÇÃO PARA A V2

Para transformar esse MVP funcional em uma plataforma escalável, profissional e com alta confiabilidade operacional, a V2 deverá ser desacoplada nos seguintes módulos:

```
┌─────────────────────────────────────────────────────────────┐
│                       INTERFACE WEB                         │
│       (Painel Principal / Cockpit de Controle de Vídeos)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    API GATEWAY / CONTROLLERS                │
│    ├── Rotas Web (Painel)                                   │
│    └── Rotas WhatsApp (Interface Secundária / Gatilhos)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  FILA DE JOBS (BULLMQ / REDIS)              │
│       Gerenciamento de Fila, Estados Persistidos e Retries   │
└──────┬───────────────────────┬───────────────────────┬──────┘
       │                       │                       │
┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
│   CREATIVE  │         │   AI VIDEO  │         │ MEDIA ENGINE│
│    ENGINE   │         │  CONNECTOR  │         │   (FFmpeg)  │
│ (Copy/Data) │         │  (HeyGen)   │         │ (Composição)│
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                  QUALITY CONTROL (QC) AUTOMÁTICO            │
│        Verificação de Áudio, Dimensões e Validação          │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│            STORAGE (R2) + NOTIFICAÇÃO (WHATSAPP / WEB)       │
└─────────────────────────────────────────────────────────────┘
```

### Proposta de Módulos Independentes

1. **Core / State Machine & Job Queue (BullMQ + Redis)**:
   - Toda solicitação de geração vira um `Job` persistente com ID único (`UUID`), histórico e estados formais: `QUEUED`, `SCRIPTS_GENERATED`, `HOOK_RENDERING`, `BODY_RENDERING`, `ASSEMBLING`, `PILOT_READY`, `APPROVED`, `COMPLETED`, `FAILED`.
   - Reinícios do servidor não cancelam o job: ao subir, o worker retoma a etapa onde parou.

2. **Creative Engine (Roteirização & Blueprints)**:
   - Módulo isolado de inteligência imobiliária.
   - Responsável por ler o imóvel, rodar as regras financeiras e carregar os *Video Blueprints* (estruturas narrativas com Hooks, Bodies e CTAs parametrizáveis e reutilizáveis).

3. **HeyGen Provider & AI Gateway**:
   - Módulo responsável apenas pela comunicação com a API de geração de vídeo e polling/webhooks, isolando payloads e configurações de avatares/vozes.

4. **Media Processing Engine (FFmpeg Service)**:
   - Worker assíncrono (não bloqueante) para processamento de vídeo, normalização de áudio, inclusão de legendas dinâmicas, aplicação de trilha sonora em volume reduzido e composição de layouts.

5. **Quality Control (QC) Automático**:
   - Etapa de validação antes da entrega: verifica se o arquivo resultante possui duração correta, se o áudio não está mudo e se a resolução 1080x1920 foi mantida.

6. **Interface Principal (Painel Web Cockpit) + Interface Secundária (WhatsApp)**:
   - O Painel Web torna-se o local mestre para visualizar o histórico de vídeos, aprovar pilotos, alterar fotos de fundo, trocar ganchos e acompanhar métricas.
   - O WhatsApp passa a ser um canal mensageiro de notificação e gatilho rápido de comandos.
