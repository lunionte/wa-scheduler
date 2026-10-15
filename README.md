# Agendador para WhatsApp Web

Extensão Chrome Manifest V3 feita com TypeScript, WXT, React e CSS Modules. O painel fica na própria conversa, ao lado do microfone/botão de enviar. O ícone na barra do Chrome abre o WhatsApp com o painel; não há popup separado.

Versão atual: **0.1.5**. Build instalável: `.output/chrome-mv3`. Pacote: `.output/wa-scheduler-0.1.5-chrome.zip`.

## Stack

| Tecnologia | Uso |
| --- | --- |
| TypeScript com modo estrito | Tipos do produto, mensagens e regras de negócio |
| Chrome Manifest V3 e WXT | Build, content scripts e service worker da extensão |
| React 19 e CSS Modules | Painel, estados de interação e estilos isolados |
| Zod 4 | Validação de armazenamento, comandos e respostas |
| WA-JS 4.6.1, versão fixa | Identificação da conversa ativa e envio de texto |
| Vitest e jsdom | Regras de tempo/agendamento, integração e adaptador do DOM |
| Playwright 1.56.1 | Testes do build no Chromium com perfil descartável |
| Node.js 24 e npm | Ferramentas de desenvolvimento e lockfile de dependências |

## Painel e histórico

- Clique no relógio ao lado do microfone para abrir ou fechar o painel.
- Recriações do cabeçalho do WhatsApp e falhas temporárias de identificação preservam o painel e o formulário; durante a falha, salvar fica indisponível. Uma troca confirmada do ID da conversa fecha o painel e descarta o formulário anterior. Se o site remover o host do painel, a extensão recoloca a mesma árvore React no documento, sem montar uma segunda instância.
- Arraste o cabeçalho para posicioná-lo na tela. O painel fica dentro da janela e mantém a posição durante atualizações da conversa. Fechar e abrir novamente restaura a posição padrão junto ao relógio; a posição não é salva.
- Com o controle **Mover painel** selecionado por Tab, as setas também movem o painel. Escape fecha e devolve o foco ao relógio.
- Nos agendamentos, **Editar** é azul, **Pausar** amarelo, **Continuar** verde e **Excluir** vermelho, incluindo a confirmação de exclusão. Continuar reinicia o intervalo.
- Em Agendamentos, **Excluir finalizados automaticamente** vem desativado em instalações novas e na atualização de bancos antigos. É uma configuração persistente para todas as conversas do perfil. Ao ativar, exclui também os agendamentos já finalizados; depois remove os novos finalizados automaticamente, preservando o histórico. Não exclui mensagens do WhatsApp nem agendamentos ativos/pausados. Envios incertos permanecem pausados para conferência. Desativar não restaura agendamentos já excluídos.
- **Histórico (N)** conta novos resultados ainda não lidos na conversa selecionada, incluindo envios confirmados e ocorrências não enviadas. O número desaparece quando não há novidades.
- Abrir Histórico marca os registros presentes como lidos. Resultados que chegam enquanto essa seção está aberta também são marcados. A leitura persiste ao fechar/reabrir e recarregar a página, e é compartilhada pelas abas do mesmo perfil.
- Registros anteriores à introdução desse contador aparecem como novos até serem lidos pela primeira vez.
- Histórico usa verde suave para envio confirmado e vermelho suave para resultados sem confirmação (`Não enviada`, `Falha` e `Resultado incerto`). O texto explica o resultado, sem depender apenas da cor. Um resultado incerto não prova que a mensagem deixou de ser enviada.

## Instalar no Chrome

1. Execute `npm ci` e `npm run build` se estiver usando o código-fonte.
2. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `.output/chrome-mv3` deste projeto.
4. Abra ou recarregue `https://web.whatsapp.com/`, entre na sua conta e abra uma conversa individual.
5. Clique no relógio junto ao microfone. O painel identifica a conversa ativa pelo WA-JS, sem abrir a ficha do contato e sem depender de mensagens já carregadas.

O pacote ZIP gerado por `npm run zip` pode ser extraído e carregado da mesma forma. Não é necessário instalar Node para usar um build já gerado.

## Agendamentos

