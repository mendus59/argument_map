import { describe, expect, it } from 'vitest'
import { analyseClaim, negateClause, singular } from './logic'

const variant = (text: string, name: string) => analyseClaim(text).variants.find((v) => v.name === name)?.text

describe('claim builder', () => {
  it('negates an “all” claim the way a person would say it', () => {
    expect(variant('All undocumented immigrants are criminals.', 'Opposite')).toBe('At least one undocumented immigrant is not a criminal.')
    expect(variant('All undocumented immigrants are criminals.', 'Converse')).toBe('All criminals are undocumented immigrants.')
    expect(analyseClaim('All undocumented immigrants are criminals.').variants.find((v) => v.name === 'Contrapositive')?.equivalent).toBe(true)
    expect(variant('Every child deserves an education', 'Opposite')).toBe('Not every child deserves an education.')
    expect(analyseClaim('All illegal immigrant criminals should be deported.').watchWords).toEqual(['all'])
  })

  it('works out all four forms of an “if… then…” claim', () => {
    const c = 'If it is raining, then the ground is wet.'
    expect(variant(c, 'Opposite')).toBe('It is raining, and yet the ground is not wet.')
    expect(variant(c, 'Contrapositive')).toBe('If the ground is not wet, then it is not raining.')
    expect(variant(c, 'Converse')).toBe('If the ground is wet, then it is raining.')
    expect(variant(c, 'Inverse')).toBe('If it is not raining, then the ground is not wet.')
  })

  it('handles “no”, “some”, “only” and “should” claims', () => {
    expect(variant('No vaccines are dangerous', 'Opposite')).toBe('At least one vaccine is dangerous.')
    expect(variant('Some politicians are honest', 'Opposite')).toBe('No politicians are honest.')
    expect(variant('Some politicians like dogs', 'Opposite')).toBe('No politicians like dogs.')
    expect(variant('Only citizens are voters', 'Same as')).toBe('All voters are citizens.')
    expect(analyseClaim('Buses should be free.').shape).toBe('should')
  })

  it('does not swap groups when the second part isn’t a group', () => {
    expect(variant('Some politicians are honest', 'Converse')).toBeUndefined()
  })

  it('negates clauses and finds singulars', () => {
    expect(negateClause('the ground is wet')).toBe('the ground is not wet')
    expect(negateClause('the ground is not wet')).toBe('the ground is wet')
    expect(negateClause('she has a car')).toBe('she does not have a car')
    expect(negateClause('people buy less')).toBe('it is not the case that people buy less')
    expect(singular('people')).toBe('person')
    expect(singular('policies')).toBe('policy')
    expect(singular('dangerous')).toBeNull()
  })
})
