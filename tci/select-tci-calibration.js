const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'details');
const OUT_DIR = path.join(process.cwd(), 'tci-results');
const TARGET = 50;

function arr(v){ return Array.isArray(v) ? v : []; }
function obj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
function txt(v){ return v == null ? '' : String(v).trim(); }
function low(v){ return txt(v).toLowerCase(); }
function uniq(a){ return [...new Set(a.filter(Boolean))]; }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function len(v){ return txt(v).length; }

function extract(id, x){
  const steps = arr(x.executionSteps);
  const methods = arr(x.executionMethods);
  const cases = arr(x.executionCases);
  const profiles = arr(x.profileComponents);
  const units = [
    ...arr(x.unitGroupsExecuting), ...arr(x.unitGroupsAuthority),
    ...arr(x.unitGroupsAuthorized), ...arr(x.unitGroupsCoordinating)
  ];
  const depts = [
    ...arr(x.departmentsExecuting), ...arr(x.departmentsAuthority),
    ...arr(x.departmentsAuthorized), ...arr(x.departmentsCoordinating)
  ];
  const agencies = [
    ...arr(x.executingAgencies), ...arr(x.authorizedAgencies),
    ...arr(x.delegatedAgencies), ...arr(x.coordinatingAgencies)
  ];

  const narrative = `${txt(x.description)}\n${txt(x.requirementsAndConditions)}`;
  const branchWords = ['trường hợp','nếu','hoặc','trừ trường hợp','đối với','khi','trong trường hợp','tùy trường hợp'];
  const conditionWords = ['điều kiện','yêu cầu','tiêu chuẩn','phải','không được','được phép'];
  const branchHits = branchWords.filter(w=>low(narrative).includes(w)).length;
  const conditionHits = conditionWords.filter(w=>low(narrative).includes(w)).length;
  const orCount = (narrative.match(/\bhoặc\b/gi)||[]).length;
  const ifCount = (narrative.match(/\bnếu\b/gi)||[]).length;
  const caseCount = (narrative.match(/\btrường hợp\b/gi)||[]).length;
  const conditionSignal = branchHits + conditionHits + Math.min(orCount,10) + Math.min(ifCount*2,10) + Math.min(caseCount,15);

  const methodNames = uniq(methods.map(m=>obj(m)?(txt(m.submissionMethod)||txt(m.type)||txt(m.method)):'').filter(Boolean));
  const times = [];
  for(const m of methods){ if(obj(m)){ const q=num(m.processingTime); if(q!==null) times.push(`${q} ${txt(m.processingTimeUnit)||'UNKNOWN'}`); }}
  for(const c of cases){ if(obj(c)&&obj(c.processingDay)){ const q=num(c.processingDay.qty); if(q!==null) times.push(`${q} ${txt(c.processingDay.type)||'UNKNOWN'}`); }}
  const distinctTimes = uniq(times);

  const warnings=[];
  for(const f of ['executionSteps','executionMethods','executionCases','profileComponents','requirementsAndConditions']){
    if(!(f in x)) warnings.push(`MISSING_FIELD:${f}`);
    else if(x[f]===null) warnings.push(`NULL_FIELD:${f}`);
  }
  if(steps.length===0) warnings.push('EMPTY_EXECUTION_STEPS');
  if(methods.length===0) warnings.push('EMPTY_EXECUTION_METHODS');
  if(profiles.length===0) warnings.push('EMPTY_PROFILE_COMPONENTS');
  if(distinctTimes.length>1) warnings.push('PROCESSING_TIME_CONFLICT');

  const processingNums = [];
  for(const m of methods){ if(obj(m)){ const q=num(m.processingTime); if(q!==null) processingNums.push(q); }}
  for(const c of cases){ if(obj(c)&&obj(c.processingDay)){ const q=num(c.processingDay.qty); if(q!==null) processingNums.push(q); }}

  const actorSignal = units.length + depts.length + agencies.length;
  const narrativeLength = narrative.length;

  return {
    id,
    code: txt(x.code)||txt(x.codeNotation)||id,
    name: txt(x.name)||'(Không có tên)',
    category: obj(x.category)?txt(x.category.name):'',
    features:{
      steps: steps.length,
      profileComponents: profiles.length,
      methods: methodNames.length,
      methodNames,
      executionCases: cases.length,
      processingMin: processingNums.length?Math.min(...processingNums):null,
      processingMax: processingNums.length?Math.max(...processingNums):null,
      processingValues: distinctTimes,
      timeConflict: distinctTimes.length>1,
      conditionSignal,
      actorSignal,
      unitGroups: arr(x.unitGroupsExecuting).length + arr(x.unitGroupsAuthority).length + arr(x.unitGroupsAuthorized).length + arr(x.unitGroupsCoordinating).length,
      departments: depts.length,
      agencies: agencies.length,
      narrativeLength,
      hasExecutionCases: cases.length>0,
      dataWarnings: warnings
    }
  };
}

