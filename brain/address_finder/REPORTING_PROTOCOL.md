# PROTOCOLO PERMANENTE DE HANDOFF DE RELATÓRIOS — ADDRESS FINDER

Este protocolo estabelece o fluxo obrigatório e automatizado para que o ChatGPT e outros sistemas leiam diretamente os relatórios produzidos pelo Antigravity através do repositório GitHub.

---

## Regra Permanente de Finalização de Fase

Sempre que uma Phase do Address Finder for concluída e atingir o estado:
STOP_FOR_HUMAN_REVIEW

O Antigravity executará obrigatoriamente a seguinte sequência:

1. **Salvar o relatório histórico da fase:**
   - Caminho: rain/address_finder/reports/PHASE_<ID>_<NAME>.md
   - Exemplo: rain/address_finder/reports/PHASE_2_3W_ROAD_CADASTRAL_TOPOLOGY.md

2. **Atualizar o relatório mais recente:**
   - Caminho: rain/address_finder/LATEST_PHASE_REPORT.md
   - Conteúdo: Texto integral do relatório da fase recém-concluída.

3. **Atualizar o resumo estruturado para consumo de LLMs (ChatGPT):**
   - Caminho: rain/address_finder/LATEST_PHASE_RESULTS.json

4. **Auditoria Prévia de Secrets:**
   - Verificar que nenhum arquivo .env, credencial, token, cookie ou dado pessoal sensível esteja staged para commit.

5. **Commit e Push:**
   - Mensagem de commit padronizada: 
eport: Phase <ID> results
   - Push automático para a branch principal do repositório privado no GitHub.
