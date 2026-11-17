import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.js';
import { createStore } from '../lib/store.js';
import { FirebotGateway, GatewayError, amountInCents } from '../lib/firebot.js';
import { validDocument } from '../lib/validation.js';

const customer={name:'Cliente de Teste',email:'teste@example.com',document:'52998224725',phone:'11999999999'};
const code='000201-TESTE-LOCAL-SEM-VALOR-NAO-PAGAR';
async function setup(t,options={}) {
  const charges=new Map();let calls=0;
  const gateway={
    assertReady(){},
    async createCharge(input){calls++;const id=`fire_tx_${randomUUID()}`;charges.set(id,{...input,id,status:'pending'});return {id,code,amountCents:input.amountCents,expiresAt:null};},
    async getCharge(id){return charges.get(id);},
    ...options.gateway,
  };
  const store=createStore(':memory:');
  const {server}=createApp({gateway,store,origin:'http://checkout.local',whatsappNumber:'5511999999999',...options,});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const session=await fetch(`${base}/api/catalog`);
  const cookie=session.headers.get('set-cookie').split(';')[0];
  async function request(path,body,overrides={}){
    const response=await fetch(`${base}${path}`,{method:body?'POST':'GET',headers:{cookie,origin:'http://checkout.local','content-type':'application/json',...overrides},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  return {request,store,charges,calls:()=>calls,base,cookie};
}
const input=(bumps=[])=>({requestKey:randomUUID(),customer,bumps,amount:1});

test('calculates all four combinations on the server and ignores client amounts',async t=>{
  for(const [bumps,total] of [[[],9700],[['guia-atendimento'],11690],[['guia-embalagens'],10690],[['guia-atendimento','guia-embalagens'],12680]]){
    const app=await setup(t);const r=await app.request('/api/orders',input(bumps));
    assert.equal(r.status,201);assert.equal(r.body.amount,total);assert.match(r.body.qrImage,/^data:image\/png;base64,/);assert.equal(r.body.whatsappUrl,undefined);
  }
});
test('rejects duplicated/unknown bumps and invalid customer data before creating a charge',async t=>{
  const app=await setup(t);
  for(const body of [input(['guia-atendimento','guia-atendimento']),input(['inventado']),{...input(),customer:{...customer,document:'11111111111'}},{...input(),customer:{...customer,email:'invalid'}}]){
    assert.equal((await app.request('/api/orders',body)).status,400);
  }
  assert.equal(app.calls(),0);
});
test('same request key and concurrent submission create only one charge',async t=>{
  const app=await setup(t);const body=input();
  const results=await Promise.all([app.request('/api/orders',body),app.request('/api/orders',body)]);
  assert.equal(app.calls(),1);assert.equal(results[0].body.id,results[1].body.id);
  assert.equal((await app.request('/api/orders',{...body,bumps:['guia-atendimento']})).status,409);
});
test('a new key cannot create a second active charge',async t=>{
  const app=await setup(t);const first=await app.request('/api/orders',input());
  const second=await app.request('/api/orders',input());
  assert.equal(second.status,409);assert.equal(second.body.orderId,first.body.id);assert.equal(app.calls(),1);
});
test('ambiguous timeout retains the order and blocks duplicate creation',async t=>{
  let calls=0;
  const app=await setup(t,{gateway:{assertReady(){},async createCharge(){calls++;throw new GatewayError(true);}}});
  const body=input();const first=await app.request('/api/orders',body);
  assert.equal(first.status,202);assert.equal(first.body.status,'creation_unknown');
  await app.request('/api/orders',body);await app.request('/api/orders',input());assert.equal(calls,1);
});
test('definitive gateway rejection allows a new request',async t=>{
  const app=await setup(t,{gateway:{assertReady(){},async createCharge(){throw new GatewayError(false);}}});
  const r=await app.request('/api/orders',input());assert.equal(r.status,502);assert.equal(r.body.resetRequest,true);
  assert.equal((await app.request('/api/orders',input())).status,502);
});
test('requires owner cookie and same origin',async t=>{
  const app=await setup(t);const r=await app.request('/api/orders',input());
  assert.equal((await app.request(`/api/orders/${r.body.id}`,null,{cookie:''})).status,404);
  assert.equal((await app.request('/api/orders',input(),{origin:'https://attacker.example'})).status,403);
  assert.equal((await app.request('/api/orders',input(),{origin:''})).status,403);
});
test('only verified paid status releases WhatsApp; mismatched amount never releases it',async t=>{
  const app=await setup(t);const r=await app.request('/api/orders',input());
  const charge=[...app.charges.values()][0];charge.status='paid';charge.amountCents=100;
  const wrong=await app.request(`/api/orders/${r.body.id}`);assert.equal(wrong.status,502);assert.equal(wrong.body.whatsappUrl,undefined);
  charge.amountCents=9700;const paid=await app.request(`/api/orders/${r.body.id}`);
  assert.equal(paid.body.status,'paid');assert.match(paid.body.whatsappUrl,/^https:\/\/wa.me\/5511999999999\?text=/);
  assert.equal(paid.body.code,undefined);
});
test('transaction ID mismatch does not confirm payment',async t=>{
  const app=await setup(t);const r=await app.request('/api/orders',input());
  Object.assign([...app.charges.values()][0],{id:'fire_tx_other',status:'paid'});
  assert.equal((await app.request(`/api/orders/${r.body.id}`)).status,502);
});
test('missing credentials or WhatsApp cannot create live charges',async t=>{
  const app=await setup(t,{gateway:new FirebotGateway({apiKey:'',storeUrl:'https://shop.example'})});
  assert.equal((await app.request('/api/orders',input())).status,503);
  const missing=await setup(t,{whatsappNumber:''});assert.equal((await missing.request('/api/orders',input())).status,503);assert.equal(missing.calls(),0);
});
test('paid orders can transition to refunded and lose their access link',async t=>{
  const app=await setup(t);const r=await app.request('/api/orders',input());const charge=[...app.charges.values()][0];
  charge.status='paid';await app.request(`/api/orders/${r.body.id}`);
  app.store.db.prepare('UPDATE orders SET checked_at=0 WHERE id=?').run(r.body.id);charge.status='refunded';
  const result=await app.request(`/api/orders/${r.body.id}`);assert.equal(result.body.status,'refunded');assert.equal(result.body.whatsappUrl,undefined);
});
test('order state survives database reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'lacos-test-'));const file=join(dir,'orders.sqlite');
  try{const first=createStore(file);first.insert({id:'order',owner:'owner',key:'key',fingerprint:'hash',amount:9700,items:[]});first.close();const next=createStore(file);assert.equal(next.find('owner','key').amount,9700);next.close();}finally{
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'lacos-test-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
test('CPF/CNPJ check digits and amount precision',()=>{
  assert.equal(validDocument('529.982.247-25'),true);assert.equal(validDocument('11.222.333/0001-81'),true);
  assert.equal(validDocument('00000000000'),false);assert.equal(validDocument('52998224724'),false);
  assert.equal(amountInCents(126.8),12680);assert.equal(amountInCents('97'),null);assert.equal(amountInCents(97.001),null);
});

test('FireBot request uses documented route, reais, plain QR, and server key',async()=>{
  let request;
  const gateway=new FirebotGateway({apiKey:'test-key',storeUrl:'https://shop.example',fetcher:async(url,options)=>{
    request={url,...options};return Response.json({success:true,transactionId:'fire_tx_test',amount:126.8,status:'PENDING',pixCopiaECola:code});
  }});
  const result=await gateway.createCharge({reference:'ref',amountCents:12680,customer:{...customer,phone:'5511999999999'},items:[{name:'Combo'}]});
  const body=JSON.parse(request.body);assert.equal(request.url,'https://firebotbr.com/api/v1/pix/create');assert.equal(body.amount,126.8);assert.equal(body.productType,'DIGITAL');assert.equal(body.qrStyle,'plain');assert.equal(body.customer.cpf,customer.document);assert.equal(body.customer.phone,'11999999999');assert.equal(request.headers['x-api-key'],'test-key');assert.equal(result.expiresAt,null);
});
test('FireBot status verifies transaction identity and documented status',async()=>{
  let status='PAID';
  const gateway=new FirebotGateway({apiKey:'test',storeUrl:'https://shop.example',fetcher:async url=>{assert.equal(url,'https://firebotbr.com/api/v1/pix/fire_tx_test');return Response.json({transactionId:'fire_tx_test',amount:97,status});}});
  assert.equal((await gateway.getCharge('fire_tx_test')).status,'paid');status='APPROVED';await assert.rejects(()=>gateway.getCharge('fire_tx_test'));
});
test('FireBot treats timeout and malformed success as uncertain and 401 as definitive',async()=>{
  const run=fetcher=>new FirebotGateway({apiKey:'test',storeUrl:'https://shop.example',fetcher}).request('/pix/create',{method:'POST'});
  await assert.rejects(()=>run(async()=>{throw new Error('timeout');}),e=>e.uncertain===true);
  await assert.rejects(()=>run(async()=>new Response('bad-json')),e=>e.uncertain===true);
  await assert.rejects(()=>run(async()=>new Response('unauthorized',{status:401})),e=>e.uncertain===false);
});
