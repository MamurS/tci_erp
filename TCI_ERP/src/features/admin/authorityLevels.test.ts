import { describe, expect, it } from 'vitest'

import M71 from '../../../supabase/migrations/0071_authority_levels.sql?raw'
import { isLive, levelRole, memberCandidates } from './authorityLevels'
import type { AuthorityLevel, LevelMember } from './authorityLevels'

const level = (id: string, rank: number, stream: 'credit' | 'commercial' = 'credit'): AuthorityLevel => ({
  id,
  stream,
  rank,
  is_committee: rank === 5,
  chair_id: null,
})
const levels = [level('c1', 1), level('c2', 2), level('c5', 5), level('m1', 1, 'commercial')]
const member = (level_id: string, user_id: string, valid_to: string | null = null): LevelMember => ({
  id: `${level_id}-${user_id}`,
  level_id,
  user_id,
  valid_from: '2026-01-01',
  valid_to,
})
const people = [
  { user_id: 'a', roles: ['credit_underwriter'] },
  { user_id: 'b', roles: ['credit_underwriter'] },
  { user_id: 'c', roles: ['commercial_underwriter'] },
  { user_id: 'd', roles: ['admin'] },
]

describe('authority level membership (mirror of add_authority_level_member, 0071)', () => {
  it('offers the department only, one rank 1–4 per stream, a committee seat besides', () => {
    const members = [member('c1', 'a')]
    expect(memberCandidates(people, levels[1]!, levels, members, '2026-10-23').map((p) => p.user_id)).toEqual(['b'])
    expect(memberCandidates(people, levels[2]!, levels, members, '2026-10-23').map((p) => p.user_id)).toEqual(['a', 'b'])
    expect(memberCandidates(people, levels[3]!, levels, members, '2026-10-23').map((p) => p.user_id)).toEqual(['c'])
    // an ended membership frees the rank
    expect(
      memberCandidates(people, levels[1]!, levels, [member('c1', 'a', '2026-10-22')], '2026-10-23').map((p) => p.user_id),
    ).toEqual(['a', 'b'])
    expect(M71).toContain('level_member_one_rank: a person sits at one rank per stream')
    expect(M71).toContain("if not exists (select 1 from tci.user_roles r where r.user_id = p_user_id and r.role = tci.validation_role(v_level.stream)) then")
    expect(levelRole('commercial')).toBe('commercial_underwriter')
  })

  it('treats valid_to as inclusive', () => {
    expect(isLive({ valid_from: '2026-01-01', valid_to: '2026-10-23' }, '2026-10-23')).toBe(true)
    expect(isLive({ valid_from: '2026-01-01', valid_to: '2026-10-22' }, '2026-10-23')).toBe(false)
    expect(isLive({ valid_from: '2026-10-24', valid_to: null }, '2026-10-23')).toBe(false)
    expect(M71).toContain('m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)')
  })
})
