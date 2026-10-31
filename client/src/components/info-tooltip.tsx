import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Small (i) hover tooltip for charts — states what model/data generated the
 * visual and how a viewer should read it, so no one has to narrate the UI.
 */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
    <Tooltip>
      <TooltipTrigger
          aria-label={text}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
    </TooltipProvider>
  )
}
