// ALTEGO necesita resolver la identidad persistente de las variantes de producto.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {validAssetId} from '../../infrastructure/storage/storage-resolver.js';

export const validVariantId=(id,productId)=>Number.isSafeInteger(productId)&&productId>0&&(validAssetId(id)||id==='legacy-'+productId);
