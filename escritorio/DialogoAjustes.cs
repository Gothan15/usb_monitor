// ============================================================
//  USB Monitor — App de escritorio: diálogo de ajustes
// ============================================================
//  Lo único que se puede ajustar a mano es la dirección del
//  panel. Por defecto va en automático (la IP de la ruta
//  por defecto y el puerto del instalador, como la bandeja);
//  el campo permite fijar otra URL — por ejemplo, si la app
//  se usa desde otro PC de la red y se quiere apuntar al
//  equipo que sirve el panel. Vacío = automático.

namespace USBMonitor.Escritorio;

internal sealed class DialogoAjustes : Form
{
    private readonly TextBox _campoUrl = new();

    // La URL que el usuario dejó al aceptar (null = automática).
    internal string? UrlResultante { get; private set; }

    internal DialogoAjustes(Configuracion config)
    {
        Text = "Ajustes — USB Monitor";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(460, 178);

        // Qué se detecta solo, dicho en claro: si el campo
        // queda vacío, esta es la dirección que se usará.
        var etiquetaAuto = new Label
        {
            AutoSize = true,
            Location = new Point(16, 14),
            Text = $"Dirección automática: {DireccionPanel.UrlAutomatica()}",
        };

        var etiquetaCampo = new Label
        {
            AutoSize = true,
            Location = new Point(16, 44),
            Text = "Dirección fija (déjala vacía para usar la automática):",
        };

        _campoUrl.Location = new Point(16, 68);
        _campoUrl.Size = new Size(428, 27);
        _campoUrl.Text = config.UrlManual ?? string.Empty;
        _campoUrl.PlaceholderText = "http://192.168.1.50:3000";

        var botonAceptar = new Button
        {
            Text = "Guardar",
            Location = new Point(268, 122),
            Size = new Size(84, 32),
            DialogResult = DialogResult.OK,
        };
        var botonCancelar = new Button
        {
            Text = "Cancelar",
            Location = new Point(360, 122),
            Size = new Size(84, 32),
            DialogResult = DialogResult.Cancel,
        };

        botonAceptar.Click += (_, _) =>
        {
            var texto = _campoUrl.Text.Trim();
            if (texto.Length == 0)
            {
                // Vacío: vuelve el modo automático.
                UrlResultante = null;
                return;
            }
            // Una URL que no se entiende no se guarda: mejor
            // avisar aquí que dejar la ventana sin panel.
            if (!Uri.TryCreate(texto, UriKind.Absolute, out var uri)
                || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                MessageBox.Show(this,
                    "Esa dirección no es una URL válida (tiene que empezar por http:// o https://).",
                    "USB Monitor", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
                return;
            }
            UrlResultante = texto;
        };

        Controls.Add(etiquetaAuto);
        Controls.Add(etiquetaCampo);
        Controls.Add(_campoUrl);
        Controls.Add(botonAceptar);
        Controls.Add(botonCancelar);
        AcceptButton = botonAceptar;
        CancelButton = botonCancelar;
    }
}
