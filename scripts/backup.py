"""Online SQLite backup; restore only while the application is stopped."""
import argparse
import sqlite3
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('destination')
args=parser.parse_args()
if Path(args.destination).exists():
    parser.error('Destination already exists; choose a new file')
with sqlite3.connect(f'file:{Path(args.source).resolve().as_posix()}?mode=ro',uri=True) as source:
    with sqlite3.connect(args.destination) as destination:
        source.backup(destination)
        if destination.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise RuntimeError('Backup integrity check failed')
print('Consistent backup created')
