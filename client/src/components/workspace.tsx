import { useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { SiteHeader } from "./site-header"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "sonner"
import { usePreferences } from "@/lib/preferences"
export function Workspace({title,description,children}:{title:string;description?:string;children:ReactNode}){const{t}=usePreferences();
  return <><SiteHeader title={title}/><main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("MOHCC • Disease Detection System")}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>{description&&<p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>}</div>{children}</main></>
}
export function Panel({title,children}:{title:string;children:ReactNode}){return <section className="overflow-hidden rounded-xl border bg-card shadow-lg"><h3 className="border-b bg-muted/50 px-5 py-3.5 text-sm font-bold text-foreground">{title}</h3><div className="space-y-4 p-5">{children}</div></section>}
export function Field({label,value,onChange,type="text",required=false}:{label:string;value:string;onChange:(v:string)=>void;type?:string;required?:boolean}){return <label className="block space-y-1.5 text-sm"><span className="font-medium">{label}{required&&<span className="ml-0.5 text-destructive">*</span>}</span><Input type={type} value={value} onChange={e=>onChange(e.target.value)} required={required}/></label>}
export function Action({children,onClick,variant="default",disabled=false}:{children:ReactNode;onClick?:()=>Promise<unknown>;variant?:"default"|"outline"|"destructive";disabled?:boolean}){
  const{t}=usePreferences();const [busy,setBusy]=useState(false)
  return <Button variant={variant} disabled={busy||disabled} onClick={async()=>{if(!onClick)return;setBusy(true);try{await onClick()}catch(e){toast.error(e instanceof Error?e.message: t("Action failed"))}finally{setBusy(false)}}}>{busy?<><Loader2 className="size-4 animate-spin"/>{t("Working…")}</>:children}</Button>
}
export function LoadState({error,loading,empty}:{error?:Error;loading?:boolean;empty?:boolean}){const{t}=usePreferences();if(error)return <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive">{error.message}</p>;if(loading)return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>{t("Loading…")}</p>;if(empty)return <p className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">{t("No records yet.")}</p>;return null}
export function Rows({items,columns}:{items:Record<string,any>[];columns:[string,string][]}){return <div className="overflow-hidden overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-sidebar"><tr>{columns.map(([key,label])=><th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground" key={key}>{label}</th>)}</tr></thead><tbody>{items.map((row,i)=><tr className="border-t transition-colors hover:bg-muted/50 odd:bg-muted/25" key={i}>{columns.map(([key])=><td className="max-w-sm break-words px-3 py-2.5" key={key}>{row[key]===null||row[key]===undefined?"—":String(row[key])}</td>)}</tr>)}</tbody></table></div>}
