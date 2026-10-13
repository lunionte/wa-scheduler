// A disposable DOM fixture. It never connects to WhatsApp or sends real messages.
export const whatsappFixture = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>WhatsApp — fixture</title><style>
*{box-sizing:border-box}body{margin:0;font:14px 'Segoe UI',sans-serif;background:#efeae2;color:#111b21}#app{display:flex;height:100vh}.sidebar{width:300px;background:white;border-right:1px solid #ddd;padding:24px}#main{flex:1;display:flex;flex-direction:column;min-width:0}header{height:64px;background:#f0f2f5;padding:10px 20px;display:flex;align-items:center}header button{border:0;background:none;text-align:left;font:inherit}#messages{flex:1;overflow:auto;padding:24px}.message{margin-left:auto;max-width:70%;margin-bottom:12px;background:#d9fdd3;border-radius:8px;padding:10px;white-space:pre-wrap}footer{background:#f0f2f5;display:flex;align-items:center;padding:12px;gap:10px}[contenteditable]{flex:1;min-height:42px;max-height:130px;overflow:auto;background:white;border-radius:10px;padding:10px;outline:none;white-space:pre-wrap}footer button{height:40px;width:40px;border:0;background:none;cursor:pointer;color:inherit}aside{position:fixed;right:0;top:0;width:350px;height:100vh;background:white;box-shadow:0 0 20px #0003;padding:20px}aside header{justify-content:space-between}aside span[dir]{display:block;padding:24px 0}.other{padding:14px;background:#f0f2f5;border:0;border-radius:8px;cursor:pointer}
@media(prefers-color-scheme:dark){body{background:#0b141a;color:#e9edef}.sidebar,aside{background:#111b21}header,footer,.other{background:#202c33;color:#e9edef}[contenteditable]{background:#2a3942}.message{background:#005c4b}}
</style></head><body><div id="app"><div class="sidebar"><h2>Conversas</h2><p>Página de teste local</p><button class="other" id="switch">Trocar conversa</button></div><div id="main"><header><button data-testid="conversation-info-header" aria-label="Dados do contato"><span title="Contato de teste">Contato de teste</span></button></header><div id="messages"></div><footer><span aria-hidden="true">＋</span><div contenteditable="true" role="textbox" aria-label="Digite uma mensagem"></div><button id="action" aria-label="Áudio"><span data-icon="ptt">🎙</span></button></footer></div></div><script>
window.fixturePhone='5511999999999';window.fixtureChatId=null;window.fixtureDelay=80;window.fixtureConfirm=true;window.fixtureSent=[];window.fixtureContactOpens=0;
document.querySelector('#messages').innerHTML='<div data-id="A91F410B563E4AB7"></div>';
// Explicit page-integration mock for these disposable browser tests. Production
// has no fixture branch; its real SDK adapter is exercised in page-api.test.ts.
const attempts=new Map();
Object.defineProperty(window,'__waSchedulerPageV1',{configurable:true,value:{
 identify(){const chatId=window.fixtureChatId||window.fixturePhone+'@c.us';return {ready:true,recipient:{chatId,label:document.querySelector('span[title]').title,...(chatId.endsWith('@c.us')?{phone:window.fixturePhone}:{})}}},
 send(command){
  if(attempts.has(command.occurrenceId))return attempts.get(command.occurrenceId);
  const job=(async()=>{
   const current=this.identify().recipient;
   if((command.recipient.chatId||command.recipient.phone+'@c.us')!==current.chatId||Date.now()>command.deadline)return {status:'missed',reason:'Conversa diferente ou horário expirado.'};
   window.fixtureSent.push({phone:window.fixturePhone,text:command.message});
   const row=document.createElement('div');row.className='message';row.setAttribute('data-id',crypto.randomUUID());
   const body=document.createElement('span');body.className='selectable-text';body.textContent=command.message;row.append(body);document.querySelector('#messages').append(row);
   await new Promise(resolve=>setTimeout(resolve,window.fixtureDelay));
   if(!window.fixtureConfirm)return {status:'uncertain',reason:'Confirmação indisponível.',unsafe:true};
   return {status:'sent',reason:'Envio confirmado pelo mock da integração.'};
  })();attempts.set(command.occurrenceId,job);return job;
 }
}});
const editor=document.querySelector('[contenteditable]'), action=document.querySelector('#action');
function sync(){const sending=editor.innerText.length>0;action.setAttribute('aria-label',sending?'Enviar':'Áudio');action.innerHTML='<span data-icon="'+(sending?'send':'ptt')+'">'+(sending?'➤':'🎙')+'</span>';}
editor.addEventListener('input',sync);
document.querySelector('[data-testid="conversation-info-header"]').addEventListener('click',()=>{
 window.fixtureContactOpens++;
 if(document.querySelector('aside'))return;const pane=document.createElement('aside');pane.setAttribute('data-testid','contact-info-drawer');pane.innerHTML='<header>Dados do contato<button aria-label="Fechar dados"><span data-icon="x">×</span></button></header><h2>'+document.querySelector('span[title]').title+'</h2><span dir="auto">+'+window.fixturePhone+'</span>';
 pane.querySelector('button').onclick=()=>pane.remove();document.body.append(pane);
});
action.addEventListener('click',()=>{if(!editor.innerText)return;const text=editor.innerText;window.fixtureSent.push({phone:window.fixturePhone,text});const row=document.createElement('div');row.className='message';row.setAttribute('data-id','true_'+window.fixturePhone+'_'+crypto.randomUUID());const body=document.createElement('span');body.className='selectable-text';body.textContent=text;row.append(body);document.querySelector('#messages').append(row);editor.innerHTML='';sync();if(window.fixtureConfirm)setTimeout(()=>{const check=document.createElement('span');check.setAttribute('data-icon','msg-check');check.textContent=' ✓';row.append(check)},window.fixtureDelay);});
document.querySelector('#switch').onclick=()=>{window.fixturePhone=window.fixturePhone==='5511999999999'?'5511888888888':'5511999999999';const label=window.fixturePhone==='5511999999999'?'Contato de teste':'Outro contato';const title=document.querySelector('span[title]');title.title=label;title.textContent=label;document.querySelector('#messages').innerHTML='<div data-id="false_'+window.fixturePhone+'@c.us_seed"></div>';editor.innerHTML='';sync();};
</script></body></html>`;
