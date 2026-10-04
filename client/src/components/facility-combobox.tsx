import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Check, ChevronsUpDown, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { Facility } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

/** Searchable facility picker — the full registry is ~4k entries, so a plain
 *  select is unusable; this filters as you type. */
export function FacilityCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {const{t}=usePreferences();
  const { data } = useSWR<{ items: Facility[] }>("/facilities", (u: string) => api(u))
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase()
    const all = data?.items ?? []
    if (!query) return all.slice(0, 50)
    return all.filter((f) =>
      `${f.facility_name} ${f.district} ${f.province}`.toLowerCase().includes(query)
    ).slice(0, 50)
  }, [data, q])

  return (
    <div ref={ref} className="relative w-72">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={open ? q : (value || "")}
          placeholder={value || "All facilities"}
          className="pl-8 pr-8"
          onFocus={() => { setOpen(true); setQ("") }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        />
        {value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); setQ("") }}
            aria-label={t("Clear facility filter")}
          >
            <X className="size-4" />
          </button>
        ) : (
          <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover shadow-md">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); setOpen(false) }}
          >
            {!value && <Check className="size-3.5" />} All facilities
          </button>
          {matches.map((f) => (
            <button
              key={f.facility_id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => { e.preventDefault(); onChange(f.facility_name); setOpen(false) }}
            >
              {value === f.facility_name && <Check className="size-3.5" />}
              <span className="flex-1 truncate">{f.facility_name}</span>
              <span className="text-[11px] text-muted-foreground">{f.district}</span>
            </button>
          ))}
          {!matches.length && <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("No facilities match.")}</p>}
        </div>
      )}
    </div>
  )
}
