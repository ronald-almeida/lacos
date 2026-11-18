import {api,money,summary,save,saved,forget,showError} from './shared.js';
const form=document.querySelector('#checkout-form');
const button=document.querySelector('#pay-button');
const message=document.querySelector('#form-error');
const checkboxes=[...form.querySelectorAll('[name=bump]')];
const fields=Object.fromEntries(['name','email','document','phone'].map(name=>[name,form.elements.namedItem(name)]));
let catalog;
let requestKey=saved('checkout-request') || crypto.randomUUID();
save('checkout-request',requestKey);
function selected(){return checkboxes.filter(c=>c.checked).map(c=>c.value);}
function renderSummary(){
  if(!catalog)return;
  const items=[{...catalog.product,name:'Combo 4 em 1'},...catalog.bumps.filter(b=>selected().includes(b.id))];
  summary(document.querySelector('#summary-items'),items);
  document.querySelector('#total').textContent=money(items.reduce((s,i)=>s+i.price,0));
}
checkboxes.forEach(c=>c.addEventListener('change',renderSummary));
fields.phone.addEventListener('input',()=>{
  const digits=fields.phone.value.replace(/\D/g,'').slice(0,11);
  fields.phone.value=digits.length>10 ? digits.replace(/^(\d{2})(\d{5})(\d{0,4}).*/,'($1) $2-$3') : digits.replace(/^(\d{2})(\d{4})(\d{0,4}).*/,'($1) $2-$3');
});
fields.document.addEventListener('input',()=>{
  const digits=fields.document.value.replace(/\D/g,'').slice(0,14);
  fields.document.value=digits.length<=11 ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*/,'$1.$2.$3-$4') : digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/,'$1.$2.$3/$4-$5');
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(button.disabled)return;
  message.hidden=true;button.disabled=true;button.firstElementChild.textContent='Preparando seu Pix…';
  try{
    const order=await api('/api/orders',{method:'POST',body:JSON.stringify({
      requestKey,bumps:selected(),customer:{name:fields.name.value,email:fields.email.value,document:fields.document.value,phone:fields.phone.value},
    })});
    save('checkout-order',order.id);
    location.assign(`/pagamento?pedido=${encodeURIComponent(order.id)}`);
  }catch(e){
    if(e.resetRequest){requestKey=crypto.randomUUID();save('checkout-request',requestKey);}
    if(e.orderId){save('checkout-order',e.orderId);location.assign(`/pagamento?pedido=${encodeURIComponent(e.orderId)}`);return;}
    showError(message,e.name==='TimeoutError'?'A consulta demorou mais que o esperado. Tente novamente para retomar o mesmo pedido.':e.message);
    message.scrollIntoView({behavior:'smooth',block:'center'});
    button.disabled=false;button.firstElementChild.textContent='Pagar agora';
  }
});
async function initialize(){
  try{
    catalog=await api('/api/catalog');renderSummary();button.disabled=false;
    const id=saved('checkout-order');
    if(id){
      try{
        const o=await api(`/api/orders/${encodeURIComponent(id)}`);
        if(!['pending','creating','creation_unknown'].includes(o.status)){
          forget('checkout-order');requestKey=crypto.randomUUID();save('checkout-request',requestKey);
        }
      }catch(e){if(e.status===404){forget('checkout-order');requestKey=crypto.randomUUID();save('checkout-request',requestKey);}}
    }
  }catch{showError(message,'Não foi possível carregar a oferta. Atualize a página para tentar novamente.');}
}
initialize();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
