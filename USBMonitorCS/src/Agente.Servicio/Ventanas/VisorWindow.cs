using System.Management;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using USBMonitor.Agente.Core;

namespace USBMonitor.Agente.Servicio.Ventanas;

/// <summary>
/// Visor de seriales: lista los dispositivos USB presentes para
/// copiar un serial y llevarlo a la lista blanca del panel.
///
/// La consulta WMI va en segundo plano; la ventana solo pinta el
/// resultado. Se cubren los discos USB, los móviles WPD, las
/// unidades ópticas USB y los adaptadores de red USB, como en la
/// detección amplia del agente.
/// </summary>
public sealed class VisorWindow : Window
{
    private readonly Registrador _log = Registro.Obtener("visor");
    private readonly DataGrid _tabla;
    private readonly TextBlock _estado;
    private readonly Button _botonActualizar;
    private readonly Button _botonCopiar;
    private List<FilaDispositivo> _filas = new();
    private bool _consultando;

    public VisorWindow()
    {
        Title = "NorthStar USB — Seriales de dispositivos";
        Width = 720;
        Height = 460;
        MinWidth = 600;
        MinHeight = 360;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Tema.AplicarVentana(this);

        var raiz = new Grid { Margin = new Thickness(18, 6, 18, 18) };
        raiz.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        raiz.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        raiz.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var titular = Tema.TitularVentana(
            "Dispositivos conectados",
            "Copia el serial de un dispositivo para agregarlo a la lista blanca.");
        Grid.SetRow(titular, 0);
        raiz.Children.Add(titular);

        _tabla = new DataGrid { Style = Tema.EstiloDataGrid() };
        _tabla.ColumnHeaderStyle = EstiloCabeceraTabla();
        _tabla.Columns.Add(new DataGridTextColumn
        {
            Header = "NOMBRE",
            Binding = new System.Windows.Data.Binding(nameof(FilaDispositivo.Nombre)),
            Width = new DataGridLength(1, DataGridLengthUnitType.Star)
        });
        _tabla.Columns.Add(new DataGridTextColumn
        {
            Header = "SERIAL",
            Binding = new System.Windows.Data.Binding(nameof(FilaDispositivo.Serial)),
            Width = new DataGridLength(230)
        });
        _tabla.Columns.Add(new DataGridTextColumn
        {
            Header = "LETRA",
            Binding = new System.Windows.Data.Binding(nameof(FilaDispositivo.Letra)),
            Width = new DataGridLength(70)
        });
        _tabla.Columns.Add(new DataGridTextColumn
        {
            Header = "TIPO",
            Binding = new System.Windows.Data.Binding(nameof(FilaDispositivo.Tipo)),
            Width = new DataGridLength(105)
        });
        _tabla.MouseDoubleClick += (_, _) => CopiarSerialSeleccionado();
        _tabla.SelectionChanged += (_, _) =>
        {
            if (_botonCopiar is not null)
            {
                _botonCopiar.IsEnabled = _tabla.SelectedItem is FilaDispositivo;
            }
        };

        var tarjeta = Tema.Tarjeta(_tabla, new Thickness(0, 4, 0, 12), new Thickness(0));
        Grid.SetRow(tarjeta, 1);
        raiz.Children.Add(tarjeta);

        var filaInferior = new StackPanel();
        var botones = new WrapPanel();
        _botonActualizar = Tema.BotonSecundario("Actualizar");
        _botonActualizar.Click += async (_, _) => await RefrescarAsync();
        botones.Children.Add(_botonActualizar);

        _botonCopiar = Tema.BotonPrimario("Copiar serial");
        _botonCopiar.Margin = new Thickness(0);
        _botonCopiar.IsEnabled = false;
        _botonCopiar.Click += (_, _) => CopiarSerialSeleccionado();
        botones.Children.Add(_botonCopiar);
        filaInferior.Children.Add(botones);

        _estado = new TextBlock
        {
            Text = "Consultando…",
            FontFamily = Tema.FuenteTexto,
            FontSize = 12,
            Foreground = Tema.TintaAtenuada,
            Margin = new Thickness(0, 9, 0, 0)
        };
        filaInferior.Children.Add(_estado);

        Grid.SetRow(filaInferior, 2);
        raiz.Children.Add(filaInferior);

        Content = raiz;
        Loaded += async (_, _) => await RefrescarAsync();
    }

