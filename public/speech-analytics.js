(function(){
const {createElement:h,useState,useEffect,useMemo}=React;
const M=SpeechModel;
const text=v=>String(v||'Sin dato').replace(/_/g,' ').toLowerCase().replace(/^./,v=>v.toUpperCase());
const pct=v=>v===null?'Sin dato':v.toFixed(1)+'%';
async function request(url,options){const response=await fetch(url,options);const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'No se pudo completar la solicitud.');return data;}
function csv(rows){
  const headers=[...new Set(rows.flatMap(r=>Object.keys(r.source)))];
  const cell=v=>'"'+String(v??'').replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')+'"';
  const contents='\uFEFF'+[headers,...rows.map(r=>headers.map(k=>r.source[k]??''))].map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([contents],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='speech-no-venta.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Bars({title,items,percentage=false,onSelect}){
 const max=percentage?100:Math.max(1,...items.map(i=>i.value));
 return h('section',{className:'sa-chart'},h('h3',null,title),!items.length?h('p',{className:'sa-muted'},'Sin datos para este filtro.'):items.map((item,i)=>h('div',{key:i,className:'sa-bar-row'},h(onSelect?'button':'div',{className:'sa-bar-label',onClick:onSelect?()=>onSelect(item):undefined,title:item.label},text(item.label)),h('span',null,item.caption??(percentage?pct(item.value):item.value)),h('div',{className:'sa-track'},h('div',{style:{width:Math.max(0,Math.min(100,item.value/max*100))+'%'}})))));
}
function Dialog({title,onClose,children}){
 useEffect(()=>{const listener=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);},[onClose]);
 return h('div',{className:'sa-overlay',onClick:e=>{if(e.target===e.currentTarget)onClose();}},h('section',{className:'sa-dialog',role:'dialog','aria-modal':true,'aria-label':title},h('header',null,h('h2',null,title),h('button',{onClick:onClose,'aria-label':'Cerrar',autoFocus:true},'Cerrar')),children));
}
function Detail({record,onClose}){
 const groups=[['Ficha de calidad',k=>k.startsWith('NV-')],['Cero tolerancia',k=>k.startsWith('ZT-')],['Habilidades',k=>k.startsWith('Habilidad:')],['Analisis comercial',k=>!k.startsWith('NV-')&&!k.startsWith('ZT-')&&!k.startsWith('Habilidad:')]];
 const metadata=['ID','Archivo','Asesor','Duraci\u00f3n (min)','Fecha','Versi\u00f3n','Fecha de la llamada','Nota de la ficha (%)','Puntaje obtenido','Peso aplicable','Llega al umbral (90 %)','Cero tolerancia','Cero tolerancia: c\u00f3digos','Ficha no corresponde'];
 return h(Dialog,{title:'Analisis de llamada',onClose},h('div',{className:'sa-detail-meta'},metadata.map(k=>h('div',{key:k},h('small',null,k),h('div',null,record.source[k]||'Sin dato')))),
   h('p',{className:'sa-muted'},'Nota original del SA. Los minutos son referencias de evidencia; este Excel no incluye un audio reproducible.'),
   groups.map(([label,predicate])=>h('details',{key:label,open:label==='Ficha de calidad'},h('summary',null,label),h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['Criterio / campo','Resultado','Evidencia / explicacion','Minuto'].map(v=>h('th',{key:v},v)))),h('tbody',null,Object.keys(record.source).filter(k=>!metadata.includes(k)&&!k.includes(' — ')&&predicate(k)).map(k=>h('tr',{key:k},h('td',null,k),h('td',null,record.source[k]||'Sin dato'),h('td',{className:'sa-evidence'},record.source[k+' — por qu\u00e9']||'Sin evidencia escrita'),h('td',null,record.source[k+' — minuto']||'Sin minuto')))))))));
}
window.SpeechAnalytics=function SpeechAnalytics({currentUser,onImported}){
 const [tab,setTab]=useState('no_venta'),[view,setView]=useState('summary'),[records,setRecords]=useState([]),[imports,setImports]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [filters,setFilters]=useState({}),[page,setPage]=useState(0),[detail,setDetail]=useState(null),[preview,setPreview]=useState(null),[upload,setUpload]=useState(null),[busy,setBusy]=useState(false),[allowUnmatched,setAllowUnmatched]=useState(false),[message,setMessage]=useState(''),[evidence,setEvidence]=useState(null);
 const load=async()=>{setLoading(true);try{const data=await request('/api/speech-analytics');setRecords(data.records);setImports(data.imports);}catch(e){setError(e.message);}finally{setLoading(false);}};
 useEffect(()=>{load();},[]);
 const setFilter=(key,value)=>{setPage(0);setFilters(old=>({...old,[key]:value}));};
 const rows=useMemo(()=>M.filter(records,filters),[records,filters]);
 const stats=useMemo(()=>M.summary(rows),[rows]);
 const sorted=useMemo(()=>[...rows].sort((a,b)=>b.callDate.localeCompare(a.callDate)||a.advisor.localeCompare(b.advisor)),[rows]);
 const invalidDates=filters.from&&filters.to&&filters.from>filters.to;
 async function readFile(file){
  if(!file)return;setBusy(true);setError('');setMessage('');setAllowUnmatched(false);setPreview(null);setUpload(null);
  try{
   if(!/\.xlsx$/i.test(file.name))throw Error('Selecciona un archivo .xlsx.');
   if(file.size>20*1024*1024)throw Error('El archivo supera 20 MB.');
   if(!window.XLSX)throw Error('No se cargo el lector de Excel. Recarga la pagina.');
   const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
   if(!workbook.Sheets.Resultados)throw Error('Falta la hoja Resultados.');
   const grid=XLSX.utils.sheet_to_json(workbook.Sheets.Resultados,{header:1,defval:'',raw:true});
   const headers=grid[0]||[];if(new Set(headers.map(String)).size!==headers.length)throw Error('Hay encabezados duplicados.');
   const data=XLSX.utils.sheet_to_json(workbook.Sheets.Resultados,{defval:'',raw:true});
   const payload={kind:'no_venta',file:file.name,rows:data};
   const result=await request('/api/speech-analytics/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   setUpload(payload);setPreview(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function confirmImport(){
  setBusy(true);setError('');
  try{const result=await request('/api/speech-analytics/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...upload,commit:true,allowUnmatched})});setPreview(null);setUpload(null);setMessage(`${result.newCount} analisis importados. ${result.evaluationCount} evaluaciones SA y ${result.feedbackCount} feedbacks creados. ${result.duplicates} duplicados omitidos.`);await load();if(onImported)await onImported();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const select=(key,label)=>h('label',{key},label,h('select',{value:filters[key]||'',onChange:e=>setFilter(key,e.target.value)},h('option',{value:''},'Todos'),[...new Set(records.map(r=>r[key]).filter(Boolean))].sort().map(v=>h('option',{key:v,value:v},text(v)))));
 const category=(title,items,key)=>h(Bars,{title,items:items.map(r=>({...r,value:r.count,caption:r.count+' llamadas'})),onSelect:key?item=>setFilter(key,item.label==='Sin dato'?'':item.label):undefined});
 return h('div',{className:'sa-root'},h('header',{className:'sa-heading'},h('div',null,h('small',null,'ENTEL B2B'),h('h1',null,'Speech analytic')),tab==='no_venta'&&h('div',{className:'sa-actions'},h('button',{disabled:loading,onClick:()=>{setError('');load();}},'Actualizar'),h('button',{disabled:!rows.length,onClick:()=>csv(rows)},'Descargar CSV'),M.canImport(currentUser)&&h('label',{className:'sa-button sa-primary'},busy?'Procesando...':'Importar Excel',h('input',{type:'file',accept:'.xlsx',disabled:busy,onChange:e=>{readFile(e.target.files[0]);e.target.value='';},style:{display:'none'}})))),
  h('nav',{className:'sa-tabs','aria-label':'Tipo de analisis'},[['no_venta','No venta'],['venta','Validacion de venta']].map(([value,label])=>h('button',{key:value,className:tab===value?'sa-primary':'',onClick:()=>setTab(value)},label))),
  tab==='venta'?h('section',{className:'sa-empty'},h('h2',null,'Validacion de venta'),h('p',null,'Pendiente de configurar la plantilla del SA para este tipo de analisis.')):h(React.Fragment,null,
   error&&h('div',{role:'alert',className:'sa-error'},error),message&&h('div',{role:'status',className:'sa-success'},message),
   h('section',{className:'sa-filters'},h('label',null,'Desde',h('input',{type:'date',value:filters.from||'',onChange:e=>setFilter('from',e.target.value)})),h('label',null,'Hasta',h('input',{type:'date',value:filters.to||'',onChange:e=>setFilter('to',e.target.value)})),select('advisor','Asesor'),select('version','Version'),select('segment','Segmento detectado'),select('type','Tipo de llamada'),select('reason','Motivo de no venta'),select('recovery','Recuperabilidad'),
    h('label',null,'Cero tolerancia',h('select',{value:filters.critical||'',onChange:e=>setFilter('critical',e.target.value)},h('option',{value:''},'Todas'),h('option',{value:'yes'},'Detectada'),h('option',{value:'no'},'No detectada'))),
    h('label',null,'Nota minima',h('input',{type:'number',min:0,max:100,value:filters.min||'',onChange:e=>setFilter('min',e.target.value)})),h('label',null,'Nota maxima',h('input',{type:'number',min:0,max:100,value:filters.max||'',onChange:e=>setFilter('max',e.target.value)})),
    h('label',null,'Buscar',h('input',{type:'search',placeholder:'ID, archivo o asesor',value:filters.search||'',onChange:e=>setFilter('search',e.target.value)})),h('button',{onClick:()=>{setFilters({});setPage(0);}},'Limpiar')),
   invalidDates&&h('p',{role:'alert',className:'sa-error'},'La fecha Desde no puede ser posterior a Hasta.'),
   loading?h('p',{role:'status'},'Cargando analisis...'):h(React.Fragment,null,
    h('div',{className:'sa-kpis'},[['Llamadas unicas',stats.n],['Asesores',stats.advisors.length],['Nota promedio SA',pct(stats.average)],['Alcanzan 90%',stats.passed+' / '+stats.n],['Cero tolerancia',stats.critical],['Recuperabilidad alta',stats.high]].map(([label,value])=>h('div',{key:label},h('small',null,label),h('strong',null,value)))),
    h('p',{className:'sa-muted'},'Resultados originales del SA. Las evaluaciones generadas alimentan el dashboard operativo con los pesos de la PUE; su nota puede diferir de la nota SA. Sin filtro de version se usa la mas reciente por archivo.'),
    h('nav',{className:'sa-tabs','aria-label':'Vista'},[['summary','Resultados globales'],['calls','Llamadas'],['opportunities','Oportunidades'],['imports','Importaciones']].map(([v,label])=>h('button',{key:v,className:view===v?'sa-primary':'',onClick:()=>setView(v)},label))),
    !rows.length&&view!=='imports'?h('div',{className:'sa-empty'},records.length?'No hay resultados con estos filtros.':'Aun no hay analisis importados.'):view==='summary'?h(React.Fragment,null,
     h('div',{className:'sa-chart-grid'},h(Bars,{title:'Incumplimiento por criterio',percentage:true,items:stats.criteria.filter(r=>r.applicable).map(r=>({label:r.label,value:r.rate,caption:`${r.no}/${r.applicable} (${pct(r.rate)})`}))}),
      h(Bars,{title:'Pareto de errores',items:(()=>{let accumulated=0;const sum=stats.criteria.reduce((a,b)=>a+b.no,0);return [...stats.criteria].sort((a,b)=>b.no-a.no).filter(r=>r.no).map(r=>{accumulated+=r.no;return {label:r.label,value:r.no,caption:`${r.no} errores · ${pct(accumulated/sum*100)} acum.`};});})()}),
      category('Motivos de no venta',stats.reasons,'reason'),category('Objeciones principales',stats.objections),category('Momento de perdida',stats.loss),category('Recuperabilidad',stats.recoveries,'recovery'),category('Siguientes pasos',stats.next),category('Cero tolerancia: conductas detectadas',stats.criticalCodes),category('Fin de la promocion',stats.promotion),
      h(Bars,{title:'Habilidades: promedio original',items:stats.skills.filter(r=>r.n).map(r=>({label:r.label,value:r.average,caption:r.average.toFixed(2)+' · n='+r.n}))}),
      h(Bars,{title:'Nota por fecha de llamada',percentage:true,items:stats.trend.map(r=>({label:r.day,value:r.average,caption:pct(r.average)+' · n='+r.n}))}),
      h(Bars,{title:'Distribucion de notas',items:[[0,55],[55,75],[75,90],[90,101]].map(([low,high])=>({label:low+' a '+(high===101?'100':('< '+high))+'%',value:rows.filter(r=>r.score>=low&&r.score<high).length}))})),
     h('h2',null,'Resultados por asesor'),h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['Asesor','Llamadas','Nota promedio','Cero tolerancia','Recuperabilidad alta'].map(k=>h('th',{key:k},k)))),h('tbody',null,stats.advisors.map(r=>h('tr',{key:r.advisor},h('td',null,h('button',{onClick:()=>setFilter('advisor',r.advisor)},r.advisor)),h('td',null,r.n,r.n<5?' · muestra reducida':''),h('td',null,pct(r.average)),h('td',null,r.critical),h('td',null,r.high)))))))
    :view==='calls'?h(React.Fragment,null,h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['Fecha llamada','Asesor / archivo','Version','Nota SA','Cero tolerancia','Motivo','Siguiente paso',''].map((k,i)=>h('th',{key:i},k)))),h('tbody',null,sorted.slice(page*20,page*20+20).map(r=>h('tr',{key:M.key(r)},h('td',null,r.callDate),h('td',null,r.advisor,h('small',{className:'sa-file'},r.file)),h('td',null,r.version),h('td',null,pct(r.score)),h('td',null,r.critical?'Detectada: '+r.codes:'No detectada'),h('td',null,text(r.reason)),h('td',null,text(r.next)),h('td',null,h('button',{onClick:()=>setDetail(r)},'Ver analisis'))))))),h('div',{className:'sa-actions'},h('button',{disabled:page===0,onClick:()=>setPage(page-1)},'Anterior'),h('span',null,`${page+1} / ${Math.max(1,Math.ceil(rows.length/20))}`),h('button',{disabled:(page+1)*20>=rows.length,onClick:()=>setPage(page+1)},'Siguiente')))
    :view==='opportunities'?h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['Oportunidad','Afectadas / aplicables','Asesores','Accion sugerida',''].map((k,i)=>h('th',{key:i},k)))),h('tbody',null,stats.criteria.filter(r=>r.no).map(c=>h('tr',{key:c.label},h('td',null,c.label),h('td',null,`${c.no}/${c.applicable} (${pct(c.rate)})`),h('td',null,new Set(rows.filter(r=>M.norm(r.source[c.label])==='no').map(r=>r.advisor)).size),h('td',null,'Revisar evidencias y reforzar el criterio mediante practica guiada.'),h('td',null,h('button',{onClick:()=>setEvidence(c.label)},'Ver evidencia')))))))
    :view==='imports'?h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['Archivo','Fecha de importacion','Usuario','Nuevos','Duplicados omitidos'].map(k=>h('th',{key:k},k)))),h('tbody',null,imports.map(b=>h('tr',{key:b.id},h('td',null,b.file),h('td',null,new Date(b.createdAt).toLocaleString('es-PE')),h('td',null,b.createdBy),h('td',null,b.count),h('td',null,b.duplicates)))))):null)),
  preview&&h(Dialog,{title:'Confirmar importacion: No venta',onClose:()=>{if(!busy)setPreview(null);}},h('p',null,`${preview.total} filas · ${preview.newCount} nuevas · ${preview.duplicates} duplicadas · ${preview.errors.length} errores · ${preview.conflicts.length} conflictos`),
    error&&h('p',{className:'sa-error',role:'alert'},error),
    [...preview.errors,...preview.conflicts.map(c=>({row:c.row,message:'El ID o archivo ya existe con datos distintos; no se sobrescribira.'})),...preview.warnings].map((e,i)=>h('p',{key:i,className:'sa-error'},`Fila ${e.row}: ${e.message}`)),
    h('div',{className:'sa-table-wrap'},h('table',null,h('thead',null,h('tr',null,['ID','Asesor','Fecha','Nota'].map(k=>h('th',{key:k},k)))),h('tbody',null,preview.sample.map(r=>h('tr',{key:M.key(r)},h('td',null,r.id),h('td',null,r.advisor),h('td',null,r.callDate),h('td',null,pct(r.score))))))),
    !!preview.unmatched.length&&h('div',null,h('p',null,'Sin coincidencia exacta en Dotacion: '+preview.unmatched.join(', ')),h('label',null,h('input',{type:'checkbox',checked:allowUnmatched,onChange:e=>setAllowUnmatched(e.target.checked)}),' Conservar nombres del SA sin crear usuarios ni modificar Dotacion')),
    h('p',null,`${preview.evaluationCount} evaluaciones SA y ${preview.feedbackCount} feedbacks nuevos. Evaluador: ${currentUser.nombre||currentUser.usuario}. Se respetan los bloqueos de feedback.`),
    !!preview.pendingCriteria?.length&&h('p',{className:'sa-error'},'PUE pendiente de revision (sin inventar cumplimiento): '+preview.pendingCriteria.join(', ')+'. Nota provisional sobre los criterios informados.'),
    !!preview.unmatched.length&&h('p',{className:'sa-error'},'Usuario pendiente de creacion: se conserva el asesor informado y el feedback queda sin usuario vinculado.'),
    h('button',{className:'sa-primary',disabled:busy||(!preview.newCount&&!preview.evaluationCount)||!!preview.errors.length||!!preview.conflicts.length||(!!preview.unmatched.length&&!allowUnmatched),onClick:confirmImport},busy?'Guardando...':'Confirmar importacion')),
  evidence&&h(Dialog,{title:'Evidencias: '+evidence,onClose:()=>setEvidence(null)},rows.filter(r=>M.norm(r.source[evidence])==='no').map(r=>h('article',{key:M.key(r)},h('h3',null,r.advisor+' · '+r.callDate),h('p',null,r.source[evidence+' — por qu\u00e9']||'Sin evidencia escrita'),h('p',null,'Minuto: '+(r.source[evidence+' — minuto']||'Sin dato')),h('button',{onClick:()=>{setEvidence(null);setDetail(r);}},'Ver analisis completo')))),
  detail&&h(Detail,{record:detail,onClose:()=>setDetail(null)}));
};
})();
