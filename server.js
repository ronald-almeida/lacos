import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { product, bumps, orderItems, whatsappLink } from './lib/catalog.js';
import { validateCustomer } from './lib/validation.js';
import { createStore } from './lib/store.js';
import { FirebotGateway } from './lib/firebot.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error(415,'Formato de solicitação inválido.');
  // Vercel may parse JSON before invoking this handler.
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > 8192) throw error(413,'Solicitação muito grande.');
    try { return JSON.parse(body); } catch { throw error(400,'Solicitação inválida.'); }
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw error(413,'Solicitação muito grande.');
  }
  try { return JSON.parse(body); } catch { throw error(400,'Solicitação inválida.'); }
}

export function createApp({ gateway = new FirebotGateway(), store = createStore(process.env.DATABASE_PATH || './data/orders.sqlite'),
  origin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:3000', whatsappNumber = process.env.WHATSAPP_NUMBER || '5575988393742',
  whatsappMessage = process.env.WHATSAPP_MESSAGE || 'Olá! Acabei de adquirir o Combo 4 em 1 e gostaria de receber meu acesso.' } = {}) {
  const secure = new URL(origin).protocol === 'https:';
  const inflight = new Map();
  const whatsapp = whatsappLink(whatsappNumber, whatsappMessage);
  function json(res, status, payload) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(payload));
  }
  function session(req, res) {
    const token = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('checkout_session='))?.split('=')[1];
    if (/^[a-f0-9]{64}$/.test(token || '')) return hash(token);
    const next = randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie',`checkout_session=${next}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`);
    return hash(next);
  }
  async function publicOrder(o) {
    const result = { id:o.id, amount:o.amount, items:JSON.parse(o.items), status:o.status, expiresAt:o.expires_at };
    if (o.status === 'pending') {
      result.code=o.code;
      result.qrImage=await QRCode.toDataURL(o.code, { width:280, margin:2, errorCorrectionLevel:'M' });
    }
    if (o.status === 'paid') result.whatsappUrl=whatsapp;
    return result;
  }
  async function refresh(o) {
    if (!['pending','expired','paid'].includes(o.status) || !o.gateway_id || Date.now()-o.checked_at<5000) return o;
    if (inflight.has(o.id)) return inflight.get(o.id);
    const task = (async () => {
      const charge = await gateway.getCharge(o.gateway_id);
      if (charge.id !== o.gateway_id || charge.amountCents !== o.amount ||
          !['pending','paid','expired','cancelled','refunded','failed'].includes(charge.status) ||
          (o.status === 'paid' && !['paid','refunded'].includes(charge.status))) {
        throw error(502,'Não foi possível verificar o pagamento. Tente novamente em instantes.');
      }
      await store.status(o.id, charge.status, o.owner);
      return store.get(o.id, o.owner);
    })();
    inflight.set(o.id,task);
    try { return await task; } finally { inflight.delete(o.id); }
  }
  const handler = async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw error(403,'Origem não permitida.');
        const owner = session(req,res);
        if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res,200,{product,bumps});
        if (req.method === 'POST' && url.pathname === '/api/orders') {
          if (req.headers.origin !== origin) throw error(403,'Origem não permitida.');
          const input = await readJson(req);
          if (!input || typeof input !== 'object') throw error(400,'Solicitação inválida.');
          if (!/^[a-f0-9-]{36}$/i.test(input.requestKey || '')) throw error(400,'Identificador de pedido inválido.');
          let customer, items;
          try { customer=validateCustomer(input.customer); items=orderItems(input.bumps); } catch(e) { throw error(400,e.message); }
          const amount = items.reduce((total,item)=>total+item.price,0);
          const fingerprint = hash(JSON.stringify({customer,items}));
          async function existingOrder(order) {
            if (order.fingerprint === fingerprint) return json(res,200,await publicOrder(order));
            return json(res,409,{resetRequest:true});
          }
          // Deduplicate only retries of this attempt, never the customer's CPF or prior orders.
          const existing = await store.find(owner,input.requestKey);
          if (existing) return await existingOrder(existing);
          gateway.assertReady();
          if (!whatsapp) throw error(503,'O atendimento está sendo preparado. Tente novamente mais tarde.');
          const id=randomUUID();
          const reserved=await store.insert({id,owner,key:input.requestKey,fingerprint,amount,items});
          if (!reserved.created) return await existingOrder(reserved.order);
          try {
            const charge=await gateway.createCharge({reference:id,amountCents:amount,customer,items});
            if (!charge || typeof charge.id!=='string' || charge.id.length>200 || typeof charge.code!=='string' ||
                charge.code.length<20 || charge.code.length>4096 || charge.amountCents!==amount ||
                (charge.expiresAt && (!Number.isFinite(Date.parse(charge.expiresAt)) || Date.parse(charge.expiresAt)<=Date.now()))) throw new Error('Invalid gateway response');
            await store.charge(id,charge,owner);
          } catch (e) {
            if(e.uncertain === false){await store.status(id,'failed',owner);return json(res,502,{message:e.message,resetRequest:true});}
            // Never retry blindly: the provider may have created the charge before timing out.
            await store.status(id,'creation_unknown',owner);
            return json(res,202,await publicOrder(await store.get(id,owner)));
          }
          return json(res,201,await publicOrder(await store.get(id,owner)));
        }
        const match=url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})$/);
        if (req.method==='GET' && match) {
          if (!await store.allow(`status:${owner}`,120,60000)) throw error(429,'Aguarde alguns instantes para consultar novamente.');
          const o=await store.get(match[1],owner);
          if (!o || o.owner!==owner) throw error(404,'Pedido não encontrado neste navegador.');
          return json(res,200,await publicOrder(await refresh(o)));
        }
        throw error(404,'Página não encontrada.');
      }
      if (!['GET','HEAD'].includes(req.method)) throw error(405,'Método não permitido.');
      const pages={'/':'index.html','/pagamento':'payment.html','/obrigado':'thanks.html'};
      const pathname=decodeURIComponent(url.pathname);
      const relative=pages[pathname] || pathname.replace(/^\/+/, '');
      const file=resolve(root,relative);
      if (!file.startsWith(root) || relative.includes('..')) throw error(404,'Página não encontrada.');
      let content;
      try { content=await readFile(file); } catch { throw error(404,'Página não encontrada.'); }
      res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch(e) {
      if (res.headersSent) return res.end();
      json(res,e.status || 502,{message:e.status ? e.message : 'Não foi possível consultar o pagamento. Tente novamente em instantes.'});
    }
  };
  const server = createServer(handler);
  server.requestTimeout=30000;
  return {server,store,handler};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {server,store}=createApp();
  const host=process.env.HOST || '127.0.0.1';
  const port=Number(process.env.PORT || 3000);
  server.listen(port,host,()=>console.log(`Checkout local: http://${host}:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
