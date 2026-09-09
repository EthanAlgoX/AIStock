import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportMarkdownBody } from '../ReportMarkdownBody';
import { parseAnalysisChart } from '../../../utils/analysisChart';

const chart={version:1,type:'line',title:'现金流趋势',source:'年度报告',basis:'observed',unit:'亿元',series:[{key:'v0',name:'现金流',expression:'cash'}],data:[{label:'2023',v0:-2},{label:'2024',v0:null},{label:'2025',v0:4}]};
const markdown='## 结论\n\n保持证据完整。\n\n```analysis-chart\n'+JSON.stringify(chart)+'\n```';
describe('shared chart reports',()=>{
  it('renders a sourced figure with missing gaps and preserved prose',()=>{
    const {container}=render(<ReportMarkdownBody content={markdown}/>);
    expect(screen.getByRole('figure',{name:'现金流趋势'})).toBeInTheDocument();
    expect(screen.getByText('保持证据完整。')).toBeInTheDocument();
    expect(screen.getByText(/来源（由报告提供）/)).toHaveTextContent('年度报告');
    expect(container.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    fireEvent.click(screen.getByText('查看图表数值与计算依据'));
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('cash')).toBeInTheDocument();
  });
  it('preserves malformed or streaming code and ordinary code blocks',()=>{
    render(<ReportMarkdownBody content={'```analysis-chart\n{"version":1\n```\n\n```python\nprint(1)\n```'}/>);
    expect(screen.getByText(/图表数据尚未完整/)).toBeInTheDocument();
    expect(screen.getByText('print(1)')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });
  it('does not interpret text labels as executable HTML and honors image suppression',()=>{
    render(<ReportMarkdownBody allowImages={false} content={'![remote](https://example.com/a.png)\n\n```analysis-chart\n'+JSON.stringify({...chart,title:'<img src=x onerror=alert(1)>'})+'\n```'}/>);
    expect(screen.getByRole('figure')).toHaveAccessibleName('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
  it.each([null,{}, {...chart,data:[{label:'bad',v0:'3'}]}, {...chart,data:[{label:'missing',v0:null}]}, {...chart,series:[...chart.series,...chart.series]}])('rejects invalid schemas %j',value=>{
    expect(parseAnalysisChart(JSON.stringify(value))).toBeNull();
  });
  it('renders explicit condition relationships without inventing probabilities',()=>{
    const flow={version:1,type:'flow',title:'跟踪条件',source:'研究假设',basis:'scenario',nodes:['增长持续','复核估值'],edges:[{from:0,to:1,label:'得到财报验证后'}]};
    render(<ReportMarkdownBody content={'```analysis-chart\n'+JSON.stringify(flow)+'\n```'}/>);
    expect(screen.getByRole('figure',{name:'跟踪条件'})).toBeInTheDocument();
    expect(screen.getByText(/得到财报验证后/)).toBeInTheDocument();
    expect(screen.getByText('假设情景')).toBeInTheDocument();
  });
});
