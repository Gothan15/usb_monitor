"""Kit de interfaz Fluent (Windows 11) para las herramientas del agente.

Sustituye a tkinter en el compañero, el visor de seriales y la
herramienta de administración. Las ventanas se dibujan con pywebview
(WebView2, integrado en Windows 11) sobre HTML/CSS con el lenguaje
visual de Fluent: tipografía Segoe UI, superficies con borde fino y
esquinas redondeadas, acento del sistema y tema claro/oscuro según
el propio Windows (prefers-color-scheme).

El CSS vive una sola vez aquí; cada programa compone su página con
fluent_page() y habla con su lógica mediante la API de pywebview.
Sin interfaz gráfica disponible (o sin pywebview), create_window
lanza RuntimeError con el motivo: cada programa decide cómo morir
con dignidad (el compañero lo registra y sale; el servicio de
Windows lo relanza).
"""

from __future__ import annotations

try:  # pywebview solo hace falta para mostrar ventanas
    import webview
except ImportError as exc:  # pragma: no cover - depende del entorno
    webview = None  # type: ignore[assignment]
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

FLUENT_CSS = """
:root{
  --fondo:#F3F3F3; --superficie:#FBFBFB; --tarjeta:#FFFFFF;
  --texto:#1B1B1B; --suave:#5D5D5D; --borde:rgba(0,0,0,.09);
  --acento:#0067C0; --acento-texto:#FFFFFF; --acento-hover:#005A9E;
  --relleno:rgba(0,0,0,.045); --relleno-hover:rgba(0,0,0,.09);
  --peligro:#C42B1C; --exito:#0F7B0F; --campo:#FFFFFF;
}
@media (prefers-color-scheme: dark){
  :root{
    --fondo:#202020; --superficie:#282828; --tarjeta:#2B2B2B;
    --texto:#FFFFFF; --suave:#A3A3A3; --borde:rgba(255,255,255,.09);
    --acento:#4CC2FF; --acento-texto:#00375F; --acento-hover:#62CDFF;
    --relleno:rgba(255,255,255,.06); --relleno-hover:rgba(255,255,255,.11);
    --peligro:#FF99A4; --exito:#6CCB5F; --campo:#313131;
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
  background:var(--fondo); color:var(--texto); font-size:14px;
  padding:22px; -webkit-user-select:none; user-select:none;
}
h1{font-size:20px; font-weight:600; margin:0 0 4px}
.sub{color:var(--suave); font-size:13px; margin:0 0 16px; line-height:1.45}
.tarjeta{
  background:var(--tarjeta); border:1px solid var(--borde);
  border-radius:8px; padding:18px; margin-bottom:14px;
  box-shadow:0 2px 4px rgba(0,0,0,.06);
}
.etq{font-size:12px; color:var(--suave); margin:0 0 5px; font-weight:600}
input[type=text],input[type=password]{
  width:100%; padding:8px 10px; font:inherit; color:var(--texto);
  background:var(--campo); border:1px solid var(--borde);
  border-bottom:2px solid rgba(128,128,128,.55); border-radius:4px;
  outline:none; margin-bottom:12px;
}
input:focus{border-bottom-color:var(--acento)}
.fila{display:flex; gap:8px; flex-wrap:wrap; align-items:center}
button{
  font:inherit; font-size:13px; padding:7px 16px; cursor:pointer;
  border-radius:4px; border:1px solid var(--borde);
  background:var(--relleno); color:var(--texto);
}
button:hover{background:var(--relleno-hover)}
button:disabled{opacity:.45; cursor:default}
button.acento{
  background:var(--acento); color:var(--acento-texto);
  border-color:transparent; font-weight:600;
}
button.acento:hover{background:var(--acento-hover)}
.estado{font-size:13px; min-height:18px; margin-top:10px; line-height:1.45}
.estado.error{color:var(--peligro)}
.estado.ok{color:var(--exito)}
.check{display:flex; gap:7px; align-items:center; font-size:13px; color:var(--suave); margin:-4px 0 10px}
table{width:100%; border-collapse:collapse; font-size:13px}
th{ text-align:left; color:var(--suave); font-weight:600; font-size:12px;
    padding:6px 8px; border-bottom:1px solid var(--borde)}
td{padding:7px 8px; border-bottom:1px solid var(--borde); -webkit-user-select:text; user-select:text}
tr.fila-dato{cursor:pointer}
tr.fila-dato:hover{background:var(--relleno)}
tr.seleccionada{background:var(--relleno-hover)}
.log{
  font-family:"Cascadia Mono",Consolas,monospace; font-size:12px;
  white-space:pre-wrap; word-break:break-word; max-height:170px;
  overflow:auto; color:var(--suave); line-height:1.5;
}
.punto{display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:1px}
"""


def fluent_page(body_html: str, extra_css: str = "", extra_js: str = "") -> str:
    """Documento HTML completo con el CSS Fluent compartido."""
    return (
        "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<style>{FLUENT_CSS}{extra_css}</style></head>"
        f"<body>{body_html}<script>{extra_js}</script></body></html>"
    )


def require_webview() -> None:
    """Falla con un mensaje claro si pywebview no está disponible."""
    if webview is None:
        raise RuntimeError(
            "pywebview no está instalado: la interfaz Fluent no puede "
            f"mostrarse ({_IMPORT_ERROR}). Instala las dependencias "
            "con install_dependencies.ps1."
        )


def create_window(title: str, html: str, **kwargs):
    """Crea una ventana pywebview con los valores por defecto del kit."""
    require_webview()
    kwargs.setdefault("background_color", "#F3F3F3")
    return webview.create_window(title, html=html, **kwargs)


def start() -> None:
    """Arranca el bucle de ventanas (bloquea el hilo principal)."""
    require_webview()
    webview.start()
