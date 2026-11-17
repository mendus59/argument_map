// Claim builder: recognises common shapes of claim and works out their opposite,
// converse, inverse and contrapositive in plain words, with tips for debating them.
// Rule-based and approximate: it handles everyday sentences, not every sentence.

export type Shape = 'all' | 'no' | 'some' | 'only' | 'if' | 'should' | 'other'

export interface Variant {
  name: 'Opposite' | 'Converse' | 'Inverse' | 'Contrapositive' | 'Same as'
  /** What the variant is, in a few plain words. */
  what: string
  text: string
  /** true: says the same thing as the claim; false: doesn't follow from it; null: it's the claim's opposite. */
  equivalent: boolean | null
  note: string
}

export interface ClaimLogic {
  shape: Shape
  /** The shape in plain words, e.g. "A claim about every member of a group". */
  summary: string
  variants: Variant[]
  tips: string[]
  /** Sweeping words worth checking, as written in the claim. */
  watchWords: string[]
}

const AUX = ['is', 'are', 'was', 'were', 'will', 'can', 'could', 'should', 'must', 'would', 'may', 'might', 'has', 'have', 'do', 'does', 'did', 'shall']
const SWEEPING = ['all', 'every', 'everyone', 'everybody', 'everything', 'always', 'never', 'none', 'no one', 'nobody', 'nothing', 'only', 'any', 'each', 'entirely', 'completely', 'certainly', 'impossible']

