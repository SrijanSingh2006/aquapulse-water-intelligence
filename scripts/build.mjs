import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { readdir,readFile,mkdir,writeFile,cp,rm } from 'node:fs/promises';
import path from 'node:path';
import {packageSource} from './package-source.mjs';
await rm('dist',{recursive:true,force:true});
await viteBuild();
await packageSource('dist/client/aquapulse-source.zip');
const assets={};
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else assets['/'+path.relative('dist/client',file).replaceAll('\\','/')]={body:(await readFile(file)).toString('base64'),type:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.zip':'application/zip'})[path.extname(file)]||'application/octet-stream'};}}
await walk('dist/client');
await mkdir('dist/server',{recursive:true});
await bundle({entryPoints:['server/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,define:{__STATIC_ASSETS__:JSON.stringify(assets)}});
await mkdir('dist/.openai',{recursive:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/drizzle',{recursive:true});
await writeFile('dist/server/wrangler.json',JSON.stringify({name:'aquapulse',main:'index.js',compatibility_date:'2025-09-01',d1_databases:[{binding:'DB',database_name:'aquapulse',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:'../drizzle'}]},null,2));
console.log('AquaPulse Worker built with embedded frontend assets.');