function sortDesc(a,b,fn){ return [...a].sort((x,y)=>(fn(y)||0)-(fn(x)||0)); }
function sortAsc(a,b,fn){ return [...a].sort((x,y)=>(fn(x)||0)-(fn(y)||0)); }
function add(pool, rec, group, reason){
  if(!rec) return;
  let p=pool.get(rec.id);
  if(!p){ p={record:rec,groups:[],reasons:[]}; pool.set(rec.id,p); }
  if(!p.groups.includes(group)) p.groups.push(group);
  if(reason && !p.reasons.includes(reason)) p.reasons.push(reason);
}

if(!fs.existsSync(ROOT)) throw new Error(`Không tìm thấy thư mục: ${ROOT}`);

const files = fs.readdirSync(ROOT).filter(f=>f.toLowerCase().endsWith('.json')).sort();
console.log(`Đọc ${files.length} JSON trong details/ ...`);
const records=[];
for(const file of files){
  try{
    const id=path.basename(file,'.json');
    const x=JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
    if(obj(x)) records.push(extract(id,x));
  }catch(e){ console.warn(`Bỏ qua ${file}: ${e.message}`); }
}
console.log(`Phân tích được ${records.length} TTHC.`);

const groups = {};
groups.G01_SIMPLE_STEPS = sortAsc(records,0,r=>r.features.steps).slice(0,12);
groups.G02_MANY_STEPS = sortDesc(records,0,r=>r.features.steps).slice(0,12);
groups.G03_FEW_PROFILES = sortAsc(records,0,r=>r.features.profileComponents).slice(0,12);
groups.G04_MANY_PROFILES = sortDesc(records,0,r=>r.features.profileComponents).slice(0,12);
groups.G05_SHORT_TIME = records.filter(r=>r.features.processingMin!==null).sort((a,b)=>a.features.processingMin-b.features.processingMin).slice(0,12);
groups.G06_LONG_TIME = records.filter(r=>r.features.processingMax!==null).sort((a,b)=>b.features.processingMax-a.features.processingMax).slice(0,12);
groups.G07_MULTIPLE_METHODS = sortDesc(records,0,r=>r.features.methods).slice(0,12);
groups.G08_COMPLEX_CONDITIONS = sortDesc(records,0,r=>r.features.conditionSignal).slice(0,12);
groups.G09_MANY_ACTORS = sortDesc(records,0,r=>r.features.actorSignal).slice(0,12);
groups.G10_EXECUTION_CASES = records.filter(r=>r.features.hasExecutionCases).sort((a,b)=>b.features.executionCases-a.features.executionCases).slice(0,12);
groups.G11_ANOMALIES = records.filter(r=>r.features.dataWarnings.length>0).sort((a,b)=>b.features.dataWarnings.length-a.features.dataWarnings.length).slice(0,15);

groups.G12_VERY_SIMPLE = records.slice().sort((a,b)=>{
  const sa=a.features.steps*4+a.features.profileComponents*2+a.features.methods+a.features.conditionSignal;
  const sb=b.features.steps*4+b.features.profileComponents*2+b.features.methods+b.features.conditionSignal;
  return sa-sb;
}).slice(0,12);

groups.G13_VERY_COMPLEX = records.slice().sort((a,b)=>{
  const sa=a.features.steps*5+a.features.conditionSignal*2+a.features.actorSignal*2+a.features.narrativeLength/1000;
  const sb=b.features.steps*5+b.features.conditionSignal*2+b.features.actorSignal*2+b.features.narrativeLength/1000;
  return sb-sa;
}).slice(0,12);

const pool=new Map();
for(const [g,list] of Object.entries(groups)){
  for(const r of list) add(pool,r,g,`Chọn từ ${g}`);
}

const selected=new Map();
const groupCount={};
for(const g of Object.keys(groups)) groupCount[g]=0;
function choose(id, reason){
  if(selected.has(id)) return false;
  const p=pool.get(id); if(!p) return false;
  selected.set(id,{...p,reasons:[...p.reasons,reason]});
  for(const g of p.groups) groupCount[g]=(groupCount[g]||0)+1;
  return true;
}

// Bắt buộc extreme simple + complex trước.
for(const r of groups.G12_VERY_SIMPLE) if(selected.size<TARGET) choose(r.id,'Bắt buộc có mẫu rất đơn giản');
for(const r of groups.G13_VERY_COMPLEX) if(selected.size<TARGET) choose(r.id,'Bắt buộc có mẫu rất phức tạp');

