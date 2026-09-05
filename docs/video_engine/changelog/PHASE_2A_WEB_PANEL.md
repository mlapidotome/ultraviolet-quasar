# Changelog & Homologação — Fase 2A: Painel Web Mínimo de Criação e Visualização de Job

**Data:** 05/09/2026  
**Status:** CONCLUÍDO E HOMOLOGADO  
**Responsável:** Antigravity / Pair Programming  
**Job UUID Homologado pelo Painel:** `f8099b3d-d331-45ad-9983-145352d05604`  

---

## 1. Objetivo da Fase 2A

Implementar a primeira interface visual da Video Engine V2 (`video-painel.html`), permitindo a consulta de imóveis, criação de Jobs e visualização completa de scripts e dados financeiros **sem utilizar o WhatsApp, sem expor chaves de API no navegador e com proteção server-side via HTTP Basic Auth**.

---

## 2. Arquitetura Implementada

1. **Camada de Apresentação (`video-painel.html`):**
   - Interface HTML5 autocontida com CSS Dark Mode padronizado (paleta `#0B0F19`, `#111827`, tipografia *Plus Jakarta Sans*).
   - JavaScript Vanilla puro consumindo o endpoint BFF via `fetch()`.
   - **Zero frameworks pesados**, sem necessidade de build (`npm run build`).
   - Prevenção de duplo clique e estado de carregamento (*"⏳ Processando no CRM..."*).
   - Cards dedicados para:
     - 📋 Job UUID com botão de cópia rápida e status badge (`SCRIPT_READY`);
     - 🏠 Resumo do Imóvel (título, bairro, área, quartos, valor);
     - 💰 Simulação Financeira (venda, entrada, financiamento, parcela, renda mínima);
     - 🎙️ Roteiros de Anúncio: 3 Ganchos (com styling de Look) + Corpo/Desenvolvimento com botões de cópia individuais.

2. **Middleware de Autenticação Server-Side (`video_engine/panel_auth.js`):**
   - Implementação de HTTP Basic Auth nativo no Express.
   - Variáveis `PANEL_USER` e `PANEL_PASSWORD` estritamente obrigatórias no `.env` (sem fallback permissivo; erro de configuração se ausentes).
   - Parser seguro suportando senhas contendo caracteres especiais e `:` (separando estritamente no primeiro `:`).
   - Comparação segura contra timing attacks via `crypto.timingSafeEqual`.
   - Em caso de acesso não autenticado: retorno de `HTTP 401 Unauthorized` com cabeçalho padrão `WWW-Authenticate: Basic realm="Video Engine V2 Painel"`.

3. **Endpoint BFF (`video_engine/api_v2.js`):**
   - Rota interna: `POST /api/v2/panel/video-jobs`.
   - Protegida por `panelAuthMiddleware`.
   - Injeta internamente no backend `broker_id = 'marcel'` e `source = 'web_panel'`.
   - Invoca diretamente `jobService.initializeVideoJob()`.
   - Mapeamento estrito de status HTTP:
     - `201 Created`: Job criado e persistido no PostgreSQL;
     - `400 Bad Request`: Parâmetro `property_ref` vazio ou ausente;
     - `401 Unauthorized`: Falha de autenticação no painel;
     - `404 Not Found`: Imóvel inexistente na carteira do CRM;
     - `503 Service Unavailable`: Modo degradado (PostgreSQL offline), com mensagem explícita *"persistência indisponível"*;
     - `500 Internal Error`: Erro genérico seguro.

4. **Isolamento de Segurança e Proteção Estática (`gestor_server.js`):**
   - As rotas `/video-painel` e `/video-painel.html` foram registradas **antes** do middleware geral `express.static`, garantindo que o acesso à página passe obrigatoriamente pelo `panelAuthMiddleware`.
   - Proteção das rotas internas `/video_engine` e `/.env` retornando `HTTP 403 Forbidden` para impedir qualquer vazamento de código-fonte por requisição estática.
   - A rota pública externa `POST /api/v2/video-jobs` continua protegida exclusivamente por `Authorization: Bearer <VIDEO_ENGINE_API_KEY>`.

---

## 3. Arquivos Criados e Modificados

