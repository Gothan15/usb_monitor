# 📋 GUÍA PASO A PASO - Sistema de Monitoreo USB

## 🎯 OBJETIVO DE ESTA GUÍA

Esta guía te ayudará a instalar y configurar el sistema de monitoreo USB aunque no tengas conocimientos de programación. Al final, podrás:
- Monitorear cuándo se conectan USB a las computadoras de tu oficina
- Ver todos los eventos en un panel web
- Bloquear automáticamente las computadoras cuando se detecta un USB

---

## 📋 REQUISITOS ANTES DE EMPEZAR

### 🖥️ Para el Servidor Central (necesitarás UNA computadora)
- Una computadora con Windows 10 o 11 (o Linux/Mac si prefieres)
- Conexión a internet
- 2GB de RAM mínimo
- 1GB de espacio libre en disco

### 💻 Para las Computadoras a Monitorear (cada una)
- Windows 7, 8, 10 u 11
- Conexión a internet
- Permisos de administrador

---

## 🚀 PASO 1: PREPARAR EL SERVIDOR CENTRAL

### 1.1 Descargar e Instalar Node.js
Node.js es necesario para que funcione el servidor web.

1. Abre tu navegador web (Chrome, Edge, Firefox)
2. Ve a: https://nodejs.org/
3. Haz clic en el botón que dice "LTS" (es la versión recomendada)
4. Descarga el instalador para Windows
5. Ejecuta el archivo descargado
6. Sigue las instrucciones del instalador:
   - Haz clic en "Next" en todas las pantallas
   - Cuando te pregunte, marca "Add to PATH"
   - Haz clic en "Install" y espera a que termine
   - Haz clic en "Finish"

### 1.2 Verificar la Instalación
1. Abre el menú de inicio
2. Escribe "cmd" y haz clic en "Símbolo del sistema"
3. Escribe los siguientes comandos uno por uno:

```bash
node --version
npm --version
```

Si ves números (como v18.17.0 y 9.6.7), ¡todo está bien!

### 1.3 Descargar el Sistema
1. Crea una carpeta en tu escritorio llamada "USB-Monitor"
2. Copia todos los archivos del proyecto en esta carpeta
3. Abre la carpeta "USB-Monitor"

### 1.4 Instalar el Sistema
1. Dentro de la carpeta "USB-Monitor", haz clic derecho en un espacio vacío
2. Mantén presionada la tecla "Shift" y haz clic derecho
3. Selecciona "Abrir ventana de PowerShell aquí" o "Abrir símbolo del sistema aquí"
4. Escribe el siguiente comando y presiona Enter:

```bash
npm install
```

⚠️ **Este proceso puede tardar varios minutos. Espera hasta que termine.**

### 1.5 Configurar la Base de Datos
1. En la misma ventana, escribe:

```bash
npm run db:push
```

2. Espera a que termine. Si no aparece ningún error, ¡está listo!

### 1.6 Iniciar el Servidor
1. En la misma ventana, escribe:

```bash
npm run dev
```

2. Verás algo como esto:
   ```
   > Ready on http://localhost:3000
   ```

3. **¡NO CIERRES ESTA VENTANA!** El servidor debe estar siempre encendido.

### 1.7 Probar el Panel Web
1. Abre tu navegador web
2. Ve a: http://localhost:3000
3. Deberías ver el panel de monitoreo con estadísticas

---

## 💻 PASO 2: PREPARAR LAS COMPUTADORAS A MONITOREAR

### 2.1 Descargar e Instalar Python
**Repite esto en CADA computadora que quieras monitorear**

1. Abre el navegador web
2. Ve a: https://www.python.org/downloads/
3. Haz clic en "Download Python 3.x"
4. Ejecuta el archivo descargado
5. **MUY IMPORTANTE**: Al principio de la instalación, marca la casilla que dice "Add Python to PATH"
6. Haz clic en "Install Now"
7. Espera a que termine y haz clic en "Close"

### 2.2 Verificar Python
1. Abre el menú de inicio
2. Escribe "cmd" y haz clic en "Símbolo del sistema"
3. Escribe:

```bash
python --version
```

Si ves un número (como 3.11.0), está bien instalado.

### 2.3 Instalar Bibliotecas Necesarias
1. En la misma ventana, escribe:

```bash
pip install pywin32 requests pyinstaller
```

2. Espera a que termine la instalación.

### 2.4 Preparar el Script de Monitoreo
1. Copia el archivo `detector_usb_fixed.py` a la computadora
2. Colócalo en una carpeta fácil de encontrar, como "C:\USB-Monitor"

### 2.5 Configurar la Dirección del Servidor
1. Abre el archivo `detector_usb_fixed.py` con el Bloc de Notas
2. Busca la línea que dice:
   ```python
   SERVER_URL = "http://localhost:3000/api/usb-event"
   ```
3. Cambia "localhost" por la IP de tu servidor central:
   ```python
   SERVER_URL = "http://192.168.1.100:3000/api/usb-event"
   ```
   
   **¿Cómo saber la IP de tu servidor?**
   - En la computadora servidor, abre el símbolo del sistema
   - Escribe: `ipconfig`
   - Busca "Dirección IPv4" (ej: 192.168.1.100)
   - Usa esa dirección IP

4. Guarda el archivo (Ctrl + S)

### 2.6 Probar la Conexión
1. En el símbolo del sistema, navega a la carpeta donde guardaste el script:
   ```bash
   cd C:\USB-Monitor
   ```
2. Ejecuta la prueba:
   ```bash
   python detector_usb_fixed.py --test
   ```