// Đảm bảo 10 coverage cốt lõi, tối thiểu 1 và cố gắng 4/nhóm.
for(const [g,list] of Object.entries(groups)){
  let added=0;
  for(const r of list){
    if(selected.size>=TARGET || added>=4) break;
    if(!selected.has(r.id) && choose(r.id,`Bổ sung coverage ${g}`)) added++;
  }
}

// Ưu tiên anomaly chưa có.
for(const r of groups.G11_ANOMALIES){ if(selected.size>=TARGET) break; if(!selected.has(r.id)) choose(r.id,'Bổ sung bất thường dữ liệu để audit'); }

// Điền đủ 50 bằng mẫu trung vị deterministic, tránh dồn toàn bộ vào extremes.
const remaining=records.filter(r=>!selected.has(r.id)).sort((a,b)=>a.code.localeCompare(b.code,'vi'));
if(selected.size<TARGET && remaining.length){
  const need=TARGET-selected.size;
  const stride=Math.max(1,Math.floor(remaining.length/need));
  const used=new Set();
  for(let i=0;i<remaining.length && selected.size<TARGET;i+=stride){
    const r=remaining[i];
    if(!used.has(r.id)){ used.add(r.id); add(pool,r,'G14_DETERMINISTIC_SPREAD','Bổ sung để đủ 50 và phân tán mẫu'); choose(r.id,'Bổ sung deterministic spread'); }
  }
}
// Safety fill.
for(const r of remaining){ if(selected.size>=TARGET) break; if(!selected.has(r.id)){ add(pool,r,'G15_FILL','Bổ sung cuối để đủ 50'); choose(r.id,'Bổ sung cuối để đủ 50'); } }

const samples=[...selected.values()].sort((a,b)=>a.record.code.localeCompare(b.record.code,'vi')).map((p,i)=>({sampleNo:i+1,...p}));
const coverage={};
for(const g of Object.keys(groups)){
  const count=samples.filter(s=>s.groups.includes(g)).length;
  coverage[g]={selected:count,covered:count>0};
}

const out={
  metadata:{version:'TCI_V1_CALIBRATION_SELECTOR_GITHUB_1.0',generatedAt:new Date().toISOString(),source:'branch data / details/*.json',totalJsonFiles:files.length,totalParsed:records.length,target:TARGET,selected:samples.length,random:false,note:'Chỉ chọn mẫu calibration, chưa tính TCI.'},
  coverage,
  samples:samples.map(s=>({sampleNo:s.sampleNo,id:s.record.id,code:s.record.code,name:s.record.name,category:s.record.category,groups:s.groups,reasons:s.reasons,features:s.record.features}))
};

const manifest=samples.map(s=>({sampleNo:s.sampleNo,id:s.record.id,file:`details/${s.record.id}.json`,code:s.record.code,name:s.record.name}));

fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'tci-calibration-selection.json'),JSON.stringify(out,null,2));
fs.writeFileSync(path.join(OUT_DIR,'tci-calibration-manifest.json'),JSON.stringify(manifest,null,2));

let md='# TCI V1 – Calibration Sample Report\n\n';
md+=`- Tổng JSON trong details: **${files.length}**\n- Phân tích thành công: **${records.length}**\n- Số mẫu chọn: **${samples.length}**\n- Random: **Không**\n- Chưa tính điểm TCI.\n\n## Coverage\n\n`;
for(const [g,v] of Object.entries(coverage)) md+=`- ${v.covered?'✅':'❌'} ${g}: ${v.selected}\n`;
md+='\n## 50 mẫu\n\n';
for(const s of samples){
  const f=s.record.features;
  md+=`${s.sampleNo}. **${s.record.code} — ${s.record.name}**\n   - Bước: ${f.steps}; Hồ sơ: ${f.profileComponents}; Phương thức: ${f.methods}; Cases: ${f.executionCases}; Thời gian: ${f.processingMin??'UNKNOWN'}${f.processingMax!==null&&f.processingMax!==f.processingMin?`–${f.processingMax}`:''}\n   - Điều kiện signal: ${f.conditionSignal}; Actor signal: ${f.actorSignal}; Cảnh báo: ${f.dataWarnings.length}${f.dataWarnings.length?` (${f.dataWarnings.join(', ')})`:''}\n   - Nhóm: ${s.groups.join(', ')}\n\n`;
}
fs.writeFileSync(path.join(OUT_DIR,'tci-calibration-summary.md'),md);
console.log(`ĐÃ CHỌN ${samples.length} MẪU.`);
console.log(`Kết quả: ${OUT_DIR}`);
