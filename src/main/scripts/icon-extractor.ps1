# Windows Icon Extractor - Robust & Comprehensive
# Extracts icons for Win32, UWP, PWA, and all app types
# Returns base64 PNG data URI or "NOTFOUND"

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName
)

# Load required assemblies
Add-Type -AssemblyName System.Drawing

# Clean app name for matching
$cleanName = $AppName.ToLower() -replace '\.exe$', ''

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

function Convert-IconToBase64 {
    param([System.Drawing.Icon]$Icon)
    
    if ($null -eq $Icon) { return $null }
    
    try {
        $bitmap = $Icon.ToBitmap()
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $base64 = [System.Convert]::ToBase64String($stream.ToArray())
        $stream.Dispose()
        $bitmap.Dispose()
        $Icon.Dispose()
        return "data:image/png;base64,$base64"
    }
    catch {
        return $null
    }
}

function Convert-ImageToBase64 {
    param([string]$ImagePath)
    
    if (-not $ImagePath -or -not (Test-Path $ImagePath)) { return $null }
    
    try {
        $bitmap = [System.Drawing.Bitmap]::FromFile($ImagePath)
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $result = "data:image/png;base64," + [System.Convert]::ToBase64String($stream.ToArray())
        $stream.Dispose()
        $bitmap.Dispose()
        return $result
    }
    catch {
        return $null
    }
}

function Get-IconFromExe {
    param([string]$ExePath)
    
    if (-not $ExePath -or -not (Test-Path $ExePath)) { return $null }
    
    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
        return Convert-IconToBase64 -Icon $icon
    }
    catch {
        return $null
    }
}

function Get-IconFromShortcut {
    param([string]$LnkPath)
    
    if (-not (Test-Path $LnkPath)) { return $null }
    
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($LnkPath)
        $targetPath = $shortcut.TargetPath
        $iconLocation = $shortcut.IconLocation
        
        # Try icon location first (format: "path,index")
        if ($iconLocation -and $iconLocation -ne ",0" -and $iconLocation.Length -gt 2) {
            $parts = $iconLocation -split ','
            $iconPath = $parts[0].Trim()
            if ($iconPath -and (Test-Path $iconPath)) {
                $result = Get-IconFromExe -ExePath $iconPath
                if ($result) { return $result }
            }
        }
        
        # Try target path
        if ($targetPath -and (Test-Path $targetPath) -and $targetPath.EndsWith('.exe')) {
            return Get-IconFromExe -ExePath $targetPath
        }
        
        return $null
    }
    catch {
        return $null
    }
    finally {
        if ($shell) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null }
    }
}

function Search-StartMenuForApp {
    param([string]$SearchName)
    
    $searchPaths = @(
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
        "$env:LOCALAPPDATA\Microsoft\Windows\Start Menu\Programs",
        # Chrome/Edge PWA shortcuts
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Chrome Apps",
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Edge Apps"
    )
    
    # Build search patterns - include partial matches
    $patterns = @("*$SearchName*")
    
    foreach ($basePath in $searchPaths) {
        if (-not (Test-Path $basePath)) { continue }
        
        foreach ($pattern in $patterns) {
            $shortcuts = Get-ChildItem -Path $basePath -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
                Where-Object { $_.BaseName -like $pattern }
            
            foreach ($shortcut in $shortcuts) {
                $result = Get-IconFromShortcut -LnkPath $shortcut.FullName
                if ($result) { return $result }
            }
        }
    }
    
    return $null
}

function Get-RunningProcessPath {
    param([string]$ProcessName)
    
    try {
        # Try exact match first
        $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | 
            Where-Object { $_.Path } | 
            Select-Object -First 1
        
        if ($proc -and $proc.Path) {
            return $proc.Path
        }
        
        # Try partial match
        $proc = Get-Process -ErrorAction SilentlyContinue | 
            Where-Object { $_.ProcessName -like "*$ProcessName*" -and $_.Path } |
            Select-Object -First 1
        
        if ($proc -and $proc.Path) {
            return $proc.Path
        }
    }
    catch { }
    
    return $null
}

