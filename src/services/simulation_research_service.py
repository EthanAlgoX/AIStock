"""Bounded rule-parameter research; never executes strategy code or model calls."""
import hashlib
import json
import math
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from src.storage import (SimulationPortfolioResearchRecord, SimulationPortfolioRunRecord,
                         SimulationPortfolioDefinitionRecord, SimulationRunRecord)
from src.services.simulation_portfolio_engine import metrics, step, grid_rule_opinions
from src.services.crypto_portfolio_rules import opinions as crypto_opinions
from src.services.simulation_portfolio_service import SimulationPortfolioService

POLICY = 'daily_parameter_research_v1'


def candidates(config):
    """Single-field bounded mutations; fixed universe, costs and engine unchanged."""
    skill = config.get('skillSnapshot', {}).get('id')
    if skill == 'crypto_rotation':
        fields = {'cryptoLookbackDays': (7, 14, 21, 30), 'cryptoRebalanceDays': (3, 7, 14),
                  'cryptoTopN': (2, 3, 5), 'cryptoAllocation': (.3, .4, .5, .6)}
    elif skill == 'crypto_equal_weight':
        fields = {'cryptoRebalanceDays': (3, 7, 14), 'cryptoAllocation': (.3, .4, .5, .6)}
    elif skill == 'crypto_btc_hold':
        fields = {'cryptoAllocation': (.3, .4, .5, .6)}
    elif skill == 'high_volume_volatility_grid':
        fields = {'gridLookbackDays': (3, 5, 10, 20), 'gridMinVolumeRatio': (1.1, 1.3, 1.5),
                  'gridMinRange': (.03, .05, .08), 'gridLevels': (3, 5, 7)}
    else:
        raise ValueError('Unsupported research rule')
    for field, values in fields.items():
        for value in values:
            # Saved histories have only the lookback required by the source run.
            if field == 'cryptoLookbackDays' and value > max(21, config.get(field, 30)):
                continue
            if field == 'cryptoAllocation' and skill != 'crypto_equal_weight' and value > config['maxWeight']:
                continue
            if value != config.get(field):
                yield {'field': field, 'before': config.get(field), 'after': value}


def replay(config, snapshots):
    config = dict(config, startDate=snapshots[0]['date'])
    state, days = {'cash': config['initialCash']}, []
    for snap in snapshots:
        bars, day = snap['bars'], snap['date']
        state, output = step(config, state, day, bars, snap['benchmarkClose'])
        decide = crypto_opinions if config['market'] == 'CRYPTO' else grid_rule_opinions
        decisions = decide(config, state, day, bars, config['symbols'])
        state['pending'] = dict(date=day, selected=[o['code'] for o in decisions if o['targetWeight'] > 0],
                                weights={o['code']: o['targetWeight'] for o in decisions},
                                reasons={o['code']: o['reason'] for o in decisions},
                                directions={o['code']: 'hold' for o in decisions if o.get('decision') == 'hold'})
        days.append(output)
    result = metrics(days, config['initialCash'], config['riskFreeRate'], 365 if config['market'] == 'CRYPTO' else 252)
    result['filledOrders'] = sum(t['status'] == 'filled' for d in days for t in d['trades'])
    result['feesPaid'] = sum(t['fee'] for d in days for t in d['trades'])
    result['slippagePaid'] = sum(t['slippage'] for d in days for t in d['trades'])
    return result


def verdict(candidate, baseline, limit):
    score, base = candidate['sharpe'], baseline['sharpe']
    if score is None or base is None or not math.isfinite(score) or not math.isfinite(base):
        return 'invalid_score'
    if not candidate['filledOrders']:
        return 'no_trades'
    if candidate['maxDrawdown'] > limit:
        return 'drawdown_limit'
    if score <= 0 or score <= base + .05:
        return 'no_improvement'
    return 'passed'


