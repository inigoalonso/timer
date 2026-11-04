import time


def now():
    return int(time.time() * 1000)


def initial():
    return dict(mode='prepared', selected_duration_seconds=1800,
                paused_remaining_ms=1800000, deadline_utc_ms=None, title='', revision=0,
                playlist=[], playlist_index=None, playlist_phase=None)


def validate_playlist(entries):
    if not isinstance(entries, list) or len(entries) > 100:
        raise ValueError('Use at most 100 presentations')
    for entry in entries:
        required = {'title', 'duration_seconds', 'qa_duration_seconds'}
        if not isinstance(entry, dict) or not required <= set(entry) or set(entry) - required - {'speaker'}:
            raise ValueError('Each presentation needs a title, duration and Q&A duration')
        if not isinstance(entry['title'], str) or not entry['title'].strip() or len(entry['title']) > 120:
            raise ValueError('Presentation titles must contain 1–120 characters')
        if 'speaker' in entry and (not isinstance(entry['speaker'], str) or len(entry['speaker']) > 120):
            raise ValueError('Speaker must be text of at most 120 characters')
        for field, minimum in (('duration_seconds', 60), ('qa_duration_seconds', 0)):
            duration = entry[field]
            if type(duration) is not int or not minimum <= duration <= 10800 or duration % 60:
                raise ValueError('Talks need 1–180 whole minutes; Q&A needs 0–180')
    return [entry.copy() for entry in entries]


def mutate(state, action, payload, clock=now):
    s = state.copy()
    t = clock()
    remaining = s['deadline_utc_ms'] - t if s['mode'] == 'running' else s['paused_remaining_ms']
    if action == 'set_playlist':
        s.update(playlist=validate_playlist(payload.get('entries')), playlist_index=None, playlist_phase=None)
    elif action in ('load_presentation', 'next_presentation'):
        entries = s.get('playlist', [])
        if action == 'load_presentation':
            index, phase = payload.get('index'), payload.get('phase', 'talk')
        else:
            index, phase = s.get('playlist_index'), s.get('playlist_phase')
            if index is None:
                index, phase = 0, 'talk'
            elif phase == 'talk' and entries[index]['qa_duration_seconds']:
                phase = 'qa'
            else:
                index, phase = index + 1, 'talk'
        if type(index) is not int or not 0 <= index < len(entries) or phase not in ('talk', 'qa'):
            raise ValueError('No presentation available')
        entry = entries[index]
        duration = entry['duration_seconds' if phase == 'talk' else 'qa_duration_seconds']
        if not duration:
            raise ValueError('This presentation has no Q&A')
        s.update(playlist_index=index, playlist_phase=phase, title=entry['title'],
                 selected_duration_seconds=duration, mode='prepared',
                 paused_remaining_ms=duration * 1000, deadline_utc_ms=None)
    elif action == 'start':
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
            s.update(playlist_index=None, playlist_phase=None)
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
        s.update(playlist_index=None, playlist_phase=None)
    else:
        raise ValueError('Unknown command')
    s['revision'] += 1
    return s
