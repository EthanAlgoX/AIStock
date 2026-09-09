export type AnalysisChart = {
  version:1; type:'line'|'bar'|'flow'; title:string; source:string; basis:'observed'|'scenario'|'illustrative';
  asOf?:string; unit?:string; description?:string;
  series?:{key:string;name:string;expression?:string}[];
  data?:{label:string;[key:string]:string|number|null}[];
  inputs?:{label:string;[key:string]:string|number|null}[];
  nodes?:string[]; edges?:{from:number;to:number;label:string}[];
};
const text = (v:unknown, n:number) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseAnalysisChart(raw:string):AnalysisChart | null {
  if(raw.length>60000) return null;
  try {
    const c:unknown=JSON.parse(raw);
    if(!object(c)||c.version!==1||!['line','bar','flow'].includes(String(c.type))||!text(c.title,160)||!text(c.source,400)||!['observed','scenario','illustrative'].includes(String(c.basis))) return null;
    for(const [key,max] of [['asOf',80],['unit',40],['description',800]] as const) if(c[key]!==undefined&&!text(c[key],max)) return null;
    if(c.type==='flow') {
      if(!Array.isArray(c.nodes)||c.nodes.length<2||c.nodes.length>12||!c.nodes.every(n=>text(n,100))||!Array.isArray(c.edges)||c.edges.length>20) return null;
      const length=c.nodes.length;
      if(!c.edges.every(e=>object(e)&&Number.isInteger(e.from)&&Number.isInteger(e.to)&&Number(e.from)>=0&&Number(e.to)>=0&&Number(e.from)<length&&Number(e.to)<length&&text(e.label,80))) return null;
    } else {
      if(!Array.isArray(c.series)||!c.series.length||c.series.length>4||!Array.isArray(c.data)||!c.data.length||c.data.length>120) return null;
      const series=c.series;
      if(!series.every(s=>object(s)&&typeof s.key==='string'&&/^v[0-3]$/.test(s.key)&&text(s.name,80)&&(s.expression===undefined||text(s.expression,240)))) return null;
      if(new Set(series.map(s=>s.key)).size!==series.length) return null;
      if(!c.data.every(row=>object(row)&&text(row.label,100)&&series.every(s=>row[s.key]===null||(typeof row[s.key]==='number'&&Number.isFinite(row[s.key])&&Math.abs(row[s.key] as number)<=1e15)))) return null;
      if(c.inputs!==undefined&&(!Array.isArray(c.inputs)||c.inputs.length!==c.data.length||!c.inputs.every(row=>object(row)&&text(row.label,100)&&Object.keys(row).length<=13&&Object.entries(row).every(([key,value])=>key==='label'||(key.length<=32&&(value===null||(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e15))))))) return null;
      if(!c.data.some(row=>object(row)&&series.some(s=>typeof row[s.key]==='number'))) return null;
    }
    return c as AnalysisChart;
  } catch {return null;}
}