- **Data e hora:** envio único no fuso do sistema no momento da criação.
- **Janela aleatória:** escolha uma data e dois horários nesse dia. Um minuto, incluindo os limites, é sorteado ao salvar e mostrado na lista. O horário não muda ao recarregar.
- **A cada intervalo:** minutos ou horas inteiros, no mínimo um minuto. O primeiro envio ocorre após o intervalo. Continua até pausar ou excluir; retomar inicia uma nova contagem.
- Vários agendamentos por conversa, com edição, exclusão, pausa/retomada de recorrências e histórico.
- O tema acompanha o sistema, mesmo se o WhatsApp estiver configurado com outro tema.

Mantenha **a conversa agendada selecionada** na aba do WhatsApp. A aba pode estar em segundo plano. A extensão não troca de conversa para enviar e não abre o WhatsApp sozinha no horário. Se a conversa estiver diferente, o WhatsApp indisponível ou o computador dormindo, a ocorrência é pulada; mensagens atrasadas não são acumuladas. O Chrome pode atrasar alarmes: a tolerância é de até 60 segundos.

São suportados apenas mensagens de texto e conversas individuais. A versão inicial considera uma conta do WhatsApp por perfil do Chrome; exclua os agendamentos antes de trocar de conta. Não são suportados grupos, anexos, áudio, enquetes ou respostas citadas.

A identificação usa o ID da conversa ativa retornado pelo WA-JS. Quando esse ID contém um telefone, o painel também mostra o número. Identificadores internos LID não são exibidos como telefone: nesse caso, o painel mostra o nome e “Conversa individual identificada”. Se a integração ainda não estiver pronta ou não devolver uma conversa individual válida, o agendamento fica indisponível; a extensão não tenta descobrir o destinatário pelo nome nem abre suas informações automaticamente.

## Rascunhos e resultados

O envio usa diretamente o WA-JS. A extensão não modifica, limpa nem restaura o compositor; o rascunho, incluindo emojis e quebras de linha, permanece intacto. Preparações de anexos, áudio ou respostas citadas fazem a ocorrência ser pulada.

Backups de rascunhos criados por versões anteriores continuam disponíveis no painel para recuperação manual. Se o envio foi acionado e não há confirmação, o resultado fica **incerto** e o agendamento é pausado. Confira a conversa antes de retomar: não há repetição automática de envios incertos.

**Enviada** significa que a biblioteca retornou um ID de mensagem com ACK de envio ou resultado de envio OK. Isso não confirma entrega ou leitura pelo destinatário. O histórico guarda as últimas 200 ocorrências do perfil.

## Desenvolvimento

Requisitos: Node.js 24 e npm. As versões exatas estão em `package-lock.json`.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run zip
```

Os testes de navegador carregam o build em um perfil descartável do Chromium e interceptam o domínio do WhatsApp com uma página de teste local. Os cenários de envio substituem explicitamente a integração da página por um mock; testes unitários exercitam o adaptador do SDK. Um cenário separado verifica a inicialização do bundle real, os globais de terceiros e a ausência de requisições de telemetria durante essa inicialização. **Não acessam contas nem enviam mensagens reais.** Execute o build antes dos testes E2E. As capturas ficam em `artifacts/` e as traces de falhas em `test-results/`.

Se o Chromium do cache não iniciar neste Windows com erro de configuração “side-by-side”, os testes aceitam `WA_SCHEDULER_CHROMIUM` com o caminho de uma cópia completa do Chromium do Playwright. Neste ambiente, a cópia usada está em `artifacts/chromium-test/chrome.exe`; essa pasta não entra no pacote da extensão.

```powershell
$env:WA_SCHEDULER_CHROMIUM = (Resolve-Path 'artifacts/chromium-test/chrome.exe').Path
npm run test:e2e
```

## Arquitetura

- **Service worker:** único escritor dos agendamentos; fila serial, alarmes pontuais, recuperação de estado e despacho para uma única aba.
- **Content script isolado:** botão compacto na barra e painel em um Shadow DOM separado do compositor. O DOM é usado apenas para posicionamento e bloqueios de preparações incompatíveis.
- **Integração MAIN:** WA-JS 4.6.1 empacotado localmente consulta a conversa ativa e envia texto usando módulos internos do WhatsApp. O worker chama a integração por `chrome.scripting.executeScript`; não há canal de envio por `window.postMessage`. A distribuição foi adaptada para manter WPP/WPPConfig de outras extensões e desativar analytics antes da inicialização. O helper Node que usava eval foi desabilitado para o build de navegador. Licenças e avisos de terceiros acompanham o pacote.
- **Persistência:** `chrome.storage.local`, esquema versionado e validado, registro de ocorrência antes do despacho e leitura de backups legados de rascunho.
- **Permissões:** `storage`, `alarms`, `scripting` e acesso apenas a `https://web.whatsapp.com/*`. Código e estilos são empacotados localmente; não há backend, sincronização nem telemetria.

