"""Preparación de la suite (Fase 7 del plan de arreglos).

El servicio es un programa de Windows: en otros sistemas se instalan
sustitutos mínimos de los módulos win32/wmi para poder importar el
módulo y probar su lógica pura. En Windows no se sustituye nada.
"""

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class _Stub(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = 0
        setattr(self, name, value)
        return value


def _install_windows_stubs() -> None:
    for name in (
        "pythoncom", "win32api", "win32con", "win32event", "win32service",
        "win32serviceutil", "servicemanager", "wmi", "win32file",
        "win32security", "win32process", "ntsecuritycon", "winerror",
        "pywintypes",
    ):
        if name not in sys.modules:
            sys.modules[name] = _Stub(name)
    sys.modules["pythoncom"].com_error = type("com_error", (Exception,), {})
    sys.modules["pywintypes"].com_error = sys.modules["pythoncom"].com_error
    sys.modules["wmi"].x_wmi_timed_out = type("x_wmi_timed_out", (Exception,), {})

    class _Framework:
        def __init__(self, args=None):
            pass

    sys.modules["win32serviceutil"].ServiceFramework = _Framework


try:
    import usb_monitor_service  # noqa: F401
except ImportError:
    _install_windows_stubs()
    import usb_monitor_service  # noqa: F401
