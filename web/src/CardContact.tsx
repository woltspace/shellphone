import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, MessageCircle, Pause, Play, Shuffle } from 'lucide-react';
import { send, say, type Wolt } from './room';
import type { Ctx } from './Message';
import { choices, LookCanvas, normalizeLook, type Look } from './CardLook';
import './CardContact.css';
type Memory = {identity:string;context:string;learnings:string;archive:string};
const sections = [['identity','Who I am'],['context','Working on'],['learnings','Learned'],['archive','Diary']] as const;
export function ContactCard({wolt,ctx,host,look:stored,onClose,onNewChat,onLookSaved}:{wolt:Wolt;ctx:Ctx;host?:string;look?:Partial<Look>;onClose:()=>void;onNewChat:(wolt:string)=>void;onLookSaved?:(look:Look)=>void}) {
 // A keyed inner component prevents another wolt's private card flashing during navigation.
 return <CardBody key={`${ctx.me}:${wolt.wolt}:${wolt.owner}`} {...{wolt,ctx,host,stored,onClose,onNewChat,onLookSaved}}/>;
}
function CardBody({wolt,ctx,host,stored,onClose,onNewChat,onLookSaved}:{wolt:Wolt;ctx:Ctx;host?:string;stored?:Partial<Look>;onClose:()=>void;onNewChat:(wolt:string)=>void;onLookSaved?:(look:Look)=>void}) {
 const owner=ctx.me===wolt.owner, canManage=owner||ctx.me===host;
 const [look,setLook]=useState(()=>normalizeLook(stored,wolt.creature)),[editing,setEditing]=useState(false),[memory,setMemory]=useState<Memory|null>(null),[loading,setLoading]=useState(owner),[note,setNote]=useState(''),[expanded,setExpanded]=useState(''),[busy,setBusy]=useState(false),[paused,setPaused]=useState(!!wolt.paused);
 useEffect(()=>setLook(normalizeLook(stored,wolt.creature)),[stored?.creature,stored?.hat,stored?.glasses,stored?.scene,wolt.creature]);
 useEffect(()=>setPaused(!!wolt.paused),[wolt.paused]);
 useEffect(()=>{if(!owner)return;let live=true;send(`/api/card?wolt=${encodeURIComponent(wolt.wolt)}`,{cache:'no-store'}).then(async r=>{if(!live)return;if(!r?.ok){setNote(r?.status===404?'No memory shared yet.':r?.status===403?'This memory is only available to this wolt’s owner.':'Could not load memory. Close and reopen to retry.');return;}const d=await r.json();if(live)setMemory(Object.fromEntries(sections.map(([k])=>[k,typeof d[k]==='string'?d[k]:''])) as Memory);}).catch(()=>{if(live)setNote('Could not load memory. Close and reopen to retry.');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[owner,wolt.wolt]);
 if(editing)return <LookEditor name={wolt.wolt} initial={look} onCancel={()=>setEditing(false)} onSave={async next=>{const error=await say('/api/look',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wolt:wolt.wolt,look:next})});if(!error){setLook(next);onLookSaved?.(next);setEditing(false);}return error;}}/>;
 return <section className="wolt-card" aria-label={`${wolt.wolt}'s contact card`}>
  <div className="card-stage"><LookCanvas look={look} scene label={`${wolt.wolt} in ${look.scene}`}/><button className="card-back" aria-label="Close contact card" onClick={onClose}><ArrowLeft size={20}/></button>{canManage&&<button className="card-change" onClick={()=>setEditing(true)}>Change look</button>}</div>
  <header className="card-heading"><h2>{wolt.wolt}</h2><p>{owner?'your':`${ctx.person(wolt.owner)?.name || wolt.owner}’s`} {look.creature}</p></header>
  <div className="card-actions"><button onClick={()=>onNewChat(wolt.wolt)}><MessageCircle size={20}/>New chat</button>{canManage&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const e=await say('/api/wolt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wolt:wolt.wolt,state:paused?'on':'paused'})});if(e)setNote(e);else setPaused(!paused);}catch{setNote('Could not change pause state.');}finally{setBusy(false);}}}>{paused?<Play size={20}/>:<Pause size={20}/>} {paused?'Resume':'Pause'}</button>}</div>
  {owner&&<><h3 className="card-section">About {wolt.wolt} <small>· only you see this</small></h3>{loading&&<p className="card-note" role="status">Loading memory…</p>}{memory&&sections.map(([key,label])=><div key={key}><button className="card-memory" aria-expanded={expanded===key} onClick={()=>setExpanded(expanded===key?'':key)}><span><strong>{label}</strong><small>{memory[key]?.split('\n').find(x=>x.trim())||'Nothing shared yet'}</small></span><ChevronRight size={18}/></button>{expanded===key&&<div className="card-prose">{memory[key]||'Nothing shared yet.'}</div>}</div>)}</>}
  {note&&<p className="card-note" role="status">{note}</p>}
 </section>;
}
export function LookEditor({name,initial,onCancel,onSave}:{name:string;initial:Look;onCancel:()=>void;onSave:(look:Look)=>Promise<string|null>}) {
 const [draft,setDraft]=useState(initial),[tab,setTab]=useState<keyof Look>('hat'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="wolt-card" aria-label={`${name}'s look`}><header className="card-editor-head"><button disabled={busy} onClick={onCancel}>Cancel</button><h2>{name}’s look</h2><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setError(await onSave(draft)||'');}catch{setError('Could not save your look. Try again.');}finally{setBusy(false);}}}>{busy?'Saving…':'Done'}</button></header>
 <LookCanvas look={draft} scene label={`${name}'s preview`}/>
 <div className="card-tabs" aria-label="Look category">{(Object.keys(choices) as (keyof Look)[]).map(k=><button key={k} disabled={busy} aria-pressed={tab===k} onClick={()=>setTab(k)}>{k==='glasses'?'Glasses':k[0].toUpperCase()+k.slice(1)}</button>)}<button disabled={busy} aria-label="Surprise me" onClick={()=>setDraft(Object.fromEntries(Object.entries(choices).map(([k,v])=>[k,v[Math.floor(Math.random()*v.length)]])) as Look)}><Shuffle size={18}/></button></div>
 <div className="card-options">{choices[tab].map(value=><button key={value} disabled={busy} aria-label={value.replaceAll('-',' ')||'None'} aria-pressed={draft[tab]===value} onClick={()=>setDraft({...draft,[tab]:value})}><LookCanvas look={{...draft,[tab]:value}} scene={tab==='scene'} size={44} label={value||'None'}/><small>{value.replaceAll('-',' ')||'None'}</small></button>)}</div>
 <h3 className="card-section">Face everywhere</h3><div className="card-previews">{[64,36,24].map(size=><LookCanvas key={size} look={draft} size={size} label={`${size} pixel preview`}/>)}<small>Everyone in the room sees this look.</small></div>{error&&<p className="card-note" role="alert">{error}</p>}
 </section>;
}
