import ELK from 'elkjs/lib/elk-api'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'
import type cytoscape from 'cytoscape'

const partition = (kind: string) => ['Person', 'Thread', 'Message'].includes(kind) ? 0 : kind === 'Assertion' ? 1 : 2

/** Layout runs in a worker. Layout-only edge orientation never changes the stored relations. */
export function knowledgeLayout(cy: cytoscape.Core, vertical: boolean) {
  const elk = new ELK({ workerFactory: () => new Worker(workerUrl) })
  const nodes = cy.nodes()
  const ranks = new Map(nodes.map((n) => [n.id(), partition(n.data('kind'))]))
  const done = elk.layout({
    id: 'knowledge',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': vertical ? 'DOWN' : 'RIGHT',
      'elk.partitioning.activate': 'true',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.separateConnectedComponents': 'false',
      'elk.randomSeed': '1',
    },
    children: nodes.map((n) => ({
      id: n.id(), width: n.outerWidth(), height: n.outerHeight(),
      layoutOptions: { 'elk.partitioning.partition': String(ranks.get(n.id())) },
    })),
    edges: cy.edges().map((e) => {
      const s = e.source().id(), t = e.target().id()
      const reverse = ranks.get(s)! > ranks.get(t)!
      return { id: e.id(), sources: [reverse ? t : s], targets: [reverse ? s : t] }
    }),
  }).then((graph) => new Map((graph.children ?? []).map((n) => [n.id, {
    x: (n.x ?? 0) + (n.width ?? 0) / 2,
    y: (n.y ?? 0) + (n.height ?? 0) / 2,
  }])))
  return { done, cancel: () => elk.terminateWorker() }
}
