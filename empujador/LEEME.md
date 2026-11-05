# El empujador

En esta carpeta va `USBMonitorEmpujador.exe` en el equipo del panel:
es el ayudante que hace el empujón de las tareas de instalación
(SMB al recurso C$ del destino + servicio temporal por RPC, el
modelo de Kaspersky). El ejecutor de tareas del panel lo lanza
como proceso hijo; sin él, los destinos nuevos de una tarea
terminan en error con este motivo explicado.

El exe sale de compilar el proyecto `USBMonitorCS/empujador`
del repositorio y viaja en el zip de la Release del agente,
junto al ejecutable: una sola descarga surte esta carpeta y
la de `paquete-agente/`. La ruta se puede cambiar con la variable de entorno
`EMPUJADOR_PATH`.

El ejecutable del agente que empuja es el de la carpeta
`paquete-agente/` del panel (el mismo que sirve el canal de
actualización): deja ahí el `USBMonitorService.exe` vigente.
