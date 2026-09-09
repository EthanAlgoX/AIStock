"""Bounded, reproducible chart calculations; no interpreter, files or network access."""
import ast
import json
import math
import operator

from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolPolicy
from src.agent.tools.execution import check_tool_execution

_BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def _text(value, maximum, field):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'{field} must be nonempty text, at most {maximum} characters')
    return value.strip()


def _number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1e15:
        raise ValueError('Chart values must be finite numbers within ±1e15, or null')
    return value


def _expression(code, columns):
    tree = ast.parse(_text(code, 240, 'expression'), mode='eval')
    nodes = list(ast.walk(tree))
    if len(nodes) > 64:
        raise ValueError('Expression is too complex')
    for node in nodes:
        if not isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
                                 ast.Add, ast.Sub, ast.Mult, ast.Div, ast.UAdd, ast.USub)):
            raise ValueError('Use only numeric columns, constants, parentheses and + - * /')
        if isinstance(node, ast.Name) and (node.id not in columns or len(node.id) > 32):
            raise ValueError(f'Unknown numeric column: {node.id}')
        if isinstance(node, ast.Constant):
            _number(node.value)
    return tree.body


def _calculate(node, row):
    if isinstance(node, ast.Name):
        return _number(row.get(node.id))
    if isinstance(node, ast.Constant):
        return _number(node.value)
    if isinstance(node, ast.UnaryOp):
        value = _calculate(node.operand, row)
        return None if value is None else _number(-value if isinstance(node.op, ast.USub) else value)
    left, right = _calculate(node.left, row), _calculate(node.right, row)
    if left is None or right is None or (isinstance(node.op, ast.Div) and right == 0):
        return None
    return _number(_BINARY[type(node.op)](left, right))


def build_analysis_chart(spec: dict) -> dict:
    """Validate a declarative program and return embeddable, portable Markdown."""
    check_tool_execution()
    if not isinstance(spec, dict) or len(json.dumps(spec, ensure_ascii=False)) > 60000:
        raise ValueError('Chart program must be an object smaller than 60 KB')
    kind = spec.get('type')
    if kind not in {'line', 'bar', 'flow'}:
        raise ValueError('Chart type must be line, bar or flow')
    output = dict(version=1, type=kind, title=_text(spec.get('title'), 160, 'title'),
                  source=_text(spec.get('source'), 400, 'source'),
                  basis=spec.get('basis', 'observed'))
    if output['basis'] not in {'observed', 'scenario', 'illustrative'}:
        raise ValueError('basis must be observed, scenario or illustrative')
    for field, limit in [('asOf', 80), ('unit', 40), ('description', 800)]:
        if spec.get(field):
            output[field] = _text(spec[field], limit, field)
    if kind == 'flow':
        nodes, edges = spec.get('nodes'), spec.get('edges')
        if not isinstance(nodes, list) or not 2 <= len(nodes) <= 12 or not isinstance(edges, list) or len(edges) > 20:
            raise ValueError('Flows require 2–12 nodes and up to 20 explicit edges')
        output['nodes'] = [_text(label, 100, 'node') for label in nodes]
        output['edges'] = []
        for edge in edges:
            if not isinstance(edge, dict) or any(type(edge.get(k)) is not int or not 0 <= edge[k] < len(nodes) for k in ('from', 'to')):
                raise ValueError('Flow edges must reference existing zero-based node indexes')
            output['edges'].append({'from':edge['from'], 'to':edge['to'], 'label':_text(edge.get('label', '→'), 80, 'edge label')})
    else:
        rows, series = spec.get('data'), spec.get('series')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 120 or not all(isinstance(r, dict) for r in rows):
            raise ValueError('Charts require 1–120 data rows')
        if not isinstance(series, list) or not 1 <= len(series) <= 4 or not all(isinstance(s, dict) for s in series):
            raise ValueError('Charts require 1–4 numeric series with the same unit')
        columns = set().union(*(row.keys() for row in rows)) - {'label'}
        output['series'] = []
        expressions = []
        for index, series_item in enumerate(series):
            expression = _text(series_item.get('expression'), 240, 'expression')
            expressions.append(_expression(expression, columns))
            output['series'].append({'key':f'v{index}', 'name':_text(series_item.get('name'), 80, 'series name'), 'expression':expression})
        used_columns = sorted({node.id for expr in expressions for node in ast.walk(expr) if isinstance(node, ast.Name)})
        if len(used_columns) > 12:
            raise ValueError('Use at most 12 input columns per chart')
        output['inputs'] = [{'label':_text(row.get('label'), 100, 'row label'), **{key:_number(row.get(key)) for key in used_columns}} for row in rows]
        output['data'] = []
        for row in rows:
            check_tool_execution()
            output['data'].append({'label':_text(row.get('label'), 100, 'row label'),
                                   **{f'v{i}':_calculate(expr, row) for i, expr in enumerate(expressions)}})
        if not any(row[s['key']] is not None for row in output['data'] for s in output['series']):
            raise ValueError('No numeric observations available to plot')
        output['missingValues'] = sum(row[s['key']] is None for row in output['data'] for s in output['series'])
    encoded = json.dumps(output, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode('utf-8')) > 60000:
        raise ValueError('Chart output is too large; reduce rows or labels')
    markdown = '```analysis-chart\n' + encoded + '\n```'
    return {'chart':output, 'markdown':markdown,
            'instruction':'Embed markdown verbatim in the user-facing answer. Keep source/date/unit and explain the finding. Null values are missing, not zero. Source is supplied by the caller, not independently verified.'}


ALL_CHART_TOOLS = [ToolDefinition(
    name='build_analysis_chart',
    description='代码计算与绘图 / Calculate and plot supplied evidence. Returns an analysis-chart Markdown block for reports and chat. '
                'spec: type line/bar/flow, title, source, asOf, unit, basis observed/scenario/illustrative. '
                'Numeric charts: data [{label:"2024",revenue:120,cost:80}], series [{name:"margin",expression:"(revenue-cost)/revenue*100"}]. '
                'Only + - * / and parentheses are executable; missing values and division by zero stay null. '
                'Flow: nodes ["Evidence","Decision"], edges [{from:0,to:1,label:"supports"}]. '
                'Use real tool evidence; never invent statistics or mix units. No network, file or shell access.',
    parameters=[ToolParameter('spec', 'object', 'Bounded declarative chart program with sourced data and arithmetic expressions.')],
    handler=build_analysis_chart, category='analysis',
    policy=ToolPolicy.declared(read_only=True, side_effects=['compute'], permissions=['analysis:compute'], cancellation_safe=True),
)]
