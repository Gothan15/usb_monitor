"""Núcleo compartido del agente USBMonitor v2.

Módulos:
  registro     log con rotación
  config       configuración (server.json > entorno > defecto) y cifrado ENC:
  diario       diario de cambios del sistema (regla «sin huella»)
  api          cliente del panel (contrato auditado 2026-11-01)
  pnp          costuras PnP de Windows (cfgmgr32): estados, padre, on/off
  volumen      candado de volumen (FSCTL) y automontaje
  dispositivos detección y clasificación (WMI)
  bloqueo      motor de bloqueo en capas, verificado, con vigía
  emergencia   desbloqueo local sin red con el hash del dueño
"""
