import { useState } from 'react'
import { ConversationView } from '../components/ConversationView'
import type { Selection } from '../map/ArgumentMap'
import { sampleMap } from '../model/sample'

export default function SamplePage() {
  const [selection, setSelection] = useState<Selection>(null)
  return (
    <ConversationView
      map={sampleMap}
      user={null}
      role={null}
      selection={selection}
      onSelect={setSelection}
      crumbs={<span className="eyebrow">Sample debate · read-only preview</span>}
    />
  )
}
