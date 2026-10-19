import test from 'node:test';
import assert from 'node:assert/strict';
import {incidentDetail,incidentHistoryItems,localQueueItem,localSubmission} from './presentation-adapter.ts';

const local={id:'incident-1',kind:'incident',author_id:'guard-1',site_id:'site-1',shift_id:'shift-1',
 payload:JSON.stringify({p_category:'theft',p_severity:'high',p_description:'Observed a damaged storage lock.',
  p_reported_at:'2026-10-19T09:00:00Z'}),state:'queued',created_at:'2026-10-19T10:00:00Z',
 received_at:null,public_number:null,error:null};
const server={id:'incident-1',public_number:'BG-INC-000001',site_id:'site-1',category:'theft',
 severity:'high',description:'Observed a damaged storage lock.',reported_at:'2026-10-19T09:00:00Z',
 received_at:'2026-10-19T10:01:00Z',status:'acknowledged'};
const names={'site-1':'Fictional Site'};

test('queued local incident cannot inherit a server receipt or acknowledgement',()=>{
 const list=incidentHistoryItems([local],[server],names);
 assert.equal(list.length,1);
 assert.equal(list[0].deliveryStatus,'queued');
 assert.equal(list[0].serverRef,null);
 const detail=incidentDetail(local,server,[],names);
 assert.equal(detail.deliveryStatus,'queued');
 assert.equal(detail.serverRef,null);
 assert.equal(detail.acknowledgmentVerifiedFromServer,false);
});

test('received local record maps actual server receipt and separately verified follow-up',()=>{
 const received={...local,state:'received',received_at:server.received_at,public_number:server.public_number};
 const summary=localSubmission(received,names);
 assert.equal(summary.serverRef,'BG-INC-000001');
 assert.equal(localQueueItem(received,names).deliveryStatus,'received');
 const update={id:'update-1',update_type:'acknowledged',note:'Reviewed',created_at:'2026-10-19T10:02:00Z'};
 const detail=incidentDetail(received,server,[update],names);
 assert.equal(detail.deliveryStatus,'acknowledged');
 assert.equal(detail.acknowledgmentVerifiedFromServer,true);
 assert.equal(detail.acknowledgedAt,update.created_at);
});

test('server-only history remains viewable without inventing a phone save time',()=>{
 const remote={...server,id:'server-only',status:'reported'};
 const list=incidentHistoryItems([], [remote],names);
 assert.equal(list[0].deliveryStatus,'received');
 assert.equal(list[0].createdAt,'');
 assert.equal(list[0].serverRef,remote.public_number);
 const detail=incidentDetail(null,remote,[],names);
 assert.equal(detail.createdAt,'');
 assert.equal(detail.deliveryStatus,'received');
});
