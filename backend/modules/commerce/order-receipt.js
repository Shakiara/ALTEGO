// ALTEGO necesita resolver los recibos históricos de las órdenes.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import PDFDocument from 'pdfkit';
const money=(cents,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(cents/100);

export function receiptPdf(order,items){return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:48,info:{Title:'ALTEGO Receipt',Author:'ALTEGO'}}),chunks=[];
 doc.on('data',chunk=>chunks.push(chunk));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const width=doc.page.width-96,bottom=doc.page.height-65;let y;
 function heading(){doc.font('Helvetica-Bold').fontSize(25).fillColor('#925574').text('ALTEGO',48,42);doc.font('Helvetica').fontSize(10).fillColor('#776878').text('Avatar Accessories',48,72);doc.fontSize(20).fillColor('#705474').text('Receipt',415,44,{width:130,align:'right'});y=110;}
 function columns(){doc.rect(48,y,width,25).fill('#f4edf4');doc.fillColor('#705474').font('Helvetica-Bold').fontSize(10).text('Item / Variant / Version',58,y+8,{width:350}).text('Price',430,y+8,{width:105,align:'right'});y+=34;}
 function next(){doc.addPage();heading();columns();}
 heading();doc.font('Helvetica').fontSize(10).fillColor('#453d48').text('Order '+order.order_number,48,y,{width});y=doc.y+8;
 doc.text('Acquired on: '+new Date(order.completed_at).toISOString().replace('T',' ').slice(0,19)+' UTC',48,y);y=doc.y+22;columns();
 for(const item of items){const text=item.product_name+'\n'+item.variant_name+' / Version '+item.version_number;doc.font('Helvetica').fontSize(10);const height=Math.max(38,doc.heightOfString(text,{width:350})+18);if(y+height>bottom)next();doc.font('Helvetica').fontSize(10).fillColor('#453d48').text(text,58,y,{width:350});doc.font('Helvetica-Bold').text(money(item.price_cents,order.currency),430,y,{width:105,align:'right'});y+=height;doc.moveTo(48,y-7).lineTo(48+width,y-7).strokeColor('#e5dce7').stroke();}
 if(y+145>bottom)next();y+=10;
 for(const [label,value]of [['Subtotal',order.subtotal_cents],['Taxes',order.tax_cents],['Total',order.total_cents]]){doc.font(label==='Total'?'Helvetica-Bold':'Helvetica').fontSize(label==='Total'?13:10).fillColor('#705474').text(label,320,y,{width:105}).text(money(value,order.currency),430,y,{width:105,align:'right'});y+=25;}

 doc.font('Helvetica').fontSize(10).fillColor('#925574').text('Thank you for your order!',48,y,{width});doc.end();
});}