### Organização do código

| Caminho | Responsabilidade |
| --- | --- |
| `wxt.config.ts` | Manifest, permissões, versão e plugin do bundle privado |
| `entrypoints/background.ts` | Alarmes, mensagens, recuperação, escolha da aba e limpeza de marcadores de leitura |
| `entrypoints/whatsapp.content/index.tsx` | Botão, Shadow DOM, abertura/fechamento, posição, arraste e detecção de troca de conversa |
| `entrypoints/whatsapp-main.content.ts` | Inicialização da instância privada do SDK no mundo MAIN |
| `src/core/model.ts` | Esquemas e tipos de destinatário, agendamento, ocorrência e banco |
| `src/core/time.ts` | Data local, janela aleatória, cadência e validação de horários |
| `src/core/engine.ts` | Regras e fila serial, persistência, intenção de envio, resultados e recuperação |
| `src/core/protocol.ts` | Contratos e validação das mensagens entre worker e content script |
| `src/integration/page-api.ts` | Consulta da conversa, checagens antes do envio, deduplicação e confirmação com timeout |
| `src/content/adapter.ts` | Localização dos controles e bloqueios do compositor |
| `src/ui/Panel.tsx` e `Panel.module.css` | Formulário, lista, histórico, contador de leitura e temas |
| `build/private-wa-js.ts` | Adaptação verificada da distribuição WA-JS no build |
| `public/` | Ícones e licenças/avisos da biblioteca |
| `tests/` e `e2e/` | Testes unitários, fixture e cenários de navegador |

### Fluxo e contratos

1. O painel usa `WA_SCHEDULER_SNAPSHOT`, `SAVE`, `PAUSE`, `DELETE` e `SETTINGS` (todos com prefixo `WA_SCHEDULER_`). O worker valida a mensagem e o remetente, e delega ao engine. `SETTINGS` atualiza a política de exclusão na mesma fila serial das operações do banco.
2. O engine calcula o próximo horário, persiste o banco e cria um alarme pontual. Ao iniciar uma nova instância do worker, reconstrói o alarme a partir do armazenamento.
3. No horário, o engine registra `inFlight` antes do despacho. O worker consulta abas do WhatsApp não descartadas, prioriza a ativa e pede `WA_SCHEDULER_PROBE`.
4. A aba consulta `WA_SCHEDULER_ACTIVE` no worker, que executa a leitura no mundo MAIN. Essa consulta fica **fora da fila do engine**, pois o tick aguarda o probe e não pode bloquear a consulta da qual depende.
5. Havendo destinatário correspondente e compositor disponível, o worker despacha `WA_SCHEDULER_SEND` pela API MAIN. A integração revalida conversa, conexão, prazo e preparações antes de chamar o SDK. Depois de despachar numa aba, não tenta outra.
6. A integração aguarda confirmação por até 15 segundos. O resultado vai para o histórico; envios incertos ou inseguros pausam o agendamento. O worker tem também um timeout de despacho de 25 segundos.

Mensagens do content script aceitas pelo worker precisam vir desta extensão e do WhatsApp. Operações MAIN usam o frame principal e retornam apenas destinatário/resultado validados, não o modelo completo do chat. A biblioteca fica em um escopo privado; a API da página pertence ao mundo MAIN compartilhado com o site, não representa uma barreira contra o próprio JavaScript do WhatsApp.

### Armazenamento e estados

| Chave | Conteúdo e escritor |
| --- | --- |
| `waSchedulerDatabase` | Banco versão 1: `settings`, `schedules`, `history` e `inFlight`. Escrito exclusivamente pelo engine no worker. `settings.autoDeleteFinished` tem padrão `false`, inclusive quando o campo não existe num banco antigo |
| `waSchedulerHistoryRead:<occurrenceId>` | Booleano `true` indicando leitura. Escrito pelo painel; um marcador por ocorrência evita sobrescritas entre abas. Worker limpa os marcadores de registros que saíram do histórico retido |
| `waSchedulerDraft:<occurrenceId>` | Backups legados de texto, destinatário e data. O painel permite recuperar/excluir; o envio atual não cria backups |

