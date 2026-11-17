import {api,money,summary,forget,showError} from './shared.js';
const id=new URLSearchParams(location.search).get('pedido');
const returnLink=document.querySelector('#return-link');
async function initialize(){
  try{
    if(!/^[a-f0-9-]{36}$/i.test(id||''))throw new Error('Pedido não encontrado. Acesse esta página pelo seu pagamento.');
    const o=await api(`/api/orders/${encodeURIComponent(id)}`);
    if(o.status!=='paid'){
      document.querySelector('#thanks-title').textContent='Ainda aguardamos seu pagamento';
      document.querySelector('#thanks-description').textContent='Assim que o Pix for confirmado, seu acesso estará disponível por aqui.';
      returnLink.href=`/pagamento?pedido=${encodeURIComponent(id)}`;returnLink.textContent='Ver meu pagamento Pix';returnLink.hidden=false;return;
    }
    document.querySelector('#confirmed-icon').hidden=false;
    document.querySelector('#thanks-title').textContent='Obrigada pela sua compra!';
    document.querySelector('#thanks-description').textContent='Seu pagamento foi confirmado. Agora é hora de dar vida a novas criações com o Combo 4 em 1.';
    document.querySelector('#confirmed-content').hidden=false;
    summary(document.querySelector('#receipt-items'),o.items);
    document.querySelector('#receipt-total').textContent=money(o.amount);
    if(o.whatsappUrl&&new URL(o.whatsappUrl).origin==='https://wa.me'){
      const link=document.querySelector('#whatsapp-link');link.href=o.whatsappUrl;link.hidden=false;
    }else document.querySelector('#whatsapp-help').textContent='Seu pagamento está confirmado. O canal de atendimento está temporariamente indisponível. Guarde esta página e tente novamente mais tarde.';
    forget('checkout-order');forget('checkout-request');
  }catch(e){
    document.querySelector('#thanks-title').textContent='Vamos conferir seu pedido';
    document.querySelector('#thanks-description').textContent='A confirmação não pôde ser consultada neste momento.';
    showError(document.querySelector('#thanks-error'),e.message);
    returnLink.hidden=false;
    if(/^[a-f0-9-]{36}$/i.test(id||'')){returnLink.href=`/pagamento?pedido=${encodeURIComponent(id)}`;returnLink.textContent='Consultar meu pagamento';}
  }finally{document.querySelector('#loader').hidden=true;}
}
initialize();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
