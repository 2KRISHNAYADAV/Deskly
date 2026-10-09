# Deskly Goodbye Screen · v1.0.5
# Launched by the NSIS uninstaller before wiping app data.
# Uses PowerShell WPF — no Electron dependency, runs on all Windows 10/11 systems.

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

[xml]$xaml = @'
<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    Width="500" Height="320"
    WindowStartupLocation="CenterScreen"
    WindowStyle="None"
    ResizeMode="NoResize"
    AllowsTransparency="False"
    Background="#000000"
    Topmost="True"
    UseLayoutRounding="True"
    SnapsToDevicePixels="True">
    <Grid>

        <!-- ── Top gradient accent line (signature linear/vercel touch) ── -->
        <Rectangle Height="2" VerticalAlignment="Top">
            <Rectangle.Fill>
                <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                    <GradientStop Color="#3b82f6" Offset="0"/>
                    <GradientStop Color="#818cf8" Offset="0.5"/>
                    <GradientStop Color="#8b5cf6" Offset="1"/>
                </LinearGradientBrush>
            </Rectangle.Fill>
        </Rectangle>

        <!-- ── Aurora orb — upper-left (blue) ── -->
        <Ellipse Width="430" Height="270"
                 HorizontalAlignment="Left" VerticalAlignment="Top"
                 Margin="-115,-95,0,0" Opacity="0.18">
            <Ellipse.Fill>
                <RadialGradientBrush>
                    <GradientStop Color="#3b82f6" Offset="0"/>
                    <GradientStop Color="#00000000" Offset="1"/>
                </RadialGradientBrush>
            </Ellipse.Fill>
            <Ellipse.Effect>
                <BlurEffect Radius="55"/>
            </Ellipse.Effect>
        </Ellipse>

        <!-- ── Aurora orb — lower-right (violet) ── -->
        <Ellipse Width="370" Height="370"
                 HorizontalAlignment="Right" VerticalAlignment="Bottom"
                 Margin="0,0,-115,-115" Opacity="0.14">
            <Ellipse.Fill>
                <RadialGradientBrush>
                    <GradientStop Color="#8b5cf6" Offset="0"/>
                    <GradientStop Color="#00000000" Offset="1"/>
                </RadialGradientBrush>
            </Ellipse.Fill>
            <Ellipse.Effect>
                <BlurEffect Radius="65"/>
            </Ellipse.Effect>
        </Ellipse>

        <!-- ── Main content ── -->
        <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">

            <!-- Logo: ambient glow orb + icon container -->
            <Grid HorizontalAlignment="Center" Margin="0,0,0,22">

                <!-- Soft indigo ambient glow behind icon -->
                <Ellipse Width="90" Height="90" HorizontalAlignment="Center" Opacity="0.38">
                    <Ellipse.Fill>
                        <RadialGradientBrush>
                            <GradientStop Color="#6366f1" Offset="0"/>
                            <GradientStop Color="#00000000" Offset="1"/>
                        </RadialGradientBrush>
                    </Ellipse.Fill>
                    <Ellipse.Effect>
                        <BlurEffect Radius="20"/>
                    </Ellipse.Effect>
                </Ellipse>

                <!-- Icon container — dark frosted surface with indigo glow shadow -->
                <Border Width="70" Height="70" CornerRadius="18"
                        HorizontalAlignment="Center" BorderThickness="1">
                    <Border.Background>
                        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                            <GradientStop Color="#07070f" Offset="0"/>
                            <GradientStop Color="#0d0a1c" Offset="1"/>
                        </LinearGradientBrush>
                    </Border.Background>
                    <Border.BorderBrush>
                        <SolidColorBrush Color="#1e2130"/>
                    </Border.BorderBrush>
                    <Border.Effect>
                        <DropShadowEffect Color="#6366f1" BlurRadius="14"
                                          Opacity="0.28" ShadowDepth="0"/>
                    </Border.Effect>
                    <Image x:Name="LogoImage" Width="46" Height="46"
                           RenderOptions.BitmapScalingMode="HighQuality"/>
                </Border>

            </Grid>

            <!-- Title -->
            <TextBlock Text="See you soon." FontSize="25" FontWeight="SemiBold"
                       Foreground="#FFFFFF" HorizontalAlignment="Center"
                       FontFamily="Segoe UI Variable Display, Segoe UI"
                       TextOptions.TextFormattingMode="Display"
                       Margin="0,0,0,10"/>

            <!-- Subtitle -->
            <TextBlock Text="Thanks for using Deskly Academic Edition." FontSize="13"
                       Foreground="#6b7280" HorizontalAlignment="Center"
                       FontFamily="Segoe UI Variable Text, Segoe UI"
                       TextOptions.TextFormattingMode="Display"
                       Margin="0,0,0,5"/>

            <!-- Caption -->
            <TextBlock Text="Your vault data remains safe on this machine." FontSize="12"
                       Foreground="#374151" HorizontalAlignment="Center"
                       FontFamily="Segoe UI Variable Text, Segoe UI"
                       TextOptions.TextFormattingMode="Display"
                       Margin="0,0,0,34"/>

            <!-- Progress rail -->
            <Border Width="220" Height="2" CornerRadius="1"
                    Background="#0d1117" HorizontalAlignment="Center"
                    ClipToBounds="True">
                <Border x:Name="BarFill" HorizontalAlignment="Left"
                        Height="2" Width="0" CornerRadius="1">
                    <Border.Background>
                        <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                            <GradientStop Color="#3b82f6" Offset="0"/>
                            <GradientStop Color="#a5b4fc" Offset="0.55"/>
                            <GradientStop Color="#c4b5fd" Offset="1"/>
                        </LinearGradientBrush>
                    </Border.Background>
                </Border>
            </Border>

        </StackPanel>

        <!-- Brand tag — bottom right, barely visible -->
        <TextBlock Text="deskly.app" FontSize="11"
                   FontFamily="Segoe UI" Foreground="#1a1f2e"
                   HorizontalAlignment="Right" VerticalAlignment="Bottom"
                   TextOptions.TextFormattingMode="Display"
                   Margin="0,0,18,14"/>

    </Grid>
