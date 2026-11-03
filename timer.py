import time


def now():
    return int(time.time() * 1000)


def initial():
    return dict(mode='prepared', selected_duration_seconds=1800,
                paused_remaining_ms=1800000, deadline_utc_ms=None, title='', revision=0)


def mutate(state, action, payload, clock=now):
    s = state.copy()
    t = clock()
    remaining = s['deadline_utc_ms'] - t if s['mode'] == 'running' else s['paused_remaining_ms']
    if action == 'start':
        if s['mode'] == 'running':
            raise ValueError('Already running')
        s.update(mode='running', deadline_utc_ms=t + remaining, paused_remaining_ms=None)
    elif action == 'pause':
        if s['mode'] != 'running':
            raise ValueError('Not running')
        s.update(mode='paused', paused_remaining_ms=remaining, deadline_utc_ms=None)
    elif action in ('reset', 'set_duration'):
        if action == 'set_duration':
            v = payload.get('seconds')
            if type(v) is not int or not 60 <= v <= 10800 or v % 60:
                raise ValueError('Use 1–180 whole minutes')
            s['selected_duration_seconds'] = v
        s.update(mode='prepared', paused_remaining_ms=s['selected_duration_seconds'] * 1000, deadline_utc_ms=None)
    elif action == 'adjust_time':
        v = payload.get('seconds')
        if type(v) is not int or v not in (-60, 60):
            raise ValueError('Invalid adjustment')
        remaining += v * 1000
        if not -86400000 <= remaining <= 10800000:
            raise ValueError('Outside adjustment limits')
        if s['mode'] == 'running':
            s['deadline_utc_ms'] = t + remaining
        else:
            s.update(mode='paused', paused_remaining_ms=remaining)
    elif action == 'set_title':
        v = payload.get('text')
        if not isinstance(v, str) or len(v) > 120:
            raise ValueError('Title limit is 120 characters')
        s['title'] = v
    else:
        raise ValueError('Unknown command')
    s['revision'] += 1
    return s