    private static Style EstiloCabeceraTabla()
    {
        var estilo = new Style(typeof(DataGridColumnHeader));
        estilo.Setters.Add(new Setter(Control.BackgroundProperty, Tema.SuperficieAtenuada));
        estilo.Setters.Add(new Setter(Control.ForegroundProperty, Tema.Tinta));
        estilo.Setters.Add(new Setter(Control.BorderBrushProperty, Tema.Borde));
        estilo.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(0, 0, 1, 1)));
        estilo.Setters.Add(new Setter(Control.FontFamilyProperty, Tema.FuenteTexto));
        estilo.Setters.Add(new Setter(Control.FontSizeProperty, 11.5));
        estilo.Setters.Add(new Setter(Control.FontWeightProperty, FontWeights.SemiBold));
        estilo.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(8, 6, 8, 6)));
        return estilo;
    }

    private async Task RefrescarAsync()
    {
        if (_consultando)
        {
            return;
        }
        _consultando = true;
        _botonActualizar.IsEnabled = false;
        _estado.Text = "Consultando dispositivos…";

        try
        {
            _filas = await Task.Run(EnumerarDispositivos);
            _tabla.ItemsSource = _filas;
            _botonCopiar.IsEnabled = _tabla.SelectedItem is FilaDispositivo;

            _estado.Text = _filas.Count == 0
                ? "Sin dispositivos vigilables conectados."
                : $"{_filas.Count} dispositivo(s) · actualizado a las {DateTime.Now:HH:mm:ss}";
        }
        catch (Exception ex)
        {
            _estado.Text = $"No se pudieron enumerar los dispositivos: {ex.Message}";
            _log.Excepcion("El visor no pudo enumerar dispositivos", ex);
        }
        finally
        {
            _consultando = false;
            _botonActualizar.IsEnabled = true;
        }
    }

    private void CopiarSerialSeleccionado()
    {
        if (_tabla.SelectedItem is not FilaDispositivo fila)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(fila.Serial) || fila.Serial == "—")
        {
            Tema.AvisarError("Ese dispositivo no reporta serial.", "Sin serial");
            return;
        }

        try
        {
            Clipboard.SetText(fila.Serial.Trim());
            _estado.Text = $"Serial copiado: {fila.Serial.Trim()}";
            _log.Info($"Serial copiado desde el visor: {fila.Serial.Trim()}");
        }
        catch (Exception ex)
        {
            Tema.AvisarError($"No se pudo copiar el serial: {ex.Message}", "Portapapeles");
            _log.Excepcion("El visor no pudo copiar el serial", ex);
        }
    }

    // ── Enumeración WMI (hilo de fondo) ──────────────────────────

    private static List<FilaDispositivo> EnumerarDispositivos()
    {
        var filas = new List<FilaDispositivo>();
        EnumerarDiscos(filas);
        EnumerarMoviles(filas);
        EnumerarOpticas(filas);
        EnumerarRedUsb(filas);

        return filas
            .GroupBy(f => $"{f.Tipo}|{f.Serial}|{f.Nombre}|{f.Letra}")
            .Select(g => g.First())
            .OrderBy(f => f.Tipo, StringComparer.OrdinalIgnoreCase)
            .ThenBy(f => f.Nombre, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void EnumerarDiscos(List<FilaDispositivo> filas)
    {
        using var buscador = new ManagementObjectSearcher(
            "SELECT Name, Model, SerialNumber, PNPDeviceID, InterfaceType " +
            "FROM Win32_DiskDrive");
        using ManagementObjectCollection discos = buscador.Get();

        foreach (ManagementObject disco in discos)
        {
            string pnp = Texto(disco, "PNPDeviceID");
            string interfaz = Texto(disco, "InterfaceType");
            bool esUsb = interfaz.Equals("USB", StringComparison.OrdinalIgnoreCase) ||
                pnp.StartsWith("USBSTOR", StringComparison.OrdinalIgnoreCase);
            if (!esUsb)
            {
                continue;
            }

            string nombre = Texto(disco, "Model");
            if (string.IsNullOrWhiteSpace(nombre))
            {
                nombre = Texto(disco, "Name");
            }

            filas.Add(new FilaDispositivo(
                Nombre: string.IsNullOrWhiteSpace(nombre) ? "Disco USB" : nombre.Trim(),
                Serial: NormalizarSerial(Texto(disco, "SerialNumber")),
                Letra: ObtenerLetra(disco),
                Tipo: "Disco"));
        }
    }

    private static string ObtenerLetra(ManagementObject disco)
    {
        try
        {
            foreach (ManagementObject particion in disco.GetRelated("Win32_DiskPartition"))
            {
                foreach (ManagementObject logica in particion.GetRelated("Win32_LogicalDisk"))
                {
                    string letra = Texto(logica, "DeviceID");
                    if (!string.IsNullOrWhiteSpace(letra))
                    {
                        return letra.Trim();
                    }
                }
            }
        }
        catch
        {
            // Un disco sin letra sigue siendo visible por su serial.
        }
        return "—";
    }

    private static void EnumerarMoviles(List<FilaDispositivo> filas)
    {
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT Name, PNPDeviceID FROM Win32_PnPEntity WHERE PNPClass = 'WPD'");
            using ManagementObjectCollection moviles = buscador.Get();

            foreach (ManagementObject movil in moviles)
            {
                string pnp = Texto(movil, "PNPDeviceID");
                // Solo WPD por USB: fuera los volúmenes de
                // almacenamiento (su «serial» sería un GUID inútil).
                if (!pnp.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase))
                    continue;
                filas.Add(new FilaDispositivo(
                    Nombre: Texto(movil, "Name") is { Length: > 0 } n ? n : "Móvil",
                    Serial: NormalizarSerial(SegmentoFinal(pnp)),
                    Letra: "—",
                    Tipo: "Móvil"));
            }
        }
        catch
        {
            // Sin clase WPD en esta máquina: no hay móviles que mostrar.
        }
    }

    private static void EnumerarOpticas(List<FilaDispositivo> filas)
    {
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT Name, Drive, PNPDeviceID FROM Win32_CDROMDrive");
            using ManagementObjectCollection unidades = buscador.Get();

            foreach (ManagementObject unidad in unidades)
            {
                string pnp = Texto(unidad, "PNPDeviceID");
                if (!pnp.Contains("USB", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string letra = Texto(unidad, "Drive");
                filas.Add(new FilaDispositivo(
                    Nombre: Texto(unidad, "Name") is { Length: > 0 } n ? n : "Unidad óptica USB",
                    Serial: NormalizarSerial(SegmentoFinal(pnp)),
                    Letra: string.IsNullOrWhiteSpace(letra) ? "—" : letra,
                    Tipo: "Óptica"));
            }
        }
        catch
        {
            // Consulta auxiliar: su fallo no oculta discos ni móviles.
        }
    }

    private static void EnumerarRedUsb(List<FilaDispositivo> filas)
    {
        try
        {
            using var buscador = new ManagementObjectSearcher(
                "SELECT Name, PNPDeviceID, PhysicalAdapter FROM Win32_NetworkAdapter");
            using ManagementObjectCollection adaptadores = buscador.Get();

            foreach (ManagementObject adaptador in adaptadores)
            {
                string pnp = Texto(adaptador, "PNPDeviceID");
                bool fisico = adaptador.Properties["PhysicalAdapter"]?.Value is bool b && b;
                if (!fisico || !pnp.StartsWith(@"USB\", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                filas.Add(new FilaDispositivo(
                    Nombre: Texto(adaptador, "Name") is { Length: > 0 } n ? n : "Red USB",
                    Serial: NormalizarSerial(SegmentoFinal(pnp)),
                    Letra: "—",
                    Tipo: "Red"));
            }
        }
        catch
        {
            // Consulta auxiliar.
        }
    }

    private static string Texto(ManagementObject objeto, string propiedad)
    {
        try
        {
            return objeto.Properties[propiedad]?.Value?.ToString()?.Trim() ?? string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string SegmentoFinal(string instancia)
    {
        if (string.IsNullOrWhiteSpace(instancia))
        {
            return string.Empty;
        }
        string[] partes = instancia.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        return partes.Length == 0 ? string.Empty : partes[^1];
    }

    private static string NormalizarSerial(string serial)
    {
        string limpio = (serial ?? string.Empty).Trim().TrimEnd('_');
        return string.IsNullOrWhiteSpace(limpio) ? "—" : limpio;
    }

    public sealed record FilaDispositivo(
        string Nombre,
        string Serial,
        string Letra,
        string Tipo);
}
