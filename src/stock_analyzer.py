# -*- coding: utf-8 -*-
"""
===================================
趋势交易分析器 - 基于用户交易理念
===================================

交易理念核心原则：
1. 严进策略 - 不追高，追求每笔交易成功率
2. 趋势交易 - MA5>MA10>MA20 多头排列，顺势而为
3. 效率优先 - 关注筹码结构好的股票
4. 买点偏好 - 在 MA5/MA10 附近回踩买入

技术标准：
- 多头排列：MA5 > MA10 > MA20
- 乖离率：(Close - MA5) / MA5 < 5%（不追高）
- 量能形态：缩量回调优先
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
from enum import Enum

import pandas as pd
import numpy as np

from src.config import get_config
from src.schemas.decision_scale import signal_key_for_score

logger = logging.getLogger(__name__)


class TrendStatus(Enum):
    """趋势状态枚举"""
    STRONG_BULL = "强势多头"      # MA5 > MA10 > MA20，且间距扩大
    BULL = "多头排列"             # MA5 > MA10 > MA20
    WEAK_BULL = "弱势多头"        # MA5 > MA10，但 MA10 < MA20
    CONSOLIDATION = "盘整"        # 均线缠绕
    WEAK_BEAR = "弱势空头"        # MA5 < MA10，但 MA10 > MA20
    BEAR = "空头排列"             # MA5 < MA10 < MA20
    STRONG_BEAR = "强势空头"      # MA5 < MA10 < MA20，且间距扩大


class VolumeStatus(Enum):
    """量能状态枚举"""
    HEAVY_VOLUME_UP = "放量上涨"       # 量价齐升
    HEAVY_VOLUME_DOWN = "放量下跌"     # 放量杀跌
    SHRINK_VOLUME_UP = "缩量上涨"      # 无量上涨
    SHRINK_VOLUME_DOWN = "缩量回调"    # 缩量回调（好）
    NORMAL = "量能正常"


class BuySignal(Enum):
    """买入信号枚举"""
    STRONG_BUY = "强烈买入"       # 多条件满足
    BUY = "买入"                  # 基本条件满足
    HOLD = "持有"                 # 已持有可继续
    WAIT = "观望"                 # 等待更好时机
    SELL = "卖出"                 # 趋势转弱
    STRONG_SELL = "强烈卖出"      # 趋势破坏


class MACDStatus(Enum):
    """MACD状态枚举"""
    GOLDEN_CROSS_ZERO = "零轴上金叉"      # DIF上穿DEA，且在零轴上方
    GOLDEN_CROSS = "金叉"                # DIF上穿DEA
    BULLISH = "多头"                    # DIF>DEA>0
    CROSSING_UP = "上穿零轴"             # DIF上穿零轴
    CROSSING_DOWN = "下穿零轴"           # DIF下穿零轴
    BEARISH = "空头"                    # DIF<DEA<0
    DEATH_CROSS = "死叉"                # DIF下穿DEA


class RSIStatus(Enum):
    """RSI状态枚举"""
    OVERBOUGHT = "超买"        # RSI > 70
    STRONG_BUY = "强势买入"    # 50 < RSI < 70
    NEUTRAL = "中性"          # 40 <= RSI <= 60
    WEAK = "弱势"             # 30 < RSI < 40
    OVERSOLD = "超卖"         # RSI < 30


@dataclass
class TrendAnalysisResult:
    """趋势分析结果"""
    code: str
    
    # 趋势判断
    trend_status: TrendStatus = TrendStatus.CONSOLIDATION
    ma_alignment: str = ""           # 均线排列描述
    trend_strength: float = 0.0      # 趋势强度 0-100
    
    # 均线数据
    ma5: float = 0.0
    ma10: float = 0.0
    ma20: float = 0.0
    ma60: Optional[float] = None
    current_price: float = 0.0
    
    # 乖离率（与 MA5 的偏离度）
    bias_ma5: float = 0.0            # (Close - MA5) / MA5 * 100
    bias_ma10: float = 0.0
    bias_ma20: float = 0.0
    
    # 量能分析
    volume_status: VolumeStatus = VolumeStatus.NORMAL
    volume_ratio_5d: Optional[float] = None  # 当日成交量/此前5日均量
    volume_trend: str = ""           # 量能趋势描述
    
    # 支撑压力
    support_ma5: bool = False        # MA5 是否构成支撑
    support_ma10: bool = False       # MA10 是否构成支撑
    resistance_levels: List[float] = field(default_factory=list)
    support_levels: List[float] = field(default_factory=list)

    # MACD 指标
    macd_dif: Optional[float] = None  # DIF 快线
    macd_dea: Optional[float] = None  # DEA 慢线
    macd_bar: Optional[float] = None  # MACD 柱状图
    macd_status: MACDStatus = MACDStatus.BULLISH
    macd_signal: str = ""            # MACD 信号描述

    # RSI 指标
    rsi_6: Optional[float] = None   # RSI(6) 短期
    rsi_12: Optional[float] = None  # RSI(12) 中期
    rsi_24: Optional[float] = None  # RSI(24) 长期
    rsi_status: RSIStatus = RSIStatus.NEUTRAL
    rsi_signal: str = ""              # RSI 信号描述

    # 买入信号
    buy_signal: BuySignal = BuySignal.WAIT
    signal_score: int = 0            # 综合评分 0-100
    signal_reasons: List[str] = field(default_factory=list)
    risk_factors: List[str] = field(default_factory=list)
    indicator_availability: Dict[str, bool] = field(default_factory=dict)
    analysis_warnings: List[str] = field(default_factory=list)
    rule_events: List[Dict[str, Any]] = field(default_factory=list)
    analysis_date: Optional[str] = None
    analysis_source: Optional[str] = None
    valid_bars: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'code': self.code,
            'trend_status': self.trend_status.value,
            'ma_alignment': self.ma_alignment,
            'trend_strength': self.trend_strength,
            'ma5': self.ma5,
            'ma10': self.ma10,
            'ma20': self.ma20,
            'ma60': self.ma60,
            'current_price': self.current_price,
            'bias_ma5': self.bias_ma5,
            'bias_ma10': self.bias_ma10,
            'bias_ma20': self.bias_ma20,
            'volume_status': self.volume_status.value if self.indicator_availability.get('volume_ratio_5d', True) else None,
            'volume_ratio_5d': self.volume_ratio_5d,
            'volume_trend': self.volume_trend,
            'support_ma5': self.support_ma5,
            'support_ma10': self.support_ma10,
            'buy_signal': self.buy_signal.value,
            'signal_score': self.signal_score,
            'signal_reasons': self.signal_reasons,
            'risk_factors': self.risk_factors,
            'macd_dif': self.macd_dif,
            'macd_dea': self.macd_dea,
            'macd_bar': self.macd_bar,
            'macd_status': self.macd_status.value if self.indicator_availability.get('macd', True) else None,
            'macd_signal': self.macd_signal,
            'rsi_6': self.rsi_6,
            'rsi_12': self.rsi_12,
            'rsi_24': self.rsi_24,
            'rsi_status': self.rsi_status.value if self.indicator_availability.get('rsi', True) else None,
            'rsi_signal': self.rsi_signal,
            'indicator_availability': dict(self.indicator_availability),
            'analysis_warnings': list(self.analysis_warnings),
            'rule_events': list(self.rule_events),
            'analysis_date': self.analysis_date,
            'analysis_source': self.analysis_source,
            'valid_bars': self.valid_bars,
        }


class StockTrendAnalyzer:
    """
    股票趋势分析器

    基于用户交易理念实现：
    1. 趋势判断 - MA5>MA10>MA20 多头排列
    2. 乖离率检测 - 不追高，偏离 MA5 超过 5% 不买
    3. 量能分析 - 偏好缩量回调
    4. 买点识别 - 回踩 MA5/MA10 支撑
    5. MACD 指标 - 趋势确认和金叉死叉信号
    6. RSI 指标 - 超买超卖判断
    """
    
    # 交易参数配置（BIAS_THRESHOLD 从 Config 读取，见 _generate_signal）
    VOLUME_SHRINK_RATIO = 0.7   # 缩量判断阈值（当日量/5日均量）
    VOLUME_HEAVY_RATIO = 1.5    # 放量判断阈值
    MA_SUPPORT_TOLERANCE = 0.02  # MA 支撑判断容忍度（2%）

    # MACD 参数（标准12/26/9）
    MACD_FAST = 12              # 快线周期
    MACD_SLOW = 26             # 慢线周期
    MACD_SIGNAL = 9             # 信号线周期

    # RSI 参数
    RSI_SHORT = 6               # 短期RSI周期
    RSI_MID = 12               # 中期RSI周期
    RSI_LONG = 24              # 长期RSI周期
    RSI_OVERBOUGHT = 70        # 超买阈值
    RSI_OVERSOLD = 30          # 超卖阈值
    RULE_PERIOD = 20
    RULE_VOLUME_RATIO = 2.0
    _PROVENANCE_FIELDS = ('data_source', 'source', 'provider', 'adjustment', 'volume_unit', 'currency')
    
    def __init__(self):
        """初始化分析器"""
        pass
    
    def analyze(self, df: pd.DataFrame, code: str) -> TrendAnalysisResult:
        """
        分析股票趋势
        
        Args:
            df: 包含 OHLCV 数据的 DataFrame
            code: 股票代码
            
        Returns:
            TrendAnalysisResult 分析结果
        """
        result = TrendAnalysisResult(code=code)
        result.indicator_availability = dict.fromkeys(
            ('ma5', 'ma10', 'ma20', 'ma60', 'volume_ratio_5d', 'macd',
             'rsi_6', 'rsi_12', 'rsi_24', 'rsi', 'rule_events'), False,
        )
        df = self._prepare_history(df, result)
        result.valid_bars = len(df)
        if not df.empty:
            result.analysis_date = pd.Timestamp(df.iloc[-1]['date']).date().isoformat()
            result.analysis_source = self._bar_source(df.iloc[-1], df.attrs)

        if len(df) < 20:
            logger.warning(f"{code} 数据不足，无法进行趋势分析")
            result.risk_factors.append("数据不足，无法完成分析")
            result.analysis_warnings.append(f"连续有效日线仅 {len(df)} 根，趋势分析至少需要 20 根。")
            result.risk_factors.extend(result.analysis_warnings)
            return result
        
        # 计算均线
        df = self._calculate_mas(df)

        # 计算 MACD 和 RSI
        df = self._calculate_macd(df)
        df = self._calculate_rsi(df)

        # 获取最新数据
        latest = df.iloc[-1]
        result.current_price = float(latest['close'])
        result.ma5 = self._finite_number(latest['MA5']) or 0.0
        result.ma10 = self._finite_number(latest['MA10']) or 0.0
        result.ma20 = self._finite_number(latest['MA20']) or 0.0
        result.ma60 = self._finite_number(latest['MA60'])
        for key in ('ma5', 'ma10', 'ma20', 'ma60'):
            result.indicator_availability[key] = bool(
                self._finite_number(latest[key.upper()]) is not None and latest[key.upper()] > 0
            )
        if not all(result.indicator_availability[key] for key in ('ma5', 'ma10', 'ma20')):
            result.analysis_warnings.append("趋势均线无效，已停止技术评分。")
            result.risk_factors.extend(result.analysis_warnings)
            return result
        if result.ma60 is None:
            result.analysis_warnings.append("MA60 有效样本不足 60 根，未以短周期均线替代。")

        # 1. 趋势判断
        self._analyze_trend(df, result)

        # 2. 乖离率计算
        self._calculate_bias(result)

        # 3. 量能分析
        self._analyze_volume(df, result)

        # 4. 支撑压力分析
        self._analyze_support_resistance(df, result)

        # 5. MACD 分析
        self._analyze_macd(df, result)

        # 6. RSI 分析
        self._analyze_rsi(df, result)

        # 7. 生成买入信号
        self._generate_signal(result)

        # 规则事件是独立的数值证据，不参与既有综合评分。
        self._analyze_rule_events(df, result)
        result.risk_factors.extend(result.analysis_warnings)

        return result

    @staticmethod
    def _finite_number(value: Any) -> Optional[float]:
        if value is None or isinstance(value, (bool, np.bool_)):
            return None
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        return number if math.isfinite(number) else None

    @staticmethod
    def _explicit_flag(value: Any, expected: bool = True) -> bool:
        return isinstance(value, (bool, np.bool_)) and bool(value) == expected

    @staticmethod
    def _metadata_text(value: Any) -> Optional[str]:
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _bar_source(self, bar: pd.Series, attrs: Dict[str, Any]) -> Optional[str]:
        pending = (self._explicit_flag(bar.get('is_partial_bar'))
                   or self._explicit_flag(bar.get('is_estimated'))
                   or self._explicit_flag(bar.get('closed'), False))
        if pending and 'realtime_source' in bar:
            # Realtime overlay prices may differ from the preserved daily
            # provider. An explicitly unknown quote source stays unknown.
            return self._metadata_text(bar.get('realtime_source'))
        for metadata in (bar, attrs):
            for key in ('data_source', 'source', 'provider'):
                value = self._metadata_text(metadata.get(key))
                if value:
                    return value
        return self._metadata_text(attrs.get('daily_source'))

    def _prepare_history(self, df: Optional[pd.DataFrame], result: TrendAnalysisResult) -> pd.DataFrame:
        """Keep the latest valid segment; never join across explicit quality boundaries.

        Existing daily data without closure metadata remains supported. A valid
        partial/estimated tail may update intraday indicators, but cannot emit
        rule events. Interior partial bars reset the subsequent window.
        Calendar gaps are respected when supplied, rather than guessed from
        wall-clock days (which would also reject stock-market weekends).
        """
        if df is None or df.empty:
            return pd.DataFrame()
        required = {'date', 'open', 'high', 'low', 'close', 'volume'}
        missing = required.difference(df.columns)
        if missing:
            result.analysis_warnings.append("日线缺少必要字段：" + '、'.join(sorted(missing)))
            return df.iloc[:0].copy()

        df = df.copy()
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        if df['date'].isna().any():
            result.analysis_warnings.append("日线日期无效，无法确认连续窗口，已停止技术评分。")
            return df.iloc[:0].copy()
        df = df.sort_values('date', kind='stable').reset_index(drop=True)
        for key in ('open', 'high', 'low', 'close', 'volume'):
            df[key] = df[key].mask(df[key].map(lambda value: isinstance(value, (bool, np.bool_))))
            df[key] = pd.to_numeric(df[key], errors='coerce')

        pending = df.apply(
            lambda row: self._explicit_flag(row.get('is_partial_bar'))
            or self._explicit_flag(row.get('is_estimated'))
            or self._explicit_flag(row.get('closed'), False), axis=1,
        )
        # Preserve the existing realtime indicator contract: trailing realtime
        # rows are estimates, while an interior pending row breaks continuity.
        end = len(df)
        while end and pending.iloc[end - 1]:
            end -= 1
        if end < len(df):
            result.analysis_warnings.append("末段日线未闭合或为估算值，技术指标仅供盘中观察，未生成确认规则事件。")
        if pending.iloc[:end].any():
            result.analysis_warnings.append("历史中间未闭合或估算日线已排除，后续窗口重新预热。")
        start = 0
        previous_date = None
        previous_identity = None
        invalid_count = 0
        boundaries = 0
        for index, row in df.iterrows():
            numbers = {key: self._finite_number(row[key]) for key in ('open', 'high', 'low', 'close', 'volume')}
            quality = row.get('quality')
            flags = set(quality) if isinstance(quality, (list, tuple)) and all(
                isinstance(flag, str) for flag in quality
            ) else set()
            quality_missing = quality is None or (isinstance(quality, float) and math.isnan(quality))
            invalid_quality = (not quality_missing and not isinstance(quality, (list, tuple))) or bool(
                flags.difference({'gap_before', 'corporate_action'})
            )
            if isinstance(quality, (list, tuple)) and not all(isinstance(flag, str) for flag in quality):
                invalid_quality = True
            valid = all(value is not None for value in numbers.values())
            if valid:
                # Some stock feeds exclude auctions from high/low while their
                # closing price includes the auction; retain that convention.
                valid = (numbers['volume'] >= 0 and numbers['high'] >= numbers['low']
                         and all(numbers[key] > 0 for key in ('open', 'high', 'low', 'close')))
            current_date = row['date']
            if (not valid or invalid_quality or (pending.iloc[index] and index < end)
                    or (previous_date is not None and current_date <= previous_date)):
                start = index + 1
                previous_identity = None
                invalid_count += 1
            else:
                identity = tuple(self._metadata_text(row.get(key)) or self._metadata_text(df.attrs.get(key))
                                 for key in self._PROVENANCE_FIELDS)
                # The appended realtime estimate may have no daily provenance.
                # Allow it to update estimates without inventing its source;
                # this window will not be eligible for rule events.
                if pending.iloc[index] and not any(identity):
                    identity = previous_identity
                boundary = (self._explicit_flag(row.get('gap_before'))
                            or bool(flags.intersection({'gap_before', 'corporate_action'}))
                            or (previous_identity is not None and identity != previous_identity))
                if boundary:
                    start = index
                    boundaries += 1
                previous_identity = identity
            previous_date = current_date
        if invalid_count:
            result.analysis_warnings.append(f"{invalid_count} 根日线存在缺失、无效值或重复日期，窗口已重新预热。")
        if boundaries:
            result.analysis_warnings.append("日线缺口或来源口径变化，已从边界重新预热，未拼接历史指标。")
        return df.iloc[start:].reset_index(drop=True)

    def _analyze_rule_events(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """Explain latest range/volume events using the previous twenty bars only."""
        period = self.RULE_PERIOD
        latest = df.iloc[-1]
        ready = len(df) >= period + 1 and not (
            self._explicit_flag(latest.get('is_partial_bar'))
            or self._explicit_flag(latest.get('is_estimated'))
            or self._explicit_flag(latest.get('closed'), False)
        )
        result.indicator_availability['rule_events'] = ready
        if not ready:
            return
        previous = df.iloc[-period - 1:-1]
        common = {
            'rule_version': '1', 'bar_date': result.analysis_date, 'source': result.analysis_source,
            'reference_start': pd.Timestamp(previous.iloc[0]['date']).date().isoformat(),
            'reference_end': pd.Timestamp(previous.iloc[-1]['date']).date().isoformat(),
        }
        close = float(latest['close'])
        reference_high = float(previous['high'].max())
        reference_low = float(previous['low'].min())
        if close > reference_high or close < reference_low:
            direction = 'up' if close > reference_high else 'down'
            result.rule_events.append({
                **common, 'rule_id': 'range20', 'direction': direction,
                'parameters': {'period': period},
                'evidence': {'close': close, 'reference_high': reference_high, 'reference_low': reference_low},
                'summary': '收盘价突破此前20根日线最高价。' if direction == 'up' else '收盘价跌破此前20根日线最低价。',
            })
        mean_volume = math.fsum(float(value) / period for value in previous['volume'])
        ratio = self._finite_number(float(latest['volume']) / mean_volume) if mean_volume > 0 else None
        if ratio is not None and ratio >= self.RULE_VOLUME_RATIO:
            result.rule_events.append({
                **common, 'rule_id': 'volume20', 'direction': 'above',
                'parameters': {'period': period, 'ratio': self.RULE_VOLUME_RATIO},
                'evidence': {'volume': float(latest['volume']), 'mean_volume20': mean_volume, 'volume_ratio20': ratio},
                'summary': '成交量达到此前20根日线均量的2倍；不代表价格方向。',
            })
    
    def _calculate_mas(self, df: pd.DataFrame) -> pd.DataFrame:
        """计算均线"""
        df = df.copy()
        df['MA5'] = df['close'].rolling(window=5).mean()
        df['MA10'] = df['close'].rolling(window=10).mean()
        df['MA20'] = df['close'].rolling(window=20).mean()
        df['MA60'] = df['close'].rolling(window=60).mean()
        return df

    def _calculate_macd(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        计算 MACD 指标

        公式：
        - EMA(12)：12日指数移动平均
        - EMA(26)：26日指数移动平均
        - DIF = EMA(12) - EMA(26)
        - DEA = EMA(DIF, 9)
        - MACD = (DIF - DEA) * 2
        """
        df = df.copy()

        # 计算快慢线 EMA
        ema_fast = df['close'].ewm(span=self.MACD_FAST, adjust=False).mean()
        ema_slow = df['close'].ewm(span=self.MACD_SLOW, adjust=False).mean()

        # 计算快线 DIF
        df['MACD_DIF'] = ema_fast - ema_slow

        # 计算信号线 DEA
        df['MACD_DEA'] = df['MACD_DIF'].ewm(span=self.MACD_SIGNAL, adjust=False).mean()

        # 计算柱状图
        df['MACD_BAR'] = (df['MACD_DIF'] - df['MACD_DEA']) * 2

        return df

    def _calculate_rsi(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        计算 RSI 指标（Wilder's EMA / SMMA 口径）

        公式：
        - avg_gain / avg_loss 使用 ewm(alpha=1/period, adjust=False)
        - RS = avg_gain / avg_loss
        - RSI = 100 - (100 / (1 + RS))
        """
        df = df.copy()

        for period in [self.RSI_SHORT, self.RSI_MID, self.RSI_LONG]:
            # 计算价格变化
            delta = df['close'].diff()

            # 分离上涨和下跌
            gain = delta.where(delta > 0, 0)
            loss = -delta.where(delta < 0, 0)

            # 使用 Wilder's EMA / SMMA 口径，与常见 RSI 图表工具保持一致。
            avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
            avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()

            # 计算 RS 和 RSI
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

            # 填充 NaN 值
            rsi = rsi.fillna(50)  # 完整且无涨跌的样本使用中性值
            rsi.iloc[:period] = np.nan  # 需 period 次价格变化，不能用默认值代替预热

            # 添加到 DataFrame
            col_name = f'RSI_{period}'
            df[col_name] = rsi

        return df
    
    def _analyze_trend(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """
        分析趋势状态
        
        核心逻辑：判断均线排列和趋势强度
        """
        ma5, ma10, ma20 = result.ma5, result.ma10, result.ma20
        
        # 判断均线排列
        if ma5 > ma10 > ma20:
            # 检查间距是否在扩大（强势）
            prev = df.iloc[-5] if len(df) >= 5 else df.iloc[-1]
            prev_spread = (prev['MA5'] - prev['MA20']) / prev['MA20'] * 100 if prev['MA20'] > 0 else 0
            curr_spread = (ma5 - ma20) / ma20 * 100 if ma20 > 0 else 0
            
            if curr_spread > prev_spread and curr_spread > 5:
                result.trend_status = TrendStatus.STRONG_BULL
                result.ma_alignment = "强势多头排列，均线发散上行"
                result.trend_strength = 90
            else:
                result.trend_status = TrendStatus.BULL
                result.ma_alignment = "多头排列 MA5>MA10>MA20"
                result.trend_strength = 75
                
        elif ma5 > ma10 and ma10 <= ma20:
            result.trend_status = TrendStatus.WEAK_BULL
            result.ma_alignment = "弱势多头，MA5>MA10 但 MA10≤MA20"
            result.trend_strength = 55
            
        elif ma5 < ma10 < ma20:
            prev = df.iloc[-5] if len(df) >= 5 else df.iloc[-1]
            prev_spread = (prev['MA20'] - prev['MA5']) / prev['MA5'] * 100 if prev['MA5'] > 0 else 0
            curr_spread = (ma20 - ma5) / ma5 * 100 if ma5 > 0 else 0
            
            if curr_spread > prev_spread and curr_spread > 5:
                result.trend_status = TrendStatus.STRONG_BEAR
                result.ma_alignment = "强势空头排列，均线发散下行"
                result.trend_strength = 10
            else:
                result.trend_status = TrendStatus.BEAR
                result.ma_alignment = "空头排列 MA5<MA10<MA20"
                result.trend_strength = 25
                
        elif ma5 < ma10 and ma10 >= ma20:
            result.trend_status = TrendStatus.WEAK_BEAR
            result.ma_alignment = "弱势空头，MA5<MA10 但 MA10≥MA20"
            result.trend_strength = 40
            
        else:
            result.trend_status = TrendStatus.CONSOLIDATION
            result.ma_alignment = "均线缠绕，趋势不明"
            result.trend_strength = 50
    
    def _calculate_bias(self, result: TrendAnalysisResult) -> None:
        """
        计算乖离率
        
        乖离率 = (现价 - 均线) / 均线 * 100%
        
        严进策略：乖离率超过 5% 不追高
        """
        price = result.current_price
        
        if result.ma5 > 0:
            result.bias_ma5 = (price - result.ma5) / result.ma5 * 100
        if result.ma10 > 0:
            result.bias_ma10 = (price - result.ma10) / result.ma10 * 100
        if result.ma20 > 0:
            result.bias_ma20 = (price - result.ma20) / result.ma20 * 100
    
    def _analyze_volume(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """
        分析量能
        
        偏好：缩量回调 > 放量上涨 > 缩量上涨 > 放量下跌
        """
        if len(df) < 5:
            return
        
        latest = df.iloc[-1]
        vol_5d_avg = math.fsum(float(value) / 5 for value in df['volume'].iloc[-6:-1])
        
        if vol_5d_avg > 0:
            result.volume_ratio_5d = self._finite_number(float(latest['volume']) / vol_5d_avg)
        result.indicator_availability['volume_ratio_5d'] = result.volume_ratio_5d is not None
        if result.volume_ratio_5d is None:
            result.volume_trend = "此前5日均量无效，未判断量能形态"
            result.analysis_warnings.append("此前5日均量为零或量比无效，量能未计入评分。")
            return
        
        # 判断价格变化
        prev_close = df.iloc[-2]['close']
        price_change = (latest['close'] - prev_close) / prev_close * 100
        
        # 量能状态判断
        if result.volume_ratio_5d >= self.VOLUME_HEAVY_RATIO:
            if price_change > 0:
                result.volume_status = VolumeStatus.HEAVY_VOLUME_UP
                result.volume_trend = "放量上涨，多头力量强劲"
            else:
                result.volume_status = VolumeStatus.HEAVY_VOLUME_DOWN
                result.volume_trend = "放量下跌，注意风险"
        elif result.volume_ratio_5d <= self.VOLUME_SHRINK_RATIO:
            if price_change > 0:
                result.volume_status = VolumeStatus.SHRINK_VOLUME_UP
                result.volume_trend = "缩量上涨，上攻动能不足"
            else:
                result.volume_status = VolumeStatus.SHRINK_VOLUME_DOWN
                result.volume_trend = "缩量回调，洗盘特征明显（好）"
        else:
            result.volume_status = VolumeStatus.NORMAL
            result.volume_trend = "量能正常"
    
    def _analyze_support_resistance(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """
        分析支撑压力位
        
        买点偏好：回踩 MA5/MA10 获得支撑
        """
        price = result.current_price
        
        # 检查是否在 MA5 附近获得支撑
        if result.ma5 > 0:
            ma5_distance = abs(price - result.ma5) / result.ma5
            if ma5_distance <= self.MA_SUPPORT_TOLERANCE and price >= result.ma5:
                result.support_ma5 = True
                result.support_levels.append(result.ma5)
        
        # 检查是否在 MA10 附近获得支撑
        if result.ma10 > 0:
            ma10_distance = abs(price - result.ma10) / result.ma10
            if ma10_distance <= self.MA_SUPPORT_TOLERANCE and price >= result.ma10:
                result.support_ma10 = True
                if result.ma10 not in result.support_levels:
                    result.support_levels.append(result.ma10)
        
        # MA20 作为重要支撑
        if result.ma20 > 0 and price >= result.ma20:
            result.support_levels.append(result.ma20)
        
        # 近期高点作为压力
        if len(df) >= 20:
            recent_high = df['high'].iloc[-20:].max()
            if recent_high > price:
                result.resistance_levels.append(recent_high)

    def _analyze_macd(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """
        分析 MACD 指标

        核心信号：
        - 零轴上金叉：最强买入信号
        - 金叉：DIF 上穿 DEA
        - 死叉：DIF 下穿 DEA
        """
        # Slow EMA warmup + signal EMA warmup + a preceding value for crosses.
        required = self.MACD_SLOW + self.MACD_SIGNAL
        if len(df) < required:
            result.macd_signal = "数据不足"
            result.indicator_availability['macd'] = False
            result.analysis_warnings.append(f"MACD 连续有效样本不足 {required} 根，未计入评分。")
            return

        latest = df.iloc[-1]
        prev = df.iloc[-2]

        # 获取 MACD 数据
        result.macd_dif = float(latest['MACD_DIF'])
        result.macd_dea = float(latest['MACD_DEA'])
        result.macd_bar = float(latest['MACD_BAR'])
        result.indicator_availability['macd'] = all(
            self._finite_number(value) is not None
            for value in (result.macd_dif, result.macd_dea, result.macd_bar,
                          prev['MACD_DIF'], prev['MACD_DEA'])
        )
        if not result.indicator_availability['macd']:
            result.macd_dif = result.macd_dea = result.macd_bar = None
            result.macd_signal = "指标值无效"
            result.analysis_warnings.append("MACD 非有限，未计入评分。")
            return

        # 判断金叉死叉
        prev_dif_dea = prev['MACD_DIF'] - prev['MACD_DEA']
        curr_dif_dea = result.macd_dif - result.macd_dea

        # 金叉：DIF 上穿 DEA
        is_golden_cross = prev_dif_dea <= 0 and curr_dif_dea > 0

        # 死叉：DIF 下穿 DEA
        is_death_cross = prev_dif_dea >= 0 and curr_dif_dea < 0

        # 零轴穿越
        prev_zero = prev['MACD_DIF']
        curr_zero = result.macd_dif
        is_crossing_up = prev_zero <= 0 and curr_zero > 0
        is_crossing_down = prev_zero >= 0 and curr_zero < 0

        # 判断 MACD 状态
        if is_golden_cross and curr_zero > 0:
            result.macd_status = MACDStatus.GOLDEN_CROSS_ZERO
            result.macd_signal = "⭐ 零轴上金叉，强烈买入信号！"
        elif is_crossing_up:
            result.macd_status = MACDStatus.CROSSING_UP
            result.macd_signal = "⚡ DIF上穿零轴，趋势转强"
        elif is_golden_cross:
            result.macd_status = MACDStatus.GOLDEN_CROSS
            result.macd_signal = "✅ 金叉，趋势向上"
        elif is_death_cross:
            result.macd_status = MACDStatus.DEATH_CROSS
            result.macd_signal = "❌ 死叉，趋势向下"
        elif is_crossing_down:
            result.macd_status = MACDStatus.CROSSING_DOWN
            result.macd_signal = "⚠️ DIF下穿零轴，趋势转弱"
        elif result.macd_dif > 0 and result.macd_dea > 0:
            result.macd_status = MACDStatus.BULLISH
            result.macd_signal = "✓ 多头排列，持续上涨"
        elif result.macd_dif < 0 and result.macd_dea < 0:
            result.macd_status = MACDStatus.BEARISH
            result.macd_signal = "⚠ 空头排列，持续下跌"
        else:
            result.macd_status = MACDStatus.BULLISH
            result.macd_signal = " MACD 中性区域"

    def _analyze_rsi(self, df: pd.DataFrame, result: TrendAnalysisResult) -> None:
        """
        分析 RSI 指标

        核心判断：
        - RSI > 70：超买，谨慎追高
        - RSI < 30：超卖，关注反弹
        - 40-60：中性区域
        """
        latest = df.iloc[-1]
        for period in (self.RSI_SHORT, self.RSI_MID, self.RSI_LONG):
            value = self._finite_number(latest[f'RSI_{period}']) if len(df) >= period + 1 else None
            key = f'rsi_{period}'
            setattr(result, key, value)
            result.indicator_availability[key] = value is not None
        result.indicator_availability['rsi'] = all(
            result.indicator_availability[f'rsi_{period}']
            for period in (self.RSI_SHORT, self.RSI_MID, self.RSI_LONG)
        )
        if not result.indicator_availability['rsi']:
            result.rsi_signal = "数据不足"
            result.analysis_warnings.append(f"RSI 完整样本不足 {self.RSI_LONG + 1} 根，未计入评分。")
            return

        # 以中期 RSI(12) 为主进行判断
        rsi_mid = result.rsi_12

        # 判断 RSI 状态
        if rsi_mid > self.RSI_OVERBOUGHT:
            result.rsi_status = RSIStatus.OVERBOUGHT
            result.rsi_signal = f"⚠️ RSI超买({rsi_mid:.1f}>70)，短期回调风险高"
        elif rsi_mid > 60:
            result.rsi_status = RSIStatus.STRONG_BUY
            result.rsi_signal = f"✅ RSI强势({rsi_mid:.1f})，多头力量充足"
        elif rsi_mid >= 40:
            result.rsi_status = RSIStatus.NEUTRAL
            result.rsi_signal = f" RSI中性({rsi_mid:.1f})，震荡整理中"
        elif rsi_mid >= self.RSI_OVERSOLD:
            result.rsi_status = RSIStatus.WEAK
            result.rsi_signal = f"⚡ RSI弱势({rsi_mid:.1f})，关注反弹"
        else:
            result.rsi_status = RSIStatus.OVERSOLD
            result.rsi_signal = f"⭐ RSI超卖({rsi_mid:.1f}<30)，反弹机会大"

    def _generate_signal(self, result: TrendAnalysisResult) -> None:
        """
        生成买入信号

        综合评分系统：
        - 趋势（30分）：多头排列得分高
        - 乖离率（20分）：接近 MA5 得分高
        - 量能（15分）：缩量回调得分高
        - 支撑（10分）：获得均线支撑得分高
        - MACD（15分）：金叉和多头得分高
        - RSI（10分）：超卖和强势得分高
        """
        score = 0
        reasons = []
        risks = list(result.risk_factors)

        # === 趋势评分（30分）===
        trend_scores = {
            TrendStatus.STRONG_BULL: 30,
            TrendStatus.BULL: 26,
            TrendStatus.WEAK_BULL: 18,
            TrendStatus.CONSOLIDATION: 12,
            TrendStatus.WEAK_BEAR: 8,
            TrendStatus.BEAR: 4,
            TrendStatus.STRONG_BEAR: 0,
        }
        trend_score = trend_scores.get(result.trend_status, 12)
        score += trend_score

        if result.trend_status in [TrendStatus.STRONG_BULL, TrendStatus.BULL]:
            reasons.append(f"✅ {result.trend_status.value}，顺势做多")
        elif result.trend_status in [TrendStatus.BEAR, TrendStatus.STRONG_BEAR]:
            risks.append(f"⚠️ {result.trend_status.value}，不宜做多")

        # === 乖离率评分（20分，强势趋势补偿）===
        bias = result.bias_ma5
        if bias != bias or bias is None:  # NaN or None defense
            bias = 0.0
        base_threshold = get_config().bias_threshold

        # Strong trend compensation: relax threshold for STRONG_BULL with high strength
        trend_strength = result.trend_strength if result.trend_strength == result.trend_strength else 0.0
        if result.trend_status == TrendStatus.STRONG_BULL and (trend_strength or 0) >= 70:
            effective_threshold = base_threshold * 1.5
            is_strong_trend = True
        else:
            effective_threshold = base_threshold
            is_strong_trend = False

        if bias < 0:
            # Price below MA5 (pullback)
            if bias > -3:
                score += 20
                reasons.append(f"✅ 价格略低于MA5({bias:.1f}%)，回踩买点")
            elif bias > -5:
                score += 16
                reasons.append(f"✅ 价格回踩MA5({bias:.1f}%)，观察支撑")
            else:
                score += 8
                risks.append(f"⚠️ 乖离率过大({bias:.1f}%)，可能破位")
        elif bias < 2:
            score += 18
            reasons.append(f"✅ 价格贴近MA5({bias:.1f}%)，介入好时机")
        elif bias < base_threshold:
            score += 14
            reasons.append(f"⚡ 价格略高于MA5({bias:.1f}%)，可小仓介入")
        elif bias > effective_threshold:
            score += 4
            risks.append(
                f"❌ 乖离率过高({bias:.1f}%>{effective_threshold:.1f}%)，严禁追高！"
            )
        elif bias > base_threshold and is_strong_trend:
            score += 10
            reasons.append(
                f"⚡ 强势趋势中乖离率偏高({bias:.1f}%)，可轻仓追踪"
            )
        else:
            score += 4
            risks.append(
                f"❌ 乖离率过高({bias:.1f}%>{base_threshold:.1f}%)，严禁追高！"
            )

        # === 量能评分（15分）===
        volume_scores = {
            VolumeStatus.SHRINK_VOLUME_DOWN: 15,  # 缩量回调最佳
            VolumeStatus.HEAVY_VOLUME_UP: 12,     # 放量上涨次之
            VolumeStatus.NORMAL: 10,
            VolumeStatus.SHRINK_VOLUME_UP: 6,     # 无量上涨较差
            VolumeStatus.HEAVY_VOLUME_DOWN: 0,    # 放量下跌最差
        }
        volume_ready = result.indicator_availability.get('volume_ratio_5d', True)
        vol_score = volume_scores.get(result.volume_status, 8) if volume_ready else 0
        score += vol_score

        if volume_ready and result.volume_status == VolumeStatus.SHRINK_VOLUME_DOWN:
            reasons.append("✅ 缩量回调，主力洗盘")
        elif volume_ready and result.volume_status == VolumeStatus.HEAVY_VOLUME_DOWN:
            risks.append("⚠️ 放量下跌，注意风险")

        # === 支撑评分（10分）===
        if result.support_ma5:
            score += 5
            reasons.append("✅ MA5支撑有效")
        if result.support_ma10:
            score += 5
            reasons.append("✅ MA10支撑有效")

        # === MACD 评分（15分）===
        macd_scores = {
            MACDStatus.GOLDEN_CROSS_ZERO: 15,  # 零轴上金叉最强
            MACDStatus.GOLDEN_CROSS: 12,      # 金叉
            MACDStatus.CROSSING_UP: 10,       # 上穿零轴
            MACDStatus.BULLISH: 8,            # 多头
            MACDStatus.BEARISH: 2,            # 空头
            MACDStatus.CROSSING_DOWN: 0,       # 下穿零轴
            MACDStatus.DEATH_CROSS: 0,        # 死叉
        }
        macd_ready = result.indicator_availability.get('macd', True)
        macd_score = macd_scores.get(result.macd_status, 5) if macd_ready else 0
        score += macd_score

        if macd_ready and result.macd_status in [MACDStatus.GOLDEN_CROSS_ZERO, MACDStatus.GOLDEN_CROSS]:
            reasons.append(f"✅ {result.macd_signal}")
        elif macd_ready and result.macd_status in [MACDStatus.DEATH_CROSS, MACDStatus.CROSSING_DOWN]:
            risks.append(f"⚠️ {result.macd_signal}")
        elif macd_ready:
            reasons.append(result.macd_signal)

        # === RSI 评分（10分）===
        rsi_scores = {
            RSIStatus.OVERSOLD: 10,       # 超卖最佳
            RSIStatus.STRONG_BUY: 8,     # 强势
            RSIStatus.NEUTRAL: 5,        # 中性
            RSIStatus.WEAK: 3,            # 弱势
            RSIStatus.OVERBOUGHT: 0,       # 超买最差
        }
        rsi_ready = result.indicator_availability.get('rsi', True)
        rsi_score = rsi_scores.get(result.rsi_status, 5) if rsi_ready else 0
        score += rsi_score

        if rsi_ready and result.rsi_status in [RSIStatus.OVERSOLD, RSIStatus.STRONG_BUY]:
            reasons.append(f"✅ {result.rsi_signal}")
        elif rsi_ready and result.rsi_status == RSIStatus.OVERBOUGHT:
            risks.append(f"⚠️ {result.rsi_signal}")
        elif rsi_ready:
            reasons.append(result.rsi_signal)

        # === 综合判断 ===
        result.signal_score = score
        result.signal_reasons = reasons
        result.risk_factors = risks

        # 生成买入信号（与 canonical decision scale 保持一致）
        score_signal = signal_key_for_score(score)
        if score_signal == "strong_buy" and result.trend_status in [TrendStatus.STRONG_BULL, TrendStatus.BULL]:
            result.buy_signal = BuySignal.STRONG_BUY
        elif score_signal in {"strong_buy", "buy"} and result.trend_status in [
            TrendStatus.STRONG_BULL,
            TrendStatus.BULL,
            TrendStatus.WEAK_BULL,
        ]:
            result.buy_signal = BuySignal.BUY
        elif score_signal in {"strong_buy", "buy"} and result.trend_status in [
            TrendStatus.CONSOLIDATION,
            TrendStatus.WEAK_BEAR,
        ]:
            result.buy_signal = BuySignal.WAIT
        elif score_signal == "watch":
            result.buy_signal = BuySignal.WAIT
        elif score_signal == "sell" or result.trend_status in [TrendStatus.BEAR, TrendStatus.STRONG_BEAR]:
            result.buy_signal = BuySignal.STRONG_SELL
        else:
            result.buy_signal = BuySignal.SELL
    
    def format_analysis(self, result: TrendAnalysisResult) -> str:
        """
        格式化分析结果为文本

        Args:
            result: 分析结果

        Returns:
            格式化的分析文本
        """
        def number(value: Optional[float], spec: str) -> str:
            return format(value, spec) if value is not None else "不可用"

        macd_label = result.macd_status.value if result.indicator_availability.get('macd', True) else "不可用"
        rsi_label = result.rsi_status.value if result.indicator_availability.get('rsi', True) else "未完成预热"
        lines = [
            f"=== {result.code} 趋势分析 ===",
            f"",
            f"📊 趋势判断: {result.trend_status.value}",
            f"   均线排列: {result.ma_alignment}",
            f"   趋势强度: {result.trend_strength}/100",
            f"",
            f"📈 均线数据:",
            f"   现价: {result.current_price:.2f}",
            f"   MA5:  {result.ma5:.2f} (乖离 {result.bias_ma5:+.2f}%)",
            f"   MA10: {result.ma10:.2f} (乖离 {result.bias_ma10:+.2f}%)",
            f"   MA20: {result.ma20:.2f} (乖离 {result.bias_ma20:+.2f}%)",
            f"",
            f"📊 量能分析: {result.volume_status.value}",
            f"   量比(vs5日): {number(result.volume_ratio_5d, '.2f')}",
            f"   量能趋势: {result.volume_trend}",
            f"",
            f"📈 MACD指标: {macd_label}",
            f"   DIF: {number(result.macd_dif, '.4f')}",
            f"   DEA: {number(result.macd_dea, '.4f')}",
            f"   MACD: {number(result.macd_bar, '.4f')}",
            f"   信号: {result.macd_signal}",
            f"",
            f"📊 RSI指标: {rsi_label}",
            f"   RSI(6): {number(result.rsi_6, '.1f')}",
            f"   RSI(12): {number(result.rsi_12, '.1f')}",
            f"   RSI(24): {number(result.rsi_24, '.1f')}",
            f"   信号: {result.rsi_signal}",
            f"",
            f"🎯 操作建议: {result.buy_signal.value}",
            f"   综合评分: {result.signal_score}/100",
        ]

        if result.signal_reasons:
            lines.append(f"")
            lines.append(f"✅ 买入理由:")
            for reason in result.signal_reasons:
                lines.append(f"   {reason}")

        if result.risk_factors:
            lines.append(f"")
            lines.append(f"⚠️ 风险因素:")
            for risk in result.risk_factors:
                lines.append(f"   {risk}")

        return "\n".join(lines)


def analyze_stock(df: pd.DataFrame, code: str) -> TrendAnalysisResult:
    """
    便捷函数：分析单只股票
    
    Args:
        df: 包含 OHLCV 数据的 DataFrame
        code: 股票代码
        
    Returns:
        TrendAnalysisResult 分析结果
    """
    analyzer = StockTrendAnalyzer()
    return analyzer.analyze(df, code)


if __name__ == "__main__":
    # 测试代码
    logging.basicConfig(level=logging.INFO)
    
    # 模拟数据测试
    import numpy as np
    
    dates = pd.date_range(start='2025-01-01', periods=60, freq='D')
    np.random.seed(42)
    
    # 模拟多头排列的数据
    base_price = 10.0
    prices = [base_price]
    for i in range(59):
        change = np.random.randn() * 0.02 + 0.003  # 轻微上涨趋势
        prices.append(prices[-1] * (1 + change))
    
    df = pd.DataFrame({
        'date': dates,
        'open': prices,
        'high': [p * (1 + np.random.uniform(0, 0.02)) for p in prices],
        'low': [p * (1 - np.random.uniform(0, 0.02)) for p in prices],
        'close': prices,
        'volume': [np.random.randint(1000000, 5000000) for _ in prices],
    })
    
    analyzer = StockTrendAnalyzer()
    result = analyzer.analyze(df, '000001')
    print(analyzer.format_analysis(result))
