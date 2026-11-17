import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Globe, LoaderCircle, Search } from 'lucide-react';
import { loadKnowledge, matchKnownVenues } from './knowledge';
import { queryHints, searchVenueOnline, venueQuery, VenueSearchUnavailable, type VenueCandidate } from './venueSearch';

type Props = {
  rawText: string;
  sourceVenue: string;
  currentVenue: string;
  rowCount: number;
  onApply: (venue: string) => void;
  onCancel: () => void;
};

/** Looks up the full venue name on the web; the reviewer always chooses what is applied. */
export function VenueSearchPanel({ rawText, sourceVenue, currentVenue, rowCount, onApply, onCancel }: Props) {
  const initial = venueQuery(rawText, sourceVenue || currentVenue);
  const [malayalam, setMalayalam] = useState(initial.malayalam);
  const [english, setEnglish] = useState(initial.english);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  // Venues you approved before need no web search or key.
  const [known] = useState<VenueCandidate[]>(() => matchKnownVenues(sourceVenue || currentVenue, initial.hints, loadKnowledge())
    .filter(match => match.name !== currentVenue)
    .map(match => ({ name: match.name, score: match.score, mentions: 1, url: '', source: 'your approved venues' })));
  const [candidates, setCandidates] = useState<VenueCandidate[]>(known);
  const [chosen, setChosen] = useState(known[0]?.name || currentVenue);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function search() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState('searching'); setError(''); setUnavailable(false);
    try {
      const hints = [...new Set([...initial.hints, ...queryHints(malayalam)])];
      const result = await searchVenueOnline([malayalam, english], hints, fetch, abort.signal);
      const merged = [...known, ...result.candidates.filter(candidate => !known.some(k => k.name.toLowerCase() === candidate.name.toLowerCase()))];
      setCandidates(merged);
      if (merged[0]) setChosen(merged[0].name);
      setState('done');
    } catch (caught) {
      if (abort.signal.aborted) return;
      setUnavailable(caught instanceof VenueSearchUnavailable);
      setError(caught instanceof Error ? caught.message : 'Venue search failed.');
      setState('error');
    }
  }

  return <>
    <div className="modal-content venue-search">
      <p>The poster only shows part of the venue name. Search the web for the full name, check the source, then choose what to use.</p>
      <label className="venue-field"><span>Malayalam search</span><input value={malayalam} onChange={e => setMalayalam(e.target.value)} /></label>
      <label className="venue-field"><span>English search</span><input value={english} onChange={e => setEnglish(e.target.value)} /></label>
      <button className="button secondary small" disabled={state === 'searching' || (!malayalam.trim() && !english.trim())} onClick={() => void search()}>
        {state === 'searching' ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}Search the web
      </button>
      <div className="info-box"><Globe size={17} /><span>Only these two search texts are sent to Brave Search. The poster image and schedule are not.</span></div>

      {state === 'error' && <div className="info-box venue-error"><AlertCircle size={17} /><span>{error}{unavailable && <> See <b>Find venue online</b> in the README.</>}</span></div>}
      {state === 'done' && !candidates.length && <p className="muted">No temple names in the results matched this poster. Edit the search text and try again, or type the venue below.</p>}
      {candidates.length > 0 && <div className="venue-candidates" role="radiogroup" aria-label="Venue matches">
        {candidates.map(candidate => <label key={candidate.name} className={chosen === candidate.name ? 'selected' : ''}>
          <input type="radio" name="venue-candidate" checked={chosen === candidate.name} onChange={() => setChosen(candidate.name)} />
          <span className="venue-candidate-text"><strong>{candidate.name}</strong>
            <small>{Math.round(Math.max(0, Math.min(1, candidate.score)) * 100)}% match with the poster{candidate.mentions > 1 ? ` · ${candidate.mentions} results` : ''} · {candidate.url ? <a href={candidate.url} target="_blank" rel="noreferrer noopener">{candidate.source || 'source'}<ExternalLink size={10} /></a> : candidate.source}</small>
          </span>
        </label>)}
      </div>}

      <label className="venue-field"><span>Venue to apply</span><input value={chosen} onChange={e => setChosen(e.target.value)} placeholder="Choose a match or type the venue" /></label>
      {sourceVenue && <p className="muted">OCR read “{sourceVenue}”. Your choice is remembered for posters with the same OCR text.</p>}
    </div>
    <div className="modal-actions">
      <button className="button secondary" onClick={onCancel}>Cancel</button>
      <button className="button primary" disabled={!chosen.trim() || chosen.trim() === currentVenue.trim()} onClick={() => onApply(chosen.trim())}><Check size={15} />Use for {rowCount} row{rowCount === 1 ? '' : 's'}</button>
    </div>
  </>;
}
