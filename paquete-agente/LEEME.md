# Paquete de actualización del agente

En esta carpeta se deja el `USBMonitorService.exe` vigente (el de la
última Release del agente) para que el panel pueda actualizar los
equipos por el canal de órdenes, sin depender de GitHub desde la LAN.

Junto al exe, un `manifiesto.json` con la versión:

```json
{ "version": "1.0.4" }
```

El panel calcula el SHA-256 del exe y lo sirve en
`GET /api/agent/paquete/manifiesto`; el agente descarga de
`GET /api/agent/paquete`, verifica el hash y solo entonces se
sustituye. El exe y el manifiesto no van al repositorio (están en
.gitignore): son archivos de la instalación, no del código.