function Get-UWPAppIcon {
    param([string]$AppName)
    
    try {
        # Get all UWP packages
        $packages = Get-AppxPackage -ErrorAction SilentlyContinue | 
            Where-Object { 
                $_.Name -like "*$AppName*" -or 
                $_.PackageFamilyName -like "*$AppName*" 
            }
        
        foreach ($package in $packages) {
            $installLocation = $package.InstallLocation
            if (-not $installLocation -or -not (Test-Path $installLocation)) { continue }
            
            $manifestPath = Join-Path $installLocation "AppxManifest.xml"
            if (-not (Test-Path $manifestPath)) { continue }
            
            try {
                [xml]$manifest = Get-Content $manifestPath -ErrorAction SilentlyContinue
                
                # Try to get logo from manifest
                $logoPath = $null
                if ($manifest.Package.Properties.Logo) {
                    $logoPath = $manifest.Package.Properties.Logo
                }
                elseif ($manifest.Package.Applications.Application.VisualElements) {
                    $visualElements = $manifest.Package.Applications.Application.VisualElements
                    $logoPath = $visualElements.Square44x44Logo
                    if (-not $logoPath) { $logoPath = $visualElements.Square150x150Logo }
                    if (-not $logoPath) { $logoPath = $visualElements.Logo }
                }
                
                if (-not $logoPath) { continue }
                
                $fullLogoPath = Join-Path $installLocation $logoPath
                $dir = [System.IO.Path]::GetDirectoryName($fullLogoPath)
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($fullLogoPath)
                $ext = [System.IO.Path]::GetExtension($fullLogoPath)
                
                # Try various scale variants (prefer higher quality)
                $variants = @(
                    (Join-Path $dir "$baseName.targetsize-256$ext"),
                    (Join-Path $dir "$baseName.targetsize-256_altform-unplated$ext"),
                    (Join-Path $dir "$baseName.scale-200$ext"),
                    (Join-Path $dir "$baseName.targetsize-96$ext"),
                    (Join-Path $dir "$baseName.targetsize-64$ext"),
                    (Join-Path $dir "$baseName.targetsize-48$ext"),
                    (Join-Path $dir "$baseName.scale-100$ext"),
                    $fullLogoPath
                )
                
                # Also search Assets folder
                $assetsDir = Join-Path $installLocation "Assets"
                if (Test-Path $assetsDir) {
                    $assetFiles = Get-ChildItem -Path $assetsDir -Filter "*.png" -ErrorAction SilentlyContinue |
                        Where-Object { $_.Name -like "*Square*" -or $_.Name -like "*logo*" -or $_.Name -like "*icon*" } |
                        Sort-Object Length -Descending  # Larger files usually = higher res
                    
                    foreach ($asset in $assetFiles) {
                        $variants += $asset.FullName
                    }
                }
                
                foreach ($variant in $variants) {
                    if ($variant -and (Test-Path $variant)) {
                        $result = Convert-ImageToBase64 -ImagePath $variant
                        if ($result) { return $result }
                    }
                }
            }
            catch { }
        }
    }
    catch { }
    
    return $null
}

function Search-CommonInstallPaths {
    param([string]$AppName)
    
    # Expanded list of common installation directories
    $searchPaths = @(
        # Program Files
        "C:\Program Files\$AppName",
        "C:\Program Files (x86)\$AppName",
        "C:\Program Files\$AppName\$AppName.exe",
        "C:\Program Files (x86)\$AppName\$AppName.exe",
        # User-specific
        "$env:LOCALAPPDATA\Programs\$AppName",
        "$env:LOCALAPPDATA\$AppName",
        "$env:APPDATA\$AppName",
        # Scoop
        "$env:USERPROFILE\scoop\apps\$AppName\current",
        # Chocolatey
        "C:\ProgramData\chocolatey\lib\$AppName",
        # Specific app paths
        "$env:LOCALAPPDATA\Microsoft\WindowsApps"
    )
    
    foreach ($basePath in $searchPaths) {
        if (-not (Test-Path $basePath)) { continue }
        
        # If it's a directory, search for exe files
        if (Test-Path $basePath -PathType Container) {
            $exeFiles = Get-ChildItem -Path $basePath -Filter "*.exe" -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like "*$AppName*" -or $_.BaseName -eq $AppName }
            
            foreach ($exe in $exeFiles) {
                $result = Get-IconFromExe -ExePath $exe.FullName
                if ($result) { return $result }
            }
        }
        # If it's an exe file directly
        elseif ($basePath.EndsWith('.exe')) {
            $result = Get-IconFromExe -ExePath $basePath
            if ($result) { return $result }
        }
    }
    
    return $null
}

