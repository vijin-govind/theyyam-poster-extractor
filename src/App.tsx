import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { Sparkles, Plus, Download, Upload, Search, ChevronRight, ChevronDown, ArrowUpRight, Trash2, X, Check, CheckCircle2, AlertCircle, LoaderCircle, Link2, ZoomIn, FileText, ArrowRight, PanelLeft, RotateCcw, Keyboard, Info, BrainCircuit, MessageSquareText, Mic, MicOff, Globe, MapPin } from 'lucide-react';
import { VenueSearchPanel } from './VenueSearchPanel';
import { get, set } from 'idb-keyval';
import { columns, createInitialBatch, emptyRow, validateRows, validateRow, buildWorkbook } from './schema';
import type { Row, Poster, FieldKey } from './schema';
import { read as readWorkbook, utils as xlsxUtils, writeFile } from 'xlsx';
import { clearKnowledge, importVenues, knowledgeCounts, knownVenueDetails, learnWords, recordApprovedRows, rememberVenueDetails } from './knowledge';
import { buildVenueWorkbook, MAX_VENUE_ROWS, suggestVenue, validateVenues, type VenueDetails, type VenueErrors, type VenueField } from './venues';
import { VenuesPanel, type VenueRow } from './VenuesPanel';
import { clearLearnedCorrections, learnedCorrectionCount, learnCorrection, loadLearnedCorrections } from './learning';
import { cleanExtractedTheyyam, cleanExtractedVenue, isLikelyPerformanceLabel, parsePosterRegions, wordPairs } from './parser';
import { applyGregorianDateSelection, gregorianToMalayalam } from './calendar';
import { parseGuidedPosterInput } from './guided';

type Batch = { posters: Poster[]; rows: Row[]; updatedAt?: number; /** Venue import details keyed by the schedule's venue name. */ venues?: Record<string, VenueDetails> };
type Notice = { message: string; action?: () => void; label?: string };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
type SpeechRecognitionLike = {
 lang: string; continuous: boolean; interimResults: boolean;
 onresult: ((event: SpeechEventLike) => void) | null;
 onerror: (() => void) | null;
 onend: (() => void) | null;
 start: () => void; stop: () => void;
};
const STORAGE_KEY = 'theyyam-extractor-v1';
const SAMPLE = createInitialBatch();
const blobDataUrl = (blob: Blob) => new Promise<string>((resolve,reject)=>{const f=new FileReader(); f.onload=()=>resolve(String(f.result));f.onerror=()=>reject(new Error('Could not read this image.'));f.readAsDataURL(blob);});
const migrateSavedRow = (row: Row): Row => {
 const converted = row.dateKey && (!row.malayalamMonth || !row.malayalamDay || !row.malayalamYear)
  ? gregorianToMalayalam(row.dateKey)
  : null;
 return {...row,...converted,venue:cleanExtractedVenue(row.venue),theyyam:cleanExtractedTheyyam(row.theyyam)};
};
const recoverSavedRows = (rows: Row[], posters: Poster[]): Row[] => {
 const candidatesByPoster = new Map(posters.map(poster => {
  const regions = poster.rawText?.split(/--- OCR region \d+ ---\s*/).filter(Boolean) || [];
  return [poster.id, parsePosterRegions(regions)] as const;
 }));
 return rows.map(original => {
  const row = migrateSavedRow(original);
  if (row.venue) return row;
  const rowLabel = cleanExtractedTheyyam(row.sourceLabel || row.theyyam);
  const matches = (candidatesByPoster.get(row.posterId) || []).filter(candidate => {
   const candidateLabel = cleanExtractedTheyyam(candidate.sourceLabel || candidate.theyyam || '');
   if (!candidate.venue || candidateLabel !== rowLabel) return false;
   if (row.start && candidate.start && row.start !== candidate.start) return false;
   if (row.dateKey && candidate.dateKey && row.dateKey !== candidate.dateKey) return false;
   return true;
  });
  const venues = [...new Set(matches.map(candidate => candidate.venue).filter(Boolean))];
  const sourceVenues = [...new Set(matches.map(candidate => candidate.sourceVenue).filter(Boolean))];
  return venues.length === 1 ? {...row,venue:venues[0]!,sourceVenue:sourceVenues.length===1?sourceVenues[0]:row.sourceVenue} : row;
 });
};

function Modal({ title, children, close, wide=false }: {title:string;children:React.ReactNode;close:()=>void;wide?:boolean}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.focus();return()=>previous?.focus();},[]);
 function handleKeys(e:KeyboardEvent){if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={handleKeys}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={19}/></button></div>{children}</div></div>;
}

