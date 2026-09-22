"""Localized fixed copy shared by market reports and their wrappers."""
from src.report_language import normalize_report_language

from src.utils.market_review_region import MARKET_REVIEW_REGION_ORDER as REGION_ORDER
_NAMES = {
    "zh": ("A股", "港股", "美股", "日股", "韩股", "台股", "英国股市", "加拿大股市", "澳大利亚股市", "印度股市", "德国股市", "法国股市"),
    "en": ("A-share", "HK", "US", "Japan", "Korea", "Taiwan", "UK", "Canada", "Australia", "India", "Germany", "France"),
    "ja": ("中国A株", "香港", "米国", "日本", "韓国", "台湾", "英国", "カナダ", "オーストラリア", "インド", "ドイツ", "フランス"),
    "ko": ("중국 A주", "홍콩", "미국", "일본", "한국", "대만", "영국", "캐나다", "호주", "인도", "독일", "프랑스"),
    "zh-TW": ("A股", "港股", "美股", "日股", "韓股", "台股", "英國股市", "加拿大股市", "澳洲股市", "印度股市", "德國股市", "法國股市"),
}
MARKET_NAMES = {lang: dict(zip(REGION_ORDER, names)) for lang, names in _NAMES.items()}
REVIEW_COPY = {
    "zh": {"root": "大盘复盘", "suffix": "大盘复盘", "separator": "以下为下一市场大盘复盘", "indices": "主要指数", "macro": "全球宏观观测", "missing": "暂无可用数据", "fallback": "AI 分析暂不可用，以下仅展示已获取的数据，不生成趋势或交易判断。", "limits": "未接入的市场宽度、资金流和板块数据不作推断。"},
    "en": {"root": "Market Review", "suffix": "Market Recap", "separator": "Next market recap follows", "indices": "Major Indices", "macro": "Global Macro Observations", "missing": "No data available", "fallback": "AI analysis is unavailable. Only retrieved data is shown; no trend or trading conclusions are generated.", "limits": "Missing breadth, flows and sector data are not inferred."},
    "ja": {"root": "市場総括", "suffix": "市場総括", "separator": "次の市場の総括", "indices": "主要指数", "macro": "グローバルなマクロ指標", "missing": "利用可能なデータはありません", "fallback": "AI分析を利用できないため、取得済みデータのみを表示します。トレンドや売買の判断は生成しません。", "limits": "未取得の市場の騰落銘柄数、資金フロー、業種別データは推測しません。"},
    "ko": {"root": "시황 리뷰", "suffix": "시황 리뷰", "separator": "다음 시장 시황 리뷰", "indices": "주요 지수", "macro": "글로벌 거시 지표", "missing": "사용 가능한 데이터가 없습니다", "fallback": "AI 분석을 사용할 수 없어 수집된 데이터만 표시합니다. 추세나 매매 판단은 생성하지 않습니다.", "limits": "누락된 상승·하락 종목 수, 자금 흐름 및 업종 데이터는 추정하지 않습니다."},
    "zh-TW": {"root": "大盤複盤", "suffix": "大盤複盤", "separator": "以下為下一市場大盤複盤", "indices": "主要指數", "macro": "全球宏觀觀測", "missing": "暫無可用資料", "fallback": "AI 分析暫不可用，以下僅顯示已取得的資料，不產生趨勢或交易判斷。", "limits": "未接入的市場寬度、資金流和板塊資料不作推斷。"},
}


def market_name(region: str, language: str) -> str:
    return MARKET_NAMES[normalize_report_language(language)].get(region, region.upper())


def review_heading(region: str, language: str) -> str:
    language = normalize_report_language(language)
    separator = "" if language in {"zh", "zh-TW", "ja"} else " "
    return market_name(region, language) + separator + REVIEW_COPY[language]["suffix"]
