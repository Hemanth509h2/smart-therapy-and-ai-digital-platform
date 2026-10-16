import sys
from pathlib import Path

# Make server.py / stt_proxy.py importable when pytest runs from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