export default function App(){
 const [batch,setBatch]=useState<Batch>(SAMPLE);
 const [loaded,setLoaded]=useState(false);
 const [saveState,setSaveState]=useState<'saved'|'saving'|'error'>('saved');
 const [activeId,setActiveId]=useState(SAMPLE.posters[0]?.id??'');
 const [selectedRow,setSelectedRow]=useState('');
 const [search,setSearch]=useState('');
 const [onlyReview,setOnlyReview]=useState(false);
 const [dragging,setDragging]=useState(false);
 const [notice,setNotice]=useState<Notice|null>(null);
 const [dialog,setDialog]=useState<'export'|'reset'|'help'|'learning-reset'|'remove-poster'|'reanalyze-poster'|'guided-entry'|'venue-search'|null>(null);
 const [learningCount,setLearningCount]=useState(()=>learnedCorrectionCount());
 const [knowledge,setKnowledge]=useState(()=>knowledgeCounts());
 const [posterAction,setPosterAction]=useState<Poster|null>(null);
 const [guidedPoster,setGuidedPoster]=useState<Poster|null>(null);
 const [guidedText,setGuidedText]=useState('');
 const [guidedLanguage,setGuidedLanguage]=useState('ml-IN');
 const [guidedError,setGuidedError]=useState('');
 const [listening,setListening]=useState(false);
 const [preview,setPreview]=useState<Poster|null>(null);
 const [showText,setShowText]=useState(false);
 const [showSidebar,setShowSidebar]=useState(false);
 const [uploading,setUploading]=useState(false);
 const [uploadStage,setUploadStage]=useState('');
 const feedRef=useRef<HTMLDivElement>(null);
 const gridRef=useRef<HTMLDivElement>(null);
 const fileRef=useRef<HTMLInputElement>(null);
 const activeRef=useRef(activeId);
 const cancelRef=useRef<AbortController|null>(null);
 const speechRef=useRef<SpeechRecognitionLike|null>(null);
 const uploadLock=useRef(false);
 const scrollLock=useRef(0);
 const initialSave=useRef(true);
 useEffect(()=>{let cancelled=false;get<Batch>(STORAGE_KEY).then(saved=>{if(cancelled)return;if(saved&&Array.isArray(saved.rows)&&Array.isArray(saved.posters)){const rows=saved.rows.filter(row=>!row.sourceLabel||row.theyyam.trim()!==row.sourceLabel.trim()||isLikelyPerformanceLabel(row.theyyam));const restored={...saved,posters:saved.posters.map(p=>p.state==='processing'?{...p,state:'error' as const,error:'Extraction was interrupted. Upload this poster again to retry.'}:p),rows:recoverSavedRows(rows,saved.posters)};setBatch(restored);setActiveId(restored.posters[0]?.id??'');}}).catch(()=>{setSaveState('error');setNotice({message:'Local storage is unavailable. Keep this tab open and export your work.'});}).finally(()=>{if(!cancelled)setLoaded(true);});return()=>{cancelled=true;};},[]);
 useEffect(()=>{activeRef.current=activeId;},[activeId]);
 useEffect(()=>{if(!batch.posters.some(p=>p.id===activeId))setActiveId(batch.posters[0]?.id??'');},[batch.posters,activeId]);
 useEffect(()=>{if(!loaded)return;if(initialSave.current){initialSave.current=false;return;}setSaveState('saving');const timer=window.setTimeout(()=>{set(STORAGE_KEY,batch).then(()=>setSaveState('saved')).catch(()=>{setSaveState('error');setNotice({message:'Could not save locally. Export your schedule to keep a copy.'});});},350);return()=>clearTimeout(timer);},[batch,loaded]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(null),7000);return()=>clearTimeout(timer);},[notice]);
 const issues=useMemo(()=>validateRows(batch.rows),[batch.rows]);
 const [view,setView]=useState<'schedule'|'venues'>('schedule');
 const venueRows=useMemo<VenueRow[]>(()=>{
  const order:string[]=[];const counts=new Map<string,number>();const sources=new Map<string,string>();
  for(const row of batch.rows){const key=row.venue.trim();if(!key)continue;if(!counts.has(key))order.push(key);counts.set(key,(counts.get(key)||0)+1);if(row.sourceVenue&&!sources.has(key))sources.set(key,row.sourceVenue);}
  const list=order.map(key=>batch.venues?.[key]||suggestVenue(key,sources.get(key)||'',knownVenueDetails(key)));
  const errors=list.map(()=>({} as VenueErrors));
  for(const issue of validateVenues(list))errors[issue.index][issue.field]??=issue.message;
  return order.map((key,index)=>({key,details:list[index],errors:errors[index],rowCount:counts.get(key)||0}));
 },[batch.rows,batch.venues]);
 const venueIssueCount=useMemo(()=>venueRows.reduce((sum,venue)=>sum+Object.keys(venue.errors).length,0),[venueRows]);
 const issueRows=useMemo(()=>new Set(issues.map(i=>i.rowId)),[issues]);
 const visibleRows=useMemo(()=>batch.rows.filter(row=>(!onlyReview||issueRows.has(row.id))&&(!search||columns.some(c=>String(row[c.key]).toLocaleLowerCase().includes(search.toLocaleLowerCase())))),[batch.rows,onlyReview,issueRows,search]);
 const counts=useMemo(()=>batch.rows.reduce<Record<string,number>>((a,r)=>{a[r.posterId]=(a[r.posterId]||0)+1;return a;},{}),[batch.rows]);
 const activePoster=batch.posters.find(p=>p.id===activeId);
 const isSample=batch.posters.some(p=>p.isSample);
 function updateBatch(fn:(b:Batch)=>Batch){setBatch(b=>({...fn(b),updatedAt:Date.now()}));}
 function scrollToRow(id:string,field?:FieldKey){window.setTimeout(()=>{const container=gridRef.current;const row=document.getElementById(`row-${id}`);if(container&&row)container.scrollTo({top:row.offsetTop-77,behavior:'smooth'});if(field){const cell=document.getElementById(`cell-${id}-${field}`) as HTMLInputElement|null;cell?.focus({preventScroll:true});if(container&&cell){const left=cell.getBoundingClientRect().left-container.getBoundingClientRect().left+container.scrollLeft;container.scrollTo({left:Math.max(0,left-48),behavior:'smooth'});}}},40);}
 function selectPoster(id:string,scrollGrid=true){setActiveId(id);if(scrollGrid){const first=visibleRows.find(r=>r.posterId===id);if(first)scrollToRow(first.id);}}
 function focusPoster(id:string){setActiveId(id);scrollLock.current=Date.now()+700;const card=document.getElementById(`poster-${id}`);const feed=feedRef.current;if(card&&feed)feed.scrollTo({top:card.offsetTop-16,behavior:'smooth'});}
 function handleFeedScroll(){if(Date.now()<scrollLock.current)return;const feed=feedRef.current;if(!feed)return;const top=feed.getBoundingClientRect().top;let best='',distance=Infinity;for(const p of batch.posters){const card=document.getElementById(`poster-${p.id}`);if(!card)continue;const rect=card.getBoundingClientRect();const d=rect.bottom<top+70?Infinity:Math.abs(rect.top-top-16);if(d<distance){distance=d;best=p.id;}}if(best&&best!==activeRef.current){activeRef.current=best;selectPoster(best);}}
 function updateCell(rowId:string,key:FieldKey,value:string){updateBatch(b=>({...b,rows:b.rows.map(r=>r.id===rowId?(key==='dateKey'?applyGregorianDateSelection(r,value):{...r,[key]:value}):r)}));}
 function learnReviewedCell(row:Row,key:FieldKey,value:string){
  const source=key==='theyyam'?row.sourceLabel:key==='venue'?row.sourceVenue:undefined;
  // Word spellings generalize to other posters: "കുറി" → "Kuri" helps any label containing it.
  if(key==='theyyam'&&row.sourceLabel&&learnWords(wordPairs(row.sourceLabel,value)))setKnowledge(knowledgeCounts());
  if((key==='theyyam'||key==='venue')&&source&&learnCorrection(key,source,value)){
   setLearningCount(learnedCorrectionCount());
   setNotice({message:`${key==='venue'?'Venue':'Theyyam'} correction learned for matching future OCR text.`});
  }
 }
 function resetLearning(){
  if(clearLearnedCorrections()&&clearKnowledge()){
   setLearningCount(0);setKnowledge(knowledgeCounts());setDialog('help');setNotice({message:'Learned corrections cleared from this browser.'});
  }else setNotice({message:'Learned corrections could not be cleared.'});
 }
 function addRow(){if(!batch.posters.length){setNotice({message:'Upload a poster first to link your new performance.'});fileRef.current?.click();return;}const row=emptyRow(batch.posters.find(p=>p.id===activeId)?.id||batch.posters[0].id);updateBatch(b=>({...b,rows:[...b.rows,row]}));setOnlyReview(false);setSearch('');setSelectedRow(row.id);scrollToRow(row.id,'venue');setNotice({message:'New draft row added. Fill in the required fields.'});}
 function deleteRow(row:Row){const index=batch.rows.findIndex(r=>r.id===row.id);updateBatch(b=>({...b,rows:b.rows.filter(r=>r.id!==row.id)}));setNotice({message:'Performance removed.',label:'Undo',action:()=>{updateBatch(b=>{const rows=[...b.rows];rows.splice(index,0,row);return {...b,rows};});setNotice(null);}});}
 function applyPosterVenue(poster:Poster,venue:string){
  const rows=batch.rows.filter(r=>r.posterId===poster.id);
  const sources=[...new Set(rows.map(r=>r.sourceVenue).filter((v):v is string=>Boolean(v)))];
  let learned=false;
  for(const source of sources)learned=learnCorrection('venue',source,venue)||learned;
  if(learned)setLearningCount(learnedCorrectionCount());
  updateBatch(b=>({...b,rows:b.rows.map(r=>r.posterId===poster.id?{...r,venue}:r)}));
  setDialog(null);setPosterAction(null);
  setNotice({message:`Venue set to “${venue}” for ${rows.length} row${rows.length===1?'':'s'}.${learned?' It will be reused for matching OCR text.':''}`});
 }
 async function importVenueList(file:File|undefined){
  if(!file)return;
  try{
   const workbook=readWorkbook(await file.arrayBuffer());
   const sheet=workbook.Sheets[workbook.SheetNames[0]];
   const table=xlsxUtils.sheet_to_json<unknown[]>(sheet,{header:1,blankrows:false}).map(r=>r.map(c=>String(c??'').trim()));
   const header=table[0]?.findIndex(c=>/^(venue|venue ?name|temple|name)$/i.test(c))??-1;
   const names=(header>=0?table.slice(1).map(r=>r[header]):table.map(r=>r[0])).filter((n):n is string=>Boolean(n&&n.length>=3));
   const added=importVenues(names);
   setKnowledge(knowledgeCounts());
   setNotice({message:`Imported ${names.length} venue name${names.length===1?'':'s'} (${added} new). Posters will be matched against them.`});
  }catch{setNotice({message:'That file could not be read. Use a CSV or Excel file with venue names in the first column or a "venue" column.'});}
 }
 function updateVenue(key:string,field:VenueField,value:string){
  const current=venueRows.find(v=>v.key===key)?.details;if(!current)return;
  updateBatch(b=>({...b,venues:{...b.venues,[key]:{...(b.venues?.[key]||current),[field]:value}}}));
 }
 // Keeps the schedule linked to the venue file: the schedule's venue becomes the venue's nameEn.
 function commitVenueName(key:string){
  const details=batch.venues?.[key];const name=details?.nameEn.trim();
  if(!details||!name||name===key)return;
  const sources=[...new Set(batch.rows.filter(r=>r.venue.trim()===key&&r.sourceVenue).map(r=>r.sourceVenue!))];
  for(const source of sources)learnCorrection('venue',source,name);
  setLearningCount(learnedCorrectionCount());
  updateBatch(b=>{const venues={...b.venues};delete venues[key];venues[name]={...details,...Object.fromEntries(Object.entries(venues[name]||{}).filter(([,v])=>v))} as VenueDetails;return {...b,venues,rows:b.rows.map(r=>r.venue.trim()===key?{...r,venue:name}:r)};});
  setNotice({message:`Renamed “${key}” to “${name}” in ${venueRows.find(v=>v.key===key)?.rowCount||0} schedule rows.`});
 }
 function exportVenues(){
  if(uploading){setNotice({message:'Wait for poster extraction to finish before exporting.'});return;}
  if(!venueRows.length){setNotice({message:'No venues yet. Performances need a venue before venues can be exported.'});return;}
  if(venueRows.length>MAX_VENUE_ROWS){setView('venues');setNotice({message:`The venue import accepts up to ${MAX_VENUE_ROWS} rows; this batch has ${venueRows.length}.`});return;}
  if(venueIssueCount){setView('venues');setNotice({message:`Fix ${venueIssueCount} venue field${venueIssueCount===1?'':'s'} before downloading. Required: nameEn, village, and district or districtId.`});return;}
  try{
   const list=venueRows.map(v=>v.details);
   writeFile(buildVenueWorkbook(list),`theyyam-venues-${new Date().toISOString().slice(0,10)}.xlsx`,{compression:true});
   rememberVenueDetails(list);setKnowledge(knowledgeCounts());
   setNotice({message:`Exported ${list.length} venue${list.length===1?'':'s'} in the venue bulk-import format. Their details will pre-fill future posters.`});
  }catch{setNotice({message:'The venue spreadsheet could not be generated. Please try again.'});}
 }
 function confirmPosterAction(poster:Poster,action:'remove-poster'|'reanalyze-poster'|'venue-search'){
  setPosterAction(poster);setDialog(action);
 }
 function removePoster(){
  if(!posterAction)return;
  const removed=posterAction;
  updateBatch(b=>({...b,posters:b.posters.filter(p=>p.id!==removed.id),rows:b.rows.filter(r=>r.posterId!==removed.id)}));
  if(preview?.id===removed.id)setPreview(null);
  setPosterAction(null);setDialog(null);
  setNotice({message:`Removed ${removed.title} and its linked performances.`});
 }
 function openGuidedEntry(poster:Poster){
  setGuidedPoster(poster);setGuidedText('');setGuidedError('');setDialog('guided-entry');
 }
 function closeGuidedEntry(){
  speechRef.current?.stop();speechRef.current=null;setListening(false);setGuidedPoster(null);setGuidedError('');setDialog(null);
 }
 function toggleVoiceEntry(){
  if(listening){speechRef.current?.stop();return;}
  const speechWindow=window as typeof window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};
  const Constructor=speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition;
  if(!Constructor){setGuidedError('Voice recognition is not supported in this browser. You can type or paste the details instead.');return;}
  const recognition=new Constructor();speechRef.current=recognition;recognition.lang=guidedLanguage;recognition.continuous=true;recognition.interimResults=false;
  recognition.onresult=event=>{let transcript='';for(let index=event.resultIndex;index<event.results.length;index++){if(event.results[index].isFinal)transcript+=`${event.results[index][0].transcript} `;}if(transcript.trim()){setGuidedText(current=>`${current}${current.trim()?'\n':''}${transcript.trim()}`);setGuidedError('');}};
  recognition.onerror=()=>{setGuidedError('The microphone could not transcribe that audio. Check microphone permission or type the details instead.');setListening(false);};
  recognition.onend=()=>{setListening(false);speechRef.current=null;};
  try{recognition.start();setListening(true);setGuidedError('');}catch{setGuidedError('Voice recognition could not start. Type the details instead.');}
 }
 function addGuidedRows(){
  if(!guidedPoster)return;
  const candidates=parseGuidedPosterInput(guidedText,loadLearnedCorrections());
  if(!candidates.length){setGuidedError('I could not find a Theyyam entry. Use the labels Venue, Date, Theyyam, and Time, or add a blank row and complete it in the table.');return;}
  const rows=candidates.map(candidate=>({...emptyRow(guidedPoster.id),...candidate,id:crypto.randomUUID(),posterId:guidedPoster.id}));
  updateBatch(batch=>{
   const lastPosterRow=batch.rows.reduce((last,row,index)=>row.posterId===guidedPoster.id?index:last,-1);
   const updated=[...batch.rows];updated.splice(lastPosterRow+1,0,...rows);return {...batch,rows:updated};
  });
  const posterTitle=guidedPoster.title;closeGuidedEntry();setActiveId(guidedPoster.id);setOnlyReview(false);setSearch('');
  setNotice({message:`Added ${rows.length} draft performance${rows.length===1?'':'s'} from your text or voice guidance for ${posterTitle}.`});
 }
 function addBlankGuidedRow(){
  if(!guidedPoster)return;const row=emptyRow(guidedPoster.id,{description:'Added manually after automatic extraction found no performances.'});
  updateBatch(batch=>({...batch,rows:[...batch.rows,row]}));const id=guidedPoster.id;closeGuidedEntry();setActiveId(id);setOnlyReview(false);setSearch('');scrollToRow(row.id,'venue');
 }
 function goToIssue(){const issue=issues[0];if(!issue)return;setOnlyReview(false);setSearch('');setDialog(null);setSelectedRow(issue.rowId);const row=batch.rows.find(r=>r.id===issue.rowId);if(row)focusPoster(row.posterId);scrollToRow(issue.rowId,issue.field);}
 function exportFile(){if(uploading){setNotice({message:'Wait for poster extraction to finish before exporting.'});return;}if(!batch.rows.length){setNotice({message:'Add at least one performance before exporting.'});return;}if(issues.length){setDialog('export');return;}try{const workbook=buildWorkbook(batch.rows);writeFile(workbook,`theyyam-schedule-${new Date().toISOString().slice(0,10)}.xlsx`,{compression:true});const samples=new Set(batch.posters.filter(p=>p.isSample).map(p=>p.id));const counts=recordApprovedRows(batch.rows.filter(r=>!samples.has(r.posterId)),wordPairs);setKnowledge(counts);setNotice({message:`Exported ${batch.rows.length} performances with all 16 import columns. Their venues and names now help future posters.`});}catch{setNotice({message:'The spreadsheet could not be generated. Please try again.'});}}
 async function uploadFiles(files:FileList|File[]|null){if(!files?.length||uploadLock.current)return;uploadLock.current=true;setUploading(true);setDragging(false);try{const {extractPoster,validatePosterFile}=await import('./ocr');for(const file of Array.from(files)){const error=validatePosterFile(file);if(error){setNotice({message:`${file.name}: ${error}`});continue;}const id=crypto.randomUUID();const poster:Poster={id,title:file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' '),fileName:file.name,previewUrl:'',dateLabel:'Uploaded just now',state:'processing',progress:0,isSample:false,sourceBlob:file,sourceType:file.type};updateBatch(b=>({...b,posters:[...b.posters,poster]}));window.setTimeout(()=>focusPoster(id),50);const controller=new AbortController();cancelRef.current=controller;try{const result=await extractPoster(file,(progress,label)=>{setUploadStage(label);setBatch(b=>({...b,posters:b.posters.map(p=>p.id===id?{...p,progress}:p)}));},controller.signal);const previewUrl=await blobDataUrl(result.previewBlob);const rows=result.candidates.map(candidate=>({...emptyRow(id),...candidate,id:crypto.randomUUID(),posterId:id}));updateBatch(b=>({...b,posters:b.posters.map(p=>p.id===id?{...p,previewUrl,rawText:result.rawText,state:'ready',progress:100}:p),rows:[...b.rows,...rows]}));setNotice({message:rows.length?`${rows.length} draft performances extracted. Review the poster and complete any missing fields.`:'Poster added. No performances could be confidently identified; use Add Row and the extracted text to enter the schedule.'});setActiveId(id);}catch(error){const message=error instanceof Error?error.message:'Extraction failed. Please try again.';updateBatch(b=>({...b,posters:b.posters.map(p=>p.id===id?{...p,state:'error',error:message}:p)}));setNotice({message});}finally{cancelRef.current=null;}}
 }catch{setNotice({message:'The upload engine could not load. Check your connection and try again.'});}finally{uploadLock.current=false;setUploading(false);setUploadStage('');if(fileRef.current)fileRef.current.value='';}}
 async function reanalyzePoster(){
  const poster=posterAction;if(!poster||uploadLock.current)return;
  setDialog(null);setPosterAction(null);uploadLock.current=true;setUploading(true);setActiveId(poster.id);
  updateBatch(b=>({...b,posters:b.posters.map(p=>p.id===poster.id?{...p,state:'processing',progress:0,error:undefined}:p)}));
  const controller=new AbortController();cancelRef.current=controller;
  let usedPreview=false;
  try{
   const {extractPoster}=await import('./ocr');
   let source=poster.sourceBlob;
   if(!source){
    if(!poster.previewUrl)throw new Error('No saved image is available. Remove this poster and upload the original again.');
    const response=await fetch(poster.previewUrl);if(!response.ok)throw new Error('The saved poster preview could not be opened.');
    source=await response.blob();usedPreview=true;
   }
   const sourceName=usedPreview&&/\.pdf$/i.test(poster.fileName)?poster.fileName.replace(/\.pdf$/i,'.jpg'):poster.fileName;
   const file=new File([source],sourceName,{type:usedPreview?(source.type||'image/jpeg'):(poster.sourceType||source.type||'image/jpeg')});
   const result=await extractPoster(file,(progress,label)=>{setUploadStage(label);setBatch(b=>({...b,posters:b.posters.map(p=>p.id===poster.id?{...p,progress}:p)}));},controller.signal);
   const previewUrl=await blobDataUrl(result.previewBlob);
   const replacements=result.candidates.map(candidate=>({...emptyRow(poster.id),...candidate,id:crypto.randomUUID(),posterId:poster.id}));
   updateBatch(b=>{
    const firstIndex=b.rows.findIndex(row=>row.posterId===poster.id);
    const rows=b.rows.filter(row=>row.posterId!==poster.id);
    rows.splice(firstIndex<0?rows.length:Math.min(firstIndex,rows.length),0,...replacements);
    return {...b,rows,posters:b.posters.map(p=>p.id===poster.id?{...p,previewUrl,rawText:result.rawText,state:'ready',progress:100,error:undefined,dateLabel:'Reanalyzed just now'}:p)};
   });
   setNotice({message:replacements.length?`Reanalysis replaced the previous rows with ${replacements.length} new draft performances.${usedPreview?' The saved preview was used; the original file may produce better OCR.':''}`:`Reanalysis found no confident performances. The previous rows were removed.${usedPreview?' Upload the original file for the best OCR quality.':''}`});
  }catch(error){
   const message=error instanceof Error?error.message:'Reanalysis failed. Please try again.';
   updateBatch(b=>({...b,posters:b.posters.map(p=>p.id===poster.id?{...p,state:'error',error:message}:p)}));
   setNotice({message:`Reanalysis failed. Existing rows were kept. ${message}`});
  }finally{cancelRef.current=null;uploadLock.current=false;setUploading(false);setUploadStage('');}
 }
 function dropFiles(e:DragEvent){e.preventDefault();void uploadFiles(e.dataTransfer.files);}
 function cellKey(e:KeyboardEvent<HTMLInputElement|HTMLSelectElement>,row:Row,key:FieldKey){if(e.key==='Enter'){e.preventDefault();const next=visibleRows[visibleRows.findIndex(r=>r.id===row.id)+1];if(next)(document.getElementById(`cell-${next.id}-${key}`) as HTMLElement)?.focus();}if(e.key==='Escape')e.currentTarget.blur();}
 function newBatch(){updateBatch(()=>({posters:[],rows:[]}));setActiveId('');setSearch('');setOnlyReview(false);setDialog(null);setNotice({message:'New batch ready. Upload posters to get started.'});}
 if(!loaded)return <div className="app-shell"><header className="topbar"><div className="brand"><span className="brand-icon"><Sparkles size={21}/></span><h1>Theyyam Poster Extractor</h1></div></header><div className="loading-workspace" role="status"><LoaderCircle className="spin" size={24}/><p>Opening your workspace…</p></div></div>;
 return <div className="app-shell">
  <header className="topbar">
   <div className="brand"><span className="brand-icon"><Sparkles size={21} strokeWidth={1.8}/></span><h1>Theyyam Poster Extractor</h1><span className="batch-badge"><span className="blue-dot"/>Batch Mode: {batch.posters.length} Posters</span></div>
   <button className={`status-pill ${issues.length?'needs-review':'all-valid'}`} onClick={issues.length?goToIssue:()=>setNotice({message:'All performances pass the bulk-import validation checks.'})}><span className="status-dot"/><strong>{batch.rows.length} Performances Extracted</strong><span className="pill-separator">•</span><span>{issues.length?`${issues.length} Field${issues.length===1?'':'s'} Need${issues.length===1?'s':''} Review`:'Ready to export'}</span></button>
   <div className="top-actions"><button className="button secondary" onClick={addRow} disabled={!loaded}><Plus size={17}/>Add Row</button><button className="button primary" onClick={exportFile} disabled={!loaded||uploading}><Download size={17}/>Download .xlsx</button><button className="button secondary" onClick={exportVenues} disabled={!loaded||uploading}><MapPin size={17}/>Download venues</button></div>
  </header>
  <main className={`workspace ${showSidebar?'mobile-posters':''}`}>
   <aside className="sidebar">
    <div className="panel-heading"><div><div className="eyebrow">SOURCE DOCUMENTS</div><h2>Poster feed <span className="count-badge">{batch.posters.length}</span></h2></div><button className="icon-button" title="Start a new batch" aria-label="Start a new batch" disabled={uploading} onClick={()=>setDialog('reset')}><Plus size={19}/></button></div>
    <div className="feed-caption"><span>Scroll to sync with extracted rows</span><span className="synced"><Link2 size={13}/> Synced</span></div>
    <div className="poster-feed" ref={feedRef} onScroll={handleFeedScroll}>
     {batch.posters.length===0?<div className="empty-feed"><div className="empty-icon"><FileText size={26}/></div><h3>Your next batch starts here</h3><p>Upload a poster to extract and review its performance schedule.</p><button className="button secondary" onClick={()=>fileRef.current?.click()}><Plus size={16}/>Choose posters</button></div>:batch.posters.map((poster,index)=><article id={`poster-${poster.id}`} key={poster.id} className={`poster-card ${poster.id===activeId?'active':''}`} onClick={()=>selectPoster(poster.id)}>
      <div className="poster-card-heading"><div className="poster-meta"><div className="eyebrow">POSTER {String(index+1).padStart(2,'0')}{poster.isSample&&<span className="sample-tag">SAMPLE</span>}</div><h3>{poster.title}</h3><p title={poster.fileName}>{poster.fileName}</p></div><span className="performance-badge">{counts[poster.id]||0} <span>performances</span></span></div>
      <div className="poster-card-actions"><button disabled={uploading||poster.state==='processing'||poster.isSample} title={poster.isSample?'Sample posters cannot be reanalyzed':'Run OCR again and replace this poster’s rows'} onClick={e=>{e.stopPropagation();confirmPosterAction(poster,'reanalyze-poster');}}><RotateCcw size={13}/>Reanalyze</button><button disabled={uploading||poster.state==='processing'||poster.isSample||!counts[poster.id]} title={poster.isSample?'Sample posters already have full venue names':'Search the web for this poster’s full venue name'} onClick={e=>{e.stopPropagation();confirmPosterAction(poster,'venue-search');}}><Globe size={13}/>Find venue</button><button className="remove-poster-button" disabled={uploading||poster.state==='processing'} onClick={e=>{e.stopPropagation();confirmPosterAction(poster,'remove-poster');}}><Trash2 size={13}/>Remove</button></div>
      {!poster.isSample&&poster.state==='ready'&&!counts[poster.id]&&<div className="guided-entry-callout"><div><MessageSquareText size={16}/><span><b>No performance rows found</b><small>Describe the schedule by text or voice.</small></span></div><button onClick={e=>{e.stopPropagation();openGuidedEntry(poster);}}><Mic size={13}/>Guide extraction</button></div>}
      <div className={`poster-image-wrap poster-tint-${index%3}`}>
       {poster.state==='processing'?<div className="processing"><LoaderCircle className="spin" size={28}/><h3>Reading your poster</h3><p>{uploadStage||'Preparing document…'}</p><div className="progress-track"><div style={{width:`${poster.progress||0}%`}}/></div><span>{poster.progress||0}% · English + Malayalam</span><button className="text-button" onClick={e=>{e.stopPropagation();cancelRef.current?.abort();}}>Cancel extraction</button></div>:poster.state==='error'?<div className="processing error-state"><AlertCircle size={30}/><h3>Couldn’t read this poster</h3><p>{poster.error}</p><span>Use Reanalyze above or remove this poster.</span></div>:<><button className="poster-preview-button" aria-label={`View ${poster.title} poster`} onClick={e=>{e.stopPropagation();selectPoster(poster.id);setPreview(poster);setShowText(false);}}><img src={poster.previewUrl} alt={`${poster.title} source poster`} loading={index?'lazy':'eager'}/></button><button className="zoom-button" aria-label={`Enlarge ${poster.title}`} onClick={e=>{e.stopPropagation();setPreview(poster);setShowText(false);}}><ZoomIn size={15}/><span>View poster</span></button></>}
      </div>
      <button className="poster-card-footer" onClick={()=>selectPoster(poster.id)}><span>{poster.dateLabel}</span><span className={poster.id===activeId?'in-view':''}>{poster.id===activeId?<><span className="blue-dot"/>In view</>:'View rows'}<ChevronRight size={16}/></span></button>
     </article>)}
     {batch.posters.length>0&&<div className="feed-end"><CheckCircle2 size={14}/>{batch.posters.length} source documents in this batch</div>}
    </div>
    <div className="upload-dock"><input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" className="sr-only" aria-label="Upload posters" onChange={e=>void uploadFiles(e.target.files)} disabled={uploading}/><div className={`dropzone ${dragging?'dragging':''} ${uploading?'busy':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={dropFiles}><span className="upload-icon">{uploading?<LoaderCircle size={20} className="spin"/>:<Upload size={19}/>}</span><p>{uploading?'Extracting your posters…':<>Drop more posters here or <button disabled={uploading} onClick={()=>fileRef.current?.click()}>Browse</button></>}</p><span>JPG, PNG, WebP or PDF <span className="middot">·</span> Max 20 MB each</span></div><div className="privacy-note"><span className="privacy-dot"/>Processed privately in your browser</div></div>
   </aside>
   <section className="schedule-panel" aria-label="Master extracted schedule">
    <div className="schedule-heading"><div><div className="title-line"><h2>Master extracted schedule</h2><span className="schema-badge">BULK IMPORT SCHEMA</span></div><p>{view==='schedule'?`${batch.rows.length} performances combined from ${batch.posters.length} posters. Edit values directly in the grid.`:`${venueRows.length} venues used by this batch, in the venue bulk-import format.`}</p></div><div className="view-switch" role="tablist" aria-label="Choose export"><button role="tab" aria-selected={view==='schedule'} className={view==='schedule'?'selected':''} onClick={()=>setView('schedule')}>Schedule <span>{batch.rows.length}</span></button><button role="tab" aria-selected={view==='venues'} className={view==='venues'?'selected':''} onClick={()=>setView('venues')}><MapPin size={12}/>Venues <span className={venueIssueCount?'warning-count':''}>{venueRows.length}</span></button></div></div>
    {view==='venues'?<VenuesPanel venues={venueRows} issueCount={venueIssueCount} onChange={updateVenue} onCommitName={commitVenueName} onDownload={exportVenues}/>:<>
    <div className="grid-toolbar"><div className="filter-tabs"><button className={!onlyReview?'selected':''} onClick={()=>setOnlyReview(false)}>All performances <span>{batch.rows.length}</span></button><button className={onlyReview?'selected':''} onClick={()=>setOnlyReview(true)}>Needs review <span className={issueRows.size?'warning-count':''}>{issueRows.size}</span></button></div><div className="toolbar-right"><div className="search-box"><Search size={15}/><input aria-label="Search performances" placeholder="Search schedule…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="icon-button" onClick={()=>setSearch('')} aria-label="Clear search"><X size={12}/></button>}</div><button className="icon-button help-button" title="Keyboard shortcuts and schema help" aria-label="Keyboard shortcuts and schema help" onClick={()=>setDialog('help')}><Info size={16}/></button></div></div>
    <div className="grid-context"><span><span className="legend-square"/>Required field <b>*</b></span><span className="context-poster"><span className="legend-square blue"/>{activePoster?`Synced to poster ${String(batch.posters.indexOf(activePoster)+1).padStart(2,'0')}`:'No poster selected'}</span><span className="scroll-hint">16 columns <ArrowRight size={12}/></span></div>
    <div className="table-scroller" ref={gridRef}>
     <table className="data-grid" aria-label="Editable extracted performances"><colgroup><col style={{width:46}}/>{columns.map(c=><col key={c.key} style={{width:c.width}}/>)}<col style={{width:43}}/></colgroup><thead><tr><th className="row-number">#</th>{columns.map(c=><th key={c.key} title={c.required?'Required field':c.key==='start'||c.key==='end'?'Required depending on time certainty':c.key==='recurrenceInterval'?'Required when recurrence is n_yearly':'Optional field'}>{c.key}{c.required&&<span className="required-star">*</span>}</th>)}<th className="row-action"><span className="sr-only">Row actions</span></th></tr></thead><tbody>
      {visibleRows.map(row=>{const errors=validateRow(row);const rowNumber=batch.rows.indexOf(row)+1;const isActive=row.posterId===activeId;return <tr id={`row-${row.id}`} key={row.id} className={`${isActive?'synced-row':''} ${selectedRow===row.id?'selected-row':''}`} onClick={()=>{setSelectedRow(row.id);focusPoster(row.posterId);}}><th scope="row" className="row-number"><button title={`Select row ${rowNumber} and its poster`} onClick={()=>focusPoster(row.posterId)}>{rowNumber}</button></th>{columns.map(c=><td key={c.key} className={`${errors[c.key]?'invalid-cell':''} ${c.type==='select'?'select-cell':''}`} title={errors[c.key]}><div className="cell-wrap">{c.type==='select'?<><select id={`cell-${row.id}-${c.key}`} aria-label={`Row ${rowNumber} ${c.key}`} aria-invalid={!!errors[c.key]} title={errors[c.key]||c.key} value={row[c.key]} onChange={e=>updateCell(row.id,c.key,e.target.value)} onKeyDown={e=>cellKey(e,row,c.key)}><option value="">Select…</option>{c.options?.map(option=><option key={option} value={option}>{option}</option>)}</select><ChevronDown className="select-chevron" size={13}/></>:<input id={`cell-${row.id}-${c.key}`} aria-label={`Row ${rowNumber} ${c.key}`} aria-invalid={!!errors[c.key]} title={errors[c.key]||row[c.key]} value={row[c.key]} type={c.type==='number'?'number':c.type==='date'?'date':'text'} inputMode={c.type==='number'?'numeric':undefined} min={c.min} max={c.max} placeholder={errors[c.key]?'Required':c.type==='date'?'YYYY-MM-DD':c.type==='time'?'HH:MM':'—'} spellCheck={false} onChange={e=>updateCell(row.id,c.key,e.target.value)} onBlur={e=>learnReviewedCell(row,c.key,e.target.value)} onKeyDown={e=>cellKey(e,row,c.key)}/>}</div></td>)}<td className="row-action"><button className="delete-button" aria-label={`Delete row ${rowNumber}`} onClick={e=>{e.stopPropagation();deleteRow(row);}}><Trash2 size={14}/></button></td></tr>;})}
     </tbody></table>
     {visibleRows.length===0&&<div className="empty-table"><Search size={26}/><h3>{batch.rows.length?'No matching performances':'Your schedule is ready for its first row'}</h3><p>{batch.rows.length?'Try a different search or switch to all performances.':'Upload a poster or add a performance manually.'}</p>{batch.rows.length?<button className="button secondary" onClick={()=>{setSearch('');setOnlyReview(false);}}>Clear filters</button>:<button className="button secondary" onClick={addRow}><Plus size={16}/>Add Row</button>}</div>}
     {visibleRows.length>0&&<button className="add-grid-row" onClick={addRow}><Plus size={14}/>Add a performance <span>to {activePoster?.title||'this batch'}</span></button>}
    </div>
    <footer className="grid-footer"><div><strong>{visibleRows.length}{visibleRows.length!==batch.rows.length?` / ${batch.rows.length}`:''} rows</strong><span className="footer-divider"/><span>16 columns</span><span className="footer-divider"/><span className={`save-status ${saveState==='error'?'save-error':''}`}>{saveState==='saving'?<LoaderCircle size={12} className="spin"/>:saveState==='error'?<AlertCircle size={12}/>:<Check size={13}/>} {saveState==='saved'?'Saved locally':saveState==='saving'?'Saving…':'Not saved'}</span></div><button className={issues.length?'footer-warning':'footer-ready'} onClick={issues.length?goToIssue:exportFile}>{issues.length?<AlertCircle size={15}/>:<CheckCircle2 size={15}/>}<span>{issues.length?`${issues.length} field${issues.length===1?'':'s'} to review`:'Ready to export'}</span>{issues.length>0&&<ArrowUpRight size={13}/>}</button></footer></>}
   </section>
  </main>
  <div className="mobile-switch"><button onClick={()=>setShowSidebar(!showSidebar)}><PanelLeft size={16}/>{showSidebar?'Show schedule':'Show posters'}</button></div>
  <div className="app-bottom"><span><span className="small-brand-mark"><Sparkles size={11}/></span>THEYYAM WORKSPACE<span className="bottom-divider">/</span>Internal admin tool</span><span>{isSample&&<span className="sample-note">Sample batch · replace with your own posters</span>}<span className="bottom-divider">|</span><Keyboard size={12}/>Click a cell to edit <span className="keycap">↵</span> Next row</span></div>
  {notice&&<div className="toast" role="status"><CheckCircle2 size={17}/><span>{notice.message}</span>{notice.action&&<button onClick={notice.action}>{notice.label}</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={()=>setNotice(null)}><X size={15}/></button></div>}
  {dialog==='export'&&<Modal title="A quick review before export" close={()=>setDialog(null)}><div className="modal-content"><div className="review-summary"><AlertCircle size={23}/><div><h3>{issues.length} field{issues.length===1?' needs':'s need'} your attention</h3><p>Complete these values so your spreadsheet matches the bulk-import schema.</p></div></div><div className="issue-list">{issues.slice(0,12).map(issue=><button key={`${issue.rowId}-${issue.field}`} onClick={()=>{setDialog(null);setOnlyReview(false);setSearch('');const r=batch.rows.find(r=>r.id===issue.rowId);if(r)focusPoster(r.posterId);scrollToRow(issue.rowId,issue.field);}}><span className="issue-row-number">Row {batch.rows.findIndex(r=>r.id===issue.rowId)+1}</span><span><strong>{issue.field}</strong><small>{issue.message}</small></span><ChevronRight size={16}/></button>)}</div>{issues.length>12&&<p className="muted">And {issues.length-12} more fields. Use the Needs review tab to see them all.</p>}</div><div className="modal-actions"><button className="button secondary" onClick={()=>setDialog(null)}>Keep editing</button><button className="button primary" onClick={goToIssue}>Review first field<ArrowRight size={16}/></button></div></Modal>}
  {dialog==='reset'&&<Modal title="Start a new batch" close={()=>setDialog(null)}><div className="modal-content"><p>This will clear the {batch.posters.length} posters and {batch.rows.length} performances saved in this browser. Export your current schedule first if you need to keep it.</p><div className="info-box"><Upload size={19}/><span>Your new batch will be empty and ready for your own posters.</span></div></div><div className="modal-actions"><button className="button secondary" onClick={()=>setDialog(null)}>Cancel</button><button className="button primary" onClick={newBatch}><RotateCcw size={15}/>Start new batch</button></div></Modal>}
  {dialog==='help'&&<Modal title="Your poster review workspace" close={()=>setDialog(null)}><div className="modal-content help-content"><h3>From poster to spreadsheet</h3><p>Upload JPG, PNG, WebP or PDF files. English and Malayalam OCR runs on your device. Recognized performances become draft rows; check the original poster and fill in missing details.</p><h3>Reviewer learning</h3><div className="info-box"><BrainCircuit size={20}/><span><b>{learningCount} learned correction{learningCount===1?'':'s'}</b><br/>When you correct an OCR-extracted venue or Theyyam name, the exact field-specific correction is reused on matching future uploads in this browser.</span></div><div className="info-box"><BrainCircuit size={20}/><span><b>{knowledge.words} learned word{knowledge.words===1?'':'s'} · {knowledge.venues} known venue{knowledge.venues===1?'':'s'} · {knowledge.theyyams} known Theyyam name{knowledge.theyyams===1?'':'s'}</b><br/>Correcting a Theyyam name teaches its words (e.g. <i>കുറി</i> → Kuri), so they help other labels. Exporting a schedule adds its venues and names; new posters with a partial venue are matched against them, and OCR misspellings that sound alike are recognized.</span></div><div className="help-actions"><label className="button secondary"><Upload size={14}/>Import venue list<input type="file" accept=".csv,.xlsx,.xls,.txt" hidden onChange={e=>{void importVenueList(e.target.files?.[0]);e.target.value='';}}/></label>{(learningCount>0||knowledge.words+knowledge.venues+knowledge.theyyams>0)&&<button className="button secondary" onClick={()=>setDialog('learning-reset')}><RotateCcw size={14}/>Clear everything learned</button>}</div><h3>Time & recurrence rules</h3><p><b>exact / approximate:</b> start required. <b>range:</b> start and end required (overnight ranges allowed). <b>unknown:</b> times may be blank. Use 24-hour HH:MM. For <b>n_yearly</b>, provide an interval from 2–24.</p><h3>Working in the grid</h3><p>Click to edit; <kbd>Tab</kbd> moves between fields; <kbd>Enter</kbd> moves to the next row. Clicking a row brings its source poster into view. Scroll horizontally to reach all 16 columns.</p><h3>Local & private</h3><p>Drafts, previews, and learned corrections stay in this browser and are not shared between devices. Export a spreadsheet to keep a separate copy. The initial 36-row batch is sample data.</p></div></Modal>}
  {dialog==='learning-reset'&&<Modal title="Clear learned corrections?" close={()=>setDialog('help')}><div className="modal-content"><p>This removes {learningCount} venue and Theyyam correction{learningCount===1?'':'s'}, {knowledge.words} learned word{knowledge.words===1?'':'s'}, {knowledge.venues} known venue{knowledge.venues===1?'':'s'} and {knowledge.theyyams} known Theyyam name{knowledge.theyyams===1?'':'s'} from this browser. Your schedule rows and posters will not be changed.</p></div><div className="modal-actions"><button className="button secondary" onClick={()=>setDialog('help')}>Cancel</button><button className="button primary" onClick={resetLearning}><RotateCcw size={15}/>Clear corrections</button></div></Modal>}
  {dialog==='remove-poster'&&posterAction&&<Modal title="Remove this poster?" close={()=>{setDialog(null);setPosterAction(null);}}><div className="modal-content"><p><b>{posterAction.title}</b> and its {counts[posterAction.id]||0} linked performance row{counts[posterAction.id]===1?'':'s'} will be removed from this browser.</p></div><div className="modal-actions"><button className="button secondary" onClick={()=>{setDialog(null);setPosterAction(null);}}>Cancel</button><button className="button danger" onClick={removePoster}><Trash2 size={15}/>Remove poster</button></div></Modal>}
  {dialog==='venue-search'&&posterAction&&(()=>{const rows=batch.rows.filter(r=>r.posterId===posterAction.id);const venues=rows.map(r=>r.venue).filter(Boolean);const current=venues.sort((a,b)=>venues.filter(v=>v===b).length-venues.filter(v=>v===a).length)[0]||'';return <Modal title="Find the full venue name" close={()=>{setDialog(null);setPosterAction(null);}}><VenueSearchPanel rawText={posterAction.rawText||''} sourceVenue={rows.find(r=>r.sourceVenue)?.sourceVenue||''} currentVenue={current} rowCount={rows.length} onApply={venue=>applyPosterVenue(posterAction,venue)} onCancel={()=>{setDialog(null);setPosterAction(null);}}/></Modal>;})()}
  {dialog==='reanalyze-poster'&&posterAction&&<Modal title="Reanalyze this poster?" close={()=>{setDialog(null);setPosterAction(null);}}><div className="modal-content"><p>OCR will run again for <b>{posterAction.title}</b>. If it succeeds, its {counts[posterAction.id]||0} current performance row{counts[posterAction.id]===1?'':'s'} will be replaced with new draft rows. Learned venue and Theyyam corrections will be applied.</p>{!posterAction.sourceBlob&&<div className="info-box"><AlertCircle size={19}/><span>This older upload does not include its original file, so reanalysis will use the saved preview. Re-uploading the original may produce better results.</span></div>}</div><div className="modal-actions"><button className="button secondary" onClick={()=>{setDialog(null);setPosterAction(null);}}>Cancel</button><button className="button primary" onClick={()=>void reanalyzePoster()}><RotateCcw size={15}/>Reanalyze and replace</button></div></Modal>}
  {dialog==='guided-entry'&&guidedPoster&&<Modal title="Guide the extraction" close={closeGuidedEntry} wide><div className="guided-split"><aside className="guided-poster-pane" aria-label="Source poster reference"><div><img src={guidedPoster.previewUrl} alt={`${guidedPoster.title} source poster`}/></div><span><b>Source poster</b><small>{guidedPoster.fileName}</small></span></aside><div className="modal-content guided-entry-modal"><p>Read the poster beside this form, then type or speak one label per line. Multiple Theyyam and Time pairs create multiple draft rows.</p><div className="guided-example"><span>Venue: എടച്ചേരി ശ്രീ മുത്തപ്പൻ ക്ഷേത്രം</span><span>Date: 2025 November 8</span><span>Theyyam: ഗുളികൻ വെള്ളാട്ടം</span><span>Time: 6:30 PM</span></div><textarea aria-label="Poster schedule text or voice transcript" value={guidedText} onChange={event=>{setGuidedText(event.target.value);setGuidedError('');}} placeholder={'Venue: …\nDate: …\nTheyyam: …\nTime: …'} rows={8}/><div className="voice-entry-controls"><select aria-label="Voice language" value={guidedLanguage} onChange={event=>setGuidedLanguage(event.target.value)} disabled={listening}><option value="ml-IN">Malayalam</option><option value="en-IN">English (India)</option></select><button className={`button ${listening?'danger':'secondary'}`} onClick={toggleVoiceEntry}>{listening?<><MicOff size={15}/>Stop listening</>:<><Mic size={15}/>Speak details</>}</button><span>{listening?'Listening… Speak the field labels and values.':'Voice availability depends on your browser.'}</span></div>{guidedError&&<div className="guided-error" role="alert"><AlertCircle size={15}/>{guidedError}</div>}</div></div><div className="modal-actions"><button className="button secondary" onClick={closeGuidedEntry}>Cancel</button><button className="button secondary" onClick={addBlankGuidedRow}><Plus size={15}/>Add blank row</button><button className="button primary" disabled={!guidedText.trim()} onClick={addGuidedRows}><MessageSquareText size={15}/>Create draft rows</button></div></Modal>}
  {preview&&<Modal title={preview.title} close={()=>setPreview(null)} wide><div className="preview-toolbar"><span>{preview.fileName}</span>{preview.rawText&&<button className="button secondary small" onClick={()=>setShowText(!showText)}><FileText size={14}/>{showText?'Show poster':'Extracted text'}</button>}</div>{showText?<pre className="ocr-text">{preview.rawText}</pre>:<div className="full-preview"><img src={preview.previewUrl} alt={preview.title}/></div>}<div className="preview-bottom">{preview.isSample?'Sample poster for exploring the workspace.':/\.pdf$/i.test(preview.fileName)?'First-page preview. Extracted text includes all pages; review against your original PDF.':'Compare extracted details with the original poster before exporting.'}</div></Modal>}
 </div>;
}
