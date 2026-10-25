/** «Группа» — the company inside its corporate group.
 *
 * A company with no relationships is a group of one, of which it is its own
 * ultimate parent; the tab still renders, because "this company stands alone"
 * is an underwriting fact worth stating, not an empty screen.
 *
 * Nothing on this tab is ever visible to a client: migration 0038 gives the
 * relationship tables no client policy at all, and 0040 asserts that no
 * client-facing view reaches the group surface.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, ConfirmDialog, Spinner, SectionTitle } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../lib/roles'
import { useEntities, useLatestGrades } from '../entities/api'
import { useClaims } from '../claims'
import {
  useCurrentGroupLimit,
  useEndGroupLimit,
  useEndRelationship,
  useEntityGroup,
  useEntitySuggestions,
  useGroupExposure,
  useGroupExposureLines,
  useGroupFinancials,
  useGroupLimitStatusFor,
  useGroupMemberFinancials,
  useGroupRelationships,
} from './api'
import { groupErrorKey } from './errors'
import { buildOwnershipTree, membersOutsideTree } from './group'
import { GroupExposurePanel } from './GroupExposurePanel'
import { GroupFinancialsPanel } from './GroupFinancialsPanel'
import { GroupLimitModal } from './GroupLimitModal'
import { GroupRatingCard } from './GroupRatingCard'
import { GroupMembersTable } from './GroupMembersTable'
import { GroupTree } from './GroupTree'
import { RelationshipModal } from './RelationshipModal'
import { SuggestionsPanel } from './SuggestionsPanel'

export function GroupTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  const { t } = useTranslation()
  const { roles } = useAuth()

  const mayEdit = hasRole(
    roles,
    'information_manager',
    'credit_underwriter',
    'commercial_underwriter',
  )
  const mayManageLimit = hasRole(roles, 'credit_underwriter')

  const group = useEntityGroup(entityId)
  const members = useMemo(() => group.data ?? [], [group.data])
  const memberIds = useMemo(() => members.map((m) => m.member_id), [members])
  const parentId = members[0]?.ultimate_parent_id

  const relationships = useGroupRelationships(entityId, memberIds)
  const exposure = useGroupExposure(parentId)
  const lines = useGroupExposureLines(parentId)
  const groupLimit = useCurrentGroupLimit(parentId)
  const limitStatus = useGroupLimitStatusFor(parentId)
  const suggestions = useEntitySuggestions(entityId)
  const financials = useGroupFinancials(parentId)
  const memberFinancials = useGroupMemberFinancials(parentId, memberIds)
  const { data: entities } = useEntities()
  const grades = useLatestGrades()
  const claims = useClaims()
  const endRelationship = useEndRelationship()
  const endGroupLimit = useEndGroupLimit()

  const [relationshipOpen, setRelationshipOpen] = useState(false)
  const [limitOpen, setLimitOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Both "end" actions change what the group may hold from today, so each
  // is confirmed — the child whose edge is ending, or the limit.
  const [endingChildId, setEndingChildId] = useState<string | null>(null)
  const [endingLimit, setEndingLimit] = useState(false)

  const names = useMemo(
    () => new Map((entities ?? []).map((e) => [e.id, e.name])),
    [entities],
  )
  const parentName = parentId ? (names.get(parentId) ?? entityName) : entityName

  const tree = useMemo(
    () =>
      parentId
        ? buildOwnershipTree(parentId, names.get(parentId) ?? entityName, relationships.data ?? [])
        : null,
    [parentId, names, entityName, relationships.data],
  )
  const outside = useMemo(
    () => (tree ? membersOutsideTree(tree, memberIds) : []),
    [tree, memberIds],
  )

  // Claims on the group's buyers, not on this company alone: an open claim on
  // a sister is exactly the thing a group view exists to surface.
  const groupClaims = useMemo(
    () => (claims.data ?? []).filter((c) => memberIds.includes(c.buyer_entity_id)),
    [claims.data, memberIds],
  )

  const endingEdge = endingChildId
    ? ((relationships.data ?? []).find((r) => r.child_entity_id === endingChildId && r.is_live) ?? null)
    : null

  const handleEndEdge = async () => {
    setError(null)
    if (!endingEdge) return
    // The edge shows its end date at once (optimistic), so the dialog closes.
    setEndingChildId(null)
    try {
      await endRelationship.mutateAsync({ relationshipId: endingEdge.id })
    } catch (e) {
      setError(t(groupErrorKey(e) ?? 'groups.errors.saveFailed'))
    }
  }

  const handleEndLimit = async () => {
    setError(null)
    if (!parentId) return
    try {
      await endGroupLimit.mutateAsync({ ultimateParentId: parentId })
    } catch (e) {
      setError(t(groupErrorKey(e) ?? 'groups.errors.saveFailed'))
    } finally {
      setEndingLimit(false)
    }
  }

  if (group.isLoading) return <Spinner label={t('common.loading')} />

  const isAlone = members.length <= 1

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="text-[0.8125rem] text-neg-500" role="alert">
          {error}
        </p>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <SectionTitle
          hint={isAlone ? t('groups.tree.alone') : t('groups.tree.summary', { count: members.length, parent: parentName })}
          actions={
            mayEdit && (
              <Button size="sm" variant="secondary" onClick={() => setRelationshipOpen(true)}>
                {t('groups.actions.addRelationship')}
              </Button>
            )
          }
        >
          {t('groups.tree.title')}
        </SectionTitle>

        {tree && !isAlone && <GroupTree tree={tree} focusId={entityId} onEndEdge={mayEdit ? setEndingChildId : undefined} />}

        {outside.length > 0 && (
          <div>
            <h4 className="mb-1 text-[0.8125rem] font-semibold text-slate-700">
              {t('groups.tree.outside')}
            </h4>
            <p className="mb-1.5 text-[0.75rem] text-slate-500">{t('groups.tree.outsideHint')}</p>
            <ul className="flex flex-wrap gap-2">
              {outside.map((id) => (
                <li key={id}>
                  <Badge>{names.get(id) ?? id}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <GroupExposurePanel
        exposure={exposure.data ?? null}
        lines={lines.data ?? []}
        groupLimit={groupLimit.data ?? null}
        status={limitStatus.data ?? null}
        mayManageLimit={mayManageLimit && Boolean(parentId)}
        onSetLimit={() => setLimitOpen(true)}
        onEndLimit={() => setEndingLimit(true)}
      />

      {/* The group's grade caps its members' (0074). */}
      <GroupRatingCard entityId={entityId} />

      <Card className="flex flex-col gap-3 p-5">
        <SectionTitle>{t('groups.members.title')}</SectionTitle>
        <GroupMembersTable
          members={members}
          focusId={entityId}
          names={names}
          grades={grades.data}
          lines={lines.data ?? []}
          claims={groupClaims}
        />
      </Card>

      <GroupFinancialsPanel
        totals={financials.data ?? null}
        members={memberFinancials.data ?? []}
      />

      <SuggestionsPanel
        entityId={entityId}
        suggestions={suggestions.data ?? []}
        isLoading={suggestions.isLoading}
        mayEdit={mayEdit}
      />

      <RelationshipModal
        open={relationshipOpen}
        onClose={() => setRelationshipOpen(false)}
        entityId={entityId}
        entityName={entityName}
      />
      {/* Mounted only while open, so it starts from the limit as it stands now
          rather than from whatever was loaded when the tab first rendered. */}
      {parentId && limitOpen && (
        <GroupLimitModal
          open
          onClose={() => setLimitOpen(false)}
          ultimateParentId={parentId}
          ultimateParentName={parentName}
          currentAmount={groupLimit.data ? Number(groupLimit.data.max_amount) : null}
          currentCurrency={groupLimit.data?.currency_code ?? null}
        />
      )}

      <ConfirmDialog
        open={Boolean(endingEdge)}
        title={t('groups.confirm.endRelationshipTitle')}
        message={
          endingEdge
            ? t('groups.confirm.endRelationshipMessage', {
                parent: endingEdge.parent_name,
                child: endingEdge.child_name,
              })
            : ''
        }
        confirmLabel={t('groups.confirm.endRelationshipAction')}
        pending={endRelationship.isPending}
        onConfirm={() => void handleEndEdge()}
        onCancel={() => setEndingChildId(null)}
      />
      <ConfirmDialog
        open={endingLimit}
        title={t('groups.confirm.endLimitTitle')}
        message={t('groups.confirm.endLimitMessage', { name: parentName })}
        confirmLabel={t('groups.actions.endGroupLimit')}
        pending={endGroupLimit.isPending}
        onConfirm={() => void handleEndLimit()}
        onCancel={() => setEndingLimit(false)}
      />
    </div>
  )
}
