import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceApi } from '../../api/workspace';
import DataSourcesPage from '../DataSourcesPage';

vi.mock('../../api/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/workspace')>();
  return { ...actual, workspaceApi: { ...actual.workspaceApi, listDataSources: vi.fn(), createDataSource: vi.fn(), archiveDataSource: vi.fn() } };
});

const api=vi.mocked(workspaceApi);
const builtIns=[
  { sourceId:'system_market_data',name:'系统行情与 K 线',kind:'kline' as const,connectionKey:'system_market_data',required:true,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
  { sourceId:'system_news',name:'系统新闻检索',kind:'news' as const,connectionKey:'system_news',required:false,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
  { sourceId:'system_fundamentals',name:'系统基本面数据',kind:'fundamentals' as const,connectionKey:'system_fundamentals',required:false,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
];

describe('DataSourcesPage',()=>{
  beforeEach(()=>{vi.resetAllMocks();api.listDataSources.mockResolvedValue(builtIns);});

  it('shows the three system defaults as ready without asking for per-strategy credentials',async()=>{
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    expect(await screen.findByText('系统行情与 K 线')).toBeInTheDocument();
    expect(screen.getByText('系统新闻检索')).toBeInTheDocument();
    expect(screen.getByText('系统基本面数据')).toBeInTheDocument();
    expect(screen.getByText('默认启用')).toBeInTheDocument();
  });

  it('persists the data type and market tag used by strategy matching',async()=>{
    api.createDataSource.mockResolvedValue({id:9,sourceId:'custom:hk-daily',name:'港股日线数据库',kind:'kline',description:'港股历史行情',connectionKey:'hk_daily_v1',required:false,builtIn:false,selectable:true,availability:'registered',selectionMode:'provider',markets:['hk']});
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText('系统行情与 K 线');
    fireEvent.change(screen.getByLabelText('数据源名称'),{target:{value:'港股日线数据库'}});
    fireEvent.click(screen.getByLabelText('适用市场 A 股'));
    fireEvent.click(screen.getByLabelText('适用市场 港股'));
    fireEvent.change(screen.getByLabelText('连接标识'),{target:{value:'hk_daily_v1'}});
    fireEvent.change(screen.getByLabelText('用途说明'),{target:{value:'港股历史行情'}});
    fireEvent.click(screen.getByRole('button',{name:'登记到数据源目录'}));
    await waitFor(()=>expect(api.createDataSource).toHaveBeenCalledWith({name:'港股日线数据库',connectionKey:'hk_daily_v1',description:'港股历史行情',kind:'kline',markets:['hk']}));
    expect(await screen.findByText('港股日线数据库')).toBeInTheDocument();
  });

  it('does not submit a source without at least one market',async()=>{
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText('系统行情与 K 线');
    fireEvent.change(screen.getByLabelText('数据源名称'),{target:{value:'未标注来源'}});
    fireEvent.change(screen.getByLabelText('连接标识'),{target:{value:'unmarked_source'}});
    fireEvent.click(screen.getByLabelText('适用市场 A 股'));
    expect(screen.getByText('请至少选择一个适用市场。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'登记到数据源目录'})).toBeDisabled();
    expect(api.createDataSource).not.toHaveBeenCalled();
  });

  it('shows configured and unconfigured provider choices separately from automatic defaults',async()=>{
    api.listDataSources.mockResolvedValue([
      ...builtIns,
      {sourceId:'kline:akshare',name:'AkShare 行情',kind:'kline',connectionKey:'kline:akshare',required:false,builtIn:true,selectable:true,availability:'configured',selectionMode:'provider',markets:['cn','hk']},
      {sourceId:'news:tavily',name:'Tavily 新闻搜索',kind:'news',connectionKey:'news:tavily',required:false,builtIn:true,selectable:false,availability:'unconfigured',selectionMode:'provider',markets:['cn','hk','us']},
    ]);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    expect(await screen.findByText('AkShare 行情')).toBeInTheDocument();
    expect(screen.getByText('Tavily 新闻搜索')).toBeInTheDocument();
    expect(screen.getAllByText('已配置')).not.toHaveLength(0);
    expect(screen.getAllByText('未配置')).not.toHaveLength(0);
    expect(screen.getByText('适用市场：A 股 / 港股')).toBeInTheDocument();
    expect(screen.getByText('已配置提供方')).toBeInTheDocument();
    expect(screen.getByText('待配置提供方')).toBeInTheDocument();
    expect(screen.queryByText(/策略草稿/)).not.toBeInTheDocument();
  });

  it('shows every publisher covered by the default finance RSS route',async()=>{
    api.listDataSources.mockResolvedValue([
      ...builtIns,
      {
        sourceId:'news:finance_rss',
        name:'财经资讯 RSS 聚合',
        kind:'news',
        connectionKey:'news:finance_rss',
        required:false,
        builtIn:true,
        selectable:true,
        availability:'configured',
        selectionMode:'provider',
        markets:['cn','hk','us'],
        includedSources:[
          {id:'reuters-business',name:'Reuters Business',domain:'reuters.com',category:'publisher',markets:['cn','hk','us']},
          {id:'business-wire',name:'Business Wire',domain:'businesswire.com',category:'corporate_wire',markets:['cn','hk','us']},
          {id:'sec',name:'SEC',domain:'sec.gov',category:'regulator',markets:['us']},
        ],
      },
    ]);

    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading',{name:'默认财经资讯网络'})).toBeInTheDocument();
    expect(screen.getByText('Reuters Business')).toBeInTheDocument();
    expect(screen.getByText('Business Wire')).toBeInTheDocument();
    expect(screen.getByText('SEC')).toBeInTheDocument();
    expect(screen.getByText('3 个来源·默认可用')).toBeInTheDocument();
    expect(screen.getByText(/不表示已批量抓取或保存各站正文/)).toBeInTheDocument();
  });
});
