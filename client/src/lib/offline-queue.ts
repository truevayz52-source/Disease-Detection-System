import { api,getToken } from "./api"
import { listQueue,putQueue,deleteQueue } from "./indexeddb"
export function currentOwner():string {try{return JSON.parse(atob((getToken()||"").split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).sub||""}catch{return ""}}
const draftKey=()=>`dds_notification_draft:${currentOwner()}`
export interface NotificationDraft{savedAt:string;data:unknown}
export function saveDraft(data:unknown){if(currentOwner())localStorage.setItem(draftKey(),JSON.stringify({savedAt:new Date().toISOString(),data}))}
export function loadDraft():NotificationDraft|null{try{return JSON.parse(localStorage.getItem(draftKey())||"null")}catch{return null}}
export function clearDraft(){localStorage.removeItem(draftKey())}
export async function enqueue(payload:any){const userId=currentOwner();if(!userId)throw Error("Sign in before queuing a record");await putQueue({id:payload.submissionId||crypto.randomUUID(),userId,payload,status:"pending",attempts:0,nextAttempt:0,createdAt:new Date().toISOString()});window.dispatchEvent(new Event("dds-queue"))}
let syncing=false
export async function syncQueue(force=false){
  if(syncing||!navigator.onLine||!currentOwner())return
  syncing=true
  try{
    const userId=currentOwner(),items=(await listQueue()).filter(i=>i.userId===userId&&i.status!=="conflict"&&(force||i.status==="pending"&&i.nextAttempt<=Date.now())).slice(0,20)
    if(!items.length)return
    const {results}=await api("/offline/sync",{method:"POST",body:JSON.stringify({items:items.map(i=>({id:i.id,payload:i.payload}))})})
    for(const result of results){const item=items.find(i=>i.id===result.id);if(!item)continue;if(result.status==="synced")await deleteQueue(item.id);else await putQueue({...item,status:result.status==="conflict"?"conflict":result.retryable?"pending":"failed",attempts:item.attempts+1,error:result.error,nextAttempt:Date.now()+Math.min(300000,2000*2**item.attempts)})}
  }finally{syncing=false;window.dispatchEvent(new Event("dds-queue"))}
}
