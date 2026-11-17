import { AlertCircle, CheckCircle2, ChevronDown, Download, MapPin } from 'lucide-react';
import { KERALA_DISTRICTS, venueColumns, type VenueDetails, type VenueErrors, type VenueField } from './venues';

export type VenueRow = { key: string; details: VenueDetails; errors: VenueErrors; rowCount: number };

type Props = {
  venues: VenueRow[];
  issueCount: number;
  onChange: (key: string, field: VenueField, value: string) => void;
  onCommitName: (key: string) => void;
  onDownload: () => void;
};

/** One editable row per venue in the batch, in the venue bulk-import format. */
export function VenuesPanel({ venues, issueCount, onChange, onCommitName, onDownload }: Props) {
  return <>
    <div className="grid-context venue-context"><span><span className="legend-square" />Required <b>*</b></span><span>District or districtId is required</span><span className="scroll-hint">14 columns</span></div>
    <div className="table-scroller">
      <table className="data-grid venue-grid" aria-label="Venues for bulk import">
        <colgroup><col style={{ width: 46 }} />{venueColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}<col style={{ width: 70 }} /></colgroup>
        <thead><tr><th className="row-number">#</th>{venueColumns.map(column => <th key={column.key} title={column.hint}>{column.key}{column.required && <span className="required-star">*</span>}</th>)}<th>rows</th></tr></thead>
        <tbody>
          {venues.map((venue, index) => <tr key={venue.key}>
            <th scope="row" className="row-number">{index + 1}</th>
            {venueColumns.map(column => {
              const error = venue.errors[column.key] || (column.key === 'district' ? venue.errors.district : undefined);
              const id = `venue-${index}-${column.key}`;
              const value = venue.details[column.key] || '';
              return <td key={column.key} className={`${error ? 'invalid-cell' : ''} ${column.type === 'select' ? 'select-cell' : ''}`} title={error || column.hint}>
                <div className="cell-wrap">
                  {column.type === 'select'
                    ? <><select id={id} aria-label={`Venue ${index + 1} ${column.key}`} value={value} onChange={e => onChange(venue.key, column.key, e.target.value)}>
                        <option value="">—</option>{column.options!.map(option => <option key={option}>{option}</option>)}
                      </select><ChevronDown size={14} className="select-chevron" /></>
                    : <input id={id} aria-label={`Venue ${index + 1} ${column.key}`} value={value} placeholder={column.required ? 'Required' : '—'}
                        inputMode={column.type === 'number' ? 'decimal' : undefined} list={column.type === 'district' ? 'kerala-districts' : undefined}
                        onChange={e => onChange(venue.key, column.key, e.target.value)}
                        onBlur={column.key === 'nameEn' ? () => onCommitName(venue.key) : undefined} />}
                </div>
              </td>;
            })}
            <td className="venue-row-count" title="Performances in the schedule at this venue">{venue.rowCount}</td>
          </tr>)}
        </tbody>
      </table>
      <datalist id="kerala-districts">{KERALA_DISTRICTS.map(district => <option key={district} value={district} />)}</datalist>
      {!venues.length && <div className="empty-table"><MapPin size={26} /><h3>No venues yet</h3><p>Venues appear here once performances have a venue.</p></div>}
    </div>
    <footer className="grid-footer">
      <div><strong>{venues.length} venue{venues.length === 1 ? '' : 's'}</strong><span className="footer-divider" /><span>Changing nameEn also renames the venue in the schedule.</span></div>
      <button className={issueCount ? 'footer-warning' : 'footer-ready'} onClick={onDownload}>
        {issueCount ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{issueCount ? `${issueCount} field${issueCount === 1 ? '' : 's'} to fix` : <>Download venues <Download size={13} /></>}
      </button>
    </footer>
  </>;
}
