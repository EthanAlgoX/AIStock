# -*- coding: utf-8 -*-
"""
===================================
数据源策略层 - 包初始化
===================================

本包实现策略模式管理多个数据源，实现：
1. 统一的数据获取接口
2. 自动故障切换
3. 防封禁流控策略

数据源优先级由各 Fetcher 和运行配置共同决定：
- Efinance、AkShare、Pytdx、Baostock、YFinance、Tencent 为基础回退链；
- 配置密钥后，HiThink Financial API、Tushare、TickFlow、Longbridge、
  Finnhub、Alpha Vantage 等可选来源才会注册；
- 数字越小越优先，同优先级按初始化顺序排列；
- 跨市场请求还会按各来源支持的市场进行过滤。
"""

from .base import BaseFetcher, DataFetcherManager
from .efinance_fetcher import EfinanceFetcher
from .tencent_fetcher import TencentFetcher
from .akshare_fetcher import AkshareFetcher, is_hk_stock_code
from .tushare_fetcher import TushareFetcher
from .pytdx_fetcher import PytdxFetcher
from .baostock_fetcher import BaostockFetcher
from .yfinance_fetcher import YfinanceFetcher
from .longbridge_fetcher import LongbridgeFetcher
from .finnhub_fetcher import FinnhubFetcher
from .alphavantage_fetcher import AlphaVantageFetcher
from .hithink_finance_fetcher import HiThinkFinanceFetcher
from .apocdata_macro_fetcher import ApocDataMacroFetcher
from .fred_macro_fetcher import FredMacroFetcher
from .us_index_mapping import is_us_index_code, is_us_stock_code, get_us_index_yf_symbol, US_INDEX_MAPPING

__all__ = [
    'BaseFetcher',
    'DataFetcherManager',
    'EfinanceFetcher',
    'TencentFetcher',
    'AkshareFetcher',
    'TushareFetcher',
    'PytdxFetcher',
    'BaostockFetcher',
    'YfinanceFetcher',
    'LongbridgeFetcher',
    'FinnhubFetcher',
    'AlphaVantageFetcher',
    'HiThinkFinanceFetcher',
    'ApocDataMacroFetcher',
    'FredMacroFetcher',
    'is_us_index_code',
    'is_us_stock_code',
    'is_hk_stock_code',
    'get_us_index_yf_symbol',
    'US_INDEX_MAPPING',
]