class SimulationResearchService:
    def __init__(self, db=None):
        self.portfolios = SimulationPortfolioService(db)
        self.db = self.portfolios.db

    @staticmethod
    def item(row):
        return dict(id=row.id, sourceId=row.source_id, createdAt=row.created_at.isoformat(),
                    candidateDefinitionId=row.candidate_definition_id, **json.loads(row.result_json))

    def list(self, source_id):
        with self.db.get_session() as session:
            rows = session.scalars(select(SimulationPortfolioResearchRecord).where(
                SimulationPortfolioResearchRecord.source_id == source_id).order_by(
                SimulationPortfolioResearchRecord.id.desc()).limit(20)).all()
            return [self.item(row) for row in rows]

    def create(self, source_id, budget=12, max_drawdown=.2):
        if type(budget) is not int or not 1 <= budget <= 16 or not 0 < max_drawdown <= .8:
            raise ValueError('Invalid research budget or drawdown limit')
        source = self.portfolios.detail(source_id)
        config = source['config']
        if (source['mode'] != 'backtest' or source['status'] != 'completed'
                or config.get('decisionBackend') != 'rules' or config.get('scopeRefresh', 'snapshot') != 'snapshot'
                or config.get('universeHistory', 'frozen') != 'frozen'):
            raise ValueError('Research requires a completed fixed-universe rule backtest')
        with self.db.get_session() as session:
            rows = session.scalars(select(SimulationRunRecord).where(
                SimulationRunRecord.strategy_version_id == source['versionId'],
                SimulationRunRecord.execution_mode == 'portfolio_day',
                SimulationRunRecord.status == 'completed').order_by(SimulationRunRecord.id)).all()
            snapshots = [json.loads(row.input_snapshot_json) for row in rows]
        n = len(snapshots)
        if n < 100:
            raise ValueError('Research requires at least 100 completed daily samples')
        digest = hashlib.sha256(json.dumps([POLICY, source_id, config, snapshots, budget, max_drawdown],
                                          sort_keys=True).encode()).hexdigest()
        with self.db.get_session() as session:
            previous = session.scalar(select(SimulationPortfolioResearchRecord).where(
                SimulationPortfolioResearchRecord.request_hash == digest))
            if previous:
                return self.item(previous)
        splits = {'train': snapshots[:n*3//5], 'validation': snapshots[n*3//5:n*4//5], 'final': snapshots[n*4//5:]}
        baseline = {key: replay(config, splits[key]) for key in ('train', 'validation')}
        experiments, best = [], None
        for change in list(candidates(config))[:budget]:
            candidate = dict(config, **{change['field']: change['after']})
            train, validation = (replay(candidate, splits[key]) for key in ('train', 'validation'))
            reason = verdict(validation, baseline['validation'], max_drawdown)
            if (train['sharpe'] is None or baseline['train']['sharpe'] is None
                    or train['sharpe'] < baseline['train']['sharpe'] - .1
                    or train['maxDrawdown'] > max_drawdown):
                reason = 'train_regression'
            experiments.append(dict(**change, train=train, validation=validation, reason=reason))
            if reason == 'passed' and (best is None or validation['sharpe'] > experiments[best]['validation']['sharpe']):
                best = len(experiments)-1
        # The final segment is never used to choose or retry a candidate.
        baseline['final'] = replay(config, splits['final'])
        final, candidate_config, accepted = None, None, False
        if best is not None:
            change = experiments[best]
            candidate_config = dict(config, **{change['field']: change['after']})
            final = replay(candidate_config, splits['final'])
            accepted = verdict(final, baseline['final'], max_drawdown) == 'passed'
        result = dict(policy=POLICY, sampleHash=source['evaluation']['sampleHash'], maxDrawdown=max_drawdown,
                      windows={key: dict(start=rows[0]['date'], end=rows[-1]['date'], samples=len(rows)) for key, rows in splits.items()},
                      baseline=baseline, experiments=experiments, bestIndex=best, final=final,
                      accepted=accepted, candidateConfig=candidate_config,
                      finalReason=verdict(final, baseline['final'], max_drawdown) if final else 'no_candidate')
        try:
            with self.db.session_scope() as session:
                row = SimulationPortfolioResearchRecord(source_id=source_id, request_hash=digest,
                                                        result_json=json.dumps(result, allow_nan=False))
                session.add(row)
                session.flush()
                return self.item(row)
        except IntegrityError:
            with self.db.get_session() as session:
                row = session.scalar(select(SimulationPortfolioResearchRecord).where(
                    SimulationPortfolioResearchRecord.request_hash == digest))
                if row is None:
                    raise
                return self.item(row)

    def adopt(self, research_id):
        with self.db.session_scope() as session:
            # Serialize concurrent requests before checking the idempotent clone.
            from sqlalchemy import update
            session.execute(update(SimulationPortfolioResearchRecord).where(
                SimulationPortfolioResearchRecord.id == research_id).values(id=research_id))
            row = session.get(SimulationPortfolioResearchRecord, research_id)
            if row is None:
                raise LookupError('Research not found')
            if row.candidate_definition_id:
                return {'id': row.candidate_definition_id}
            result = json.loads(row.result_json)
            source = session.get(SimulationPortfolioRunRecord, row.source_id)
            if source is None or source.status == 'deleted' or not result['accepted']:
                raise ValueError('No eligible candidate')
            config = deepcopy(result['candidateConfig'])
            for key in ('definitionId', 'mode', 'startDate', 'endDate'):
                config.pop(key, None)
            config.update(definitionRevision=1, researchSourceId=row.id)
            config['name'] = config['name'][:60] + f' · R{row.id}'
            definition = SimulationPortfolioDefinitionRecord(name=config['name'], config_json=json.dumps(config))
            session.add(definition)
            session.flush()
            row.candidate_definition_id = definition.id
            return {'id': definition.id}