</Window>
'@

try {
    $reader   = New-Object System.Xml.XmlNodeReader $xaml
    $window   = [System.Windows.Markup.XamlReader]::Load($reader)
    $barFill  = $window.FindName('BarFill')
    $logoImg  = $window.FindName('LogoImage')

    $window.Add_Loaded({

        # ── Load the real Deskly icon ──────────────────────────────────────
        $iconPath = Join-Path $PSScriptRoot "icon.png"
        if ((Test-Path $iconPath) -and ($null -ne $logoImg)) {
            try {
                $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
                $bmp.BeginInit()
                $bmp.UriSource    = New-Object System.Uri ("file:///" + $iconPath.Replace('\', '/'))
                $bmp.CacheOption  = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
                $bmp.DecodePixelWidth = 92   # 2× the display size — crisp on HiDPI
                $bmp.EndInit()
                $bmp.Freeze()
                $logoImg.Source = $bmp
            } catch { }
        }

        # ── Animate progress bar 0 → 220 px over 3 s (CubicEase EaseInOut) ─
        $anim          = New-Object System.Windows.Media.Animation.DoubleAnimation
        $anim.From     = 0
        $anim.To       = 220
        $anim.Duration = New-Object System.Windows.Duration ([System.TimeSpan]::FromSeconds(3))
        $ease          = New-Object System.Windows.Media.Animation.CubicEase
        $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseInOut
        $anim.EasingFunction = $ease
        $barFill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $anim)

        # ── Auto-close after 3.6 s ────────────────────────────────────────
        $script:timer          = New-Object System.Windows.Threading.DispatcherTimer
        $script:timer.Interval = [System.TimeSpan]::FromMilliseconds(3600)
        $script:timer.Add_Tick({
            $script:timer.Stop()
            $window.Close()
        })
        $script:timer.Start()
    })

    $null = $window.ShowDialog()
} catch {
    # Silent failure — uninstall continues regardless
}
