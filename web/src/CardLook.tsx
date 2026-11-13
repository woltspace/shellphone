import { useEffect, useRef } from 'react';
import catalog from './card-assets/catalog.json';
export type Look = { creature: string; hat: string; glasses: string; scene: string };
export const choices = { creature: ['raccoon','beaver','otter'], hat: ['', ...catalog.hats.map(h => h.id)], glasses: ['', 'shades','aviators','rose','nerd'], scene: ['forest','pond','camp','autumn','winter'] };
export function normalizeLook(value: Partial<Look> = {}, creature = 'raccoon'): Look {
  const defaults: Look = {creature: choices.creature.includes(creature) ? creature : 'raccoon', hat:'',glasses:'',scene:'forest'};
  return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k, choices[k as keyof Look].includes(value[k as keyof Look] || '') ? (value[k as keyof Look] ?? '') : v])) as Look;
}
const urls = import.meta.glob('./card-assets/*.png', {eager:true, query:'?url', import:'default'}) as Record<string,string>;
const cache = new Map<string,Promise<HTMLImageElement>>();
function load(id: string) { if (!cache.has(id)) cache.set(id,new Promise((resolve,reject)=>{const im=new Image(); im.onload=()=>resolve(im); im.onerror=()=>{cache.delete(id);reject(new Error('Could not load the look artwork.'));};im.src=urls[`./card-assets/${id}.png`];})); return cache.get(id)!; }
const anchors: Record<string,{hx:number;ht:number;L:number[];R:number[];y:number[]}> = {
 beaver:{hx:8.5,ht:1,L:[3,5],R:[8,11],y:[4,6]},otter:{hx:8.5,ht:1,L:[4,7],R:[10,13],y:[3,5]},raccoon:{hx:9.5,ht:2,L:[4,6],R:[11,13],y:[7,8]}
};
const scenes: Record<string,{sky:string[];ground:string;edge:string;items:[string,number,number?][]}> = {
 forest:{sky:['#22374a','#3d5a64'],ground:'#3c5a2c',edge:'#2c4421',items:[['big-pine',2],['pine',18],['mushroom',33],['fern',76],['pine',88],['acorn',101]]},
 pond:{sky:['#2b4766','#5d8aa0'],ground:'#4a6b33',edge:'#355024',items:[['cattails',2],['pond',14],['lily-pad',30],['fish',78],['dragonfly',90,-24],['cattails',96]]},
 camp:{sky:['#140f24','#2f2140'],ground:'#3a3326',edge:'#28231a',items:[['big-pine',0],['log',16],['campfire',78],['log',94]]},
 autumn:{sky:['#5a3a2a','#b5703e'],ground:'#6b5b2a',edge:'#4d401d',items:[['maple-leaf',10,-22],['stump',4],['mushroom',22],['maple-leaf',84,-28],['acorn',76],['berry-bush',94]]},
 winter:{sky:['#33415c','#8ea4c0'],ground:'#dfe8f2',edge:'#b8c6d6',items:[['big-pine',2],['snowman',22],['rock',78],['pine',94]]}
};
export function LookCanvas({look, scene=false, size=36, className='', label='Wolt'}:{look:Look;scene?:boolean;size?:number;className?:string;label?:string}) {
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let cancelled=false;const s=scenes[look.scene], ids=[`c-${look.creature}`,...(look.hat?[`h-${look.hat}`]:[]),...(scene?s.items.map(([id])=>`n-${id}`):[])];
 Promise.all(ids.map(load)).then(images=>{if(cancelled||!ref.current)return; const cv=ref.current,c=cv.getContext('2d')!;cv.width=scene?112:64;cv.height=scene?64:64;c.imageSmoothingEnabled=false;
 const by=Object.fromEntries(ids.map((id,i)=>[id,images[i]]));
 if(scene){const g=c.createLinearGradient(0,0,0,52);g.addColorStop(0,s.sky[0]);g.addColorStop(1,s.sky[1]);c.fillStyle=g;c.fillRect(0,0,112,64);c.fillStyle=s.ground;c.fillRect(0,52,112,12);c.fillStyle=s.edge;c.fillRect(0,52,112,1);for(const[id,x,dy=0]of s.items){const im=by[`n-${id}`];c.drawImage(im,x,54-im.height+dy);}}
 const im=by[`c-${look.creature}`],a=anchors[look.creature],ox=Math.round((scene?56:32)-im.width/2),oy=(scene?55:60)-im.height;c.drawImage(im,ox,oy);
 if(look.glasses){const g=({shades:['#0b0b10','#16161e','#fff'],aviators:['#c9a23a','#2d4a5c','#bfe6ff'],rose:['#8a1f4a','#ff5fa2','#ffd6ea'],nerd:['#111','','']} as Record<string,string[]>)[look.glasses];const px=(x:number,y:number,col:string)=>{c.fillStyle=col;c.fillRect(ox+x,oy+y,1,1);};const[y0,y1]=a.y;for(const[x0,x1]of[a.L,a.R]){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(g[1]||y===y0||y===y1||x===x0||x===x1)px(x,y,y===y0||!g[1]?g[0]:g[1]);if(g[2])px(x0+1,y1,g[2]);}for(let x=a.L[1]+1;x<a.R[0];x++)px(x,y0,g[0]);px(a.L[0]-1,y0,g[0]);px(a.R[1]+1,y0,g[0]);}
 if(look.hat){const h=by[`h-${look.hat}`];c.drawImage(h,Math.round(ox+a.hx-h.width/2),oy+a.ht-h.height+3);}
 if(!scene){const data=c.getImageData(0,0,64,64).data;let x0=64,y0=64,x1=-1,y1=-1;for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(data[(y*64+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(x1>=x0){const w=x1-x0+1,h=y1-y0+1,n=Math.max(w,h)+2,copy=document.createElement('canvas');copy.width=copy.height=64;copy.getContext('2d')!.drawImage(cv,0,0);cv.width=cv.height=n;c.imageSmoothingEnabled=false;c.drawImage(copy,x0,y0,w,h,Math.floor((n-w)/2),n-h-1,w,h);}}
 }).catch(()=>{if(!cancelled&&ref.current){const c=ref.current.getContext('2d');c?.clearRect(0,0,ref.current.width,ref.current.height);}});return()=>{cancelled=true;};},[look.creature,look.hat,look.glasses,look.scene,scene]);
 return <canvas ref={ref} role="img" aria-label={label} className={className} style={{imageRendering:'pixelated',width:scene?'100%':size,height:scene?'auto':size,aspectRatio:scene?'112 / 64':'1'}}/>;
}
