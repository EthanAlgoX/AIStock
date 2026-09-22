"""Cross-market routing and official-source contracts; no live credentials required."""
from unittest.mock import patch

import pandas as pd
import pytest

from data_provider.base import DataFetchError, DataFetcherManager, normalize_stock_code
from data_provider.international_fetcher import TaiwanOfficialFetcher, JQuantsFetcher, KrxOfficialFetcher, _taiwan_month
from data_provider.us_index_mapping import is_us_stock_code
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.core.trading_calendar import get_market_for_stock
from src.market_context import detect_market
from src.services.simulation_portfolio_service import SimulationPortfolioService
from src.services.screening.daily import fetch_daily_history
from src.services.international_screening_service import universe
from src.strategy_kernels.catalog import builtin_package
from tests.test_simulation_portfolios import config


@pytest.mark.parametrize('symbol,market', [('HSBA.L','gb'),('RY.TO','ca'),('BHP.AX','au'),('RELIANCE.NS','in'),('500325.BO','in'),('SAP.DE','de'),('AIR.PA','fr'),('2330.TW','tw'),('7203.T','jp'),('005930.KS','kr')])
def test_symbol_contract_across_entrypoints(symbol, market):
    assert normalize_stock_code(symbol.lower()) == symbol
    assert detect_market(symbol) == get_market_for_stock(symbol) == market
    assert not is_us_stock_code(symbol)
    assert YfinanceFetcher()._convert_stock_code(symbol) == symbol
    with patch.object(DataFetcherManager, 'get_daily_data', return_value=(pd.DataFrame({'close':[1]}), 'official')) as fetch:
        assert fetch_daily_history(symbol, source='auto').attrs['daily_source'] == 'official'
        fetch.assert_called_once_with(symbol, days=120)


def test_taiwan_units_dates_and_schema():
    _taiwan_month.cache_clear()
    payload={'tables':[{'fields':['日 期','成交張數','成交仟元','開盤','最高','最低','收盤','漲跌','筆數'], 'data':[['115/08/03','1,234','5,678','100','110','90','105','5','10']]}]}
    fetcher=TaiwanOfficialFetcher()
    with patch('data_provider.international_fetcher.public_json', return_value=payload):
        frame=fetcher._normalize_data(fetcher._fetch_raw_data('6488.TWO','2026-08-01','2026-08-31'),'6488.TWO')
    assert frame.iloc[0]['date']=='2026-08-03'
    assert frame.iloc[0]['volume']==1234000
    assert frame.iloc[0]['amount']==5678000
    invalid=frame.copy(); invalid.loc[0,'high']=95
    with pytest.raises(DataFetchError): fetcher._normalize_data(invalid,'6488.TWO')
    _taiwan_month.cache_clear()


def test_jquants_pagination_raw_prices_and_security_identity():
    row=dict(Date='2026-08-03',Code='72030',O=100,H=110,L=90,C=105,Vo=1000,Va=105000,AdjC=50)
    fetcher=JQuantsFetcher('test-key')
    with patch('data_provider.international_fetcher.public_json', side_effect=[{'data':[row],'pagination_key':'next'},{'data':[]}]) as request:
        frame=fetcher._normalize_data(fetcher._fetch_raw_data('7203.T','2026-08-01','2026-08-31'),'7203.T')
    assert frame.iloc[0]['close']==105
    assert request.call_count==2
    with patch('data_provider.international_fetcher.public_json',return_value={'data':[dict(row,Code='99990')]}):
        with pytest.raises(DataFetchError,match='another security'): fetcher._fetch_raw_data('7203.T','2026-08-01','2026-08-31')


def test_krx_selects_symbol_and_trading_sessions():
    row=dict(ISU_SRT_CD='005930',TDD_OPNPRC='70,000',TDD_HGPRC='72,000',TDD_LWPRC='69,000',TDD_CLSPRC='71,000',ACC_TRDVOL='10,000',ACC_TRDVAL='710,000,000')
    fetcher=KrxOfficialFetcher('test-key')
    with patch('data_provider.international_fetcher._krx_day',return_value=[dict(row,ISU_SRT_CD='000000'),row]) as request:
        frame=fetcher._normalize_data(fetcher._fetch_raw_data('005930.KS','2026-08-03','2026-08-03'),'005930.KS')
    assert request.call_count==1
    assert frame.iloc[0]['close']==71000


@pytest.mark.parametrize('market,symbol,benchmark',[('TW','2330.TW','0050.TW'),('JP','7203.T','1306.T'),('KR','005930.KS','069500.KS')])
def test_paper_configuration_retains_market_contract(market,symbol,benchmark):
    service=object.__new__(SimulationPortfolioService)
    prepared=service._prepare_config(config(market=market,symbols=[symbol],lotSize=1,reportLanguage='ko'))
    assert prepared['benchmark']==benchmark
    assert prepared['reportLanguage']=='ko'
    with pytest.raises(ValueError):service._prepare_config(config(market=market,symbols=['AAPL']))


def test_configured_screening_never_crosses_market(monkeypatch):
    monkeypatch.setenv('SCREENING_INTERNATIONAL_TICKERS','{"GB":["HSBA.L"]}')
    assert universe('gb')==['HSBA.L']
    monkeypatch.setenv('SCREENING_INTERNATIONAL_TICKERS','{"GB":["AAPL"]}')
    with pytest.raises(ValueError,match='selected market'): universe('gb')


def test_research_kernel_markets_are_in_hashed_contract():
    package=builtin_package('单股研究策略',purpose='research_report',output_contract='ResearchReport',timeframe='1d',run_interval='on_demand')
    assert {'tw','jp','kr','gb','ca','au','in','de','fr'} <= set(package['configurable']['markets'])
    assert package['sha256']


def test_taiwan_directory_handles_distinct_exchange_schemas():
    from data_provider.international_fetcher import taiwan_listings
    taiwan_listings.cache_clear()
    with patch('data_provider.international_fetcher.public_json', side_effect=[
        [{'公司代號':'2330','公司簡稱':'台積電','英文簡稱':'TSMC'}],
        [{'SecuritiesCompanyCode':'6488','CompanyAbbreviation':'環球晶','Symbol':'GlobalWafers'}],
    ]):
        rows=taiwan_listings(0)
    assert [r['canonicalCode'] for r in rows]==['2330.TW','6488.TWO']
    assert rows[1]['nameEn']=='GlobalWafers'
    taiwan_listings.cache_clear()


def test_official_request_errors_never_include_secret():
    import requests
    from data_provider.international_fetcher import public_json
    with patch('data_provider.international_fetcher.requests.get', side_effect=requests.RequestException('secret-key')):
        with pytest.raises(DataFetchError) as error:
            public_json('https://example.test',headers={'AUTH_KEY':'secret-key'})
    assert 'secret-key' not in str(error.value)


@pytest.mark.parametrize('language,name',[('zh','简体中文'),('en','English'),('ko','한국어'),('ja','日本語'),('zh-TW','繁體中文')])
def test_range_prompt_uses_selected_language(language,name):
    from src.services.trading_agent_service import TradingAgentService
    assert name in TradingAgentService.language_directive({'reportLanguage':language})
