interface Node { type: string; value?: string; children?: Node[]; data?: { hName?: string } }
const opening = /^<(u|sup|sub|mark)>$/i
const closing = /^<\/(u|sup|sub|mark)>$/i

/** Only these attribute-free inline tags become elements; all other HTML remains disabled. */
export function remarkSafeFormatting() {
  return (tree: Node) => {
    function visit(node: Node) {
      if (!node.children) return
      node.children.forEach(visit)
      const result: Node[] = []
      const stack: Array<{ tag: string; original: Node; children: Node[] }> = []
      const append = (child: Node) => (stack.at(-1)?.children ?? result).push(child)
      for (const child of node.children) {
        const open = child.type === 'html' ? opening.exec(child.value ?? '') : null
        const close = child.type === 'html' ? closing.exec(child.value ?? '') : null
        if (open) { stack.push({ tag: open[1].toLowerCase(), original: child, children: [] }); continue }
        if (close && stack.at(-1)?.tag === close[1].toLowerCase()) {
          const group = stack.pop()!
          append({ type: 'emphasis', children: group.children, data: { hName: group.tag } }); continue
        }
        append(child)
      }
      while (stack.length) { const unclosed = stack.pop()!; (stack.at(-1)?.children ?? result).push(unclosed.original, ...unclosed.children) }
      node.children = result
    }
    visit(tree)
  }
}
