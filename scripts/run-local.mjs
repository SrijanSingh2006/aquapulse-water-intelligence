import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
mkdirSync('.wrangler/logs',{recursive:true});
const args=process.argv.slice(2);
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:'.wrangler/logs/wrangler.log',CLOUDFLARE_CF_FETCH_ENABLED:'false',XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||process.cwd()+'/.wrangler/config'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
