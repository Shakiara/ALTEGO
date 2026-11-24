// ALTEGO necesita resolver la generación del icono de escritorio desde el recurso original.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';import {createRequire} from 'node:module';const sharp=createRequire(new URL('../../backend/package.json',import.meta.url))('sharp');

const source=await fs.readFile(new URL('../../frontend/public/altego-icon.svg',import.meta.url)),sizes=[16,24,32,48,64,128,256],images=await Promise.all(sizes.map(size=>sharp(source,{density:384}).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
for(let i=0;i<sizes.length;i++){const entry=6+i*16;header[entry]=header[entry+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;}
await fs.writeFile(new URL('../console/desktop/altego.ico',import.meta.url),Buffer.concat([header,...images]));console.log('Original ALTEGO favicon converted to Windows ICO (7 sizes).');
