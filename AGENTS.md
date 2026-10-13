# Instruções de desenvolvimento

Leia o README.md antes de alterar o projeto. Ele descreve o produto, a arquitetura,
os comandos e as limitações. Estas regras se aplicam a todo o repositório.

## Escopo e invariantes

- Chrome Manifest V3, TypeScript estrito, WXT, React e CSS Modules.
- Somente texto e conversas individuais, com WhatsApp aberto e a conversa alvo
  selecionada. Não ampliar o escopo sem uma solicitação do usuário.
- Nunca identificar pelo nome, hashes das mensagens ou abertura automática da
  ficha. Use o ID da conversa ativa do SDK; não converter LID em telefone.
- Nunca trocar de conversa para enviar nem alterar o compositor/rascunho.
- Preserve checagem de destinatário, conexão, prazo e preparações incompatíveis.
- Ocorrências indisponíveis são puladas, sem catch-up. Não repetir um despacho
  incerto. Registrar intenção antes de enviar; recuperação deve pausar ocorrências
  interrompidas. Nunca tentar uma segunda aba depois de despachar na primeira.
- Somente o SchedulerEngine, acionado pelo worker, escreve waSchedulerDatabase.
  Preferências da UI usam chaves separadas e não alteram agendamentos.
- A consulta WA_SCHEDULER_ACTIVE fica fora da fila do engine: um tick espera o
  probe da aba, que depende dessa consulta. Enfileirá-la causaria deadlock.

## Código e integração

- Separe core (regras), integration (SDK), content (DOM) e ui (apresentação).
  Evite any; valide dados de armazenamento e mensagens nas fronteiras com Zod.
- Mantenha a versão de WA-JS fixa. O build adapta a distribuição com substituições
  verificadas; não suprima os erros dessas verificações ao atualizar a biblioteca.
- Preserve WPP/WPPConfig de terceiros, configuração privada, analytics desligado
  antes de inicializar, código local e licenças/avisos de modificações no pacote.
- Não adicionar eval, código remoto, permissões/domínios amplos, canais de envio
  por postMessage, telemetria ou serviços externos sem escopo autorizado.
- Diagnósticos devem conter apenas estado/estrutura, sem textos, telefones,
  identificadores de contatos ou dados de autenticação.
- Não editar node_modules, .wxt ou .output como implementação. Altere o fonte e
  regenere. Atualize package.json, package-lock.json e manifest em wxt.config.ts
  juntos quando preparar uma nova versão.

## Interface

- Mantenha a tipografia da página, tema do sistema e isolamento em Shadow DOM.
  Somente o botão compacto participa da barra; o painel permanece fixo no body.
- Arraste e movimento por teclado devem manter o painel na tela. Não persistir a
  posição; toda reabertura começa na âncora padrão. Atualizações do DOM não devem
  reposicionar um painel movido. Fechar e trocar conversa cancelam o arraste.
- Pausar amarelo, Continuar verde, Excluir vermelho e Editar azul. Histórico com
  tons suaves verde/vermelho, mantendo textos de status (cor não é o único sinal).
- Contador de histórico é por conversa e conta ocorrências ainda não lidas;
  abrir a seção marca os registros presentes como lidos. Marcadores são separados
  do banco, persistem localmente e são removidos quando saem do histórico retido.
- Preserve foco, Escape, navegação por Tab, labels e controles acessíveis.

## Verificação e entrega

- Execute npm run typecheck e verificações pertinentes. Para regras de envio ou
  persistência, execute npm test. Para mudanças no painel/content/worker, gere o
  build e execute os cenários E2E pertinentes; amplie a suíte se houver regressão
  ou mudança que afete outras partes. Não criar testes que só repitam o código.
- Os testes de navegador usam perfil descartável e mock explícito do WhatsApp.
  Não conectar contas reais nem enviar mensagens reais automaticamente em testes.
  Uma solicitação para desenvolver não autoriza enviar mensagens a contatos.
- Para validar a integração real, pedir que o usuário execute o checklist manual
  do README numa conversa de teste autorizada. Diferencie evidência real de fixture.
- Inspecione capturas claro/escuro para alterações visuais; preserve as verificações
  de rascunho, deduplicação, troca de conversa e resultados incertos.
- Ao entregar, atualize o README quando comportamento/arquitetura mudar, gere o
  ZIP com npm run zip e informe o que mudou, os testes e limitações pertinentes.
- Não recriar RETOMADA.md como checklist temporário; manter a documentação estável
  no README e estas instruções no AGENTS.md.
