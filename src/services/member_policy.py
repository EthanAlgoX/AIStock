"""Fail-closed member API policy. Platform administration is never inherited."""


def member_api_allowed(path, method):
    parts = path.strip('/').split('/')
    if parts[:2] != ['api', 'v1'] or len(parts) < 3:
        return False
    group = parts[2]
    resource = parts[3] if len(parts) > 3 else ''
    read = method in {'GET', 'HEAD'}
    if group == 'auth':
        return resource in {'status', 'logout', 'change-password', 'change-email'}
    if group == 'workspace':
        if resource == 'run-history':
            return read
        if resource in {'mcp-servers', 'data-sources', 'runtime-manifest'}:
            return read
        return resource in {
            'capabilities', 'default-task-plan', 'portfolio-research', 'skills', 'tools',
            'experts', 'expert-teams', 'tasks', 'runs', 'schedules',
            'market-dashboards', 'market-subscriptions',
            'notification-settings', 'chat-settings',
        }
    if group == 'agent':
        return resource in {'models', 'status', 'skills', 'strategies', 'chat', 'research'} and resource != 'send' and '/chat/send' not in path
    if group == 'portfolio':
        return resource in {'accounts', 'trades', 'cash-ledger', 'corporate-actions', 'positions', 'snapshot', 'risk', 'fx'}
    if group == 'history':
        return read and not any(part in {'share-image', 'share-image-html', 'diagnostics'} for part in parts)
    if group == 'stocks':
        return read or resource in {'search', 'resolve', 'watchlist'}
    if group in {'usage', 'decision-signals'}:
        return True
    if group in {'analysis', 'screening'}:
        return True
    if group == 'simulation':
        # Executable package intake, arbitrary strategy source editing and live
        # broker operations are administrative. Built-in versions remain readable.
        return read or (resource == 'portfolios' and method == 'POST' and (
            len(parts) == 4
            or (len(parts) == 6 and parts[4].isdigit() and parts[5] == 'control')
            or parts[4:] in (['definitions'], ['universe-preview'])
            or (len(parts) == 7 and parts[4] == 'definitions' and parts[5].isdigit() and parts[6] == 'validations')
        ))
    if group == 'alerts':
        return True
    if group == 'intelligence':
        return read
    return False