3. Si dice "Conexión exitosa", ¡todo está bien!

---

## 🔧 PASO 3: INSTALAR EL SERVICIO DE MONITOREO

### 3.1 Instalar como Servicio Windows
1. En el símbolo del sistema (como administrador):
   - Haz clic derecho en el símbolo del sistema
   - Selecciona "Ejecutar como administrador"
2. Navega a la carpeta del script:
   ```bash
   cd C:\USB-Monitor
   ```
3. Instala el servicio:
   ```bash
   python detector_usb_fixed.py --install
   ```
4. Si dice "Servicio USBMonitor instalado correctamente", ¡perfecto!

### 3.2 Iniciar el Servicio
1. En el mismo símbolo del sistema, escribe:
   ```bash
   net start USBMonitor
   ```
2. Si dice "El servicio USBMonitor se ha iniciado correctamente", ¡listo!

### 3.3 Verificar que el Servicio está Corriendo
1. Presiona Windows + R
2. Escribe: `services.msc`
3. Busca "USB Monitor Service" en la lista
4. Debería decir "En ejecución" y "Automático"

---

## 🧪 PASO 4: PROBAR EL SISTEMA COMPLETO

### 4.1 Probar la Detección de USB
1. En una computadora monitoreada, conecta un dispositivo USB (memoria, teléfono, etc.)
2. **La sesión debería bloquearse automáticamente** (mostrará la pantalla de inicio de sesión)
3. Inicia sesión nuevamente

### 4.2 Verificar en el Panel Web
1. En la computadora servidor, abre el navegador
2. Ve a: http://localhost:3000
3. Espera unos 30 segundos (el panel se actualiza automáticamente)
4. Deberías ver:
   - Un nuevo evento en la pestaña "Eventos USB"
   - La computadora en la pestaña "Computadoras"
   - Las estadísticas actualizadas

---

## 📱 PASO 5: MANTENIMIENTO Y USO DIARIO

### 5.1 Mantener el Servidor Encendido
- **La computadora servidor debe estar siempre encendida**
- La ventana del servidor (donde ejecutaste `npm run dev`) debe estar abierta
- Si apagas la computadora, debes volver a ejecutar `npm run dev`

### 5.2 Acceder al Panel de Monitoreo
- Desde cualquier computadora en la red, abre un navegador
- Usa la dirección IP del servidor: http://IP_DEL_SERVIDOR:3000
- Ej: http://192.168.1.100:3000

### 5.3 Monitorear Eventos
- El panel se actualiza solo cada 30 segundos
- También puedes hacer clic en "Actualizar" para refrescar manualmente
- Los eventos más recientes aparecen primero

### 5.4 Administrar Computadoras
- En la pestaña "Computadoras" puedes ver:
  - Qué computadoras están activas
  - Cuándo fue la última conexión
  - La dirección IP de cada una

---

## 🚨 SOLUCIÓN DE PROBLEMAS COMUNES

### Problema: "El servicio no se instala"
**Solución:**
1. Asegúrate de ejecutar el símbolo del sistema como administrador
2. Verifica que Python esté instalado correctamente
3. Revisa que pywin32 esté instalado: `pip show pywin32`

### Problema: "Los eventos no aparecen en el panel"
**Solución:**
1. Verifica que el servidor esté encendido (ventana con `npm run dev` abierta)
2. Comprueba la IP en el script Python
3. Prueba la conexión: `python detector_usb_fixed.py --test`
4. Revisa que ambos equipos estén en la misma red

### Problema: "La computadora no se bloquea al conectar USB"
**Solución:**
1. Verifica que el servicio esté corriendo: `net start USBMonitor`
2. Revisa los permisos de administrador
3. Prueba ejecutar el script manualmente: `python detector_usb_fixed.py`

### Problema: "El panel web no carga"
**Solución:**
1. Asegúrate de que el servidor esté corriendo
2. Verifica que estés usando la dirección correcta (localhost:3000 o IP:3000)
3. Reinicia el servidor: cierra la ventana y vuelve a ejecutar `npm run dev`

### Problema: "No puedo encontrar la IP del servidor"
**Solución:**
1. En el servidor, abre símbolo del sistema
2. Escribe: `ipconfig`
3. Busca "Dirección IPv4" bajo tu conexión de red
4. Usa esa dirección (ej: 192.168.1.100)

---

## 📞 CUÁNDO PEDIR AYUDA

Contacta a soporte técnico si:
- Sigues los pasos y algo no funciona
- Necesitas monitorear muchas computadoras
- Quieres personalizar el sistema
- Tienes problemas de red en la oficina

---

## 🎉 ¡FELICITACIONES!

Si has seguido todos los pasos, ahora tienes:
✅ Un sistema de monitoreo USB funcionando  
✅ Bloqueo automático de computadoras  
✅ Panel web para ver todos los eventos  
✅ Registro completo de actividad USB  

El sistema está protegiendo tus computadoras y registrando todo en tiempo real.

---

## 📝 NOTAS IMPORTANTES

- **No cierres la ventana del servidor** - Si la cierras, el sistema deja de funcionar
- **El servidor debe estar siempre encendido** - Es el cerebro del sistema
- **Puedes monitorear tantas computadoras como quieras** - Solo repite el Paso 2 y 3 en cada una
- **Los eventos se guardan para siempre** - Puedes ver el historial completo en el panel
- **El sistema funciona en red local** - Asegúrate que todas las computadoras puedan comunicarse entre sí

---

🔒 **¡Tu sistema de seguridad USB está listo y funcionando!**