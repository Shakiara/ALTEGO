// ALTEGO necesita resolver la lectura centralizada de la configuración local.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './environment.js';


try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Could not load the local .env configuration.');
}

export default readConfig();
