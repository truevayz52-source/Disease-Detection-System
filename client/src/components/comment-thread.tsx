import { useState } from "react"
import useSWR from "swr"
import { api } from "@/lib/api"
import { Panel,Action,LoadState } from "./workspace"
import { useAuth } from "@/lib/auth"
import { usePreferences } from "@/lib/preferences"
export function CommentThread({notificationId}:{notificationId:string}){const{t}=usePreferences();
  const {user}=useAuth(),[text,setText]=useState(""),url=`/comments/death_notifications/${notificationId}`,{data,error,mutate}=useSWR<any>(user?.role==="mortuary_clerk"?null:url,api)
  if(user?.role==="mortuary_clerk")return null
  return <Panel title={t("Case discussion")}><LoadState error={error}/>{data?.items.map((c:any)=><article key={c.comment_id} className="space-y-2 border-b pb-3 text-sm"><p className="font-medium">{c.full_name} <span className="font-normal text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span></p><p className="whitespace-pre-wrap">{c.comment_text}</p>{c.user_id===user?.userId&&<Action variant="outline" onClick={async()=>{await api(`/comments/${c.comment_id}`,{method:"DELETE"});mutate()}}>{t("Delete")}</Action>}</article>)}<label className="block text-sm">{t("Add a comment")}<textarea className="mt-2 block min-h-24 w-full rounded-md border bg-background p-3" value={text} maxLength={4000} onChange={e=>setText(e.target.value)}/></label><Action onClick={async()=>{await api("/comments",{method:"POST",body:JSON.stringify({entityType:"death_notifications",entityId:notificationId,text})});setText("");mutate()}}>{t("Post comment")}</Action></Panel>
}
