import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { saveErrorMessage } from './errors'

describe('saveErrorMessage', () => {
  it('names a refused save instead of blaming the connection', () => {
    expect(saveErrorMessage(new FirebaseError('permission-denied', 'no'), 'The import')).toMatch(/^The import was refused.*rules are published/)
    expect(saveErrorMessage(new FirebaseError('unavailable', 'x'), 'The import')).toMatch(/connection/)
    expect(saveErrorMessage(new FirebaseError('invalid-argument', 'x'), 'The import')).toMatch(/too large/)
    expect(saveErrorMessage(new Error('x'), 'The debate')).toBe('The debate couldn’t be saved. Try again.')
  })
})
