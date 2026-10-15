"""Include installed dependency license files alongside the frozen backend."""
import importlib.metadata
from pathlib import Path
import shutil
import sys

destination = Path(__file__).resolve().parents[1] / 'build/backend/badnotes-backend/licenses'
destination.mkdir(parents=True, exist_ok=True)
for distribution in importlib.metadata.distributions():
    name = distribution.metadata['Name']
    for file in distribution.files or []:
        if not any(word in file.name.lower() for word in ('license', 'copying', 'notice')):
            continue
        source = Path(distribution.locate_file(file))
        if source.is_file():
            target = destination / name / str(file).replace('..', '_')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
for name in ('LICENSE.txt', 'LICENSE'):
    source = Path(sys.base_prefix) / name
    if source.is_file():
        shutil.copy2(source, destination / 'Python-LICENSE.txt')
print('Collected dependency licenses:', destination)
