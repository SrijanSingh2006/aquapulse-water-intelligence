import {readFile,readdir,writeFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import path from 'node:path';
// Standard ZIP records, with a fixed timestamp to keep the downloadable source reproducible.
export async function packageSource(destination){
 const roots=['README.md','LICENSE','package.json','package-lock.json','tsconfig.json','vite.config.ts','wrangler.jsonc','drizzle.config.ts','index.html','.gitignore','.env.example','.openai','.github','src','server','ml','migrations','db','drizzle','docs','scripts','tests','public'];
 const files=[];async function walk(file){const stat=await import('node:fs/promises').then(fs=>fs.stat(file));if(stat.isDirectory()){for(const item of (await readdir(file)).sort())if(!['__pycache__','.DS_Store'].includes(item))await walk(path.join(file,item));}else if(!file.endsWith('.zip')&&!file.endsWith('.pyc'))files.push(file);}
 for(const root of roots)await walk(root);
 const table=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
 const entries=[],directory=[];let offset=0;
 for(const file of files){const name=Buffer.from('aquapulse/'+file.replaceAll('\\','/')),data=await readFile(file),compressed=deflateRawSync(data),crc=crc32(data);const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);entries.push(header,name,compressed);directory.push(central,name);offset+=header.length+name.length+compressed.length;}
 const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);await writeFile(destination,Buffer.concat([...entries,central,end]));console.log(`Packaged ${files.length} source files for download.`);
}
