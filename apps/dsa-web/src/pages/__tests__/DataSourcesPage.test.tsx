import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceApi, type WorkspaceDataSource } from '../../api/workspace';
import DataSourcesPage from '../DataSourcesPage';

vi.mock('../../api/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/workspace')>();
  return { ...actual, workspaceApi: { ...actual.workspaceApi, listDataSources: vi.fn(), createDataSource: vi.fn(), archiveDataSource: vi.fn(), probeDataSource: vi.fn() } };
});
vi.mock('../../api/crypto', () => ({ cryptoApi: { market: async () => ({ assets: [] }) } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const api=vi.mocked(workspaceApi);
const builtIns=[
  { sourceId:'system_market_data',name:'系统行情与 K 线',kind:'kline' as const,connectionKey:'system_market_data',required:true,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
  { sourceId:'system_news',name:'系统新闻检索',kind:'news' as const,connectionKey:'system_news',required:false,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
  { sourceId:'system_fundamentals',name:'系统基本面数据',kind:'fundamentals' as const,connectionKey:'system_fundamentals',required:false,builtIn:true,selectable:true,availability:'system_managed' as const,markets:['cn','hk','us'] },
];

describe('DataSourcesPage',()=>{
  beforeEach(()=>{vi.resetAllMocks();api.listDataSources.mockResolvedValue(builtIns);});

  it('keeps an unread catalog unknown and retries a failed initial read', async () => {
    const firstRead = deferred<WorkspaceDataSource[]>();
    api.listDataSources.mockReturnValueOnce(firstRead.promise);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

    const summary = screen.getByRole('region', { name: '数据连接摘要' });
    expect(within(summary).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('默认绑定')).not.toBeInTheDocument();
    expect(screen.queryByText('还没有自定义数据源')).not.toBeInTheDocument();
    expect(screen.queryByText('0 个仍待配置')).not.toBeInTheDocument();
    expect(screen.getByLabelText('数据源名称')).toBeDisabled();

    await act(async () => { firstRead.reject(new Error('Catalog read failed')); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Catalog read failed');
    expect(within(summary).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('默认绑定')).not.toBeInTheDocument();
    expect(screen.queryByText('还没有自定义数据源')).not.toBeInTheDocument();
    expect(screen.queryByText('0 个仍待配置')).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('系统行情与 K 线')).toBeInTheDocument();
    expect(api.listDataSources).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('默认绑定')).toBeInTheDocument();
    expect(screen.getByText('还没有自定义数据源')).toBeInTheDocument();
    expect(within(summary).getAllByText('0')).toHaveLength(4);
    expect(screen.getByLabelText('数据源名称')).toBeEnabled();
  });

  it('retains the last successful catalog and marks it stale during and after a failed refresh', async () => {
    const custom: WorkspaceDataSource = { id: 11, sourceId: 'custom:daily', name: '已登记日线来源', kind: 'kline', connectionKey: 'daily', required: false, builtIn: false, selectable: true, availability: 'registered', markets: ['cn'] };
    const provider: WorkspaceDataSource = { sourceId: 'kline:akshare', name: 'AkShare 行情', kind: 'kline', connectionKey: 'kline:akshare', required: false, builtIn: true, selectable: true, availability: 'configured', selectionMode: 'provider', healthStatus: 'available', markets: ['cn'] };
    const refresh = deferred<WorkspaceDataSource[]>();
    api.listDataSources.mockResolvedValueOnce([...builtIns, provider, custom]).mockReturnValueOnce(refresh.promise).mockResolvedValueOnce(builtIns);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText(custom.name);
    const summary = screen.getByRole('region', { name: '数据连接摘要' });
    expect(within(summary).getAllByText('1')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(screen.getByText('正在更新，暂时保留上次数据。')).toBeInTheDocument();
    expect(screen.getByText(custom.name)).toBeInTheDocument();
    expect(screen.getByText(provider.name)).toBeInTheDocument();
    expect(within(summary).getAllByText('1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '移出目录' })).toBeDisabled();
    await act(async () => { refresh.reject(new Error('Refresh failed')); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Refresh failed');
    expect(alert).toHaveTextContent('显示上次成功读取的目录。');
    expect(screen.getByText(custom.name)).toBeInTheDocument();
    expect(screen.getByText(provider.name)).toBeInTheDocument();
    expect(within(summary).getAllByText('1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '移出目录' })).toBeEnabled();

    fireEvent.click(within(alert).getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.queryByText(custom.name)).not.toBeInTheDocument());
    expect(api.listDataSources).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(summary).getAllByText('0')).toHaveLength(4);
  });

  it('does not claim default bindings for a successfully loaded empty catalog', async () => {
    api.listDataSources.mockResolvedValue([]);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    expect(await screen.findByText('还没有自定义数据源')).toBeInTheDocument();
    expect(screen.queryByText('默认绑定')).not.toBeInTheDocument();
    expect(screen.queryByText(/K 线、新闻、基本面和宏观数据已作为/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '数据连接摘要' })).getAllByText('0')).toHaveLength(4);
  });

  it('blocks concurrent register submissions and releases the guard after failure for a real retry', async () => {
    const registration = deferred<WorkspaceDataSource>();
    const custom: WorkspaceDataSource = { id: 12, sourceId: 'custom:daily', name: '私有日线目录', kind: 'kline', connectionKey: 'private_daily', setupUrl: 'https://data.example.com/docs', accessMode: 'api_key', required: false, builtIn: false, selectable: true, availability: 'registered', markets: ['cn'] };
    api.createDataSource.mockReturnValueOnce(registration.promise).mockResolvedValueOnce(custom);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText('系统行情与 K 线');
    fireEvent.change(screen.getByLabelText('数据源名称'), { target: { value: custom.name } });
    fireEvent.change(screen.getByLabelText('注册或接入说明链接'), { target: { value: custom.setupUrl } });
    fireEvent.change(screen.getByLabelText('连接标识'), { target: { value: custom.connectionKey } });
    const form = screen.getByLabelText('数据源名称').closest('form')!;

    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.createDataSource).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('数据源名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在登记…' })).toBeDisabled();
    await act(async () => { registration.reject(new Error('Registration failed')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration failed');
    expect(screen.getByLabelText('数据源名称')).toHaveValue(custom.name);
    expect(screen.getByLabelText('数据源名称')).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '登记到数据源目录' }));
    expect(await screen.findByText(custom.name)).toBeInTheDocument();
    expect(api.createDataSource).toHaveBeenCalledTimes(2);
    expect(api.createDataSource).toHaveBeenLastCalledWith({ name: custom.name, connectionKey: custom.connectionKey, setupUrl: custom.setupUrl, accessMode: 'api_key', description: undefined, kind: 'kline', markets: ['cn'] });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('数据源名称')).toHaveValue('');
    expect(screen.getAllByText(custom.name)).toHaveLength(1);
  });

  it('shows the three system defaults as ready without asking for per-strategy credentials',async()=>{
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    expect(await screen.findByText('系统行情与 K 线')).toBeInTheDocument();
    expect(screen.getByText('系统新闻检索')).toBeInTheDocument();
    expect(screen.getByText('系统基本面数据')).toBeInTheDocument();
    expect(screen.getByText('默认启用')).toBeInTheDocument();
  });

  it('persists the data type and market tag used by strategy matching',async()=>{
    api.createDataSource.mockResolvedValue({id:9,sourceId:'custom:hk-daily',name:'港股日线数据库',kind:'kline',description:'港股历史行情',connectionKey:'hk_daily_v1',setupUrl:'https://data.example.com/register',accessMode:'api_key',required:false,builtIn:false,selectable:true,availability:'registered',selectionMode:'provider',markets:['hk']});
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText('系统行情与 K 线');
    fireEvent.change(screen.getByLabelText('数据源名称'),{target:{value:'港股日线数据库'}});
    fireEvent.click(screen.getByLabelText('适用市场 A 股'));
    fireEvent.click(screen.getByLabelText('适用市场 港股'));
    fireEvent.change(screen.getByLabelText('注册或接入说明链接'),{target:{value:'https://data.example.com/register'}});
    fireEvent.change(screen.getByLabelText('连接标识'),{target:{value:'hk_daily_v1'}});
    fireEvent.change(screen.getByLabelText('用途说明'),{target:{value:'港股历史行情'}});
    fireEvent.click(screen.getByRole('button',{name:'登记到数据源目录'}));
    await waitFor(()=>expect(api.createDataSource).toHaveBeenCalledWith({name:'港股日线数据库',connectionKey:'hk_daily_v1',setupUrl:'https://data.example.com/register',accessMode:'api_key',description:'港股历史行情',kind:'kline',markets:['hk']}));
    expect(await screen.findByText('港股日线数据库')).toBeInTheDocument();
  });

  it('does not submit a source without at least one market',async()=>{
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    await screen.findByText('系统行情与 K 线');
    fireEvent.change(screen.getByLabelText('数据源名称'),{target:{value:'未标注来源'}});
    fireEvent.change(screen.getByLabelText('注册或接入说明链接'),{target:{value:'https://data.example.com/docs'}});
    fireEvent.change(screen.getByLabelText('连接标识'),{target:{value:'unmarked_source'}});
    fireEvent.click(screen.getByLabelText('适用市场 A 股'));
    expect(screen.getByText('请至少选择一个适用市场。')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'登记到数据源目录'})).toBeDisabled();
    expect(api.createDataSource).not.toHaveBeenCalled();
  });

  it('shows configured and unconfigured provider choices separately from automatic defaults',async()=>{
    api.listDataSources.mockResolvedValue([
      ...builtIns,
      {sourceId:'kline:akshare',name:'AkShare 行情',kind:'kline',connectionKey:'kline:akshare',required:false,builtIn:true,selectable:true,availability:'configured',selectionMode:'provider',setupUrl:'https://akshare.akfamily.xyz/tutorial.html',accessMode:'no_credential',configurationKeys:[],markets:['cn','hk']},
      {sourceId:'news:tavily',name:'Tavily 新闻搜索',kind:'news',connectionKey:'news:tavily',required:false,builtIn:true,selectable:false,availability:'unconfigured',selectionMode:'provider',setupUrl:'https://app.tavily.com/',accessMode:'api_key',configurationKeys:['TAVILY_API_KEYS'],markets:['cn','hk','us']},
    ]);
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
    expect(await screen.findByText('AkShare 行情')).toBeInTheDocument();
    expect(screen.getByText('Tavily 新闻搜索')).toBeInTheDocument();
    expect(screen.getAllByText('已配置')).not.toHaveLength(0);
    expect(screen.getAllByText('未配置')).not.toHaveLength(0);
    expect(screen.getByText('适用市场：A 股 / 港股')).toBeInTheDocument();
    expect(screen.getByText('已配置提供方')).toBeInTheDocument();
    expect(screen.getByText('等待检测')).toBeInTheDocument();
    expect(screen.getAllByText('未检测')).not.toHaveLength(0);
    expect(screen.getByRole('link',{name:'打开 Tavily 新闻搜索 接入说明'})).toHaveAttribute('href','https://app.tavily.com/');
    expect(screen.getByText('API Key · TAVILY_API_KEYS')).toBeInTheDocument();
    expect(screen.queryByText(/策略草稿/)).not.toBeInTheDocument();
  });

  it('keeps configuration and observed health separate and can run a live probe',async()=>{
    const akshare={sourceId:'kline:akshare',name:'AkShare 行情',kind:'kline' as const,connectionKey:'kline:akshare',required:false,builtIn:true,selectable:true,availability:'configured' as const,selectionMode:'provider' as const,providerName:'AkshareFetcher',probeSupported:true,healthStatus:'not_tested' as const,markets:['cn','hk']};
    api.listDataSources.mockResolvedValue([...builtIns,akshare]);
    api.probeDataSource.mockResolvedValue({...akshare,healthStatus:'available',operational:true,lastCheckedAt:'2026-09-03T10:00:00Z',lastLatencyMs:321,lastRecordCount:12});

    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

    expect(await screen.findByText('AkShare 行情')).toBeInTheDocument();
    expect(screen.getAllByText('已配置')).not.toHaveLength(0);
    expect(screen.getAllByText('未检测')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'检测 AkShare 行情'}));
    await waitFor(()=>expect(api.probeDataSource).toHaveBeenCalledWith('kline:akshare'));
    expect(await screen.findByText('可用')).toBeInTheDocument();
    expect(screen.getByText(/321 ms/)).toBeInTheDocument();
    expect(screen.getByText(/12 条有效记录/)).toBeInTheDocument();
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
          {id:'reuters-business',name:'Reuters Business',domain:'reuters.com',websiteUrl:'https://www.reuters.com/business/',category:'publisher',markets:['cn','hk','us']},
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
    expect(screen.getByText('3 个默认覆盖来源')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Reuters Business'})).toHaveAttribute('href','https://www.reuters.com/business/');
    expect(screen.getByText(/不表示已批量抓取或保存各站正文/)).toBeInTheDocument();
  });
});
