import { useEffect } from "react"

const literalSources = new WeakMap<Text, string>()
const lastRendered = new WeakMap<Text, string>()
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"])

/**
 * Localises literal UI text while screens are progressively moved to `t()`
 * calls. It deliberately only rewrites text/attributes that have a
 * dictionary entry, so entered data, names, locations, IDs and technical
 * values are left untouched.
 *
 * Each node remembers the value this pass last wrote (or observed). When
 * the DOM text differs on a later pass, React updated the node since then —
 * the fresh value is adopted as the new source to translate rather than
 * restoring a stale original. Without this, dynamic counters (KPIs, map
 * legend counts, badges) freeze at whatever value they first rendered —
 * usually 0 before data loads.
 *
 * `translate` is the dictionary lookup (`t` from usePreferences, no vars).
 *
 * Mark any subtree `data-i18n-skip` to keep it in English.
 */
export function useLocalizedDom(translate: (s: string) => string) {
  useEffect(() => {
    const localize = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      let node: Node | null
      while ((node = walker.nextNode())) nodes.push(node as Text)

      nodes.forEach((textNode) => {
        const parent = textNode.parentElement
        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest("[data-i18n-skip]")) return
        const current = textNode.nodeValue ?? ""
        let original = literalSources.get(textNode)
        if (original === undefined || current !== lastRendered.get(textNode)) {
          // First sighting, or React rewrote the node since our last pass.
          original = current
          literalSources.set(textNode, original)
        }
        const trimmed = original.trim()
        if (!trimmed) {
          lastRendered.set(textNode, current)
          return
        }
        const leading = original.match(/^\s*/)?.[0] ?? ""
        const trailing = original.match(/\s*$/)?.[0] ?? ""
        const next = `${leading}${translate(trimmed)}${trailing}`
        if (next !== current) textNode.nodeValue = next
        lastRendered.set(textNode, next)
      })

      document.querySelectorAll<HTMLElement>("[placeholder], [title], [aria-label]").forEach((element) => {
        ;(["placeholder", "title", "aria-label"] as const).forEach((attribute) => {
          const key = `i18n${attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`
          const outKey = `${key}Out`
          const current = element.getAttribute(attribute)
          if (current === null) {
            delete element.dataset[key]
            delete element.dataset[outKey]
            return
          }
          let original = element.dataset[key]
          // Re-adopt when the attribute changed outside this localiser.
          if (original === undefined || current !== element.dataset[outKey]) {
            original = current
            element.dataset[key] = original
          }
          const translated = translate(original)
          if (translated !== current) element.setAttribute(attribute, translated)
          element.dataset[outKey] = translated
        })
      })
    }

    localize()
    const observer = new MutationObserver(localize)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [translate])
}
