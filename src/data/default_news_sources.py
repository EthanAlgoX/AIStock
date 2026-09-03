# -*- coding: utf-8 -*-
"""Canonical public publishers covered by the keyless finance-news route."""

from __future__ import annotations

from typing import Final


DEFAULT_FINANCE_NEWS_SOURCES: Final[tuple[dict[str, object], ...]] = (
    {"id": "reuters-business", "name": "Reuters Business", "domain": "reuters.com", "websiteUrl": "https://www.reuters.com/business/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "cnbc", "name": "CNBC", "domain": "cnbc.com", "websiteUrl": "https://www.cnbc.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "marketwatch", "name": "MarketWatch", "domain": "marketwatch.com", "websiteUrl": "https://www.marketwatch.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "yahoo-finance", "name": "Yahoo Finance", "domain": "finance.yahoo.com", "websiteUrl": "https://finance.yahoo.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "financial-times", "name": "Financial Times", "domain": "ft.com", "websiteUrl": "https://www.ft.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "business-insider", "name": "Business Insider", "domain": "businessinsider.com", "websiteUrl": "https://www.businessinsider.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "fox-business", "name": "Fox Business", "domain": "foxbusiness.com", "websiteUrl": "https://www.foxbusiness.com/", "category": "publisher", "markets": ["us"]},
    {"id": "jin10", "name": "金十数据", "domain": "jin10.com", "websiteUrl": "https://www.jin10.com/", "category": "publisher", "markets": ["cn", "hk", "us"]},
    {"id": "globenewswire", "name": "GlobeNewswire", "domain": "globenewswire.com", "websiteUrl": "https://www.globenewswire.com/", "category": "corporate_wire", "markets": ["cn", "hk", "us"]},
    {"id": "business-wire", "name": "Business Wire", "domain": "businesswire.com", "websiteUrl": "https://www.businesswire.com/", "category": "corporate_wire", "markets": ["cn", "hk", "us"]},
    {"id": "pr-newswire", "name": "PR Newswire", "domain": "prnewswire.com", "websiteUrl": "https://www.prnewswire.com/", "category": "corporate_wire", "markets": ["cn", "hk", "us"]},
    {"id": "sec", "name": "SEC", "domain": "sec.gov", "websiteUrl": "https://www.sec.gov/", "category": "regulator", "markets": ["us"]},
    {"id": "federal-reserve", "name": "Federal Reserve", "domain": "federalreserve.gov", "websiteUrl": "https://www.federalreserve.gov/", "category": "regulator", "markets": ["us"]},
)