Agendamentos têm estados `active`, `paused` e `finished`; resultados têm `sent`, `missed`, `failed` e `uncertain`. O banco retém 200 resultados no perfil, filtrados por ID da conversa na UI. Excluir um agendamento não apaga os resultados já registrados. A exclusão automática filtra somente `finished` durante o commit do engine, depois de registrar o resultado. Uma ocorrência perdida ou uma falha de envio único pode finalizar o agendamento; envio incerto/inseguro o pausa e o mantém. Dados incompatíveis são preservados e sinalizados, sem reset silencioso.

Datas são interpretadas no fuso local na criação e persistidas como timestamps. Intervalos são persistidos em minutos e calculados a partir de uma âncora, preservando a cadência após ocorrências perdidas. O horário aleatório é escolhido uma vez ao salvar; editar e salvar a janela pode escolher um novo horário.

## Padrões para agents e contribuidores

As instruções aplicáveis a todo o projeto estão em [AGENTS.md](AGENTS.md). Leia este README e esse arquivo antes de desenvolver.

- Manter TypeScript estrito, validação nas fronteiras e separação entre regras, SDK, DOM e UI. Evitar `any` e mudanças nos artefatos gerados como implementação.
- Preservar os invariantes de envio: ID confiável, conversa selecionada, rascunho intacto, bloqueios de preparação, intenção persistida, deduplicação e ausência de retry após incerteza.
- Não enfileirar a consulta de identidade atrás do tick que depende dela. Preferências de UI não devem alterar o banco de agendamentos.
- Preservar empacotamento local, versão fixa do SDK, namespace privado, ausência de analytics e licenças. Uma atualização do SDK deve passar pelas verificações do bundle e pela validação da integração.
- Seguir temas do sistema, tipografia da página, cores semânticas, acessibilidade por teclado e painel separado do fluxo do compositor. Não expor detalhes técnicos desnecessários na UI.
- Verificar mudanças com TypeScript e testes pertinentes, revisar capturas quando houver mudanças visuais e distinguir fixture de validação real. Testes automatizados nunca devem usar contas reais ou enviar a contatos.
- Atualizar a documentação e as três versões (`package.json`, raiz do `package-lock.json`/pacote raiz e `wxt.config.ts`) ao preparar uma release; gerar o build e ZIP a partir do fonte.

## Validação em uma conta real

Na versão 0.1.2, o usuário confirmou identificação sem ficha, envio pontual único com rascunho intacto, recorrência em segundo plano, ocorrência pulada após trocar a conversa e bloqueios durante preparação de resposta citada e prévia de anexo. A versão 0.1.3 adiciona arraste, cores das ações e contador do histórico, cobertos nos testes de navegador. O checklist abaixo pode ser repetido após atualizações do WhatsApp ou da extensão.

A automação depende de módulos internos do WhatsApp através do WA-JS, e de seletores do DOM para posicionamento e bloqueios. Ambos podem mudar. Os testes com fixtures não comprovam compatibilidade com a versão real do site. A integração deve ser validada numa conversa de teste antes de usar com outros destinatários.

1. Carregue o build e abra uma conversa de teste individual. Verifique o nome e, quando disponível, o telefone mostrado no painel, inclusive em contatos salvos e números não salvos. A ficha do contato deve permanecer fechada.
2. Agende um envio para alguns minutos à frente; confirme o texto e o horário no histórico.
3. Repita deixando outra aba selecionada e mantendo a conversa correta no WhatsApp.
4. Prepare um rascunho com emojis e quebras de linha. Confirme que a mensagem agendada é enviada e o rascunho permanece intacto.
5. Troque de conversa antes do horário: nenhum contato deve receber a mensagem e a ocorrência deve aparecer como não enviada.
6. Prepare uma resposta citada/anexo/gravação: o envio deve ser pulado sem alterar o conteúdo.
7. Teste duas abas, recarregamento, suspensão do worker e desconexão. Nunca deve haver dois envios para a mesma ocorrência. Se o worker reiniciar durante um despacho, a ocorrência deve ficar incerta e pausada.

Se o botão não aparecer ou o telefone não puder ser confirmado, não contorne a verificação de destinatário. O adaptador precisa ser ajustado à versão atual da interface. Publicação na Chrome Web Store não faz parte desta entrega.

Ao atualizar o build, clique em **Recarregar** na extensão em `chrome://extensions` e recarregue também a aba do WhatsApp. Se o relógio continuar ausente, clique no ícone da extensão e confira no console do WhatsApp a entrada **WA Scheduler: barra de mensagem não localizada**. Esse diagnóstico contém apenas contagens e atributos estruturais dos controles, sem mensagens ou telefones.
