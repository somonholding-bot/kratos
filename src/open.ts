import { execFileSync } from 'node:child_process';
import { config } from './config.ts';
import { issueLoginCode } from './auth.ts';

const url = `http://${config.host}:${config.port}/login?c=${issueLoginCode()}`;
execFileSync('open', [url]);
console.log('Panel de Kratos abierto en el navegador (código de acceso de un solo uso, válido 2 minutos).');
