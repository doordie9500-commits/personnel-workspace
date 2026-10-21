import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShifts,prepareShifts,hours} from '../web/shifts-model.js';
import {validate,diff} from '../cloudflare/worker.js';
import {utc} from '../web/shifts-ui.js';
const warehouse={id:'w',name:'АТБ 1',number:'1',address:'',archived:false};
const shift=(id='s',start='2026-10-21T05:00:00.000Z',end='2026-10-21T17:00:00.000Z')=>({id,warehouse_id:'w',warehouse_name:'АТБ 1',group:'Група 1',start,end,actual_end:'',status:'Заплановано',members:[{id:'p',name:'Іван'}],responsible_id:'p',notes:''});
const state=()=>({title:'Тест',people:[{id:'p',name:'Іван',archived:false}],groups:[],roles:[],events:[],warehouses:[{...warehouse}],shifts:[shift()]});
test('Overlap, overnight, adjacent shifts, malformed dates and archive protection',()=>{
 const s=state();s.shifts.push(shift('two','2026-10-21T16:00:00.000Z','2026-10-22T05:00:00.000Z'));assert.throws(()=>validateShifts(s),/перетинаються/);
 s.shifts[1].start=s.shifts[0].end;assert.equal(validateShifts(s).shifts.length,2);
 s.warehouses[0].archived=true;assert.throws(()=>validateShifts(s),/активні/);s.warehouses[0].archived=false;
 s.shifts[1].status='Скасовано';s.shifts[1].start=s.shifts[0].start;assert.equal(validateShifts(s).shifts.length,2);
 s.shifts[0].end='2026-02-30T17:00:00Z';assert.throws(()=>validateShifts(s));
});
test('Historical participants survive removal; creators are server supplied; history cannot be deleted',()=>{
 let s=state();prepareShifts(s,{}, {id:'actor'});assert.equal(s.shifts[0].created_by,'actor');s=validate(s);
 const changed=structuredClone(s);changed.people=[];assert.equal(validate(prepareShifts(changed,s,{id:'other'})).shifts[0].members[0].name,'Іван');
 const removed=structuredClone(s);removed.shifts=[];assert.throws(()=>prepareShifts(removed,s,{id:'actor'}),/видаляти/);
 const finished=structuredClone(s);finished.shifts[0].status='Завершили зміну';finished.shifts[0].actual_end='2026-10-21T18:00:00.000Z';prepareShifts(finished,s,{id:'other'});assert.equal(hours(finished.shifts[0]),13);assert.equal(finished.shifts[0].created_by,'actor');assert.equal(finished.shifts[0].updated_by,'other');
 const edited=structuredClone(finished);edited.shifts[0].notes='rewrite';assert.throws(()=>prepareShifts(edited,finished,{id:'actor'}),/Історична/);
 assert.ok(diff(s,finished).some(d=>d.table==='shifts'));
});
test('Old state loads additively; stale clients preserve shift tables',()=>{
 const old={title:'Тест',people:[],events:[],groups:[],roles:[]};assert.deepEqual(validate(old).shifts,[]);const before=state();prepareShifts(old,before,{id:'x'});assert.equal(old.shifts.length,1);
});
test('Kyiv wall times support winter/summer and reject DST gaps/ambiguities',()=>{
 assert.equal(utc('2026-10-21T08:00'),'2026-10-21T05:00:00.000Z');assert.equal(utc('2026-12-21T08:00'),'2026-12-21T06:00:00.000Z');assert.throws(()=>utc('2026-03-29T03:30'));assert.throws(()=>utc('2026-10-25T03:30'));
});
