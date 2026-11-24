// ALTEGO necesita resolver la navegación entre páginas de resultados.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export function pageNumbers(page:number,total:number):number[]{if(total<=7)return Array.from({length:total},(_,i)=>i+1);const values=[1,...Array.from({length:3},(_,i)=>Math.max(2,Math.min(page-1,total-3))+i),total];const result:number[]=[];for(const n of values){if(result.length&&n-result[result.length-1]>1)result.push(0);result.push(n);}return result;}