# ═══════════════════════════════════════════════════════════════════════════════
# KNOWN APP MAPPINGS (for apps with non-standard names/locations)
# ═══════════════════════════════════════════════════════════════════════════════

$knownApps = @{
    # Browsers
    'brave' = @("$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe")
    'chrome' = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    'msedge' = @("$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    'firefox' = @("$env:ProgramFiles\Mozilla Firefox\firefox.exe", "$env:ProgramFiles (x86)\Mozilla Firefox\firefox.exe")
    'opera' = @("$env:LOCALAPPDATA\Programs\Opera\opera.exe", "$env:APPDATA\Opera Software\Opera Stable\opera.exe")
    'vivaldi' = @("$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe")
    'comet' = @("$env:LOCALAPPDATA\Comet\Comet.exe", "$env:LOCALAPPDATA\Programs\Comet\Comet.exe", "$env:LOCALAPPDATA\Perplexity\Comet\Comet.exe")
    'arc' = @("$env:LOCALAPPDATA\Arc\Application\Arc.exe", "$env:LOCALAPPDATA\Programs\Arc\Arc.exe")
    'tor' = @("$env:USERPROFILE\Desktop\Tor Browser\Browser\firefox.exe")
    'librewolf' = @("$env:ProgramFiles\LibreWolf\librewolf.exe")
    'waterfox' = @("$env:ProgramFiles\Waterfox\waterfox.exe")
    'floorp' = @("$env:ProgramFiles\Floorp\floorp.exe", "$env:LOCALAPPDATA\Floorp\floorp.exe")
    'zen' = @("$env:LOCALAPPDATA\zen\zen.exe", "$env:ProgramFiles\Zen Browser\zen.exe")
    
    # Development
    'code' = @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe", "$env:ProgramFiles\Microsoft VS Code\Code.exe")
    'cursor' = @("$env:LOCALAPPDATA\Programs\cursor\Cursor.exe")
    'sublime_text' = @("$env:ProgramFiles\Sublime Text\sublime_text.exe")
    'notepad++' = @("$env:ProgramFiles\Notepad++\notepad++.exe", "$env:ProgramFiles (x86)\Notepad++\notepad++.exe")
    'windowsterminal' = $null  # UWP - handled separately
    
    # Communication
    'discord' = @("$env:LOCALAPPDATA\Discord\Update.exe")
    'slack' = @("$env:LOCALAPPDATA\slack\slack.exe")
    'teams' = @("$env:LOCALAPPDATA\Microsoft\Teams\current\Teams.exe", "$env:LOCALAPPDATA\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams\current\Teams.exe")
    'zoom' = @("$env:APPDATA\Zoom\bin\Zoom.exe")
    'telegram' = @("$env:APPDATA\Telegram Desktop\Telegram.exe")
    'whatsapp' = @("$env:LOCALAPPDATA\WhatsApp\WhatsApp.exe")
    
    # Media & Entertainment
    'spotify' = @("$env:APPDATA\Spotify\Spotify.exe")
    'vlc' = @("$env:ProgramFiles\VideoLAN\VLC\vlc.exe", "$env:ProgramFiles (x86)\VideoLAN\VLC\vlc.exe")
    'obs64' = @("$env:ProgramFiles\obs-studio\bin\64bit\obs64.exe")
    
    # Utilities
    'explorer' = @("C:\Windows\explorer.exe")
    'snippingtool' = $null  # UWP
    'calculator' = $null    # UWP  
    'notepad' = @("C:\Windows\System32\notepad.exe", "C:\Windows\notepad.exe")
    'powershell' = @("C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
    'pwsh' = @("$env:ProgramFiles\PowerShell\7\pwsh.exe")
    'photos' = $null  # UWP
    'mspaint' = @("C:\Windows\System32\mspaint.exe")
    'paint' = @("C:\Windows\System32\mspaint.exe")
    
    # Gaming
    'steam' = @("$env:ProgramFiles (x86)\Steam\steam.exe")
    'epicgameslauncher' = @("$env:ProgramFiles (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe")
    
    # Productivity
    'word' = @("$env:ProgramFiles\Microsoft Office\root\Office16\WINWORD.EXE", "$env:ProgramFiles (x86)\Microsoft Office\root\Office16\WINWORD.EXE")
    'excel' = @("$env:ProgramFiles\Microsoft Office\root\Office16\EXCEL.EXE", "$env:ProgramFiles (x86)\Microsoft Office\root\Office16\EXCEL.EXE")
    'powerpnt' = @("$env:ProgramFiles\Microsoft Office\root\Office16\POWERPNT.EXE", "$env:ProgramFiles (x86)\Microsoft Office\root\Office16\POWERPNT.EXE")
    'outlook' = @("$env:ProgramFiles\Microsoft Office\root\Office16\OUTLOOK.EXE", "$env:ProgramFiles (x86)\Microsoft Office\root\Office16\OUTLOOK.EXE")
    'onenote' = @("$env:ProgramFiles\Microsoft Office\root\Office16\ONENOTE.EXE")
    
    # Design
    'figma' = @("$env:LOCALAPPDATA\Figma\Figma.exe")
    'photoshop' = @("$env:ProgramFiles\Adobe\Adobe Photoshop 2024\Photoshop.exe", "$env:ProgramFiles\Adobe\Adobe Photoshop CC 2023\Photoshop.exe")
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN EXTRACTION LOGIC - TRY MULTIPLE STRATEGIES
# ═══════════════════════════════════════════════════════════════════════════════

$result = $null

# Strategy 1: Check known app paths first
if ($knownApps.ContainsKey($cleanName)) {
    $paths = $knownApps[$cleanName]
    if ($null -ne $paths) {
        foreach ($knownPath in $paths) {
            # Handle wildcards in path
            if ($knownPath -like '*`**') {
                $resolvedPaths = Resolve-Path $knownPath -ErrorAction SilentlyContinue
                foreach ($resolved in $resolvedPaths) {
                    if (Test-Path $resolved) {
                        $result = Get-IconFromExe -ExePath $resolved.Path
                        if ($result) { break }
                    }
                }
            }
            elseif (Test-Path $knownPath) {
                $result = Get-IconFromExe -ExePath $knownPath
            }
            if ($result) { break }
        }
    }
    else {
        # null paths means UWP app - skip to UWP strategy
        $result = Get-UWPAppIcon -AppName $cleanName
    }
    
    if ($result) {
        Write-Output $result
        exit 0
    }
}

# Strategy 2: Check if process is running
$exePath = Get-RunningProcessPath -ProcessName $cleanName
if ($exePath) {
    $result = Get-IconFromExe -ExePath $exePath
    if ($result) {
        Write-Output $result
        exit 0
    }
}

# Strategy 3: Search Start Menu shortcuts (works for PWAs!)
$result = Search-StartMenuForApp -SearchName $cleanName
if ($result) {
    Write-Output $result
    exit 0
}

# Strategy 4: Try UWP app packages
$result = Get-UWPAppIcon -AppName $cleanName
if ($result) {
    Write-Output $result
    exit 0
}

# Strategy 5: Search common installation directories
$result = Search-CommonInstallPaths -AppName $cleanName
if ($result) {
    Write-Output $result
    exit 0
}

# No icon found
Write-Output "NOTFOUND"
exit 1
