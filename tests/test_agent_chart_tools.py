import copy
import json
from threading import Event

import pytest
from src.agent.tools.chart_tools import build_analysis_chart
from src.agent.factory import get_tool_registry
from src.agent.tool_surface import ToolSurface
from src.agent.tools.execution import ToolAccessContext


def program():
    return {'type':'line','title':'利润率','source':'年度报告第 10 页','asOf':'2025-12-31','unit':'%',
            'data':[{'label':'2024','revenue':100,'cost':80},{'label':'2025','revenue':120,'cost':90}],
            'series':[{'name':'利润率','expression':'(revenue-cost)/revenue*100'}]}


def test_computes_real_supplied_values_and_portable_markdown_without_mutating_input():
    spec=program(); original=copy.deepcopy(spec)
    result=build_analysis_chart(spec)
    assert [r['v0'] for r in result['chart']['data']]==[20,25]
    assert json.loads(result['markdown'].split('\n')[1])==result['chart']
    assert result['chart']['inputs']==original['data']
    assert spec==original


@pytest.mark.parametrize('code',['__import__("os").system("id")','revenue.__class__','[x for x in revenue]','2 ** 999999','revenue[0]','lambda: 1','True','unknown+1'])
def test_arbitrary_python_and_unknown_columns_are_rejected(code):
    spec=program();spec['series'][0]['expression']=code
    with pytest.raises((ValueError,SyntaxError)):
        build_analysis_chart(spec)


def test_missing_values_and_zero_denominators_stay_missing():
    spec=program();spec['data']+=[{'label':'missing','cost':4},{'label':'zero','revenue':0,'cost':0}]
    result=build_analysis_chart(spec)['chart']
    assert result['data'][-1]['v0'] is None and result['data'][-2]['v0'] is None
    assert result['missingValues']==2


@pytest.mark.parametrize('value',[float('inf'),float('nan'),True,1e20,'100'])
def test_non_numeric_and_unbounded_values_are_rejected(value):
    spec=program();spec['data'][0]['revenue']=value
    with pytest.raises(ValueError):build_analysis_chart(spec)


def test_limits_and_flow_edges_are_validated():
    spec=program();spec['data']*=61
    with pytest.raises(ValueError):build_analysis_chart(spec)
    flow={'type':'flow','title':'条件','source':'报告中的研究假设','basis':'scenario','nodes':['盈利增长','重新估值'],'edges':[{'from':0,'to':1,'label':'若验证'}]}
    assert build_analysis_chart(flow)['chart']['edges'][0]['label']=='若验证'
    flow['edges'][0]['to']=2
    with pytest.raises(ValueError):build_analysis_chart(flow)


def test_tool_is_registered_and_executes_through_real_surface():
    registry=get_tool_registry()
    definition=registry.resolve('build_analysis_chart')
    assert definition and definition.policy.read_only and definition.policy.cancellation_safe
    result=ToolSurface(registry).execute_tool('build_analysis_chart',{'spec':program()},ToolAccessContext())
    assert result['ok'] and 'analysis-chart' in result['result_text']


def test_cancelled_surface_does_not_run_chart():
    event=Event();event.set()
    result=ToolSurface(get_tool_registry()).execute_tool('build_analysis_chart',{'spec':program()},ToolAccessContext(cancel_event=event))
    assert not result['ok']
