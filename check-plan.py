#!/usr/bin/env python3
"""Проверить общую версию плана в репозитории страницы."""
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent


def validate(plan, data_dir):
    errors = []
    platforms = {p['id'] for p in plan.get('platforms', [])}
    videos = plan.get('videos', {})
    ids, last_date = set(), ''
    data_dir = Path(data_dir).resolve()
    for item in plan.get('items', []):
        ident = item.get('id', '')
        date = item.get('date', '')
        if not ident or ident in ids:
            errors.append(f'{ident}: отсутствует или повторяется id')
        ids.add(ident)
        if len(date) != 10 or date < last_date:
            errors.append(f'{ident}: неверная дата или порядок дней')
        last_date = date
        kind, fmt = item.get('kind'), item.get('format')
        if kind not in ('reel', 'slot') or fmt not in ('pure', 'plates'):
            errors.append(f'{ident}: неверный вид карточки или формат')
        selected = item.get('platforms', [])
        if set(selected + item.get('optional', [])) - platforms:
            errors.append(f'{ident}: неизвестная площадка')
        if fmt == 'plates' and 'li' not in selected and not item.get('noLinkedIn'):
            errors.append(f'{ident}: для плашек нужен LinkedIn')
        if fmt == 'pure' and 'li' in selected:
            errors.append(f'{ident}: для чистой игры LinkedIn только по желанию')
        vid = item.get('video')
        if kind == 'slot' and vid:
            errors.append(f'{ident}: у пустого слота есть видео')
        if vid and vid not in videos:
            errors.append(f'{ident}: видео {vid} отсутствует в реестре')
        if len(item.get('shortsTitle', '')) > 100:
            errors.append(f'{ident}: заголовок Shorts длиннее 100 символов')
        if len((item.get('linkedin') or {}).get('text', '')) > 3000:
            errors.append(f'{ident}: текст LinkedIn длиннее 3000 символов')
    for vid, video in videos.items():
        file_url = video.get('file')
        if not file_url:
            continue
        parts = urlsplit(file_url)
        file_path = (data_dir / parts.path).resolve()
        if data_dir not in file_path.parents or not file_path.is_file():
            errors.append(f'{vid}: файл видео не найден в data')
            continue
        poster = (data_dir / urlsplit(video.get('poster', '')).path).resolve()
        if data_dir not in poster.parents or not poster.is_file():
            errors.append(f'{vid}: обложка не найдена в data')
        version = parse_qs(parts.query).get('v', [None])[0]
        if version and hashlib.sha1(file_path.read_bytes()).hexdigest()[:8] != version:
            errors.append(f'{vid}: версия ссылки не совпадает с файлом')
    return errors


if __name__ == '__main__':
    try:
        content = json.loads((ROOT / 'data' / 'plan.json').read_text(encoding='utf-8'))
        problems = validate(content, ROOT / 'data')
    except (OSError, ValueError, TypeError) as exc:
        sys.exit(f'Не удалось проверить план: {exc}')
    if problems:
        sys.exit('\n'.join(problems))
    print(f"План в порядке: {len(content['items'])} дней, {len(content['videos'])} видео в реестре")
