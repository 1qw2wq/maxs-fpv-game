"""Compatibility entry point for the expanded city + arsenal + live transport suite."""
import os,runpy
from pathlib import Path
os.environ.setdefault('CITY_LIVE','1')
runpy.run_path(str(Path(__file__).with_name('test-expanded-assets.py')),run_name='__main__')
