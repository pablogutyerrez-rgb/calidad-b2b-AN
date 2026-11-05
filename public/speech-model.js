(function(root){
  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const roles=['admin','analista','monitor','supervisor','coordinador','formador'];
  function canRead(user){
    const access=Array.isArray(user?.platformAccess)?user.platformAccess:[user?.clientId||user?.platformId||'entel_b2b'];
    return roles.includes(norm(user?.rol))&&access.includes('entel_b2b');
  }
  const canImport=user=>canRead(user)&&['admin','analista','monitor'].includes(norm(user.rol));
  const number=v=>v===null||v===undefined||clean(v)===''?null:Number(String(v).replace(',','.'));
  function date(v){
    if(typeof v==='number')v=new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);
    const value=clean(v).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Fecha de llamada invalida; se requiere AAAA-MM-DD.');
    return value;
  }
  function parseRows(rows){
    if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw Error('Importa entre 1 y 5000 filas.');
    const required=['ID','Archivo','Asesor','Version','Fecha de la llamada','Nota de la ficha (%)','Puntaje obtenido','Peso aplicable','Cero tolerancia'];
    const parsed=[],errors=[];
    rows.forEach((raw,i)=>{
      try{
        if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Fila invalida.');
        const source=Object.fromEntries(Object.entries(raw).map(([k,v])=>[clean(k),v==null?'':clean(v)]));
        const byName=Object.fromEntries(Object.entries(source).map(([k,v])=>[norm(k),v]));
        for(const k of required)if(!clean(byName[norm(k)]))throw Error('Falta '+k);
        const get=k=>byName[norm(k)]||'';
        const score=number(get('Nota de la ficha (%)')),points=number(get('Puntaje obtenido')),weight=number(get('Peso aplicable'));
        if(!Number.isFinite(score)||score<0||score>100||!Number.isFinite(points)||!Number.isFinite(weight)||weight<=0||points<0||points>weight)throw Error('Nota, puntaje o peso invalido.');
        const criteria=Object.keys(source).filter(k=>/^NV-/.test(k)&&!k.includes(' — '));
        if(!criteria.length)throw Error('Faltan criterios NV de la ficha No venta.');
        const version=get('Version').toUpperCase();
        if(!['V1','V2'].includes(version))throw Error('Version no soportada: '+version);
        const critical=norm(get('Cero tolerancia'));
        if(!['detectada','no detectada'].includes(critical))throw Error('Cero tolerancia invalida.');
        const callDate=date(raw['Fecha de la llamada']??get('Fecha de la llamada'));
        parsed.push({id:get('ID'),file:get('Archivo'),advisor:get('Asesor'),version,callDate,uploadDate:get('Fecha'),
          score,points,weight,critical:critical==='detectada',codes:get('Cero tolerancia: codigos'),duration:number(get('Duracion (min)')),
          type:get('Tipo de llamada'),segment:get('Segmento detectado'),reason:get('Motivo de no venta'),next:get('Siguiente paso'),recovery:get('Recuperabilidad'),source,
          warnings:Math.abs(score-points/weight*100)>0.15?['La nota no coincide con puntaje / peso; se conserva la nota del SA.']:[],row:i+2});
      }catch(e){errors.push({row:i+2,message:e.message});}
    });
    return {rows:parsed,errors};
  }
  const key=r=>r.id+'::'+r.version;
  function comparableDate(value){
    const numeric=Number(value);
    const dateText=String(value).replace(' ','T');
    const timestamp=value!==''&&Number.isFinite(numeric)&&numeric>20000?Date.UTC(1899,11,30)+numeric*86400000:Date.parse(dateText+(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(dateText)?'Z':''));
    return Number.isFinite(timestamp)?new Date(Math.round(timestamp/1000)*1000).toISOString():value;
  }
  const fingerprint=r=>JSON.stringify(Object.keys(r.source).sort().map(k=>[k,['fecha','fecha de la llamada'].includes(norm(k))?comparableDate(r.source[k]):r.source[k]]));
  function planImport(incoming,existing){
    const ids=new Map(existing.map(r=>[key(r),r])),files=new Map(existing.map(r=>[norm(r.file)+'::'+r.version,r]));
    const added=[],duplicates=[],conflicts=[];
    for(const r of incoming){
      const old=ids.get(key(r))||files.get(norm(r.file)+'::'+r.version);
      if(old){(fingerprint(old)===fingerprint(r)?duplicates:conflicts).push({row:r.row,id:r.id});continue;}
      added.push(r);ids.set(key(r),r);files.set(norm(r.file)+'::'+r.version,r);
    }
    return {added,duplicates,conflicts};
  }
  function uniqueCalls(rows){
    const map=new Map();
    for(const r of rows){const k=norm(r.file);const old=map.get(k);if(!old||r.version.localeCompare(old.version)>0)map.set(k,r);}
    return [...map.values()];
  }
  function filter(rows,f={}){
    const base=f.version?rows.filter(r=>r.version===f.version):uniqueCalls(rows);
    const start=f.from||f.to,end=f.to||f.from;
    return base.filter(r=>(!start||r.callDate>=start)&&(!end||r.callDate<=end)&&
      ['advisor','segment','type','reason','recovery'].every(k=>!f[k]||r[k]===f[k])&&
      (!f.critical||(f.critical==='yes')===r.critical)&&(!f.min||r.score>=Number(f.min))&&(!f.max||r.score<=Number(f.max))&&
      (!f.search||norm(r.file+' '+r.id+' '+r.advisor).includes(norm(f.search))));
  }
  function summary(rows){
    const categories=field=>Object.entries(rows.reduce((a,r)=>{const v=r[field]||r.source[field]||'Sin dato';a[v]=(a[v]||0)+1;return a;},{})).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count);
    const allKeys=[...new Set(rows.flatMap(r=>Object.keys(r.source)))];
    const criteria=allKeys.filter(k=>k.startsWith('NV-')&&!k.includes(' — ')).map(label=>{
      let yes=0,no=0,na=0,missing=0;
      rows.forEach(r=>{const v=norm(r.source[label]);if(v==='si')yes++;else if(v==='no')no++;else if(['no aplica','no_aplica'].includes(v))na++;else missing++;});
      return {label,yes,no,na,missing,applicable:yes+no,rate:yes+no?no/(yes+no)*100:null};
    }).sort((a,b)=>(b.rate??-1)-(a.rate??-1));
    const skills=allKeys.filter(k=>k.startsWith('Habilidad:')&&!k.includes(' — ')).map(label=>{
      const values=rows.map(r=>number(r.source[label])).filter(v=>Number.isFinite(v));
      return {label,n:values.length,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
    });
    const advisors=[...new Set(rows.map(r=>r.advisor))].map(advisor=>{const a=rows.filter(r=>r.advisor===advisor);return {advisor,n:a.length,average:a.reduce((s,r)=>s+r.score,0)/a.length,critical:a.filter(r=>r.critical).length,high:a.filter(r=>r.recovery==='ALTA').length};});
    const trend=[...new Set(rows.map(r=>r.callDate))].sort().map(day=>{const a=rows.filter(r=>r.callDate===day);return {day,n:a.length,average:a.reduce((s,r)=>s+r.score,0)/a.length};});
    return {n:rows.length,advisors,average:rows.length?rows.reduce((s,r)=>s+r.score,0)/rows.length:null,
      passed:rows.filter(r=>r.score>=90).length,critical:rows.filter(r=>r.critical).length,high:rows.filter(r=>r.recovery==='ALTA').length,
      criteria,skills,trend,reasons:categories('reason'),objections:categories('Objeci\u00f3n principal'),loss:categories('Momento de la p\u00e9rdida'),recoveries:categories('recovery'),next:categories('next'),
      criticalCodes:Object.entries(rows.filter(r=>r.critical).reduce((a,r)=>{for(const code of new Set(r.codes.split(/[,;]+/).map(clean).filter(Boolean)))a[code]=(a[code]||0)+1;return a;},{})).map(([label,count])=>({label,count})),
      promotion:categories('Fin de la promoci\u00f3n')};
  }
  root.SpeechModel={canRead,canImport,norm,parseRows,planImport,key,filter,summary,uniqueCalls};
})(globalThis);
