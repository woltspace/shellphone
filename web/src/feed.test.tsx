// @vitest-environment jsdom
import React from 'react';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,act,cleanup} from '@testing-library/react';
import {Feed} from './App';
const m=(n:number)=>({id:`m${n}`,n,at:1700000000,kind:'human',email:'other',text:`message ${n}`});
const ctx:any={me:'me',person:(e:string)=>({email:e,name:e,color:'#888'}),wolts:[],people:[],seen:{},all:[],looks:{},view:()=>{},retry:()=>{},openPage:()=>{}};
const base:any={ctx,working:{},stick:{current:()=>{}},seen:{main:1,A:1,B:1}};
function advance(ms:number){act(()=>vi.advanceTimersByTime(ms));}
beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'hidden',{configurable:true,value:false});vi.stubGlobal('IntersectionObserver',class {cb:any;constructor(cb:any){this.cb=cb}observe(){this.cb([{isIntersecting:true}])}disconnect(){}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('actual Feed/NewLine from working tree',()=>{
it('Everyone preserves arrivals under an open thread, then shows and fades its line',()=>{
 const v=render(<Feed {...base} list={[m(1)]}/>);
 v.rerender(<Feed {...base} list={[m(1)]} covered/>);
 v.rerender(<Feed {...base} list={[m(1),m(2)]} covered/>);
 advance(4000); expect(v.container.querySelector('[data-new]')?.getAttribute('aria-hidden')).toBe('false');
 v.rerender(<Feed {...base} list={[m(1),m(2)]}/>);
 expect(v.container.querySelector('[data-new]')?.textContent).toContain('1 new');
 expect(v.container.querySelector('[data-mid="m1"]')?.className).toContain('opacity-55');
 advance(1999);expect(v.container.querySelector('[data-new]')?.getAttribute('aria-hidden')).toBe('false');
 advance(1);expect(v.container.querySelector('[data-new]')?.getAttribute('aria-hidden')).toBe('true');
 advance(600);expect(v.container.querySelector('[data-new]')).toBeNull();
});
it('A → B → A keeps unread arriving in A while away, even when B has not faded',()=>{
 const v=render(<Feed {...base} place="A" list={[m(1)]}/>);
 v.rerender(<Feed {...base} place="B" list={[m(1),m(2)]}/>);
 advance(500);
 v.rerender(<Feed {...base} place="A" list={[m(1),m(3)]}/>);
 expect(v.container.querySelector('[data-mid="m3"] [data-new]')?.textContent).toContain('1 new');
 advance(1500);expect(v.container.querySelector('[data-new]')?.getAttribute('aria-hidden')).toBe('false');
 advance(1100);expect(v.container.querySelector('[data-new]')).toBeNull();
});
it('messages arriving while caught up do not leave a new line or dim',()=>{
 const v=render(<Feed {...base} list={[m(1)]}/>);
 v.rerender(<Feed {...base} list={[m(1),m(2)]}/>);
 expect(v.container.querySelector('[data-new]')).toBeNull();
 expect(v.container.querySelector('.opacity-55')).toBeNull();
});
});
