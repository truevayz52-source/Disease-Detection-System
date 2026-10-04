export interface QueueItem {id:string;userId:string;payload:unknown;status:"pending"|"failed"|"conflict";attempts:number;nextAttempt:number;createdAt:string;error?:string}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("dds-offline",1);request.onupgradeneeded=()=>request.result.createObjectStore("queue",{keyPath:"id"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction("queue",mode),request=run(tx.objectStore("queue"));tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error)}})}
export const listQueue=()=>transaction("readonly",s=>s.getAll()) as Promise<QueueItem[]>
export const putQueue=(item:QueueItem)=>transaction("readwrite",s=>s.put(item))
export const deleteQueue=(id:string)=>transaction("readwrite",s=>s.delete(id))
