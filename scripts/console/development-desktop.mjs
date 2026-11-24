// ALTEGO necesita resolver la compilación local de la interfaz WPF.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';

export async function desktopExecutable(root){
 const directory=path.join(root,'scripts/console/desktop'),source=path.join(directory,'Desktop.cs'),manifest=path.join(directory,'Desktop.manifest'),icon=path.join(directory,'altego.ico');
 const digest=createHash('sha256').update(await fs.readFile(source)).update(await fs.readFile(manifest)).update(await fs.readFile(icon)).digest('hex');
 const cache=path.join(os.tmpdir(),'altego-dev-console',digest),executable=path.join(cache,'Altego.DevConsole.exe');
 try{const bytes=await fs.readFile(executable),record=JSON.parse(await fs.readFile(executable+'.json','utf8'));if(createHash('sha256').update(bytes).digest('hex')===record.sha256)return executable;}catch{}
 const framework=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319');try{await fs.access(path.join(framework,'csc.exe'));await fs.access(path.join(framework,'WPF/PresentationFramework.dll'));}catch{throw Error('Windows WPF/.NET Framework with its C# compiler is required. Enable .NET Framework in Windows or install it manually, then reopen ALTEGO. No system software was installed.');}await fs.mkdir(cache,{recursive:true});
 const references=['System.Core.dll','System.Xml.dll','System.Xaml.dll','System.Web.Extensions.dll'].map(name=>path.join(framework,name));references.push(...['WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll'].map(name=>path.join(framework,'WPF',name)));
 try{await promisify(execFile)(path.join(framework,'csc.exe'),['/nologo','/target:winexe','/main:Altego.EntryPoint','/out:'+executable,'/win32manifest:'+manifest,'/win32icon:'+icon,...references.map(file=>'/reference:'+file),source],{windowsHide:true,maxBuffer:2*1024*1024});}catch(error){throw Error('Could not compile the WPF desktop: '+(error.stdout||error.message));}
 const sha256=createHash('sha256').update(await fs.readFile(executable)).digest('hex');await fs.writeFile(executable+'.json',JSON.stringify({sha256,sourceDigest:digest}));return executable;
}