const IRREGULAR: Record<string, string> = { people: 'person', children: 'child', men: 'man', women: 'woman', mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose', data: 'data', criteria: 'criterion' }

const clean = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const sentence = (s: string) => cap(clean(s)) + '.'

/** A best guess at the singular of a plural noun phrase ("undocumented immigrants" → "undocumented immigrant"). Null when unsure. */
export function singular(phrase: string): string | null {
  const words = clean(phrase).split(' ')
  const last = words[words.length - 1]
  const lower = last.toLowerCase()
  let one: string | null = null
  if (IRREGULAR[lower]) one = IRREGULAR[lower]
  else if (/ies$/.test(lower) && lower.length > 4) one = last.slice(0, -3) + 'y'
  else if (/(ches|shes|sses|xes|zes)$/.test(lower)) one = last.slice(0, -2)
  else if (/[^su]s$/.test(lower)) one = last.slice(0, -1)
  if (!one) return null
  return [...words.slice(0, -1), one].join(' ')
}

const isPluralNoun = (phrase: string) => { const one = singular(phrase); return !!one && one !== clean(phrase) }

const article = (noun: string) => (/^[aeiou]/i.test(noun) && !/^(uni|use|eu)/i.test(noun) ? 'an' : 'a')

/** Negates a simple clause: "the ground is wet" → "the ground is not wet". */
export function negateClause(clause: string): string {
  const c = clean(clause)
  const words = c.split(' ')
  const i = words.findIndex((w) => AUX.includes(w.toLowerCase()))
  if (i < 0) return `it is not the case that ${lowerFirst(c)}`
  const aux = words[i].toLowerCase()
  const next = words[i + 1]?.toLowerCase()
  if (next === 'not') return [...words.slice(0, i + 1), ...words.slice(i + 2)].join(' ')
  // "has wheels" → "does not have wheels"; "has gone" stays a helper verb.
  if ((aux === 'has' || aux === 'have') && !(next && /(ed|en|been|gone|done|made)$/.test(next))) {
    return [...words.slice(0, i), aux === 'has' ? 'does not have' : 'do not have', ...words.slice(i + 1)].join(' ')
  }
  return [...words.slice(0, i + 1), 'not', ...words.slice(i + 1)].join(' ')
}

/** Splits "undocumented immigrants are criminals" into subject, linking verb and the rest. */
function splitAtVerb(rest: string): { subject: string; verb: string; predicate: string } | null {
  const words = rest.split(' ')
  const i = words.findIndex((w, j) => j > 0 && AUX.includes(w.toLowerCase()))
  if (i < 0) return null
  return { subject: words.slice(0, i).join(' '), verb: words[i].toLowerCase(), predicate: words.slice(i + 1).join(' ') }
}

/** "criminals" → "a criminal"; "dangerous" stays "dangerous". */
function predicateOne(predicate: string) {
  const one = singular(predicate)
  return one && one !== predicate ? `${article(one)} ${one}` : predicate
}

export function analyseClaim(text: string): ClaimLogic {
  const claim = clean(text)
  const watchWords = SWEEPING.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(claim))
  const lower = claim.toLowerCase()

  // If P, then Q.
  const cond = claim.match(/^if\s+(.+?)(?:,\s*then\s+|\s+then\s+|,\s*)(.+)$/i)
  if (cond) {
    const [p, q] = [clean(cond[1]), clean(cond[2])]
    return {
      shape: 'if',
      summary: 'An “if… then…” claim: whenever the first part is true, the second part is too.',
      variants: [
        { name: 'Opposite', what: 'what would make it false', text: sentence(`${p}, and yet ${negateClause(q)}`), equivalent: null, note: 'One real case where the first part holds and the second doesn’t is enough to refute it.' },
        { name: 'Contrapositive', what: 'flip and negate both parts', text: sentence(`if ${negateClause(q)}, then ${negateClause(p)}`), equivalent: true, note: 'Says exactly the same thing. Accepting the claim means accepting this.' },
        { name: 'Converse', what: 'swap the parts', text: sentence(`if ${q}, then ${p}`), equivalent: false, note: 'Doesn’t follow. The second part could be true for some other reason.' },
        { name: 'Inverse', what: 'negate both parts', text: sentence(`if ${negateClause(p)}, then ${negateClause(q)}`), equivalent: false, note: 'Doesn’t follow either. Watch for this one being slipped in.' },
      ],
      tips: [
        'Agreeing to this doesn’t mean agreeing to the converse or the inverse. Check which one is actually being argued.',
        'To test it, look for a case where the “if” part is true but the “then” part isn’t.',
      ],
      watchWords,
    }
  }

  // All / every / each S are P.
  const all = claim.match(/^(all|every|each)\s+(.+)$/i)
  if (all) {
    const parts = splitAtVerb(all[2])
    if (parts) {
      const { subject, verb, predicate } = parts
      const plural = all[1].toLowerCase() === 'all'
      const one = plural ? singular(subject) : subject
      const copula = verb === 'are' || verb === 'is'
      const groupPlural = plural ? subject : null
      const oneP = copula ? predicateOne(predicate) : predicate
      const negOne = one ? `at least one ${one} ${negateClause(`${verb === 'are' ? 'is' : verb} ${copula ? oneP : predicate}`)}` : null
      const variants: Variant[] = [
        {
          name: 'Opposite',
          what: 'what would make it false',
          text: negOne ? sentence(negOne) : sentence(`not ${lowerFirst(claim)}`),
          equivalent: null,
          note: 'A single clear counterexample is enough to refute it.',
        },
      ]
      if (copula && groupPlural) {
        const predPlural = predicate
        const nounPredicate = isPluralNoun(predicate)
        const negPred = `not ${predicateOne(predicate)}`
        variants.push(
          { name: 'Contrapositive', what: 'flip and negate both parts', text: sentence(`anyone or anything that is ${negPred} is not ${article(one ?? subject)} ${one ?? subject}`), equivalent: true, note: 'Says exactly the same thing in other words.' },
        )
        if (nounPredicate) variants.push({ name: 'Converse', what: 'swap the two groups', text: sentence(`all ${predPlural} are ${groupPlural}`), equivalent: false, note: 'Doesn’t follow. Being in the second group doesn’t put you in the first.' })
      }
      return {
        shape: 'all',
        summary: 'A sweeping claim about every member of a group.',
        variants,
        tips: [
          'One clear exception refutes an “all” claim. If “most” or “many” is what’s meant, suggest that wording.',
          `Agree first on who counts as “${one ?? subject}”: define the term before arguing about it.`,
          ...(['should', 'must'].includes(verb) ? ['It’s also a value claim: facts alone won’t settle it. Agree on the goal it serves first.'] : []),
        ],
        watchWords,
      }
    }
    return {
      shape: 'all',
      summary: 'A sweeping claim about every member of a group.',
      variants: [{ name: 'Opposite', what: 'what would make it false', text: sentence(`not ${all[1].toLowerCase()} ${all[2]}`), equivalent: null, note: 'A single clear counterexample is enough to refute it.' }],
      tips: ['One clear exception refutes an “all” claim. If “most” or “many” is what’s meant, suggest that wording.'],
      watchWords,
    }
  }

  // No S are P.
  const no = claim.match(/^no\s+(.+)$/i)
  if (no) {
    const parts = splitAtVerb(no[1])
    if (parts) {
      const { subject, verb, predicate } = parts
      const one = singular(subject)
      const copula = verb === 'are' || verb === 'is'
      return {
        shape: 'no',
        summary: 'A claim that nothing in a group has some feature.',
        variants: [
          {
            name: 'Opposite',
            what: 'what would make it false',
            text: sentence(one ? `at least one ${one} ${verb === 'are' ? 'is' : verb} ${copula ? predicateOne(predicate) : predicate}` : `some ${subject} ${verb} ${predicate}`),
            equivalent: null,
            note: 'A single clear example refutes it.',
          },
          ...(copula && isPluralNoun(predicate) ? [{ name: 'Converse' as const, what: 'swap the two groups', text: sentence(`no ${predicate} are ${subject}`), equivalent: true, note: 'For “no” claims, swapping the groups says the same thing.' }] : []),
        ],
        tips: ['Like an “all” claim, one example is enough to refute it.'],
        watchWords,
      }
    }
    return {
      shape: 'no',
      summary: 'A claim that nothing in a group has some feature.',
      variants: [{ name: 'Opposite', what: 'what would make it false', text: sentence(`some ${no[1]}`), equivalent: null, note: 'A single clear example refutes it.' }],
      tips: ['Like an “all” claim, one example is enough to refute it.'],
      watchWords,
    }
  }

  // Some S are P.
  const some = claim.match(/^(some|many|most|several)\s+(.+)$/i)
  if (some) {
    const parts = splitAtVerb(some[2])
    if (parts) {
      const { subject, verb, predicate } = parts
      const q = some[1].toLowerCase()
      const variants: Variant[] = [
        {
          name: 'Opposite',
          what: 'what would make it false',
          text: q === 'some' ? sentence(`no ${subject} ${verb} ${predicate}`) : sentence(`it is not true that ${q} ${subject} ${verb} ${predicate}`),
          equivalent: null,
          note: q === 'some' ? 'To refute it you’d have to show there are none at all, which is hard.' : `Turns on how many count as “${q}”. Agree on that first.`,
        },
      ]
      if (q === 'some' && (verb === 'are' || verb === 'is') && isPluralNoun(predicate)) {
        variants.push({ name: 'Converse', what: 'swap the two groups', text: sentence(`some ${predicate} are ${subject}`), equivalent: true, note: 'For “some” claims, swapping the groups says the same thing.' })
      }
      return {
        shape: 'some',
        summary: q === 'some' ? 'A modest claim: at least one member of the group fits.' : `A claim about a share of a group (“${q}”).`,
        variants,
        tips:
          q === 'some'
            ? ['One good example proves it. Check that it doesn’t get treated as “all” later in the debate.']
            : [`“${cap(q)}” is vague. Agree on a rough number or share, or on the evidence that would settle it.`],
        watchWords,
      }
    }
    const q = some[1].toLowerCase()
    return {
      shape: 'some',
      summary: q === 'some' ? 'A modest claim: at least one member of the group fits.' : `A claim about a share of a group (“${q}”).`,
      variants: [
        {
          name: 'Opposite',
          what: 'what would make it false',
          text: q === 'some' ? sentence(`no ${some[2]}`) : sentence(`it is not true that ${q} ${some[2]}`),
          equivalent: null,
          note: q === 'some' ? 'To refute it you’d have to show there are none at all, which is hard.' : `Turns on how many count as “${q}”. Agree on that first.`,
        },
      ],
      tips: q === 'some' ? ['One good example proves it. Check that it doesn’t get treated as “all” later in the debate.'] : [`“${cap(q)}” is vague. Agree on a rough number or share, or on the evidence that would settle it.`],
      watchWords,
    }
  }

  // Only S are P  =  All P are S.
  const only = claim.match(/^only\s+(.+)$/i)
  if (only) {
    const parts = splitAtVerb(only[1])
    if (parts && (parts.verb === 'are' || parts.verb === 'is')) {
      const { subject, predicate } = parts
      return {
        shape: 'only',
        summary: 'An “only” claim: nothing outside the group has this feature.',
        variants: [
          { name: 'Same as', what: 'the same claim turned round', text: sentence(`all ${predicate} are ${subject}`), equivalent: true, note: '“Only A are B” means every B is an A, not that every A is a B.' },
          { name: 'Opposite', what: 'what would make it false', text: sentence(`at least one of the ${predicate} is not one of the ${subject}`), equivalent: null, note: 'One example from outside the group refutes it.' },
        ],
        tips: ['“Only” is easy to misread as “all”. Restate it both ways and check you agree on which is meant.'],
        watchWords,
      }
    }
  }

  // S should (not) V: a value claim.
  const should = claim.match(/^(.+?)\s+(should|ought to|must)\s+(not\s+)?(.+)$/i)
  if (should) {
    const [, subject, modal, not, action] = should
    return {
      shape: 'should',
      summary: 'A value claim about what ought to happen.',
      variants: [
        {
          name: 'Opposite',
          what: 'what disagreeing means',
          text: sentence(`it is not the case that ${lowerFirst(subject)} ${modal} ${not ? 'not ' : ''}${action}`),
          equivalent: null,
          note: `Disagreeing doesn’t have to mean “${subject} ${modal} ${not ? '' : 'not '}${action}”. It can also mean it’s optional, or depends on the case.`,
        },
      ],
      tips: [
        'Facts alone won’t settle a “should”. Ask which goal or value it serves, and agree on that first.',
        'There’s usually a hidden “if… then…” premise: if it achieves the goal, we should do it. Make it explicit.',
        'Ask about cost, side effects and alternatives: is this the best way to the goal?',
      ],
      watchWords,
    }
  }

  return {
    shape: 'other',
    summary: lower.length ? 'A plain statement.' : '',
    variants: lower.length
      ? [{ name: 'Opposite', what: 'what disagreeing means', text: sentence(`it is not true that ${lowerFirst(claim)}`), equivalent: null, note: 'State exactly which part you disagree with. That’s often more useful than the whole opposite.' }]
      : [],
    tips: ['Is it a fact, a prediction or a value? Facts and predictions need evidence; values need reasons.'],
    watchWords,
  }
}
