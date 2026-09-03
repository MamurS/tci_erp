/** The ownership tree, hung off the group's ultimate parent.
 *
 * The graph can contain cycles (0038 is explicit about it), so the walk that
 * builds this tree carries a visited set exactly as the SQL does: a company
 * already on the path is drawn as a leaf and marked, never expanded again.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { formatPercent } from '../../lib/format'
import type { TreeNode } from './group'

interface GroupTreeProps {
  tree: TreeNode
  /** The company whose card we are on: highlighted so the reader can place
   * themselves in the tree. */
  focusId: string
  onEndEdge?: (childId: string) => void
}

export function GroupTree({ tree, focusId, onEndEdge }: GroupTreeProps) {
  return (
    <ul className="flex flex-col gap-1">
      <TreeBranch node={tree} focusId={focusId} isRoot onEndEdge={onEndEdge} />
    </ul>
  )
}

function TreeBranch({
  node,
  focusId,
  isRoot = false,
  onEndEdge,
}: {
  node: TreeNode
  focusId: string
  isRoot?: boolean
  onEndEdge?: (childId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const isFocus = node.entityId === focusId

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1">
        <Link
          to={`/entities/${node.entityId}`}
          className={`text-sm hover:underline ${
            isFocus ? 'font-semibold text-slate-900' : 'text-accent-700'
          }`}
        >
          {node.name}
        </Link>
        {isRoot && <Badge tone="accent">{t('groups.ultimateParent')}</Badge>}
        {node.relationshipType && (
          <span className="text-[12px] text-slate-500">
            {t(`groups.relationshipTypes.${node.relationshipType}`)}
          </span>
        )}
        {node.ownershipPct !== null && (
          <span className="text-[12px] font-medium text-slate-700">
            {formatPercent(Number(node.ownershipPct), locale)}
          </span>
        )}
        {node.cyclic && <Badge tone="warn">{t('groups.cyclicEdge')}</Badge>}
        {onEndEdge && !isRoot && !node.cyclic && (
          <button
            type="button"
            onClick={() => onEndEdge(node.entityId)}
            className="text-[12px] text-slate-400 underline hover:text-neg-500"
          >
            {t('groups.actions.endRelationship')}
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 flex flex-col gap-1 border-l border-slate-200 pl-4">
          {node.children.map((child) => (
            <TreeBranch
              key={`${node.entityId}-${child.entityId}`}
              node={child}
              focusId={focusId}
              onEndEdge={onEndEdge}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
