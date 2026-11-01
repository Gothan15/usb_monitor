"""Arranque de la suite del agente v2.

Inserta USBMonitor/ en sys.path. Los módulos del núcleo que tocan
Windows (pnp, volumen) no se importan en las pruebas: la lógica se
prueba a través de las costuras inyectadas.
"""
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))