| Arquivo | Ação | Descrição |
|---|---|---|
| `video_engine/panel_auth.js` | **NOVO** | Middleware HTTP Basic Auth com parser seguro para senhas com `:` e verificação estrita de variáveis. |
| `video-painel.html` | **NOVO** | Interface Web responsiva, leve e moderna para criação e inspeção de Jobs. |
| `video_engine/api_v2.js` | **MODIFICADO** | Adicionado endpoint BFF `POST /panel/video-jobs` com autenticação Basic Auth. |
| `gestor_server.js` | **MODIFICADO** | Registradas rotas `/video-painel` protegidas e bloqueio estático de `/video_engine` e `/.env`. |
| `.env` | **CONFIGURADO** | Adicionadas variáveis `PANEL_USER` e `PANEL_PASSWORD` (contendo `:` na senha). |
| `docs/video_engine/changelog/PHASE_2A_WEB_PANEL.md` | **NOVO** | Registro de homologação e changelog da Fase 2A. |
| `CURRENT_STATE.md` | **ATUALIZADO** | Atualização do estado global da arquitetura Video Engine V2. |

---

## 4. Resultados da Bateria de Homologação (12 Testes)

A suíte completa executada diretamente no ambiente da VPS obteve 100% de sucesso:

1. **Acesso Não-Autenticado a `GET /video-painel`:**  
   Retornou `HTTP 401 Unauthorized` com cabeçalho `WWW-Authenticate: Basic realm="Video Engine V2 Painel"`. `[APROVADO]`
2. **Acesso Não-Autenticado ao Endpoint BFF `POST /api/v2/panel/video-jobs`:**  
   Retornou `HTTP 401 Unauthorized`. `[APROVADO]`
3. **Acesso Autenticado a `GET /video-painel` com Senha Contendo `:`:**  
   Retornou `HTTP 200 OK` e entregou o HTML completo da interface. `[APROVADO]`
4. **Auditoria de Segurança no HTML/JS Entregue ao Navegador:**  
   Comprovado: nenhuma senha, token de API ou `localStorage`/`sessionStorage` para credenciais. `[APROVADO]`
5. **Auditoria de Proteção de Arquivos Internos:**  
   `GET /video_engine/db.js` → `HTTP 403 Forbidden`  
   `GET /video_engine/panel_auth.js` → `HTTP 403 Forbidden`  
   `GET /.env` → `HTTP 403 Forbidden` `[APROVADO]`
6. **Criação Nominal de Job pelo Painel (`#1639`):**  
   Retornou `HTTP 201 Created` gerando o Job UUID `f8099b3d-d331-45ad-9983-145352d05604` com status `SCRIPT_READY`. `[APROVADO]`
7. **Conferência no PostgreSQL:**  
   Registro persistido com `id = f8099b3d-d331-45ad-9983-145352d05604`, `broker_id = 'marcel'`, `source = 'web_panel'`, `status = 'SCRIPT_READY'` e snapshots íntegros. `[APROVADO]`
8. **Validação de Erros de Domínio:**  
   `property_ref: "99999999"` → `HTTP 404 Not Found`  
   `property_ref: ""` → `HTTP 400 Bad Request` `[APROVADO]`
9. **Modo Degradado / PostgreSQL Offline:**  
   Com o cluster do PostgreSQL parado, a requisição retornou `HTTP 503 Service Unavailable` com imóvel e scripts gerados, `job_id: null` e linguagem "persistência indisponível". Serviço restaurado em seguida. `[APROVADO]`
10. **Validação de Variáveis Obrigatórias:**  
    Testado isoladamente que a ausência de `PANEL_USER` ou `PANEL_PASSWORD` nega acesso imediatamente com `500 SERVER_MISCONFIGURED` sem exibir credenciais. `[APROVADO]`
11. **Não-Regressão da API Externa Fase 1D:**  
    Endpoint `POST /api/v2/video-jobs` com `Authorization: Bearer <KEY>` retornou `HTTP 201 Created` normalmente. `[APROVADO]`
12. **Saúde de Produção:**  
    PM2 `bali-gestor` online (PID 60633) e PostgreSQL `active`. Sessão WhatsApp de Marcel mantida 100% ONLINE. `[APROVADO]`

---

## 5. Limites e O que Permanece Intocado

* ❌ Nenhuma geração/renderização de vídeo é iniciada pelo painel nesta fase (sem chamadas HeyGen/FFmpeg/R2).
* ❌ Sem biblioteca ou listagem histórica de vídeos.
* ❌ WhatsApp V1 (`activeVideoSessions`, áudios 1-4, `CLONE`, `OK`) totalmente preservado.