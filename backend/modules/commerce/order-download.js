// ALTEGO necesita resolver los paquetes completos de órdenes adquiridas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {ownedResources,writeOwnedZip,archiveSlug as slug} from './owned-downloads.js';
import {receiptPdf} from './order-receipt.js';
import {requireUser,requireLiveSession} from '../accounts/auth.js';import {suspensionForLogin} from '../accounts/account-sanctions.js';
import {withAcquisitionTransaction} from './acquisitions.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
async function authorized(pool,req,run){
 const [[order]]=await pool.execute("SELECT id FROM orders WHERE order_number=? AND buyer_id=? AND status='completed'",[req.params.orderNumber,req.user.id]);
 if(!order)throw fail(404,'Order not found.');
 const [products]=await pool.execute('SELECT DISTINCT product_id FROM order_items WHERE order_id=? AND buyer_id=?',[order.id,req.user.id]);
 return withAcquisitionTransaction(pool,req.user.id,products.map(p=>p.product_id),async context=>{
  const sql=context.sql;await requireLiveSession(sql,req);
  const [[buyer]]=await sql.execute('SELECT id,role FROM users WHERE id=?',[req.user.id]);if(await suspensionForLogin(sql,buyer))throw fail(403,'This account is suspended.');
  const [lines]=await sql.execute(`SELECT i.*,v.snapshot,v.version_number,a.acquired_version_id FROM order_items i JOIN orders o ON o.id=i.order_id AND o.buyer_id=i.buyer_id
   JOIN product_versions v ON v.id=i.version_id AND v.product_id=i.product_id
   LEFT JOIN acquisitions a ON a.order_item_id=i.id AND a.user_id=i.buyer_id AND a.product_id=i.product_id AND a.variant_id=i.variant_id
   WHERE i.order_id=? AND i.buyer_id=? AND o.status='completed' ORDER BY i.product_id,i.variant_id`,[order.id,req.user.id]);
  if(!lines.length||lines.some(l=>l.acquired_version_id!==l.version_id))throw fail(409,'The order resources require an integrity check.');
  const [[receipt]]=await sql.execute("SELECT order_number,completed_at,currency,subtotal_cents,tax_cents,total_cents,payment_method FROM orders WHERE id=? AND buyer_id=? AND status='completed'",[order.id,req.user.id]);
  return run(sql,lines,receipt);
 });
}

export function installOrderDownloads(app,pool){
 const download=async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');if(!uuid(req.params.orderNumber))throw fail(404,'Order not found.');

  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'altego-order-download-'));let disconnected=false;
  req.on('aborted',()=>{disconnected=true;});res.on('close',()=>{disconnected=true;});
  try{
   const files=[],cached=new Map(),names=new Set(),directories=new Map();const product=req.params.productId===undefined?null:Number(req.params.productId);if(product!==null&&(!Number.isSafeInteger(product)||product<1))throw fail(404,'Product not found.');
   await authorized(pool,req,async(sql,allLines,receipt)=>{
    const lines=product===null?allLines:allLines.filter(line=>line.product_id===product);if(!lines.length)throw fail(404,'Product not found in this order.');
    if(product===null){const pdf=await receiptPdf(receipt,allLines);const source=path.join(temp,'receipt.pdf');await fs.writeFile(source,pdf,{flag:'wx'});files.push({source,name:'Receipt.pdf'});}
    for(const line of lines){
     if(disconnected)throw fail(499,'Download cancelled.');
     const {assets}=await ownedResources(sql,req.user.id,line);
     if(!directories.has(line.product_id))directories.set(line.product_id,slug(line.product_name)+'_'+line.product_id);
     const directory=directories.get(line.product_id);
     for(const asset of assets){const kind=asset.kind;
      const key=line.product_id+':'+kind+':'+line.version_id+':'+asset.sha256;let source=cached.get(key);
      if(!source){source=path.join(temp,String(cached.size)+'.'+kind);await fs.writeFile(source,asset.data,{flag:'wx'});cached.set(key,source);}
      const name=kind==='glb'?directory+'/'+slug(line.product_name)+'_v'+line.version_number+'_'+line.version_id+'_'+String(asset.sha256).slice(0,10)+'.glb':directory+'/'+slug(line.variant_name)+'_'+slug(line.variant_id)+'_v'+line.version_id+'.png';
      if(!names.has(name)){names.add(name);files.push({source,name});}
     }
    }
   });
   const archive=path.join(temp,'order.zip');await writeOwnedZip(files,archive);if(disconnected)return;

   await authorized(pool,req,async()=>{});if(disconnected)return;
   await new Promise((resolve,reject)=>res.download(archive,'ALTEGO_Order_'+req.params.orderNumber+(product===null?'':'_Product_'+product)+'.zip',e=>e?reject(e):resolve()));
  }catch(e){if(req.aborted||res.destroyed)return;if(res.headersSent){res.destroy(e);return;}throw e;}
  finally{const real=await fs.realpath(temp);if(path.dirname(real)!==await fs.realpath(os.tmpdir())||!path.basename(real).startsWith('altego-order-download-'))throw Error('Unsafe temporary archive cleanup');await fs.rm(real,{recursive:true,force:true});}
 };
 app.get('/api/account/orders/:orderNumber/download',requireUser,download);
 app.get('/api/account/orders/:orderNumber/products/:productId/download',requireUser,download);
}

