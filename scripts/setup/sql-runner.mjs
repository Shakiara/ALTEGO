// ALTEGO necesita resolver la ejecución de SQL con delimitadores y cuerpos de triggers.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export function sqlStatements(source){
 const statements=[];let buffer='',delimiter=';',quote=null,lineComment=false,blockComment=false;
 for(let i=0;i<source.length;i++){
  if(!quote&&!lineComment&&!blockComment&&(i===0||source[i-1]==='\n')){
   const match=source.slice(i).match(/^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*\r?\n/i);
   if(match){if(buffer.replace(/--[^\n]*(?:\n|$)/g,'').trim())throw Error('Unexpected DELIMITER inside a statement.');buffer='';delimiter=match[1];i+=match[0].length-1;continue;}
  }
  const c=source[i],next=source[i+1];
  if(lineComment){buffer+=c;if(c==='\n')lineComment=false;continue;}
  if(blockComment){buffer+=c;if(c==='*'&&next==='/'){buffer+=next;i++;blockComment=false;}continue;}
  if(quote){buffer+=c;if(c==='\\'){if(next!==undefined){buffer+=next;i++;}}else if(c===quote){if(next===quote){buffer+=next;i++;}else quote=null;}continue;}
  if(c==='-'&&next==='-'&&/\s/.test(source[i+2]||'')){lineComment=true;buffer+=c;continue;}
  if(c==='/'&&next==='*'){blockComment=true;buffer+=c;continue;}
  if(c==='\''||c==='"'||c==='`'){quote=c;buffer+=c;continue;}
  if(source.startsWith(delimiter,i)){if(buffer.trim())statements.push(buffer.trim());buffer='';i+=delimiter.length-1;continue;}
  buffer+=c;
 }
 if(quote||blockComment)throw Error('Unterminated SQL literal or comment.');
 if(buffer.replace(/--[^\n]*(?:\n|$)/g,'').trim())throw Error('SQL statement requires a delimiter.');
 return statements;
}
export async function executeInstallationSql(sql,source,database){
 if(!/^[A-Za-z0-9_]{1,64}$/.test(database))throw Error('Invalid installation database name.');
 for(const statement of sqlStatements(source.replaceAll('`tienda_avatares_2053`','`'+database+'`')))await sql.query(statement);
}
