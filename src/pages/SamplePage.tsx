import { DebateView } from '../components/DebateView'
import { sampleMap } from '../model/sample'

export default function SamplePage() {
  return <DebateView map={sampleMap} eyebrow="Sample debate · read-only preview" />
}
