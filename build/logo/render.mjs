import {createRequire} from 'module';
const puppeteer=createRequire(import.meta.url)('/private/tmp/claude-501/-Users-jotharshhh-Projects/fbfd4abe-00d7-4bff-a4d8-c81710a86022/scratchpad/sitesnap-test/node_modules/puppeteer-core');
import fs from 'fs';
const svg=fs.readFileSync('logo.svg','utf8');
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage();
for(const [size,out] of [[1024,'logo-1024.png'],[512,'logo-512.png']]){
  await p.setViewport({width:size,height:size});
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await p.screenshot({path:out,omitBackground:true,clip:{x:0,y:0,width:size,height:size}});
}
await b.close();
