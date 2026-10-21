import test from 'node:test';
import assert from 'node:assert/strict';
import {personnelSummary,personnelStatus} from '../web/personnel-summary.js';
test('Global summary includes group shifts, excludes archived people and never double-counts',()=>{
 const state={people:[{id:'a'},{id:'b'},{id:'c'},{id:'d',archived:true}],events:[{person_id:'b',kind:'Відпустка',start:'2026-10-01',end:'2026-10-31'}],shifts:[{start:'2026-10-21T05:00:00Z',end:'2026-10-30T17:00:00Z',status:'Заплановано',members:[{id:'a'},{id:'b'}]}]};
 assert.deepEqual(personnelSummary(state,'2026-10-21'),{total:3,work:1,absence:1,free:1});assert.equal(personnelStatus(state,state.people[1],'2026-10-21'),'absence');
 state.shifts[0].status='Скасовано';assert.equal(personnelSummary(state,'2026-10-21').work,0);
});
test('Return date releases absence and ordinary work periods still contribute',()=>{
 const state={people:[{id:'a'},{id:'b'}],events:[{person_id:'a',kind:'Лікарня',start:'2026-10-01',end:'2026-10-31',returned_on:'2026-10-21'},{person_id:'b',kind:'Робота',start:'2026-10-21',end:'2026-10-24'}]};
 assert.deepEqual(personnelSummary(state,'2026-10-21'),{total:2,work:1,absence:0,free:1});
});
