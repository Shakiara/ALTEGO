// ALTEGO necesita resolver la validación e incorporación de archivos GLB y PNG.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {creatorStorageEnabled} from './storage-identity.js';
import { randomUUID, createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {storageRoot,writeAssetFile} from './storage-resolver.js';
import {storeTemporaryUpload} from './upload-staging.js';
export {storageRoot};
export const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function validateGlb(data){
 if(data.length<28||data.length>25*1024*1024||data.readUInt32LE(0)!==0x46546c67||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length)throw fail('Upload a valid GLB 2.0 file (maximum 25 MB).');
 let offset=12,doc,bin=0;
 while(offset<data.length){if(offset+8>data.length)throw fail('Invalid GLB chunk.');const size=data.readUInt32LE(offset),type=data.readUInt32LE(offset+4);offset+=8;if(size%4||offset+size>data.length)throw fail('Invalid GLB chunk length.');if(!doc){if(type!==0x4e4f534a)throw fail('Missing GLB JSON.');try{doc=JSON.parse(data.subarray(offset,offset+size).toString());}catch{throw fail('Invalid GLB JSON.');}}else if(type===0x004e4942)bin=size;offset+=size;}
 if(doc?.asset?.version!=='2.0'||!Array.isArray(doc.meshes)||!doc.meshes.length||!Array.isArray(doc.scenes)||!doc.scenes.length)throw fail('GLB must contain a scene and mesh.');
 for(const key of ['buffers','bufferViews','accessors','images','materials','nodes','extensionsRequired'])if(doc[key]!==undefined&&!Array.isArray(doc[key]))throw fail('Invalid GLB '+key+' structure.');
 if((doc.buffers||[]).some(b=>b.uri||b.byteLength>bin)||(doc.images||[]).some(i=>i.uri))throw fail('GLB must embed its buffers and images; external resources are not supported.');
 for(const view of doc.bufferViews||[])if(view.buffer!==0||!Number.isInteger(view.byteLength)||view.byteLength<0||!Number.isInteger(view.byteOffset||0)||(view.byteOffset||0)<0||(view.byteOffset||0)+view.byteLength>bin)throw fail('Invalid GLB buffer range.');

 for(const mesh of doc.meshes)if(!Array.isArray(mesh.primitives)||!mesh.primitives.length)throw fail('GLB meshes must contain primitives.');
 const primitives=doc.meshes.flatMap(m=>m.primitives);
 for(const primitive of primitives){if(!primitive.attributes||!doc.accessors?.[primitive.attributes.POSITION])throw fail('GLB mesh positions are missing.');}
 for(const accessor of doc.accessors||[]){const view=doc.bufferViews?.[accessor.bufferView];const size={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[accessor.componentType];const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16}[accessor.type];if(!size||!components||!Number.isInteger(accessor.count)||accessor.count<1)throw fail('Invalid GLB accessor.');if(accessor.bufferView!==undefined&&(!view||(accessor.byteOffset||0)+(accessor.count-1)*(view.byteStride||size*components)+size*components>view.byteLength))throw fail('GLB accessor exceeds its buffer.');}
 const compatible=primitives.length>0&&primitives.every(p=>Number.isInteger(p.material)&&doc.materials?.[p.material]&&Number.isInteger(p.attributes?.TEXCOORD_0)&&doc.accessors?.[p.attributes.TEXCOORD_0]?.type==='VEC2'&&!(doc.materials[p.material].pbrMetallicRoughness?.baseColorTexture?.texCoord>0)&&!(doc.materials[p.material].pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform?.texCoord>0))&&(doc.extensionsRequired||[]).every(e=>e==='KHR_texture_transform');
 return {compatible,materials:doc.materials?.length||0};
}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export function validatePng(data){
 if(data.length<45||data.length>10*1024*1024||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw fail('Upload a valid PNG (maximum 10 MB).');
 let offset=8,width,height,channels,ended=false;const chunks=[];
 while(offset<data.length){if(offset+12>data.length)throw fail('Truncated PNG.');const size=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8);if(offset+12+size>data.length)throw fail('Invalid PNG chunk.');if(crc32(data.subarray(offset+4,offset+8+size))!==data.readUInt32BE(offset+8+size))throw fail('PNG checksum failed.');
 if(offset===8&&type!=='IHDR')throw fail('Missing PNG header.');
 if(type==='IHDR'){if(offset!==8||size!==13)throw fail('Invalid PNG header.');width=data.readUInt32BE(offset+8);height=data.readUInt32BE(offset+12);channels={0:1,2:3,4:2,6:4}[data[offset+17]];if(size!==13||!width||!height||width>4096||height>4096||data[offset+16]!==8||!channels||data[offset+18]||data[offset+19]||data[offset+20])throw fail('Use a non-interlaced 8-bit RGB/RGBA or grayscale PNG, up to 4096 × 4096.');}
 if(type==='IDAT')chunks.push(data.subarray(offset+8,offset+8+size));offset+=12+size;if(type==='IEND'){ended=true;break;}}
 if(!ended||offset!==data.length||!chunks.length)throw fail('Incomplete PNG.');
 try{const row=width*channels+1,decoded=inflateSync(Buffer.concat(chunks),{maxOutputLength:row*height});if(decoded.length!==row*height)throw Error();for(let i=0;i<height;i++)if(decoded[i*row]>4)throw Error();}catch{throw fail('PNG image data cannot be decoded.');}
 return {width,height};
}
export async function storeAsset(sql,ownerId,kind,data,{temporary=false}={}){
 const metadata=kind==='glb'?validateGlb(data):validatePng(data);
 if(temporary||creatorStorageEnabled())return storeTemporaryUpload(sql,ownerId,kind,data,metadata);
 const assetId=randomUUID();
 const descriptor={id:assetId,owner_id:ownerId,kind,sha256:createHash('sha256').update(data).digest('hex'),storage_layout:'legacy'};
 await writeAssetFile(descriptor,'original',data);await writeAssetFile(descriptor,'preview',data);
 await sql.execute('INSERT INTO assets (id,owner_id,kind,sha256,byte_size,metadata) VALUES (?,?,?,?,?,?)',[assetId,ownerId,kind,createHash('sha256').update(data).digest('hex'),data.length,JSON.stringify(metadata)]);
 return {id:assetId,kind,...metadata,preview_url:'/api/previews/'+assetId};
}
