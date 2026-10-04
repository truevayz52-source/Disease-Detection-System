import { useEffect,useState } from "react"
import { useAuth } from "@/lib/auth"
import { listQueue,deleteQueue,putQueue,type QueueItem } from "@/lib/indexeddb"
import { syncQueue } from "@/lib/offline-queue"
import { Workspace,Panel,Action,LoadState } from "@/components/workspace"
import { usePreferences } from "@/lib/preferences"
export default function OfflineSync(){const{t}=usePreferences();
  const {user}=useAuth(),[items,setItems]=useState<QueueItem[]>([]),[error,setError]=useState<Error>()
  async function refresh(){try{setItems((await listQueue()).filter(i=>i.userId===user?.userId))}catch(e){setError(e as Error)}}
  useEffect(()=>{refresh();window.addEventListener("dds-queue",refresh);return()=>window.removeEventListener("dds-queue",refresh)},[user?.userId])
  return <Workspace title={t("Offline Sync")} description={t("Records saved on this device stay assigned to your account. Conflicting or invalid records remain here for review.")}><LoadState error={error} empty={!items.length}/><Action onClick={async()=>{await syncQueue(true);await refresh()}}>{t("Sync now")}</Action>{items.map(item=><Panel key={item.id} title={`${item.status} • ${new Date(item.createdAt).toLocaleString()}`}><p className="text-sm">{(item.payload as any)?.patient?.fullName} • Attempts: {item.attempts}</p>{item.error&&<p className="text-sm text-destructive">{item.error}</p>}<div className="flex gap-3"><Action variant="outline" onClick={async()=>{await putQueue({...item,status:"pending",nextAttempt:0});await syncQueue(true);await refresh()}}>Retry</Action><Action variant="outline" onClick={async()=>{if(window.confirm(t("Permanently remove this unsynced record from this device?"))){await deleteQueue(item.id);await refresh()}}}>{t("Discard record")}</Action></div></Panel>)}</Workspace>
}
