const BASE_URL = 'https://firebotbr.com/api/v1';
const STATUSES = { PENDING:'pending', PAID:'paid', EXPIRED:'expired', CANCELED:'cancelled', CANCELLED:'cancelled', REFUNDED:'refunded', FAILED:'failed' };
export const amountInCents = amount => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const cents=Math.round(amount*100);
  return Number.isSafeInteger(cents) && Math.abs(amount*100-cents)<0.000001 ? cents : null;
};
const validId = id => typeof id==='string' && /^fire_tx_[A-Za-z0-9_-]{1,180}$/.test(id);
export class GatewayError extends Error {
  constructor(uncertain=false) {
    super('Não foi possível gerar o Pix agora. Confira seus dados e tente novamente mais tarde.');
    this.status=502;this.uncertain=uncertain;
  }
}

/** Contract: https://firebotbr.com/integracoes/docs, captured 12–17 Nov 2026. */
export class FirebotGateway {
  constructor({apiKey=process.env.FIREBOT_API_KEY,storeUrl=process.env.PUBLIC_ORIGIN,fetcher=fetch}={}) {
    Object.assign(this,{apiKey,storeUrl,fetcher});
  }
  assertReady() {
    let url;
    try { url=new URL(this.storeUrl); } catch {}
    if (!this.apiKey?.trim() || !url || url.protocol!=='https:' || url.username || url.password) {
      const e=new Error('O pagamento está temporariamente indisponível. Tente novamente mais tarde.');
      e.status=503;throw e;
    }
  }
  async request(path,options={}) {
    this.assertReady();
    const creating=options.method==='POST';
    try {
      const response=await this.fetcher(`${BASE_URL}${path}`,{
        ...options,headers:{'Accept':'application/json','Content-Type':'application/json','x-api-key':this.apiKey.trim()},
        redirect:'error',signal:AbortSignal.timeout(20000),
      });
      // Never log provider bodies or credentials. A timeout/5xx may hide a created charge.
      if(!response.ok)throw new GatewayError(creating&&(response.status>=500||response.status===408));
      let body;
      try{body=await response.json();}catch{throw new GatewayError(creating);}
      if(!body||typeof body!=='object'||Array.isArray(body)||body.success===false||body.error)throw new GatewayError(creating);
      return body.data??body;
    }catch(e){if(e instanceof GatewayError)throw e;throw new GatewayError(creating);}
  }
  async createCharge({reference,amountCents,customer,items}) {
    const charge=await this.request('/pix/create',{
      method:'POST',body:JSON.stringify({
        amount:amountCents/100,productType:'DIGITAL',
        description:`${items.map(i=>i.name).join(' + ')} | Pedido ${reference}`,
        storeUrl:this.storeUrl,qrStyle:'plain',
        customer:{name:customer.name,email:customer.email,cpf:customer.document,phone:customer.phone.replace(/^55/,'')},
      }),
    });
    if(!validId(charge.transactionId)||amountInCents(charge.amount)!==amountCents||
      !['PENDING','PAID'].includes(charge.status)||typeof charge.pixCopiaECola!=='string'||
      !charge.pixCopiaECola.startsWith('000201')||charge.pixCopiaECola.length>4096)throw new GatewayError(true);
    return {id:charge.transactionId,code:charge.pixCopiaECola,amountCents,expiresAt:charge.expiresAt||null};
  }
  async getCharge(id) {
    if(!validId(id))throw new GatewayError();
    const charge=await this.request(`/pix/${encodeURIComponent(id)}`);
    if(charge.transactionId!==id||amountInCents(charge.amount)===null||!Object.hasOwn(STATUSES,charge.status))throw new GatewayError();
    return {id:charge.transactionId,amountCents:amountInCents(charge.amount),status:STATUSES[charge.status]};
  }
}
