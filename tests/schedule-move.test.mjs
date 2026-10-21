import test from 'node:test';
import assert from 'node:assert/strict';
import {movePeriod,addDays} from '../web/schedule-move.js';
import {moveShiftToDay,shiftCoversDay} from '../web/shifts-ui.js';
import {validateShifts} from '../web/shifts-model.js';
test('Moving a period from its middle preserves length, owner and notes across months',()=>{
 const before={id:'e',person_id:'p',kind:'Робота',start:'2026-10-24',end:'2026-10-31',notes:'keep'};
 const after=movePeriod(before,'2026-10-27','2026-11-02');assert.equal(after.start,'2026-10-30');assert.equal(after.end,'2026-11-06');assert.equal(after.person_id,'p');assert.equal(after.notes,'keep');assert.equal(before.start,'2026-10-24');assert.equal(addDays('2026-12-31',1),'2027-01-01');
 assert.throws(()=>movePeriod({...before,returned_on:'2026-10-28'},before.start,'2026-11-01'));assert.throws(()=>movePeriod(before,before.start,'2026-02-30'));
});
test('Moving a night shift preserves Kyiv wall times across DST and rejects closed history',()=>{
 const before={id:'s',warehouse_id:'w',warehouse_name:'Склад',status:'Заплановано',start:'2026-10-23T19:00:00.000Z',end:'2026-10-24T05:00:00.000Z',members:[{id:'p',name:'Тест'}]};
 const after=moveShiftToDay(before,'2026-10-26');assert.equal(after.start,'2026-10-26T20:00:00.000Z');assert.equal(after.end,'2026-10-27T06:00:00.000Z');assert.deepEqual(after.members,before.members);assert.equal(before.start,'2026-10-23T19:00:00.000Z');
 assert.throws(()=>moveShiftToDay({...before,status:'Завершили зміну'},'2026-10-26'));
 assert.equal(shiftCoversDay(before,'2026-10-23'),true);assert.equal(shiftCoversDay(before,'2026-10-24'),true);assert.equal(shiftCoversDay({...before,end:'2026-10-23T21:00:00.000Z'},'2026-10-24'),false);assert.equal(shiftCoversDay({...before,status:'Скасовано'},'2026-10-23'),false);
 const collision={...after,id:'other'};assert.throws(()=>validateShifts({warehouses:[{id:'w',name:'Склад'}],shifts:[after,collision]}),/перетинаються/);
});
