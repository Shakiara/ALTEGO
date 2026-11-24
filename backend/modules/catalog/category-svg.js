// ALTEGO necesita resolver la validación de iconos SVG de categorías.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {SaxesParser} from 'saxes';
const fail=message=>Object.assign(Error(message),{status:400});
const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const shapes=new Set(['svg','g','path','circle','ellipse','rect','line','polygon','polyline','title','desc']);
const attributes=new Set(['viewBox','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule','clip-rule','d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','width','height','points','transform']);
export function sanitizeCategorySvg(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>16384||!input.trim())throw fail('Choose an SVG icon up to 16 KB.');
 let output='',count=0,root=false,depth=0;const parser=new SaxesParser({xmlns:true});
 parser.on('doctype',()=>{throw fail('SVG document types and entities are not allowed.');});parser.on('processinginstruction',()=>{throw fail('SVG processing instructions are not allowed.');});
 parser.on('opentag',tag=>{
  if(++count>160||tag.uri!=='http://www.w3.org/2000/svg'||!shapes.has(tag.local)||tag.prefix)throw fail('Use a simple SVG with basic vector shapes only.');
  if(depth===0){if(root||tag.local!=='svg')throw fail('Choose a valid SVG document.');root=true;const box=tag.attributes.viewBox?.value?.trim().split(/[\s,]+/).map(Number);if(!box||box.length!==4||box.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000)||box[2]<=0||box[3]<=0)throw fail('The SVG needs a valid viewBox.');}
  else if(tag.local==='svg')throw fail('Nested SVG documents are not allowed.');
  let values='';for(const attr of Object.values(tag.attributes)){
   const key=attr.local,value=attr.value.trim();if(attr.name==='xmlns'&&depth===0)continue;
   if(depth===0&&['role','aria-label'].includes(attr.name)){if(attr.name==='role'&&!['img','presentation','none'].includes(value)||attr.name==='aria-label'&&(value.length>160||/[\u0000-\u001f<>]/.test(value)))throw fail('Use a valid SVG accessibility label or role.');values+=' '+attr.name+'="'+escape(value)+'"';continue;}
   if(attr.prefix||!attributes.has(key)||/url\s*\(|[<>]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(value))throw fail('SVG attribute '+attr.name+' is not allowed. Scripts, styles, links and external resources are prohibited.');
   if(['fill','stroke'].includes(key)&&!['none','currentColor'].includes(value))throw fail('SVG fill and stroke must use currentColor or none.');
   if(key==='d'&&!/^[\s,0-9.eE+\-MmLlHhVvCcSsQqTtAaZz]+$/.test(value))throw fail('Invalid SVG path.');
   if(key==='transform'&&!/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\s,0-9.eE+\-]+\)\s*)+$/.test(value))throw fail('Invalid SVG transform.');
   if(!['fill','stroke','d','transform','stroke-linecap','stroke-linejoin','fill-rule','clip-rule'].includes(key)&&!/^[\s,0-9.eE+\-]+$/.test(value))throw fail('Use numeric SVG geometry.');
   if(key==='stroke-linecap'&&!['butt','round','square'].includes(value)||key==='stroke-linejoin'&&!['miter','round','bevel'].includes(value)||['fill-rule','clip-rule'].includes(key)&&!['nonzero','evenodd'].includes(value))throw fail('Invalid SVG shape style.');
   if(depth===0&&['width','height'].includes(key))continue;values+=' '+key+'="'+escape(value)+'"';
  }
  output+='<'+tag.local+(depth===0?' xmlns="http://www.w3.org/2000/svg"'+(!tag.attributes.fill?' fill="currentColor"':''):'')+values+'>';depth++;
 });
 parser.on('closetag',tag=>{depth--;output+='</'+tag.local+'>';});parser.on('text',text=>{if(text.trim()){if(text.length>160)throw fail('SVG descriptions are too long.');output+=escape(text);}});
 parser.on('cdata',()=>{throw fail('SVG CDATA is not allowed.');});parser.on('error',()=>{throw fail('Choose a valid SVG document.');});
 try{parser.write(input).close();}catch(error){if(error.status)throw error;throw fail('Choose a valid SVG document.');}if(!root||depth!==0)throw fail('Choose a valid SVG document.');return output;
}
