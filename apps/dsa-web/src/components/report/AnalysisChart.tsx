import { useId, useRef, useState } from 'react';
import type { AnalysisChart as Chart } from '../../utils/analysisChart';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const colors=['hsl(var(--primary))','hsl(var(--foreground))','hsl(var(--color-purple))','hsl(var(--muted-foreground))'];
const format=(v:number)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3,notation:Math.abs(v)>=1e7?'compact':'standard'}).format(v);
export function AnalysisChart({chart}:{chart:Chart}) {
  const {localize:l}=useUiLanguage();
  const titleId=useId();
  const svgRef=useRef<SVGSVGElement>(null);
  const [hidden,setHidden]=useState<string[]>([]);
  const [exportError,setExportError]=useState(false);
  const series=chart.series||[];
  const visible=series.filter(s=>!hidden.includes(s.key));
  const rows=chart.data||[];
  const values=rows.flatMap(row=>visible.map(s=>row[s.key]).filter((v):v is number=>typeof v==='number'));
  const low=Math.min(0,...values), rawHigh=Math.max(0,...values), high=rawHigh===low?low+1:rawHigh;
  const y=(v:number)=>260-(v-low)/(high-low)*220;
  const x=(i:number)=>64+i*580/Math.max(1,rows.length-1);
  const exportSvg=()=>{
    if(!svgRef.current) return;
    try {
      const svg=svgRef.current;
      const copy=svg.cloneNode(true) as SVGSVGElement;
      const originals=[svg,...Array.from(svg.querySelectorAll('*'))];
      [copy,...Array.from(copy.querySelectorAll('*'))].forEach((el,i)=>{
        const styles=getComputedStyle(originals[i]);
        for(const property of ['fill','stroke','color','font-size','font-family','font-weight']) (el as SVGElement).style.setProperty(property,styles.getPropertyValue(property));
      });
      copy.setAttribute('width','700');copy.setAttribute('height','380');
      copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
      const a=document.createElement('a');a.href=url;a.download='analysis-chart.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setExportError(false);
    } catch {setExportError(true);}
  };
  return <figure className="analysis-chart not-prose my-6 min-w-0 border-y border-border py-5" aria-labelledby={titleId}>
    <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h4 id={titleId} className="text-base font-semibold text-foreground">{chart.title}</h4><p className="mt-1 text-xs text-secondary-text">{chart.basis==='scenario'?l('假设情景','Scenario'):chart.basis==='illustrative'?l('示意关系','Illustration'):l('提供的数据','Supplied observations')}{chart.unit?` · ${chart.unit}`:''}{chart.asOf?` · ${chart.asOf}`:''}</p></div>
      {chart.type!=='flow'&&<button className="btn-secondary text-xs" type="button" onClick={exportSvg}>{l('下载图表 SVG','Download SVG')}</button>}
    </figcaption>
    {chart.description&&<p className="mb-4 max-w-prose text-sm leading-7 text-secondary-text">{chart.description}</p>}
    {chart.type==='flow'?<div className="space-y-3">
      <ol className="grid gap-3 sm:grid-cols-2">{chart.nodes?.map((node,index)=><li key={index} className="flex items-start gap-3 border border-border px-4 py-3 text-sm"><span className="text-primary">{index+1}</span><span>{node}</span></li>)}</ol>
      <ul className="space-y-2 text-sm text-secondary-text">{chart.edges?.map((edge,i)=><li key={i}><span className="grid items-center gap-2 border-b border-border py-3 sm:grid-cols-[1fr_auto_1fr]"><strong className="font-medium text-foreground">{chart.nodes?.[edge.from]}</strong><span className="text-center text-primary">→ {edge.label} →</span><strong className="font-medium text-foreground">{chart.nodes?.[edge.to]}</strong></span></li>)}</ul>
    </div>:<>
      <div className="mb-3 flex flex-wrap gap-2" aria-label={l('显示的数据系列','Visible series')}>{series.map((s,i)=><button type="button" key={s.key} aria-pressed={!hidden.includes(s.key)} disabled={!hidden.includes(s.key)&&visible.length===1} onClick={()=>setHidden(old=>old.includes(s.key)?old.filter(k=>k!==s.key):[...old,s.key])} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs disabled:cursor-default"><span aria-hidden="true" style={{background:colors[i],opacity:hidden.includes(s.key)?0.3:1}} className="h-2 w-4"/>{s.name}{hidden.includes(s.key)?l('（已隐藏）',' (hidden)'):''}</button>)}</div>
      <div className="max-w-[900px] overflow-x-auto" tabIndex={0} aria-label={l('图表，可横向滚动','Chart, scroll horizontally')}>
        <svg ref={svgRef} viewBox="0 0 700 380" className="h-auto min-w-[520px] w-full" role="img" aria-label={chart.title}>
          <title>{chart.title}</title><desc>{chart.source} · {chart.asOf||''} · {chart.unit||''}</desc>
          <rect width="700" height="380" fill="hsl(var(--card))"/>
          <text x="64" y="20" fill="hsl(var(--foreground))" fontSize="13" fontWeight="600">{chart.title.length>65?chart.title.slice(0,64)+"…":chart.title}</text>
          {[0,1,2,3,4].map(i=>{const value=low+(high-low)*i/4;return <g key={i}><line x1="64" x2="660" y1={y(value)} y2={y(value)} stroke="hsl(var(--border))"/><text x="56" y={y(value)+4} textAnchor="end" fontSize="11" fill="hsl(var(--foreground))">{format(value)}</text></g>;})}
          <line x1="64" x2="660" y1={y(0)} y2={y(0)} stroke="hsl(var(--foreground))" opacity="0.5"/>
          {visible.map(s=>{const index=series.indexOf(s);return <g key={s.key} fill={colors[index]} stroke={colors[index]}>
            {chart.type==='line'&&<path d={rows.map((row,i)=>typeof row[s.key]==='number'?`${i===0||typeof rows[i-1][s.key]!=='number'?'M':'L'} ${x(i)} ${y(row[s.key] as number)}`:'').join(' ')} fill="none" strokeWidth="2" strokeDasharray={index?`${6-index} ${index+2}`:undefined}/>}
            {rows.map((row,i)=>{const value=row[s.key];if(typeof value!=='number')return null;const bw=Math.min(36,550/rows.length/visible.length);const bx=64+(i+0.5)*580/rows.length+(visible.indexOf(s)-(visible.length/2))*bw;return chart.type==='bar'?<rect key={i} x={bx} y={Math.min(y(value),y(0))} width={Math.max(1,bw-2)} height={Math.max(1,Math.abs(y(value)-y(0)))} stroke="none"><title>{row.label} · {s.name}: {value} {chart.unit}</title></rect>:<circle key={i} cx={x(i)} cy={y(value)} r="3" stroke="none"><title>{row.label} · {s.name}: {value} {chart.unit}</title></circle>;})}
          </g>;})}
          {rows.map((row,i)=>i%Math.max(1,Math.ceil(rows.length/6))===0?<text key={i} x={chart.type==='bar'?64+(i+0.5)*580/rows.length:x(i)} y="284" textAnchor="middle" fill="hsl(var(--foreground))" fontSize="11"><title>{row.label}</title>{row.label.length>12?row.label.slice(0,11)+'…':row.label}</text>:null)}
          <text x="64" y="313" fill="hsl(var(--foreground))" fontSize="10">{chart.unit||''} · {chart.source.slice(0,75)}{chart.source.length>75?'…':''}</text>
          {visible.map((s,i)=><g key={s.key}><line x1={64+(i%2)*300} x2={82+(i%2)*300} y1={336+Math.floor(i/2)*20} y2={336+Math.floor(i/2)*20} stroke={colors[series.indexOf(s)]} strokeWidth="3"/><text x={88+(i%2)*300} y={340+Math.floor(i/2)*20} fill="hsl(var(--foreground))" fontSize="11">{s.name.length>30?s.name.slice(0,29)+"…":s.name}</text></g>)}
        </svg>
      </div>
      <p className="mt-2 text-xs leading-5 text-secondary-text">{l('横轴按输入顺序等距排列；缺失数据留空。悬停查看数值，完整精度见数据表。','Categories follow input order at equal spacing; missing values stay empty. Hover for values; full precision is in the table.')}</p>
      <details className="mt-4"><summary className="cursor-pointer py-2 text-sm text-primary">{l('查看图表数值与计算依据','View values and calculations')}</summary><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">{l('项目','Item')}</th>{series.map(s=><th className="p-2" key={s.key}>{s.name}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i} className="border-t border-border"><th className="p-2 font-normal">{row.label}</th>{series.map(s=><td className="p-2 tabular-nums" key={s.key}>{row[s.key]===null?'—':String(row[s.key])}</td>)}</tr>)}</tbody></table></div>{chart.inputs&&<div className="mt-4 overflow-x-auto"><p className="mb-2 font-medium">{l('计算输入','Calculation inputs')}</p><table className="w-full text-left text-xs"><thead><tr>{Object.keys(chart.inputs[0]).map(key=><th className="p-2" key={key}>{key}</th>)}</tr></thead><tbody>{chart.inputs.map((row,i)=><tr className="border-t border-border" key={i}>{Object.keys(chart.inputs![0]).map(key=><td className="p-2 tabular-nums" key={key}>{row[key]===null?'—':String(row[key])}</td>)}</tr>)}</tbody></table></div>}{series.map(s=>s.expression&&<p key={s.key} className="mt-2 break-words text-xs">{s.name}: <code>{s.expression}</code></p>)}</details>
    </>}
    <p className="mt-4 break-words text-xs leading-5 text-secondary-text">{l('来源（由报告提供）','Source (supplied by report)')}：{chart.source}</p>
    {exportError&&<p role="alert" className="text-sm text-danger">{l('下载失败，可查看数据表或重试。','Download failed. View the data table or retry.')}</p>}
  </figure>;
}
